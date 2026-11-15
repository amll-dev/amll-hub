import { useCallback, useEffect, useRef, useState } from 'react';
import { LRUCache } from '$/modules/spectrogram/utils/lru-cache';
import type {
  SpectrogramWorker,
  TileGenerationParams,
  WorkerResponse,
} from '$/modules/spectrogram/workers/types';
import { spectrogramLogger } from '../logger';

const MAX_CACHED_TILES = 70;

export type TileEntry = {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  gain: number;
  paletteId: string;
};

class SpectrogramWorkerClient {
  private worker: SpectrogramWorker;
  private reqIdCounter = 0;
  private pendingRequests = new Map<
    number,
    {
      resolve: (bmp: ImageBitmap) => void;
      reject: (err: Error) => void;
    }
  >();
  private onInitCompleteCallback?: () => void;

  constructor(onInitComplete?: () => void) {
    this.onInitCompleteCallback = onInitComplete;
    this.worker = new Worker(new URL('../workers/spectrogram.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = this.handleMessage.bind(this);

    this.worker.onerror = (e: ErrorEvent) => {
      const detail = e.message ?? `${e.filename ?? '<unknown>'}:${e.lineno ?? 0}:${e.colno ?? 0}`;
      console.error(`spectrogram worker onerror: ${detail}`, e);
      spectrogramLogger.error(`频谱 Worker 启动失败：${detail}`);
    };
    this.worker.onmessageerror = (e) => {
      console.error('spectrogram worker messageerror', e);
      spectrogramLogger.error('频谱 Worker 消息无法结构化克隆');
    };
  }

  private handleMessage(event: MessageEvent<WorkerResponse>) {
    const msg = event.data;
    if (msg.type === 'INIT_COMPLETE') {
      /*
       * ⚠️ 这个分支原本只有一条 console.log，删掉日志后成了空块 ——
       * 于是 `onInitCompleteCallback` **永远不会被调用**，
       * 上层的 `isWorkerReady` 一直是 false。
       *
       * 这里必须真的触发回调，否则频谱不会开始请求瓦片。
       */
      this.onInitCompleteCallback?.();
    } else if (msg.type === 'TILE_READY') {
      const request = this.pendingRequests.get(msg.reqId);
      if (request) {
        request.resolve(msg.imageBitmap);
        this.pendingRequests.delete(msg.reqId);
      } else {
        msg.imageBitmap.close();
      }
    } else if (msg.type === 'ERROR') {
      const request = this.pendingRequests.get(msg.reqId);
      if (request) {
        spectrogramLogger.warn(`Worker Error req ${msg.reqId}:`, msg.message);
        request.reject(new Error(msg.message));
        this.pendingRequests.delete(msg.reqId);
      }
    }
  }

  public getTile(params: TileGenerationParams): Promise<ImageBitmap> {
    const reqId = this.reqIdCounter++;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(reqId, { resolve, reject });
      this.worker.postMessage({
        type: 'GET_TILE',
        reqId,
        params,
      });
    });
  }

  public initAudio(sampleRate: number, duration: number) {
    this.worker.postMessage({ type: 'INIT', sampleRate, duration });
  }

  public releaseAudio() {
    this.worker.postMessage({ type: 'RELEASE' });
  }

  public setPalette(palette: Uint8Array) {
    this.worker.postMessage({ type: 'SET_PALETTE', palette });
  }

  public terminate() {
    this.worker.terminate();
    this.pendingRequests.clear();
  }
}

/**
 * 瓦片缓存 key：必须包含所有影响像素的参数。
 * 生产侧（requestTileIfNeeded）与消费侧（计算当前 bitmap）共用这一份，
 * 否则改 gain / 尺寸后两边对不上，缓存永远命不中。
 */
export const tileCacheKey = (params: {
  tileIndex: number;
  tileWidthPx: number;
  height: number;
  gain: number;
  paletteId: string;
}) =>
  `${params.tileIndex}-w${params.tileWidthPx}-h${params.height}-g${params.gain}-p${params.paletteId}`;

