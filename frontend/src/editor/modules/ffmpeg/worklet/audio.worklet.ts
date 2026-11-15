import './polyfill.ts';
import { type AudioReader, createAudioReader } from '../queue';
import { getErrorMessage } from '../utils';
import type { WorkletCommand, WorkletEvent } from './types';
import initWasm, { SoundTouchProcessor } from './wasm/soundtouch';

const WORKLET_BLOCK_SIZE = 128;

class FFmpegAudioProcessor extends AudioWorkletProcessor {
  private audioReader: AudioReader | null = null;
  private stProcessor: SoundTouchProcessor | null = null;
  private wasmMemory: WebAssembly.Memory | null = null;

  private channels: number = 2;
  private currentTempo: number = 1.0;
  private currentRate: number = 1.0;
  private playbackFractional: number = 0.0;
  private lastSeekGeneration: number = 0;
  private inputChunkSize: number = 0;
  /** process() 里复用的 wasm 内存视图，INIT 时预分配，避免音频线程每块 new */
  private inputViews: Float32Array[] = [];
  private outputViews: Float32Array[] = [];
  private viewsBuffer: ArrayBufferLike | null = null;
  /** INIT 可能因为编辑器重挂而连发两次；只让最后一次生效，避免两个 wasm 实例交错 */
  private initSeq = 0;

  constructor() {
    super();

    this.port.onmessage = async (event: MessageEvent<WorkletCommand>) => {
      const data = event.data;

      if (data.type === 'INIT') {
        const seq = ++this.initSeq;
        if (this.stProcessor) {
          this.stProcessor.free();
          this.stProcessor = null;
        }

        const { sharedBuffer, channels, wasmBytes, initId, tempo, pitch, rate } = data.payload;

        try {
          this.channels = channels;
          this.audioReader = createAudioReader(sharedBuffer);

          const wasmInstance = await initWasm({ module_or_path: wasmBytes });
          // 等待 wasm 实例化期间可能又来了一条 INIT；旧实例的结果必须丢弃，
          // 否则两条 INIT 会各自覆盖 wasmMemory / stProcessor / viewsBuffer，
          // 留下指向已 detach buffer 的视图。
          if (seq !== this.initSeq) return;
          this.wasmMemory = wasmInstance.memory;

          this.stProcessor = new SoundTouchProcessor(channels, sampleRate);

          this.stProcessor.setTempo(tempo);
          this.stProcessor.setPitch(pitch);
          this.stProcessor.setRate(rate);

          this.currentTempo = tempo;
          this.currentRate = rate;

          this.inputChunkSize = this.stProcessor.getInputChunkSize();
          this.allocateViews();

          this.postEvent({
            type: 'INIT_DONE',
            payload: { initId },
          });
        } catch (e) {
          console.error('worklet INIT_ERROR', e);
          this.postEvent({
            type: 'INIT_ERROR',
            payload: {
              initId,
              message: getErrorMessage(e),
            },
          });
        }
      } else if (data.type === 'SET_TEMPO' && this.stProcessor) {
        this.stProcessor.setTempo(data.payload.tempo);
        this.currentTempo = data.payload.tempo;
      } else if (data.type === 'SET_PITCH' && this.stProcessor) {
        this.stProcessor.setPitch(data.payload.pitch);
      } else if (data.type === 'SET_RATE' && this.stProcessor) {
        this.stProcessor.setRate(data.payload.rate);
        this.currentRate = data.payload.rate;
      } else if (data.type === 'DESTROY') {
        if (this.stProcessor) {
          this.stProcessor.free();
          this.stProcessor = null;
        }
        this.wasmMemory = null;
        this.audioReader = null;
        this.inputViews = [];
        this.outputViews = [];
        this.viewsBuffer = null;
      }
    };

    this.port.start();
  }

  private postEvent(event: WorkletEvent): void {
    this.port.postMessage(event);
  }

  /**
   * 预分配 wasm 内存上的 Float32Array 视图
   * 输入视图长度即 inputChunkSize，输出视图长度即一个 worklet 块；
   * process() 里只读改内容、复用这两个数组，不再每块 new。
   */
  private allocateViews(): void {
    const memory = this.wasmMemory;
    const processor = this.stProcessor;
    if (!memory || !processor || this.inputChunkSize <= 0) return;
    const buffer = memory.buffer;
    this.inputViews = Array.from(
      { length: this.channels },
      (_, c) => new Float32Array(buffer, processor.getInputPtr(c), this.inputChunkSize)
    );
    this.outputViews = Array.from(
      { length: this.channels },
      (_, c) => new Float32Array(buffer, processor.getOutputPtr(c), WORKLET_BLOCK_SIZE)
    );
    this.viewsBuffer = buffer;
  }

