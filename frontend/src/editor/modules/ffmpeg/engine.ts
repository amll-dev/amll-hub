import { AudioRenderer } from './core';
import { PcmFeeder } from './core/pcm-feeder';
import {
  allocateAudioQueueMemory,
  createAudioWriter,
  createMainController,
  type MainAudioController,
} from './queue';
import {
  type EngineConfig,
  type EngineError,
  EngineErrorCode,
  type EngineErrorCodeValue,
  type EngineEventMap,
  type DecodedPcm,
  type EngineState,
  type PlayerCover,
  type QueueConfig,
} from './types';
import { getErrorMessage, TypedEventTarget } from './utils';

const TIMEUPDATE_INTERVAL_MS = 250;
const ASSET_FETCH_RETRY_DELAYS_MS = [0, 250, 750, 1500] as const;

/** 分析链路的标定采样率 —— STFT 与 BPM 分析器都按 44100 调过。 */
const ANALYSIS_SAMPLE_RATE = 44100;

/**
 * AudioBuffer → 44100Hz 单声道 PCM。
 *
 * 多声道先取平均降为单声道，再用线性插值重采样。对频谱/BPM 来说
 * 线性插值足够（STFT 自己还会加窗），没必要上 sinc 插值。
 */
function resampleToMono44k(buffer: AudioBuffer): Float32Array {
  const channels = Math.max(1, buffer.numberOfChannels);
  const srcRate = buffer.sampleRate;
  const srcFrames = buffer.length;
  const outFrames = Math.round((srcFrames * ANALYSIS_SAMPLE_RATE) / srcRate);
  const out = new Float32Array(outFrames);

  if (srcRate === ANALYSIS_SAMPLE_RATE && channels === 1) {
    // 已经是目标格式，直接拷贝
    out.set(buffer.getChannelData(0).subarray(0, outFrames));
    return out;
  }

  // 先混成单声道
  const mono = new Float32Array(srcFrames);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < srcFrames; i++) mono[i] += data[i];
  }
  if (channels > 1) {
    for (let i = 0; i < srcFrames; i++) mono[i] /= channels;
  }

  // 线性插值重采样
  const ratio = srcRate / ANALYSIS_SAMPLE_RATE;
  for (let i = 0; i < outFrames; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    if (idx >= srcFrames - 1) {
      out[i] = mono[srcFrames - 1] ?? 0;
      break;
    }
    const frac = pos - idx;
    out[i] = mono[idx] * (1 - frac) + mono[idx + 1] * frac;
  }
  return out;
}

const DEFAULT_QUEUE_CONFIG: Required<QueueConfig> = {
  capacitySeconds: 30.0,
  notifyWatermarkSeconds: 2.0,
  emergencyWatermarkSeconds: 0.4,
};

export class FFmpegAudioEngine extends TypedEventTarget<EngineEventMap> {
  private config: EngineConfig;
  private queueConfig: Required<QueueConfig>;
  private loadSessionId = 0;
  private renderer: AudioRenderer;
  private audioController: MainAudioController | null = null;
  private sharedBuffer: SharedArrayBuffer | null = null;
  private feeder: PcmFeeder | null = null;

  private _assetsPreloaded = false;
  private soundtouchWasmBuffer: ArrayBuffer | null = null;
  private preloadPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;

  private _state: EngineState = 'idle';
  private _duration = 0;
  private _metadata: Record<string, string> = {};
  private _cover: PlayerCover | null = null;
  private _error: EngineError | null = null;
  private _volume = 1.0;
  private _pauseAt: number | null = null;
  private baseTime = 0;

  private _tempo = 1.0;
  private _pitch = 1.0;
  private _rate = 1.0;

  /** 解码后的 PCM（44100Hz 单声道），供频谱 / 波形 / BPM 分析。 */
  private _analysisPcm: DecodedPcm | null = null;

  private timeupdateTimer: ReturnType<typeof setInterval> | null = null;
  private loadReject: ((err: { code: EngineErrorCodeValue; message: string }) => void) | null =
    null;

  constructor(config: EngineConfig) {
    super();
    this.config = config;

    this.queueConfig = {
      ...DEFAULT_QUEUE_CONFIG,
      ...config.queueConfig,
    };

    this.renderer = new AudioRenderer(
      config.audioContext,
      config.assets.workletUrl,
      config.gainNode
    );

    this.renderer.onMessage = (event) => {
      if (event.type === 'AUTO_PAUSED') {
        this.handleAutoPaused();
      }
    };
  }

