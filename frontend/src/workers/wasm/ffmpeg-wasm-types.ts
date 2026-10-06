/// <reference lib="webworker" />

export interface FfmpegAudioModule {
  wasmMemory: WebAssembly.Memory;
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  UTF8ToString(ptr: number, maxBytesToRead?: number, ignoreNul?: boolean): string;

  _wasm_decoder_create(mode: number, sampleRate: number, channels: number): number;
  _wasm_decoder_destroy(decoderPtr: number): number;
  _wasm_decoder_decode_frame(decoderPtr: number): number;
  _wasm_decoder_get_frame_samples(decoderPtr: number): number;
  _wasm_decoder_get_channel_ptr(decoderPtr: number, channelIndex: number): number;
  _wasm_decoder_get_duration(decoderPtr: number): number;
  _wasm_decoder_set_compute_peaks(decoderPtr: number, enable: number): number;
  _wasm_get_last_error(): number;
}

export type FfmpegAudioFactory = (config: {
  locateFile: (path: string, scriptDirectory: string) => string;
  js_get_file_size: (fileId: number) => number;
  js_read_file: (fileId: number, offset: number, length: number, bufferPtr: number) => number;
}) => Promise<FfmpegAudioModule>;
