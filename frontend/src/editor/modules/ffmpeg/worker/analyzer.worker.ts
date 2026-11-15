import { getErrorMessage } from '../utils';
import initBpmWasm, {
  type BpmAnalysisResult,
  BpmAnalyzer,
  type InitOutput,
  initThreadPool,
} from './wasm/bpm-analyzer/bpm_analyzer_wasm';

let bpmWasmInstance: InitOutput | null = null;
let bpmWasmInitPromise: Promise<InitOutput> | null = null;

async function getBpmWasm(): Promise<InitOutput> {
  if (bpmWasmInstance) return bpmWasmInstance;
  if (!bpmWasmInitPromise) {
    bpmWasmInitPromise = (async () => {
      const instance = await initBpmWasm();
      await initThreadPool(navigator.hardwareConcurrency);
      return instance;
    })();
  }
  bpmWasmInstance = await bpmWasmInitPromise;
  return bpmWasmInstance;
}

/** 生成波形峰值的窗口大小（帧）。
 *
 *  原实现在 ffmpeg 每解出一帧时调一次 `_wasm_decoder_get_frame_min/max`，
 *  帧长由 ffmpeg 内部决定（通常 1024~1152）。这里固定 1024，
 *  视觉密度基本一致，且不再依赖 ffmpeg 的分帧行为。
 */
const PEAK_WINDOW = 1024;

const BATCH_TRIPLETS = 1000;
const BUFFER_SIZE = BATCH_TRIPLETS * 3;
const freePool: ArrayBuffer[] = [];
let currentBuffer: Float32Array | null = null;
let currentBufferCount = 0;
let rendererPort: MessagePort | null = null;

function getBuffer(): Float32Array {
  const ab = freePool.pop();
  if (ab) {
    return new Float32Array(ab);
  }
  return new Float32Array(BUFFER_SIZE);
}

function flushBuffer() {
  if (currentBufferCount > 0 && rendererPort && currentBuffer) {
    const count = currentBufferCount;
    const buf = currentBuffer.buffer;

    rendererPort.postMessage({ type: 'PEAKS_UPDATE', payload: { buffer: buf, count } }, [buf]);

    currentBuffer = null;
    currentBufferCount = 0;
  }
}

function pushPeak(progress: number, min: number, max: number) {
  if (!currentBuffer) {
    currentBuffer = getBuffer();
    currentBufferCount = 0;
  }

  currentBuffer[currentBufferCount++] = progress;
  currentBuffer[currentBufferCount++] = min;
  currentBuffer[currentBufferCount++] = max;

  if (currentBufferCount >= BUFFER_SIZE) {
    flushBuffer();
  }
}

let opfsAccessHandle: FileSystemSyncAccessHandle | null = null;

/**
 * 与频谱 worker 协商 OPFS 写锁的频道。
 *
 * 频谱 worker 用 `createSyncAccessHandle()` 持有 `audio_cache.pcm` 随机读瓦片，
 * 这里也要写同一个文件。同一时刻只能有一个 sync handle，所以两边靠这个
 * 频道让位：想要写的一方发 `DEMAND_LOCK`，持有方 `close()` 并回
 * `OPFS_RELEASED`。
 */
const opfsChannel = new BroadcastChannel('opfs-lock-channel');

/**
 * 从整段 PCM 算波形峰值。
 *
 * 原来这段是靠 ffmpeg 逐帧解码时顺带算 min/max（`_wasm_decoder_set_compute_peaks`）。
 * 现在 PCM 已经在主线程解码好了，这里直接扫一遍 —— 没有 wasm、没有解码器，
 * 也就不存在「解码器起不来 → 波形永远不出来」的连坐。
 */
