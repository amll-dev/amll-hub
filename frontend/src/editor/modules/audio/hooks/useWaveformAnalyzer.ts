import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { bpmStateAtom, decodedPcmAtom, pcmDataReadyAtom } from '$/modules/audio/states';
import AnalyzerWorker from '$/modules/ffmpeg/worker/analyzer.worker.ts?worker';
import RendererWorker from '$/modules/ffmpeg/worker/renderer.worker.ts?worker';

interface UseWaveformAnalyzerProps {
  wsContainerRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  sliderWidthPx: number;
  engineState: string;
}
export const useWaveformAnalyzer = ({
  wsContainerRef,
  canvasRef,
  sliderWidthPx,
  engineState,
}: UseWaveformAnalyzerProps) => {
  const setPcmDataReady = useSetAtom(pcmDataReadyAtom);
  const setBpmState = useSetAtom(bpmStateAtom);
  const pcm = useAtomValue(decodedPcmAtom);

  const analyzerWorkerRef = useRef<Worker | null>(null);
  const rendererWorkerRef = useRef<Worker | null>(null);
  const offscreenTransferred = useRef(false);
  const analyzedSamplesRef = useRef<Float32Array | null>(null);
  /** 延迟销毁句柄 */
  const destroyTimerRef = useRef<number | null>(null);
  /** pcmDataReady 兜底定时器：analyzer 永不回消息时强制放行频谱 */
  const pcmDataReadyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (destroyTimerRef.current !== null) {
      window.clearTimeout(destroyTimerRef.current);
      destroyTimerRef.current = null;
    }
    // 复用上一轮（StrictMode 假卸载）创建的 worker，避免 canvas 已经 transfer 过去却没有接收方
    if (!rendererWorkerRef.current) {
      rendererWorkerRef.current = new RendererWorker();
    }

    return () => {
      destroyTimerRef.current = window.setTimeout(() => {
        destroyTimerRef.current = null;
        if (pcmDataReadyTimeoutRef.current !== null) {
          window.clearTimeout(pcmDataReadyTimeoutRef.current);
          pcmDataReadyTimeoutRef.current = null;
        }
        analyzerWorkerRef.current?.terminate();
        analyzerWorkerRef.current = null;
        rendererWorkerRef.current?.terminate();
        rendererWorkerRef.current = null;
        // 只有真正卸载（canvas 随之销毁）才允许下次挂载重新 transfer
        offscreenTransferred.current = false;
        // pcm 存在全局 atom 里，重挂载会命中缓存；不清掉会导致波形不重绘
        analyzedSamplesRef.current = null;
      }, 0);
    };
  }, []);

  useEffect(() => {
    const clearReadyTimeout = () => {
      if (pcmDataReadyTimeoutRef.current !== null) {
        window.clearTimeout(pcmDataReadyTimeoutRef.current);
        pcmDataReadyTimeoutRef.current = null;
      }
    };
    // 无论正常/错误/异常路径都用它放行 latch，避免频谱永久停在「正在解码音频」
    const markPcmReady = () => {
      clearReadyTimeout();
      setPcmDataReady(true);
    };
    const failAnalysis = (err: unknown) => {
      markPcmReady();
      setBpmState({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    };

    if (!pcm) {
      clearReadyTimeout();
      setBpmState({ status: 'idle' });
      rendererWorkerRef.current?.postMessage({ type: 'CLEAR' });
      return;
    }

    if (!rendererWorkerRef.current || !canvasRef.current || !wsContainerRef.current) return;

    // StrictMode 二次 mount 命中缓存：上一轮已 setPcmDataReady(false)，
    // 这里必须恢复 latch，否则频谱开发环境一进编辑器就永久空白。
    if (analyzedSamplesRef.current === pcm.samples) {
      markPcmReady();
      return;
    }
    analyzedSamplesRef.current = pcm.samples;

    if (analyzerWorkerRef.current) {
      analyzerWorkerRef.current.terminate();
      analyzerWorkerRef.current = null;
    }

    // 开新分析前清掉上一轮遗留的兜底定时器
    clearReadyTimeout();
    setPcmDataReady(false);
    setBpmState({ status: 'analyzing' });

    // analyzer 若因 wasm 初始化 hang / OPFS 死锁 / CSP 等永不回消息，
    // 15s 后强制放行频谱，避免「正在解码音频」永久停留。
    pcmDataReadyTimeoutRef.current = window.setTimeout(() => {
      pcmDataReadyTimeoutRef.current = null;
      setPcmDataReady(true);
    }, 15000);

    if (!offscreenTransferred.current) {
      let offscreen: OffscreenCanvas;
      try {
        offscreen = canvasRef.current.transferControlToOffscreen();
      } catch {
        // HMR 等极端时序下 canvas 已被转移过：跳过波形初始化，但不要打断播放与打轴
        offscreenTransferred.current = true;
        markPcmReady();
        return;
      }
      const styles = getComputedStyle(wsContainerRef.current);
      const waveColor = styles.getPropertyValue('--accent-a4').trim() || '#00ffa21e';

      rendererWorkerRef.current.postMessage(
        {
          type: 'INIT_CANVAS',
          payload: {
            canvas: offscreen,
            width: wsContainerRef.current.clientWidth,
            height: wsContainerRef.current.clientHeight,
            dpr: window.devicePixelRatio || 1,
            color: waveColor,
          },
        },
        [offscreen]
      );
      offscreenTransferred.current = true;
    }

    rendererWorkerRef.current.postMessage({ type: 'CLEAR' });

    const mc = new MessageChannel();
    rendererWorkerRef.current.postMessage({ type: 'NEW_PORT', payload: { port: mc.port2 } }, [
      mc.port2,
    ]);

    // 交给 worker 时 transfer 会 neuter 掉原 buffer，而 atom 里的 pcm.samples
    // 还要给频谱侧继续用，所以必须复制一份。代价是峰值多占一份 PCM
    //（44100 × 300s × 4B ≈ 53MB）；要真正省掉它得把解码缓冲改成
    // SharedArrayBuffer（需要 COOP/COEP 隔离），属于另一个量级的改造。
    const pcmCopy = pcm.samples.slice();

    let worker: Worker;
    try {
      worker = new AnalyzerWorker();
    } catch (err) {
      // CSP / worker 资源 404 等：构造抛错，worker 永远不会回消息
      console.error('[WaveformAnalyzer] 创建分析 Worker 失败:', err);
      failAnalysis(err);
      return;
    }
    analyzerWorkerRef.current = worker;

    worker.onmessage = (e) => {
      if (e.data.type === 'ANALYZE_DONE') {
        markPcmReady();
        if (e.data.payload?.bpmResult) {
          setBpmState({
            status: 'completed',
            result: e.data.payload.bpmResult,
            calculationTime: e.data.payload.calculationTime,
          });
        } else if (e.data.payload?.error) {
          setBpmState({ status: 'error', error: e.data.payload.error });
        }

        // 分析完销毁以便腾出内存
        worker.terminate();
        if (analyzerWorkerRef.current === worker) analyzerWorkerRef.current = null;
      } else if (e.data.type === 'ANALYZE_ERROR') {
        // 错误分支也放行 latch，让频谱尝试 OPFS 兜底，而不是彻底罢工
        markPcmReady();
        setBpmState({
          status: 'error',
          error: e.data.payload?.error || 'Unknown analysis error',
        });
        worker.terminate();
        if (analyzerWorkerRef.current === worker) analyzerWorkerRef.current = null;
      }
    };

    // worker 脚本加载失败 / worker 内未捕获异常：构造不一定抛错，靠 onerror 兜底
    worker.onerror = (e) => {
      console.error('[WaveformAnalyzer] 分析 Worker 运行错误:', e.message);
      failAnalysis(new Error(e.message || 'Analyzer worker error'));
      worker.terminate();
      if (analyzerWorkerRef.current === worker) analyzerWorkerRef.current = null;
    };

    try {
      worker.postMessage(
        {
          type: 'INIT',
          payload: {
            pcm: pcmCopy,
            sampleRate: pcm.sampleRate,
            port: mc.port1,
          },
        },
        [mc.port1, pcmCopy.buffer]
      );
    } catch (err) {
      // DataCloneError 等：INIT 没发出去，worker 永远不会回消息
      console.error('[WaveformAnalyzer] 发送 INIT 失败:', err);
      failAnalysis(err);
      worker.terminate();
      if (analyzerWorkerRef.current === worker) analyzerWorkerRef.current = null;
    }

    return () => {
      clearReadyTimeout();
    };
  }, [pcm, setPcmDataReady, setBpmState, canvasRef, wsContainerRef]);

  // 处理窗口大小变化并触发防抖重绘
  useEffect(() => {
    if (sliderWidthPx > 0 && rendererWorkerRef.current && wsContainerRef.current) {
      const timeoutId = setTimeout(() => {
        if (!wsContainerRef.current || !rendererWorkerRef.current) return;
        const styles = getComputedStyle(wsContainerRef.current);
        const waveColor = styles.getPropertyValue('--accent-a4').trim() || '#00ffa21e';

        rendererWorkerRef.current.postMessage({
          type: 'RESIZE',
          payload: {
            width: sliderWidthPx,
            height: wsContainerRef.current.clientHeight,
            dpr: window.devicePixelRatio || 1,
            color: waveColor,
          },
        });
      }, 1000);
      return () => clearTimeout(timeoutId);
    }
  }, [sliderWidthPx, wsContainerRef]);

  // 如果音频引擎销毁了，或者音频引擎出错了，清空掉波形图
  useEffect(() => {
    if (engineState === 'idle' && rendererWorkerRef.current) {
      rendererWorkerRef.current.postMessage({ type: 'CLEAR' });
    }
  }, [engineState]);
};
