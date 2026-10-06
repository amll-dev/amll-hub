/**
 * Queue memory allocation and buffer watermark configuration (based on seconds)
 */
export interface QueueConfig {
  /** Total capacity of the circular buffer (seconds) */
  capacitySeconds: number;
  /** Notification watermark to trigger decoder wakeup (seconds) */
  notifyWatermarkSeconds: number;
  /** Emergency watermark; decoder wakes up immediately and unconditionally if below this value (seconds) */
  emergencyWatermarkSeconds: number;
}

/**
 * Configuration required to initialize the audio engine.
 */
export interface EngineConfig {
  /**
   * The AudioContext injected by the host environment.
   */
  audioContext: AudioContext;

  /**
   * Injected GainNode for volume control
   */
  gainNode?: GainNode;

  assets: {
    workletUrl: string;
    soundtouchWasmUrl: string;
  };

  queueConfig?: Partial<QueueConfig>;
}

/**
 * Represents the current playback state of the engine.
 */
export type EngineState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused';

export const EngineErrorCode = {
  Aborted: 1,
  Network: 2,
  Decode: 3,
  SrcNotSupported: 4,
} as const;

export type EngineErrorCodeValue = (typeof EngineErrorCode)[keyof typeof EngineErrorCode];

/**
 * Structure for engine-level errors.
 *
 * The error codes are aligned with the HTML5 MediaError standard
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaError)
 */
export interface EngineError {
  code: EngineErrorCodeValue;
  message: string;
}

/**
 * Structure for extracted cover art data.
 */
export interface PlayerCover {
  bytes: ArrayBuffer;
  mime: string | null;
}

/**
 * 频谱 / 波形 / BPM 分析用的单声道 PCM。
 *
 * 与播放链路分开：播放用 AudioContext 的 sampleRate（通常 48000）且保留
 * 立体声；分析用 44100Hz 单声道，因为 STFT 与 BPM 分析器都按 44100 标定。
 */
export interface DecodedPcm {
  /** 单声道 Float32 PCM，44100Hz */
  samples: Float32Array;
  sampleRate: number;
  /** 秒 */
  duration: number;
}

/**
 * Event map matching the DOM CustomEvent style.
 */
export interface EngineEventMap {
  play: CustomEvent<void>;
  pause: CustomEvent<void>;
  loadedmetadata: CustomEvent<void>;
  timeupdate: CustomEvent<void>;
  ended: CustomEvent<void>;
  error: CustomEvent<EngineError>;
}
