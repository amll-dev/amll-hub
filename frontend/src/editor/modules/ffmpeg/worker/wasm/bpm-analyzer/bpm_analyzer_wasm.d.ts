/* tslint:disable */
/* eslint-disable */
/** Configuration options for the BPM analyzer. */
export interface AnalyzerOptions {
  /**
   * Audio sample rate (Hz).
   *
   * It is recommended to resample to 44100 Hz first, as the algorithm is primarily tuned for
   * 44100 Hz. Default is 44100.
   */
  sampleRate?: number;
  /** Maximum audio slice length in seconds used for Percival tempo estimation. Default is 120.0. */
  percivalMaxLengthSeconds?: number;
  /** Starting ratio offset (0.0 - 1.0) for Percival tempo estimation. Default is 0.05. */
  percivalBeginRatio?: number;
  /** Maximum audio slice length in seconds used for beat tracking. Default is 75.0. */
  beatMaxLengthSeconds?: number;
  /** Starting ratio offset (0.0 - 1.0) for beat tracking. Default is 0.3. */
  beatBeginRatio?: number;
}

/** Result of the BPM detection and beat tracking analysis. */
export interface BpmAnalysisResult {
  /** Final estimated tempo in Beats Per Minute (BPM). */
  bpm: number;
  /** Base tempo estimated by the Percival algorithm before beat tracking. */
  baseBpm: number;
  /** Anchor beat timestamp in seconds. */
  anchorTick: number;
  /** Beat tracking confidence score ranging from 0.0 to 1.0. */
  confidence: number;
  /** List of absolute beat timestamps in seconds. */
  ticks: number[];
}

/**
 * WebAssembly BPM Analyzer container managing audio sample buffers.
 */
export class BpmAnalyzer {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Runs BPM detection and beat tracking on the buffered audio, returning a JavaScript object
   * result.
   */
  analyze(): BpmAnalysisResult;
  /**
   * Creates a new `BpmAnalyzer` with a given sample buffer capacity and optional settings.
   */
  constructor(sample_capacity: number, options?: AnalyzerOptions | null);
  /**
   * Resizes the internal sample buffer capacity.
   */
  resize(new_sample_capacity: number): void;
  /**
   * Sets the active audio sample length in the buffer.
   */
  set_length(new_len: number): void;
  /**
   * Returns the capacity of the internal buffer in bytes.
   */
  readonly byte_capacity: number;
  /**
   * Returns a raw byte pointer (`u8`) to the internal audio sample buffer.
   */
  readonly byte_ptr: number;
  /**
   * Returns the active length of valid audio samples in the buffer.
   */
  readonly length: number;
  /**
   * Returns a raw pointer to the internal `f32` audio sample buffer.
   */
  readonly ptr: number;
  /**
   * Returns the maximum sample capacity (`f32` count) of the internal buffer.
   */
  readonly sample_capacity: number;
}

export function initThreadPool(num_threads: number): Promise<any>;

export class wbg_rayon_PoolBuilder {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  build(): void;
  numThreads(): number;
  receiver(): number;
}

export function wbg_rayon_start_worker(receiver: number): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly __wbg_bpmanalyzer_free: (a: number, b: number) => void;
  readonly bpmanalyzer_analyze: (a: number) => [number, number, number];
  readonly bpmanalyzer_byte_capacity: (a: number) => number;
  readonly bpmanalyzer_byte_ptr: (a: number) => number;
  readonly bpmanalyzer_length: (a: number) => number;
  readonly bpmanalyzer_new: (a: number, b: number) => [number, number, number];
  readonly bpmanalyzer_resize: (a: number, b: number) => void;
  readonly bpmanalyzer_sample_capacity: (a: number) => number;
  readonly bpmanalyzer_set_length: (a: number, b: number) => [number, number];
  readonly bpmanalyzer_ptr: (a: number) => number;
  readonly __wbg_wbg_rayon_poolbuilder_free: (a: number, b: number) => void;
  readonly initThreadPool: (a: number) => any;
  readonly wbg_rayon_poolbuilder_build: (a: number) => void;
  readonly wbg_rayon_poolbuilder_numThreads: (a: number) => number;
  readonly wbg_rayon_poolbuilder_receiver: (a: number) => number;
  readonly wbg_rayon_start_worker: (a: number) => void;
  readonly memory: WebAssembly.Memory;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_thread_destroy: (a?: number, b?: number, c?: number) => void;
  readonly __wbindgen_start: (a: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number }} module - Passing `SyncInitInput` directly is deprecated.
 * @param {WebAssembly.Memory} memory - Deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(
  module:
    | { module: SyncInitInput; memory?: WebAssembly.Memory; thread_stack_size?: number }
    | SyncInitInput,
  memory?: WebAssembly.Memory
): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number }} module_or_path - Passing `InitInput` directly is deprecated.
 * @param {WebAssembly.Memory} memory - Deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init(
  module_or_path?:
    | {
        module_or_path: InitInput | Promise<InitInput>;
        memory?: WebAssembly.Memory;
        thread_stack_size?: number;
      }
    | InitInput
    | Promise<InitInput>,
  memory?: WebAssembly.Memory
): Promise<InitOutput>;
