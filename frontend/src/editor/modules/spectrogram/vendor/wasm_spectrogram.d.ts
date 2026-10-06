/* tslint:disable */
/* eslint-disable */

export class SpectrogramConfig {
  free(): void;
  [Symbol.dispose](): void;
  constructor(
    sample_rate: number,
    fft_size: number,
    hop_length: number,
    img_width: number,
    img_height: number,
    gain: number
  );
  fft_size: number;
  gain: number;
  hop_length: number;
  img_height: number;
  img_width: number;
  sample_rate: number;
}

export function generate_spectrogram_image(
  audio_data: Float32Array,
  palette: Uint8Array,
  config: SpectrogramConfig
): Uint8Array;

export function initThreadPool(num_threads: number): Promise<any>;

export function init_thread_pool(num_threads: number): Promise<any>;

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
  readonly __wbg_get_spectrogramconfig_fft_size: (a: number) => number;
  readonly __wbg_get_spectrogramconfig_gain: (a: number) => number;
  readonly __wbg_get_spectrogramconfig_hop_length: (a: number) => number;
  readonly __wbg_get_spectrogramconfig_img_height: (a: number) => number;
  readonly __wbg_get_spectrogramconfig_img_width: (a: number) => number;
  readonly __wbg_get_spectrogramconfig_sample_rate: (a: number) => number;
  readonly __wbg_set_spectrogramconfig_fft_size: (a: number, b: number) => void;
  readonly __wbg_set_spectrogramconfig_gain: (a: number, b: number) => void;
  readonly __wbg_set_spectrogramconfig_hop_length: (a: number, b: number) => void;
  readonly __wbg_set_spectrogramconfig_img_height: (a: number, b: number) => void;
  readonly __wbg_set_spectrogramconfig_img_width: (a: number, b: number) => void;
  readonly __wbg_set_spectrogramconfig_sample_rate: (a: number, b: number) => void;
  readonly __wbg_spectrogramconfig_free: (a: number, b: number) => void;
  readonly generate_spectrogram_image: (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number
  ) => void;
  readonly spectrogramconfig_new: (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number
  ) => number;
  readonly init_thread_pool: (a: number) => number;
  readonly __wbg_wbg_rayon_poolbuilder_free: (a: number, b: number) => void;
  readonly initThreadPool: (a: number) => number;
  readonly wbg_rayon_poolbuilder_build: (a: number) => void;
  readonly wbg_rayon_poolbuilder_numThreads: (a: number) => number;
  readonly wbg_rayon_poolbuilder_receiver: (a: number) => number;
  readonly wbg_rayon_start_worker: (a: number) => void;
  readonly memory: WebAssembly.Memory;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
  readonly __wbindgen_export: (a: number, b: number) => number;
  readonly __wbindgen_export2: (a: number, b: number, c: number) => void;
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
