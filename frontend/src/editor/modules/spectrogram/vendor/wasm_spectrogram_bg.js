export class SpectrogramConfig {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    SpectrogramConfigFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_spectrogramconfig_free(ptr, 0);
  }
  /**
   * @returns {number}
   */
  get fft_size() {
    const ret = wasm.__wbg_get_spectrogramconfig_fft_size(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
   * @returns {number}
   */
  get gain() {
    const ret = wasm.__wbg_get_spectrogramconfig_gain(this.__wbg_ptr);
    return ret;
  }
  /**
   * @returns {number}
   */
  get hop_length() {
    const ret = wasm.__wbg_get_spectrogramconfig_hop_length(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
   * @returns {number}
   */
  get img_height() {
    const ret = wasm.__wbg_get_spectrogramconfig_img_height(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
   * @returns {number}
   */
  get img_width() {
    const ret = wasm.__wbg_get_spectrogramconfig_img_width(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
   * @returns {number}
   */
  get sample_rate() {
    const ret = wasm.__wbg_get_spectrogramconfig_sample_rate(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
   * @param {number} arg0
   */
  set fft_size(arg0) {
    wasm.__wbg_set_spectrogramconfig_fft_size(this.__wbg_ptr, arg0);
  }
  /**
   * @param {number} arg0
   */
  set gain(arg0) {
    wasm.__wbg_set_spectrogramconfig_gain(this.__wbg_ptr, arg0);
  }
  /**
   * @param {number} arg0
   */
  set hop_length(arg0) {
    wasm.__wbg_set_spectrogramconfig_hop_length(this.__wbg_ptr, arg0);
  }
  /**
   * @param {number} arg0
   */
  set img_height(arg0) {
    wasm.__wbg_set_spectrogramconfig_img_height(this.__wbg_ptr, arg0);
  }
  /**
   * @param {number} arg0
   */
  set img_width(arg0) {
    wasm.__wbg_set_spectrogramconfig_img_width(this.__wbg_ptr, arg0);
  }
  /**
   * @param {number} arg0
   */
  set sample_rate(arg0) {
    wasm.__wbg_set_spectrogramconfig_sample_rate(this.__wbg_ptr, arg0);
  }
  /**
   * @param {number} sample_rate
   * @param {number} fft_size
   * @param {number} hop_length
   * @param {number} img_width
   * @param {number} img_height
   * @param {number} gain
   */
  constructor(sample_rate, fft_size, hop_length, img_width, img_height, gain) {
    const ret = wasm.spectrogramconfig_new(
      sample_rate,
      fft_size,
      hop_length,
      img_width,
      img_height,
      gain
    );
    this.__wbg_ptr = ret;
    SpectrogramConfigFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
}
if (Symbol.dispose) SpectrogramConfig.prototype[Symbol.dispose] = SpectrogramConfig.prototype.free;

/**
 * @param {Float32Array} audio_data
 * @param {Uint8Array} palette
 * @param {SpectrogramConfig} config
 * @returns {Uint8Array}
 */
export function generate_spectrogram_image(audio_data, palette, config) {
  const ptr0 = passArrayF32ToWasm0(audio_data, wasm.__wbindgen_malloc);
  const len0 = WASM_VECTOR_LEN;
  const ptr1 = passArray8ToWasm0(palette, wasm.__wbindgen_malloc);
  const len1 = WASM_VECTOR_LEN;
  _assertClass(config, SpectrogramConfig);
  const ret = wasm.generate_spectrogram_image(ptr0, len0, ptr1, len1, config.__wbg_ptr);
  if (ret[3]) {
    throw takeFromExternrefTable0(ret[2]);
  }
  var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
  wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
  return v3;
}
export function __wbg___wbindgen_throw_344f42d3211c4765(arg0, arg1) {
  throw new Error(getStringFromWasm0(arg0, arg1));
}
export function __wbg_new_b667d279fd5aa943(arg0, arg1) {
  const ret = new Error(getStringFromWasm0(arg0, arg1));
  return ret;
}
export function __wbindgen_init_externref_table() {
  const table = wasm.__wbindgen_externrefs;
  const offset = table.grow(4);
  table.set(0, undefined);
  table.set(offset + 0, undefined);
  table.set(offset + 1, null);
  table.set(offset + 2, true);
  table.set(offset + 3, false);
}

export const memory = new WebAssembly.Memory({ initial: 18, maximum: 16384, shared: true });
const SpectrogramConfigFinalization =
  typeof FinalizationRegistry === 'undefined'
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) => wasm.__wbg_spectrogramconfig_free(ptr, 1));

function _assertClass(instance, klass) {
  if (!(instance instanceof klass)) {
    throw new Error(`expected instance of ${klass.name}`);
  }
}

function getArrayU8FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
  if (
    cachedFloat32ArrayMemory0 === null ||
    cachedFloat32ArrayMemory0.buffer !== wasm.memory.buffer
  ) {
    cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
  }
  return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
  return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.buffer !== wasm.memory.buffer) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 1, 1) >>> 0;
  getUint8ArrayMemory0().set(arg, ptr / 1);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 4, 4) >>> 0;
  getFloat32ArrayMemory0().set(arg, ptr / 4);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}

function takeFromExternrefTable0(idx) {
  const value = wasm.__wbindgen_externrefs.get(idx);
  wasm.__externref_table_dealloc(idx);
  return value;
}

let cachedTextDecoder =
  typeof TextDecoder !== 'undefined'
    ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true })
    : undefined;
if (cachedTextDecoder) cachedTextDecoder.decode();

const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
  numBytesDecoded += len;
  if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
    cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
    cachedTextDecoder.decode();
    numBytesDecoded = len;
  }
  return cachedTextDecoder.decode(getUint8ArrayMemory0().slice(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasm;
export function __wbg_set_wasm(val) {
  wasm = val;
}
