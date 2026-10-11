import {
  audioEngineStateAtom,
  audioErrorAtom,
  audioPlayingAtom,
  currentDurationAtom,
  decodedPcmAtom,
  isAuditioningAtom,
  loadedAudioAtom,
} from '$/modules/audio/states/index.ts';
import { type AudioTrackMetadata, parseAudioTrackMetadata } from '$/modules/audio/utils/index.ts';
import { FFmpegAudioEngine } from '$/modules/ffmpeg/index.ts';
import workletUrl from '$/modules/ffmpeg/worklet/audio.worklet.ts?worker&url';
import soundtouchWasmUrl from '$/modules/ffmpeg/worklet/wasm/soundtouch_bg.wasm?url';
import { globalStore } from '$/states/store.ts';
import type { TTMLMetadata } from '$/types/ttml';
import { createLogger } from '$/utils/logger';

export const audioEngineLogger = createLogger('AudioEngine');
const AUDIO_ENGINE_INSTANCE_ID = Math.random().toString(36).slice(2, 8);

function audioFileNameFromUrl(url: string): string | null {
  try {
    const { pathname } = new URL(url, 'https://example.invalid');
    const last = pathname.split('/').pop();
    if (!last) return null;
    const dot = last.lastIndexOf('.');
    if (dot < 0) return null;
    const ext = last.slice(dot + 1).toLowerCase();
    const known = new Set([
      'mp3',
      'flac',
      'wav',
      'm4a',
      'aac',
      'ogg',
      'oga',
      'opus',
      'alac',
      'ape',
      'aiff',
      'aif',
      'aifc',
      'wma',
      'mp4',
    ]);
    return known.has(ext) ? `audio.${ext}` : null;
  } catch {
    return null;
  }
}

export type { AudioTrackMetadata };

class AudioEngineWrapper extends EventTarget {
  private engine: FFmpegAudioEngine;
  private _audioTrackMetadata: AudioTrackMetadata = {
    titles: [],
    artists: [],
    albums: [],
    composers: [],
    isrcs: [],
    fileName: '',
  };

  private _loadToken = 0;
  private _inflightLoads = new Map<string, Promise<TTMLMetadata[]>>();
  private _inflightUrl: string | null = null;
  private _abortCurrent: AbortController | null = null;

  //#region Audio context basics
  private _ctx: AudioContext | null = null;
  get ctx() {
    if (this._ctx) return this._ctx;
    this._ctx = new AudioContext({
      latencyHint: 'interactive',
    });
    return this._ctx;
  }

  private gainNode: GainNode | null = null;
  private get gain() {
    if (this.gainNode) return this.gainNode;
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = 0.5;
    this.gainNode.connect(this.ctx.destination);
    return this.gainNode;
  }
  //#endregion

  //#region Progress Emitter
  private timeUpdateListeners = new Set<(time: number) => void>();
  private tickRafId: number | null = null;

  onTimeUpdate(callback: (time: number) => void) {
    this.timeUpdateListeners.add(callback);
  }

  offTimeUpdate(callback: (time: number) => void) {
    this.timeUpdateListeners.delete(callback);
  }

  private emitTimeUpdate() {
    const currentTime = this.engine.currentTime;
    this.timeUpdateListeners.forEach((fn) => {
      fn(currentTime);
    });
  }

  private tick = () => {
    if (!this.musicPlaying) return;

    this.emitTimeUpdate();

    this.tickRafId = requestAnimationFrame(this.tick);
  };

  private startTick() {
    if (this.tickRafId === null) {
      this.tickRafId = requestAnimationFrame(this.tick);
    }
  }

  private stopTick() {
    if (this.tickRafId !== null) {
      cancelAnimationFrame(this.tickRafId);
      this.tickRafId = null;
    }
  }

  private clearAuditionState() {
    if (this.engine.pauseAt !== null || globalStore.get(isAuditioningAtom)) {
      this.engine.pauseAt = null;
      globalStore.set(isAuditioningAtom, false);
    }
  }
  //#endregion

  constructor() {
    super();

    this.engine = new FFmpegAudioEngine({
      audioContext: this.ctx,
      gainNode: this.gain,
      assets: {
        workletUrl,
        soundtouchWasmUrl,
      },
    });

    this.setupEngineListeners();
  }

