export interface FfmpegAudioConfig {
  locateFile?: (path: string, scriptDirectory: string) => string;
  js_get_file_size: (fileId: number) => number;
  js_read_file: (fileId: number, offset: number, length: number, bufferPtr: number) => number;
}

export interface FfmpegAudioModule {
  wasmMemory: WebAssembly.Memory;
  HEAP8: Int8Array;
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  HEAPU16: Uint16Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
  UTF8ToString(ptr: number, maxBytesToRead?: number, ignoreNul?: boolean): string;

  /** 创建解码器。mode=1 为流式解码，返回指针，0 表示失败 */
  _wasm_decoder_create(mode: number, sampleRate: number, channels: number): number;
  _wasm_decoder_destroy(decoderPtr: number): number;
  /** 解下一帧：1=有数据，0=EOF，-1=损坏帧 */
  _wasm_decoder_decode_frame(decoderPtr: number): number;
  _wasm_decoder_get_frame_samples(decoderPtr: number): number;
  _wasm_decoder_get_frame_min(decoderPtr: number): number;
  _wasm_decoder_get_frame_max(decoderPtr: number): number;
  /** 某声道的 PCM 在wasm 堆里的地址（零拷贝视图） */
  _wasm_decoder_get_channel_ptr(decoderPtr: number, channelIndex: number): number;
  _wasm_decoder_get_duration(decoderPtr: number): number;
  _wasm_decoder_seek(decoderPtr: number, targetSeconds: number): number;
  _wasm_decoder_set_compute_peaks(decoderPtr: number, enable: number): number;
  _wasm_get_last_error(): number;
}

export default function createFFmpegAudio(config: FfmpegAudioConfig): Promise<FfmpegAudioModule>;