export const useSpectrogramWorker = (
  pcmDataReady: boolean,
  durationInMs: number,
  paletteData: Uint8Array
) => {
  const clientRef = useRef<SpectrogramWorkerClient | null>(null);
  const [isWorkerReady, setIsWorkerReady] = useState(false);
  const tileCache = useRef<LRUCache<string, TileEntry>>(
    new LRUCache(MAX_CACHED_TILES, (_key, entry) => {
      entry.bitmap.close();
    })
  );
  const activeRequests = useRef<Set<string>>(new Set());
  // 记住上次 warn 的就绪状态：worker 未就绪时每次滚动只在「状态切换」时打一次，不再刷屏
  const warnedStateRef = useRef<string | null>(null);
  const [lastTileTimestamp, setLastTileTimestamp] = useState(0);

  const paletteDataRef = useRef(paletteData);
  useEffect(() => {
    paletteDataRef.current = paletteData;
    if (clientRef.current) {
      clientRef.current.setPalette(paletteData);
    }
  }, [paletteData]);

  useEffect(() => {
    const client = new SpectrogramWorkerClient(() => {
      setIsWorkerReady(true);
      setLastTileTimestamp(Date.now());
    });
    clientRef.current = client;

    if (paletteDataRef.current) {
      client.setPalette(paletteDataRef.current);
    }

    return () => client.terminate();
  }, []);

  useEffect(() => {
    if (pcmDataReady && clientRef.current && durationInMs > 0) {
      setIsWorkerReady(false);
      tileCache.current.clear();
      activeRequests.current.clear();

      const durationInSeconds = durationInMs / 1000;
      clientRef.current.initAudio(44100, durationInSeconds);

      if (paletteDataRef.current) {
        clientRef.current.setPalette(paletteDataRef.current);
      }
    } else if (!pcmDataReady && clientRef.current) {
      setIsWorkerReady(false);
      clientRef.current.releaseAudio();
    }
  }, [pcmDataReady, durationInMs]);

  const requestTileIfNeeded = useCallback(
    async (params: TileGenerationParams) => {
      // 这两处 early-return 以前是完全静默的：worker 没就绪时
      // 每帧都会进来然后直接 return，控制台一个字都没有，
      // 表现就是「频谱区一片灰、没有任何报错」。
      if (!clientRef.current) {
        if (warnedStateRef.current !== 'no-client') {
          console.warn('requestTileIfNeeded: worker 尚未创建');
          warnedStateRef.current = 'no-client';
        }
        return;
      }
      if (!isWorkerReady) {
        if (warnedStateRef.current !== 'not-ready') {
          console.warn('requestTileIfNeeded: worker 未就绪，跳过');
          warnedStateRef.current = 'not-ready';
        }
        return;
      }
      // 恢复正常，下次再出错时重新提示一次
      warnedStateRef.current = null;

      const cacheKey = tileCacheKey(params);
      const requestFingerprint = cacheKey;

      const cacheEntry = tileCache.current.get(cacheKey);

      const isStale =
        !cacheEntry ||
        cacheEntry.width < params.tileWidthPx ||
        cacheEntry.height !== params.height ||
        cacheEntry.gain !== params.gain ||
        cacheEntry.paletteId !== params.paletteId;

      if (isStale && !activeRequests.current.has(requestFingerprint)) {
        activeRequests.current.add(requestFingerprint);

        try {
          const bitmap = await clientRef.current.getTile(params);

          tileCache.current.set(cacheKey, {
            bitmap,
            width: params.tileWidthPx,
            height: params.height,
            gain: params.gain,
            paletteId: params.paletteId,
          });

          setLastTileTimestamp(Date.now());
        } catch (err) {
          // worker 用 `spectrogramLogger.error`（带彩色前缀）报，
          // 在一屏 console 里很容易被忽略。这里补一条裸 console.error，
          // 保证「瓦片生成失败」一定出现在控制台里。
          console.error(`生成瓦片失败 tile=${params.tileIndex}`, err);
          spectrogramLogger.error('生成频谱图瓦片失败', err);
        } finally {
          activeRequests.current.delete(requestFingerprint);
        }
      }
    },
    [isWorkerReady]
  );

  return { tileCache, requestTileIfNeeded, lastTileTimestamp, isWorkerReady };
};