  //#region Public API
  public get state(): EngineState {
    return this._state;
  }
  public get duration(): number {
    return this._duration;
  }
  public get metadata(): Record<string, string> {
    return this._metadata;
  }
  public get cover(): PlayerCover | null {
    return this._cover;
  }
  public get error(): EngineError | null {
    return this._error;
  }

  /**
   * 解码后的 PCM，供频谱 / 波形 / BPM 分析取用。
   *
   * 与播放链路分开：播放用 AudioContext 的 sampleRate（通常 48000）且
   * 保留立体声；**分析用 44100Hz 单声道**，因为 STFT 与 BPM 分析器都按
   * 44100 标定。未就绪时为 `null`。
   */
  public get analysisPcm(): DecodedPcm | null {
    return this._analysisPcm;
  }

  public get volume(): number {
    return this._volume;
  }
  public set volume(val: number) {
    if (!Number.isFinite(val)) {
      console.warn('Invalid volume value ignored', val);
      return;
    }

    this._volume = Math.max(0, Math.min(1, val));

    if (this.config.gainNode) {
      const ctx = this.config.audioContext;
      this.config.gainNode.gain.setTargetAtTime(this._volume, ctx.currentTime, 0.1);
    }
  }

  public get currentTime(): number {
    if (!this.audioController) return 0;
    return this.baseTime + this.audioController.getPlaybackIndex() / this.renderer.sampleRate;
  }
  public set currentTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      console.warn('AudioEngine: Invalid currentTime value ignored', seconds);
      return;
    }

    if (this._state !== 'ready' && this._state !== 'playing' && this._state !== 'paused') {
      return;
    }

    this.audioController?.setSeeking(true);

    this.baseTime = seconds;

    /*
     * 关键：seek 光标挪了，但**灌数据的 feeder 也得知道**——
     * 否则它还在从旧位置往环里写，播出来的是错的音频。
     */
    this.feeder?.seek(seconds, this.renderer.sampleRate);

    this.syncPauseAtToAudioController();
  }

  /**
   * 自动暂停的目标时间（绝对秒）。seek 不会取消它，传`null` 取消。
   */
  public set pauseAt(second: number | null) {
    if (second !== null && (!Number.isFinite(second) || second < 0)) {
      console.warn('Invalid pauseAt value ignored', second);
      return;
    }

    this._pauseAt = second;
    this.syncPauseAtToAudioController();
  }
  public get pauseAt(): number | null {
    return this._pauseAt;
  }

  public get tempo(): number {
    return this._tempo;
  }
  public set tempo(val: number) {
    if (!Number.isFinite(val)) {
      console.warn('Invalid tempo value ignored', val);
      return;
    }

    this._tempo = Math.max(0.1, val);
    this.renderer.setTempo(this._tempo);
  }

  public get pitch(): number {
    return this._pitch;
  }
  public set pitch(val: number) {
    if (!Number.isFinite(val)) {
      console.warn('Invalid pitch value ignored', val);
      return;
    }

    this._pitch = Math.max(0.1, val);
    this.renderer.setPitch(this._pitch);
  }

  public get rate(): number {
    return this._rate;
  }
  public set rate(val: number) {
    if (!Number.isFinite(val)) {
      console.warn('Invalid rate value ignored', val);
      return;
    }

    this._rate = Math.max(0.1, val);
    this.renderer.setRate(this._rate);
  }

  /**
   * 预加载 wasm 资源。
   *
   * SoundTouch 只影响 pitch / tempo / rate，**不影响能否播放** ——
   * 拉不到时降级为「不变调」，而不是让整个引擎起不来。
   */
  public async preloadAssets(): Promise<void> {
    if (this._assetsPreloaded) {
      return;
    }

    if (this.preloadPromise) {
      return this.preloadPromise;
    }

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.preloadPromise = (async () => {
      try {
        const [stWasmBuffer] = await Promise.all([
          this.fetchAndValidateWasm(this.config.assets.soundtouchWasmUrl, signal).catch((e) => {
            console.warn('SoundTouch wasm 加载失败，变调功能不可用', e);
            return null;
          }),
          this.pingResource(this.config.assets.workletUrl, signal),
        ]);

        this.soundtouchWasmBuffer = stWasmBuffer;
        this._assetsPreloaded = true;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          return;
        }
        const msg = getErrorMessage(e);
        this.handleError(EngineErrorCode.Network, `Asset preload failed: ${msg}`);
        throw e;
      } finally {
        this.preloadPromise = null;
      }
    })();

    return this.preloadPromise;
  }

  /**
   * 主线程解码音频并装载到回放队列。
   */
  public async loadFile(file: File): Promise<void> {
    if (!this._assetsPreloaded) {
      await this.preloadAssets();
    }

    const currentSessionId = ++this.loadSessionId;
    this.reset();

    this._state = 'loading';
    this._analysisPcm = null;

    const channels = this.renderer.maxChannels;
    const sampleRate = this.renderer.sampleRate;

    try {
      await this.renderer.initialize(channels);

      if (this.loadSessionId !== currentSessionId) {
        return;
      }

      this.sharedBuffer = allocateAudioQueueMemory(sampleRate, channels, this.queueConfig);

      this.audioController = createMainController(this.sharedBuffer);

      await this.renderer.bindQueue(
        this.sharedBuffer,
        channels,
        this._tempo,
        this._pitch,
        this._rate,
        // SoundTouch 缺失时 worklet 退化为直通
        this.soundtouchWasmBuffer ?? new ArrayBuffer(0)
      );

      if (this.loadSessionId !== currentSessionId) {
        return;
      }

      // ── 唯一的解码点：主线程 decodeAudioData ──
      const arrayBuffer = await file.arrayBuffer();

      if (this.loadSessionId !== currentSessionId) {
        return;
      }

      const audioBuffer = await this.config.audioContext.decodeAudioData(arrayBuffer);

      if (this.loadSessionId !== currentSessionId) {
        return;
      }

      /*
       * 分析用PCM：**单声道 + 44100Hz**。
       * 播放链路用 AudioContext 的 sampleRate（通常 48000）且立体声，
       * 而 STFT 与 BPM 分析器都按 44100 标定，所以这里必须重采样。
       */
      this._analysisPcm = {
        samples: resampleToMono44k(audioBuffer),
        sampleRate: ANALYSIS_SAMPLE_RATE,
        duration: audioBuffer.duration,
      };

      // 播放：把 AudioBuffer 灌进环里
      this.feeder = new PcmFeeder(createAudioWriter(this.sharedBuffer), () => this.handleEnded());
      this.feeder.setBuffer(audioBuffer);

      this._duration = audioBuffer.duration;
      this._metadata = {};
      this._cover = null;
      this._state = 'ready';
      this.dispatch('loadedmetadata');
    } catch (e) {
      const msg = getErrorMessage(e);
      this.handleError(EngineErrorCode.Decode, `Engine initialization failed: ${msg}`);
      throw e;
    }
  }

  public async play(): Promise<void> {
    if (this._state !== 'ready' && this._state !== 'paused') {
      return;
    }
    if (!this.audioController) {
      return;
    }

    await this.renderer.resumeContext();

    this._state = 'playing';
    this.audioController.play();
    /*
     * 必须同时驱动 feeder —— 它才是真正往 SharedArrayBuffer 环里写 PCM 的那个。
     * 只放audioController 的话环是空的，worklet 一直读到 0，静默无声。
     */
    this.feeder?.play();
    this.startTimeupdate();
    this.dispatch('play');
  }

  public pause(): void {
    if (this._state !== 'playing') {
      return;
    }
    if (!this.audioController) {
      return;
    }

    this._state = 'paused';
    this.audioController.pause();
    this.feeder?.pause();
    this.stopTimeupdate();
    this.dispatch('pause');
  }

  public destroy(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.stopTimeupdate();
    this.feeder?.destroy();
    this.feeder = null;
    this.renderer.destroyNode();
    this.sharedBuffer = null;
    this.audioController = null;
    this.resetState();
    this._state = 'idle';
    this.soundtouchWasmBuffer = null;
    this._assetsPreloaded = false;
  }

  private reset(): void {
    this.stopTimeupdate();
    this.audioController?.pause();
    this.feeder?.destroy();
    this.feeder = null;
    this.sharedBuffer = null;
    this.audioController = null;
    this.resetState();
    this._state = 'idle';
  }
  //#endregion

  //#region Internal Callbacks & Utils
  private async fetchAndValidateWasm(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
    const resp = await this.fetchResource(url, signal);
    if (!resp.ok) {
      throw new Error(`Failed to load WASM (HTTP ${resp.status} - ${resp.statusText}): ${url}`);
    }

    const buffer = await resp.arrayBuffer();

    if (buffer.byteLength < 4) {
      throw new Error(`File too small to be a valid WASM: ${url}`);
    }
    const view = new DataView(buffer);
    const magic = view.getUint32(0, false);
    if (magic !== 0x0061736d /* \0asm */) {
      throw new Error(
        `Invalid WASM magic number detected. Server might have returned a 404 HTML page for: ${url}`
      );
    }

    return buffer;
  }

  private async pingResource(url: string, signal: AbortSignal): Promise<void> {
    const resp = await this.fetchResource(url, signal);
    if (!resp.ok) {
      throw new Error(`Failed to load resource (HTTP ${resp.status}): ${url}`);
    }
    await resp.arrayBuffer();
  }

  private async fetchResource(url: string, signal: AbortSignal): Promise<Response> {
    let lastError: unknown;

    for (const [attempt, delayMs] of ASSET_FETCH_RETRY_DELAYS_MS.entries()) {
      if (delayMs > 0) {
        await this.waitForRetry(delayMs, signal);
      }

      try {
        const response = await fetch(url, { signal });
        if (response.ok || response.status < 500) {
          return response;
        }
        lastError = new Error(`HTTP ${response.status} - ${response.statusText}`);
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }
        lastError = error;
      }

      if (attempt < ASSET_FETCH_RETRY_DELAYS_MS.length - 1) {
        console.warn(`Audio asset request failed, retrying: ${url}`, lastError);
      }
    }

    throw new Error(
      `Failed to fetch audio asset after ${ASSET_FETCH_RETRY_DELAYS_MS.length} attempts: ${url}. ${getErrorMessage(lastError)}`
    );
  }

  private waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      return Promise.reject(new DOMException('Asset preload aborted', 'AbortError'));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', handleAbort);
        resolve();
      }, delayMs);
      const handleAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('Asset preload aborted', 'AbortError'));
      };
      signal.addEventListener('abort', handleAbort, { once: true });
    });
  }

  /** PCM 灌完（整首放完）后收尾。 */
  private handleEnded(): void {
    this.stopTimeupdate();
    this.audioController?.pause();
    this._state = 'ready';
    this.dispatch('ended');
  }

  private handleError(code: EngineErrorCodeValue, message: string): void {
    this._error = { code, message };
    this.stopTimeupdate();
    this._state = 'idle';

    if (this.loadReject) {
      this.loadReject({ code, message });
      this.loadReject = null;
    }

    this.dispatch('error', { code, message });
  }

  private handleAutoPaused(): void {
    this._pauseAt = null;

    if (this._state !== 'playing') return;

    this._state = 'paused';
    this.audioController?.pause();
    // feeder 也要停，否则它会继续往环里灌数据，白耗 CPU
    this.feeder?.pause();

    this.stopTimeupdate();
    this.dispatch('pause');
  }

  private syncPauseAtToAudioController(): void {
    if (!this.audioController) return;

    if (this._pauseAt === null) {
      this.audioController.clearPauseAtIndex();
    } else {
      let relativeTargetFrames = Math.floor(
        (this._pauseAt - this.baseTime) * this.renderer.sampleRate
      );
      relativeTargetFrames = Math.max(0, relativeTargetFrames);

      this.audioController.setPauseAtIndex(relativeTargetFrames);
    }
  }

  private startTimeupdate(): void {
    this.stopTimeupdate();
    this.timeupdateTimer = setInterval(() => {
      this.dispatch('timeupdate');
    }, TIMEUPDATE_INTERVAL_MS);
  }

  private stopTimeupdate(): void {
    if (this.timeupdateTimer !== null) {
      clearInterval(this.timeupdateTimer);
      this.timeupdateTimer = null;
    }
  }

  private resetState(): void {
    this._error = null;
    this._metadata = {};
    this._cover = null;
    this._duration = 0;
    this.baseTime = 0;
    this._analysisPcm = null;

    if (this.loadReject) {
      this.loadReject({
        code: EngineErrorCode.Aborted,
        message: 'Loading aborted by subsequent operation',
      });
      this.loadReject = null;
    }
  }
  //#endregion
}