  private setupEngineListeners() {
    this.engine.addEventListener('play', () => {
      globalStore.set(audioPlayingAtom, true);
      globalStore.set(audioEngineStateAtom, this.engine.state);
      this.startTick();
    });

    this.engine.addEventListener('pause', () => {
      globalStore.set(audioPlayingAtom, false);
      globalStore.set(audioEngineStateAtom, this.engine.state);
      this.stopTick();
      this.emitTimeUpdate();
      this.clearAuditionState();
    });

    this.engine.addEventListener('loadedmetadata', () => {
      this.updateAudioTrackMetadata();
      globalStore.set(currentDurationAtom, (this.engine.duration * 1000) | 0);
      /**
       * 把分析用的单声道 PCM 交给频谱 / 波形 / BPM。
       *
       * 以前这条链路是自己起 ffmpeg wasm worker 再解一遍，
       * 于是「解码器起不来」会同时打掉播放、频谱、波形、BPM 四样东西。
       * 现在解码只有一处（主线程 `decodeAudioData`），
       * 频谱拿不到 PCM 时最多是自己空着，播放照旧。
       */
      globalStore.set(decodedPcmAtom, this.engine.analysisPcm);
      globalStore.set(audioEngineStateAtom, this.engine.state);

      // 打实例 ID：HMR 重新求值本模块会造出**新的** AudioEngineWrapper
      // （单例被替换），旧实例的 ready 状态组件根本看不到。
    });

    this.engine.addEventListener('timeupdate', () => {
      this.dispatchEvent(new Event('timeupdate'));
    });

    this.engine.addEventListener('ended', () => {
      globalStore.set(audioPlayingAtom, false);
      this.stopTick();
      this.emitTimeUpdate();
      this.clearAuditionState();
    });

    this.engine.addEventListener('error', (e) => {
      globalStore.set(audioEngineStateAtom, this.engine.state);
      globalStore.set(audioErrorAtom, e.detail.message);
      audioEngineLogger.error(e.detail.message);
      console.error(`engine error | instance=${AUDIO_ENGINE_INSTANCE_ID}`, e.detail);
      this.stopTick();
    });
  }

  //#region Playback APIs
  get musicLoaded() {
    return (
      this.engine.state === 'ready' ||
      this.engine.state === 'playing' ||
      this.engine.state === 'paused'
    );
  }

  get audioTrackMetadata(): AudioTrackMetadata {
    return this._audioTrackMetadata;
  }

  get cover() {
    return this.engine.cover;
  }

  get musicPlaying() {
    return this.engine.state === 'playing';
  }

  get musicCurrentTime() {
    return this.engine.currentTime;
  }

  get musicDuration() {
    return this.engine.duration;
  }

  get musicPlayBackRate() {
    return this.engine.rate;
  }
  set musicPlayBackRate(v: number) {
    this.engine.tempo = v;
  }

  get volume() {
    return this.engine.volume;
  }
  set volume(v: number) {
    this.engine.volume = v;
    this.dispatchEvent(new Event('volume-change'));
  }

  get ctxCurrentTime() {
    return this.ctx.currentTime;
  }
  get ctxBaseLatency() {
    return this.ctx.baseLatency;
  }
  get ctxOutputLatency() {
    return this.ctx.outputLatency;
  }

  playNode(node: AudioScheduledSourceNode, when?: number, stop?: number) {
    node.connect(this.gain);
    node.start(when);
    node.addEventListener('ended', () => node.disconnect());
    if (stop) node.stop(stop);
  }

  private clampMusicTime(offset: number) {
    if (!Number.isFinite(offset)) return 0;
    return Math.max(0, Math.min(offset, this.musicDuration || offset));
  }

  seekMusic(offset: number) {
    this.clearAuditionState();
    const targetTime = this.clampMusicTime(offset);

    if (!this.musicPlaying) {
      this.timeUpdateListeners.forEach((fn) => {
        fn(targetTime);
      });
    }

    this.engine.currentTime = targetTime;
  }

  async resumeMusic() {
    this.clearAuditionState();
    await this.engine.play();
  }

  pauseMusic() {
    this.engine.pause();
  }

  /**
   * 试听一个音频片段
   *
   * @param startTimeInSeconds 音频片段的开始时间
   * @param endTimeInSeconds 音频片段的结束时间
   * @returns
   */
  auditionRange(startTimeInSeconds: number, endTimeInSeconds: number) {
    if (!this.musicLoaded) {
      audioEngineLogger.warn('音频未加载, 无法预览音频');
      return;
    }

    const durationInSeconds = endTimeInSeconds - startTimeInSeconds;
    if (durationInSeconds <= 0) return;

    this.engine.pauseAt = endTimeInSeconds;
    globalStore.set(isAuditioningAtom, true);

    this.engine.currentTime = startTimeInSeconds;
    this.engine.play();
  }
  //#endregion

  //#region Load
  async loadMusic(src: File): Promise<TTMLMetadata[]> {
    if (this.musicLoaded) {
      this.pauseMusic();
    }
    this.clearAuditionState();
    globalStore.set(audioEngineStateAtom, 'loading');

    globalStore.set(loadedAudioAtom, src);
    await this.engine.loadFile(src);
    this.updateAudioTrackMetadata(src);

    return this.mapAudioMetadataToTTML();
  }

