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
    if (!pcm) {
      setBpmState({ status: 'idle' });
      rendererWorkerRef.current?.postMessage({ type: 'CLEAR' });
      return;
    }

    if (!rendererWorkerRef.current || !canvasRef.current || !wsContainerRef.current) return;

    if (analyzedSamplesRef.current === pcm.samples) {
      return;
    }
    analyzedSamplesRef.current = pcm.samples;

    if (analyzerWorkerRef.current) {
      analyzerWorkerRef.current.terminate();
      analyzerWorkerRef.current = null;
    }

    setPcmDataReady(false);
    setBpmState({ status: 'analyzing' });

    if (!offscreenTransferred.current) {
      let offscreen: OffscreenCanvas;
      try {
        offscreen = canvasRef.current.transferControlToOffscreen();
      } catch {
        // HMR 等极端时序下 canvas 已被转移过：跳过波形初始化，但不要打断播放与打轴
        offscreenTransferred.current = true;
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

    const pcmCopy = pcm.samples.slice();

    analyzerWorkerRef.current = new AnalyzerWorker();
    analyzerWorkerRef.current.onmessage = (e) => {
      if (e.data.type === 'ANALYZE_DONE') {
        setPcmDataReady(true);
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
        analyzerWorkerRef.current?.terminate();
        analyzerWorkerRef.current = null;
      } else if (e.data.type === 'ANALYZE_ERROR') {
        setBpmState({
          status: 'error',
          error: e.data.payload?.error || 'Unknown analysis error',
        });
        analyzerWorkerRef.current?.terminate();
        analyzerWorkerRef.current = null;
      }
    };

    analyzerWorkerRef.current.postMessage(
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