  /**
   * wasm memory 增长会 detach 旧 buffer，建在它上面的 inputViews / outputViews
   * 会立刻失效：再往里 `Float32Array.set` 就抛
   * "Cannot perform %TypedArray%.prototype.set on a detached ArrayBuffer"。
   * AudioWorklet 里未捕获异常会直接终止该 processor，表现为无声且时间轴卡住。
   */
  private refreshViewsIfNeeded(): void {
    const memory = this.wasmMemory;
    if (!memory || this.viewsBuffer === memory.buffer) return;
    this.allocateViews();
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>
  ): boolean {
    const output = outputs[0];
    this.refreshViewsIfNeeded();
    if (
      !this.audioReader ||
      !this.stProcessor ||
      !this.wasmMemory ||
      this.inputChunkSize === 0 ||
      !output ||
      !output[0] ||
      this.inputViews.length !== this.channels ||
      this.outputViews.length !== this.channels
    ) {
      this.fillSilence(output ?? [], WORKLET_BLOCK_SIZE);
      return true;
    }

    const isCurrentlySeeking = this.audioReader.isSeeking();
    const currentSeekGeneration = this.audioReader.getSeekGeneration();

    if (this.lastSeekGeneration !== currentSeekGeneration) {
      this.stProcessor.clear();
      this.playbackFractional = 0.0;
      this.lastSeekGeneration = currentSeekGeneration;
    }

    if (!this.audioReader.isPlaying() || isCurrentlySeeking) {
      this.fillSilence(output, WORKLET_BLOCK_SIZE);
      return true;
    }

    const targetPauseIndex = this.audioReader.getPauseAtIndex();
    let remainingSourceFrames = Infinity;
    let isHittingTarget = false;

    if (targetPauseIndex !== -1) {
      const exactCurrentIndex = this.audioReader.getPlaybackIndex() + this.playbackFractional;
      remainingSourceFrames = targetPauseIndex - exactCurrentIndex;

      if (remainingSourceFrames <= 0) {
        this.fillSilence(output, WORKLET_BLOCK_SIZE);
        this.audioReader.clearPauseAtIndex();
        this.audioReader.pausePlayback();
        this.postEvent({ type: 'AUTO_PAUSED' });
        return true;
      }
    }

    while (this.stProcessor.numSamples() < WORKLET_BLOCK_SIZE) {
      const availableInSAB = this.audioReader.getAvailableReadFrames();
      if (availableInSAB === 0) {
        break;
      }

      // processInput 可能让 wasm 扩容。上一轮扩容后旧视图已经 detach，
      // 必须在这一次 readPartial 写入之前重建，否则异常会打死整个 worklet。
      this.refreshViewsIfNeeded();

      const readAmount = Math.min(availableInSAB, this.inputChunkSize);

      // 复用 INIT 时预分配的视图；readPartial 按 length 截断，不会越界写入
      const actualRead = this.audioReader.readPartial(this.inputViews, readAmount);

      if (actualRead > 0) {
        this.stProcessor.processInput(actualRead);
        // 扩容后立刻重建，下面取输出时用的 outputViews 也是同一块 wasm 内存
        this.refreshViewsIfNeeded();
      } else {
        break;
      }
    }

    const availableST = this.stProcessor.numSamples();
    let extractAmount = Math.min(availableST, WORKLET_BLOCK_SIZE);

    if (targetPauseIndex !== -1 && extractAmount > 0) {
      const timeRatio = this.currentTempo * this.currentRate;
      const allowedOutputFrames = Math.floor(remainingSourceFrames / timeRatio);

      if (extractAmount >= allowedOutputFrames) {
        extractAmount = Math.max(0, allowedOutputFrames);
        isHittingTarget = true;
      }
    }

    let extracted = 0;

    if (extractAmount > 0) {
      extracted = this.stProcessor.extractOutput(extractAmount);

      const actualChannels = Math.min(this.channels, output.length);
      for (let c = 0; c < actualChannels; c++) {
        const view = this.outputViews[c];
        // 复制整块（长度固定），超出的尾部随后由 fill(0, extracted) 清零，零分配
        if (view) output[c]!.set(view);
      }

      const consumedSourceFrames = extracted * this.currentTempo * this.currentRate;
      const totalToAccumulate = consumedSourceFrames + this.playbackFractional;

      const integerPart = Math.floor(totalToAccumulate);
      this.playbackFractional = totalToAccumulate - integerPart;

      if (integerPart > 0) {
        this.audioReader.addPlaybackIndex(integerPart);
      }
    }

    if (extracted < WORKLET_BLOCK_SIZE) {
      const actualChannels = Math.min(this.channels, output.length);
      for (let c = 0; c < actualChannels; c++) {
        output[c]!.fill(0, extracted);
      }
    }

    if (isHittingTarget) {
      this.audioReader.clearPauseAtIndex();
      this.audioReader.pausePlayback();
      this.postEvent({ type: 'AUTO_PAUSED' });
    }

    return true;
  }

  private fillSilence(output: Float32Array[], length: number): void {
    const actualChannels = Math.min(this.channels, output.length);
    for (let c = 0; c < actualChannels; c++) {
      output[c]!.fill(0, 0, length);
    }
  }
}

registerProcessor('ffmpeg-audio', FFmpegAudioProcessor);