  async loadMusicFromUrl(url: string): Promise<TTMLMetadata[]> {
    const inflight = this._inflightLoads.get(url);
    if (inflight) return inflight;

    const token = ++this._loadToken;
    if (this._inflightUrl !== null && this._inflightUrl !== url) {
      this._abortCurrent?.abort();
    }
    const controller = new AbortController();
    this._abortCurrent = controller;
    this._inflightUrl = url;

    const task = (async (): Promise<TTMLMetadata[]> => {
      let blob: Blob;
      try {
        blob = await this.downloadAudioBlob(url, controller.signal);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          throw new Error('音频加载已被更新的请求取代', { cause: e });
        }
        throw new Error(
          `无法下载参考音频（${url.slice(0, 120)}）。原始错误：${
            e instanceof Error ? e.message : String(e)
          }`,
          { cause: e }
        );
      }

      if (token !== this._loadToken) {
        throw new Error('音频加载已被更新的请求取代');
      }

      if (blob.size === 0) {
        throw new Error(`参考音频为空（${url.slice(0, 120)}）`);
      }

      const name = audioFileNameFromUrl(url) || 'audio';
      const file = new File([blob], name, {
        type: blob.type || 'audio/*',
      });
      const metadata = await this.loadMusic(file);

      if (token !== this._loadToken) {
        throw new Error('音频加载已被更新的请求取代');
      }
      return metadata;
    })();

    this._inflightLoads.set(url, task);
    try {
      return await task;
    } finally {
      // 无论成功失败都摘掉在途登记，允许之后重试同一 URL。
      if (this._inflightLoads.get(url) === task) {
        this._inflightLoads.delete(url);
      }
      // 该 URL 已不再是「在途」时，同步清掉标记，避免下次误判为「切换源」。
      if (this._inflightLoads.size === 0) {
        this._inflightUrl = null;
        this._abortCurrent = null;
      }
    }
  }

  private async downloadAudioBlob(url: string, signal: AbortSignal): Promise<Blob> {
    /** 最多尝试轮次（首轮 + 续传）。按实测每次约 4~8MB 被掐断，足够拉完 20MB。 */
    const MAX_ROUNDS = 8;
    /** 每轮中断后的退避 */
    const RETRY_BACKOFF_MS = 700;

    const chunks: Uint8Array[] = [];
    let received = 0;
    let total: number | null = null;
    let contentType = 'audio/*';
    let lastError: unknown;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const startedAt = Date.now();
      try {
        const headers: Record<string, string> = {};
        // 已收部分字节时，从断点续传
        if (received > 0) headers.Range = `bytes=${received}-`;

        const response = await fetch(url, {
          signal,
          cache: 'no-store',
          credentials: 'same-origin',
          headers,
        });

        if (round === 0) {
          if (response.status === 206) {
            throw new Error('服务器返回了分段内容（206），音频未完整下载');
          }
          if (!response.ok) {
            // 4xx 是确定性失败（地址不对 / 无权限），重试无意义
            const err = new Error(`HTTP ${response.status} ${response.statusText}`);
            if (response.status >= 400 && response.status < 500) {
              (err as { retryable?: boolean }).retryable = false;
            }
            throw err;
          }
          contentType = response.headers.get('content-type') || contentType;
          const len = Number(response.headers.get('content-length'));
          total = Number.isFinite(len) && len > 0 ? len : null;
        } else if (response.status !== 206) {
          throw new Error(`续传请求未返回 206（HTTP ${response.status}）`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          // 没有可读流（极老环境）：退回一次性 blob()
          return await response.blob();
        }
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.length > 0) {
            chunks.push(value);
            received += value.length;
          }
        }

        // 服务端声明了长度却没传完：当成本轮中断，继续续传
        if (total !== null && received < total) {
          throw new Error(`响应提前结束：已收 ${received}/${total} 字节`);
        }

        const blob = new Blob(chunks as BlobPart[], { type: contentType });
        if (round > 0) {
          console.info('[audio-engine] 音频断点续传完成', {
            url,
            bytes: received,
            rounds: round + 1,
          });
        }
        return blob;
      } catch (e) {
        // 主动 abort（被更新的请求取代）不重试
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        if (e instanceof Error && (e as { retryable?: boolean }).retryable === false) throw e;
        lastError = e;
        console.warn('音频下载中断，将断点续传', {
          url,
          round: round + 1,
          received,
          total,
          ms: Date.now() - startedAt,
          error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        });
        if (round === MAX_ROUNDS - 1) break;
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      }
    }
    console.error('音频下载重试全部失败', { url, received, total, error: lastError });
    throw lastError;
  }

  private mapAudioMetadataToTTML(): TTMLMetadata[] {
    const mapping: { key: keyof AudioTrackMetadata; targetKey: string }[] = [
      { key: 'titles', targetKey: 'musicName' },
      { key: 'artists', targetKey: 'artists' },
      { key: 'albums', targetKey: 'album' },
      { key: 'composers', targetKey: 'songwriter' },
      { key: 'isrcs', targetKey: 'isrc' },
    ];

    const result: TTMLMetadata[] = [];
    for (const { key, targetKey } of mapping) {
      const values = this._audioTrackMetadata[key];
      if (Array.isArray(values) && values.length > 0) {
        result.push({
          key: targetKey,
          value: [...values],
        });
      }
    }
    return result;
  }
  //#endregion

  private updateAudioTrackMetadata(file?: File) {
    this._audioTrackMetadata = parseAudioTrackMetadata(this.engine.metadata || {}, file);
  }
}

export const audioEngine = new AudioEngineWrapper();
