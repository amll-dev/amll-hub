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

  /**
   * 从 URL 加载音频。
   *
   * 审核页的参考音频是后端给的直链：上传音频的
   * `/api/v1/uploads/file/xxx`，或者**网易云解析出来的播放地址**。
   *
   * ## 做法：完整下载 → 交给引擎
   *
   * 整个文件先 `fetch` 成 `File`，再走 `loadMusic()`（内部
   * `decodeAudioData` 一次性解码）。**不流式播放**，理由：
   *
   *  - 时长立刻可知，歌词编辑器的时间轴/进度条不用等
   *  - 解码只有一次失败点（`decodeAudioData`），错误信息是浏览器给的，
   *    比 wasm 的 `last_error` 可读得多
   *  - 审核时经常来回拖进度、反复试听同一段，全量在手更稳
   *
   * 关于 CORS：`fetch` 确实要求对方带 `Access-Control-Allow-Origin`，
   * 但本站两条音源都满足 —— 上传音频走同源 `/api/v1/uploads/file/*`，
   * 网易云直链本身也带 CORS 头（详情页 `PlayerBoot` 早就在
   * `fetch` + `decodeAudioData` 这么用了）。
   *
   * 关于文件名：`parseAudioTrackMetadata` 靠扩展名判断音频格式，
   * 而网易云直链的 URL 里通常没有扩展名，所以从 pathname 猜一个；
   * 猜不到就用 `audio`（此时只是读不出内嵌歌名，解码不受影响）。
   */
  async loadMusicFromUrl(url: string): Promise<TTMLMetadata[]> {
    let blob: Blob;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      blob = await response.blob();
    } catch (e) {
      console.error('fetch/读取 blob 失败', e);
      throw new Error(
        `无法下载参考音频（${url.slice(0, 120)}）。原始错误：${
          e instanceof Error ? e.message : String(e)
        }`,
        { cause: e }
      );
    }

    if (blob.size === 0) {
      throw new Error(`参考音频为空（${url.slice(0, 120)}）`);
    }

    const name = audioFileNameFromUrl(url) || 'audio';
    const file = new File([blob], name, {
      type: blob.type || 'audio/*',
    });
    return this.loadMusic(file);
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