function computePeaks(pcm: Float32Array, totalSamples: number) {
  const totalWindows = Math.max(1, Math.ceil(totalSamples / PEAK_WINDOW));

  for (let w = 0; w < totalWindows; w++) {
    const start = w * PEAK_WINDOW;
    const end = Math.min(start + PEAK_WINDOW, totalSamples);

    let min = 0;
    let max = 0;
    for (let i = start; i < end; i++) {
      const v = pcm[i] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    pushPeak((w + 1) / totalWindows, min, max);
  }
  flushBuffer();
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type !== 'INIT') return;

  const { pcm, sampleRate, port } = payload as {
    pcm: Float32Array;
    sampleRate: number;
    port: MessagePort;
  };

  if (rendererPort) {
    rendererPort.onmessage = null;
  }
  rendererPort = port;
  if (rendererPort) {
    rendererPort.onmessage = (msg) => {
      if (msg.data.type === 'BUFFER_RETURN') {
        if (freePool.length < 2) {
          freePool.push(msg.data.payload);
        }
      }
    };
  }

  const totalSamples = pcm.length;

  /**
   * 波形峰值与 BPM 都是纯内存计算，完全不依赖 OPFS，必须排在
   * `createSyncAccessHandle()` 之前。原来二者串行且前置依赖 OPFS，
   * 一旦 OPFS 不可用（Safari 无 createSyncAccessHandle、隐私模式
   * navigator.storage 抛错、配额满、文件被占用），波形 + BPM 会一起连坐失效。
   */
  computePeaks(pcm, totalSamples);
  rendererPort?.postMessage({ type: 'PEAKS_FINALIZE' });

  let bpmResult: BpmAnalysisResult | null = null;
  let calculationTime = 0;
  let bpmErrorMsg: string | null = null;

  if (totalSamples > 0) {
    try {
      const wasmInstance = await getBpmWasm();
      const analyzer = new BpmAnalyzer(totalSamples, { sampleRate });

      /**
       * `byte_capacity` 是**字节**数，`pcm.byteLength` 也是字节数 ——
       * 两者同单位，可以直接取小。换成 `pcm.length`（帧数）会白读 4 倍，
       * 越界到 wasm 内存里别人的区域。
       */
      const copyBytes = Math.min(pcm.byteLength, analyzer.byte_capacity);
      const copySamples = Math.floor(copyBytes / 4);

      new Uint8Array(wasmInstance.memory.buffer, analyzer.byte_ptr, copyBytes).set(
        new Uint8Array(pcm.buffer, pcm.byteOffset, copyBytes)
      );

      analyzer.set_length(copySamples);

      const startTime = performance.now();
      bpmResult = analyzer.analyze();
      calculationTime = performance.now() - startTime;

      analyzer.free();
    } catch (bpmErr) {
      console.error('[Analyzer] BPM calculation failed:', bpmErr);
      bpmErrorMsg = getErrorMessage(bpmErr);
    }
  }

  /** 主线程收到 ANALYZE_DONE / ANALYZE_ERROR 会立刻 terminate 本 worker，
   *  所以结果消息必须在 OPFS 写入到达终态后再发，不能提前。 */
  const postResult = () => {
    if (bpmResult) {
      const { bpm, anchorTick, confidence, ticks } = bpmResult;
      self.postMessage({
        type: 'ANALYZE_DONE',
        payload: {
          bpmResult: { bpm, anchorTick, confidence, ticks },
          calculationTime,
        },
      });
    } else if (bpmErrorMsg) {
      self.postMessage({
        type: 'ANALYZE_ERROR',
        payload: { error: bpmErrorMsg },
      });
    } else {
      self.postMessage({ type: 'ANALYZE_DONE' });
    }
  };

  const closeOpfsHandle = () => {
    if (opfsAccessHandle) {
      try {
        opfsAccessHandle.close();
      } catch {
        // handle 可能已关闭，忽略
      }
      opfsAccessHandle = null;
    }
  };

  // 只有频谱瓦片需要 OPFS（随机读）。这段尽力而为，任何失败都只影响频谱，
  // 波形与 BPM 结果照常投递。
  const acquireLockAndInit = async () => {
    const rootDir = await navigator.storage.getDirectory();
    const fileHandle = await rootDir.getFileHandle('audio_cache.pcm', {
      create: true,
    });

    opfsAccessHandle = await fileHandle.createSyncAccessHandle();
    opfsAccessHandle.truncate(0);
    // PCM 落盘：频谱 worker 之后要按帧随机读这块区域。
    // 一次 write 写完 —— 原来的 1MB 分批缓冲是为了配合 ffmpeg 逐帧解码，
    // 现在整段 PCM 已在内存里，没有分批的必要。
    opfsAccessHandle.write(pcm, { at: 0 });
    opfsAccessHandle.flush();
    opfsAccessHandle.close();
    opfsAccessHandle = null;
  };

  try {
    await acquireLockAndInit();
    postResult();
  } catch (err) {
    /**
     * 拿不到 OPFS 写锁：频谱 worker 正持有同一个文件的 sync handle。
     *
     * 双方都是 `createSyncAccessHandle()` —— **主线程只能用
     * `createWritable()`，两者互斥**，所以这个让位协议必须由
     * 持有方（频谱 worker）响应 `DEMAND_LOCK` 并 `close()`。
     *
     * 不能吞掉这个错误当成功：吞了的话频谱会一直等一个永远不写
     * 的 PCM 区域，最后整张频谱空白且无任何报错。
     */
    if ((err as Error).name === 'NoModificationAllowedError') {
      opfsChannel.onmessage = async (e) => {
        if (e.data === 'OPFS_RELEASED') {
          opfsChannel.onmessage = null;
          try {
            await acquireLockAndInit();
          } catch (retryErr) {
            console.warn('[Analyzer] OPFS 让位后仍无法写入，频谱瓦片将不可用:', retryErr);
            closeOpfsHandle();
          }
          postResult();
        }
      };
      opfsChannel.postMessage('DEMAND_LOCK');
      return;
    }

    // 其它 OPFS 失败（不支持 / 隐私模式 / 配额 / 占用）：只降级频谱，
    // 日志带上原始错误对象，便于定位真正原因；波形与 BPM 不受影响。
    console.warn('[Analyzer] OPFS 不可用，频谱瓦片将降级（波形与 BPM 不受影响）:', err);
    closeOpfsHandle();
    postResult();
  }
};
