/* @ts-self-types="./bpm_analyzer_wasm.d.ts" */
import { startWorkers } from './snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js';

/**
 * WebAssembly BPM Analyzer container managing audio sample buffers.
 */
export class BpmAnalyzer {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    BpmAnalyzerFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_bpmanalyzer_free(ptr, 0);
  }
  /**
   * Runs BPM detection and beat tracking on the buffered audio, returning a JavaScript object
   * result.
   * @returns {BpmAnalysisResult}
   */
  analyze() {
    const ret = wasm.bpmanalyzer_analyze(this.__wbg_ptr);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
  }
  /**
   * Returns the capacity of the internal buffer in bytes.
   * @returns {number}
   */
  get byte_capacity() {
    const ret = wasm.bpmanalyzer_byte_capacity(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
   * Returns a raw byte pointer (`u8`) to the internal audio sample buffer.
   * @returns {number}
   */
  get byte_ptr() {
    const ret = wasm.bpmanalyzer_byte_ptr(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
   * Returns the active length of valid audio samples in the buffer.
   * @returns {number}
   */
  get length() {
    const ret = wasm.bpmanalyzer_length(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
   * Creates a new `BpmAnalyzer` with a given sample buffer capacity and optional settings.
   * @param {number} sample_capacity
   * @param {AnalyzerOptions | null} [options]
   */
  constructor(sample_capacity, options) {
    const ret = wasm.bpmanalyzer_new(
      sample_capacity,
      isLikeNone(options) ? 0 : addToExternrefTable0(options)
    );
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    this.__wbg_ptr = ret[0];
    BpmAnalyzerFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
  /**
   * Returns a raw pointer to the internal `f32` audio sample buffer.
   * @returns {number}
   */
  get ptr() {
    const ret = wasm.bpmanalyzer_ptr(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
   * Resizes the internal sample buffer capacity.
   * @param {number} new_sample_capacity
   */
  resize(new_sample_capacity) {
    wasm.bpmanalyzer_resize(this.__wbg_ptr, new_sample_capacity);
  }
  /**
   * Returns the maximum sample capacity (`f32` count) of the internal buffer.
   * @returns {number}
   */
  get sample_capacity() {
    const ret = wasm.bpmanalyzer_sample_capacity(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
   * Sets the active audio sample length in the buffer.
   * @param {number} new_len
   */
  set_length(new_len) {
    const ret = wasm.bpmanalyzer_set_length(this.__wbg_ptr, new_len);
    if (ret[1]) {
      throw takeFromExternrefTable0(ret[0]);
    }
  }
}
if (Symbol.dispose) BpmAnalyzer.prototype[Symbol.dispose] = BpmAnalyzer.prototype.free;

/**
 * @param {number} num_threads
 * @returns {Promise<any>}
 */
export function initThreadPool(num_threads) {
  const ret = wasm.initThreadPool(num_threads);
  return ret;
}

export class wbg_rayon_PoolBuilder {
  static __wrap(ptr) {
    const obj = Object.create(wbg_rayon_PoolBuilder.prototype);
    obj.__wbg_ptr = ptr;
    wbg_rayon_PoolBuilderFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    wbg_rayon_PoolBuilderFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_wbg_rayon_poolbuilder_free(ptr, 0);
  }
  build() {
    wasm.wbg_rayon_poolbuilder_build(this.__wbg_ptr);
  }
  /**
   * @returns {number}
   */
  numThreads() {
    const ret = wasm.wbg_rayon_poolbuilder_numThreads(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
   * @returns {number}
   */
  receiver() {
    const ret = wasm.wbg_rayon_poolbuilder_receiver(this.__wbg_ptr);
    return ret >>> 0;
  }
}
if (Symbol.dispose)
  wbg_rayon_PoolBuilder.prototype[Symbol.dispose] = wbg_rayon_PoolBuilder.prototype.free;

/**
 * @param {number} receiver
 */
export function wbg_rayon_start_worker(receiver) {
  wasm.wbg_rayon_start_worker(receiver);
}
function __wbg_get_imports(memory) {
  const import0 = {
    __proto__: null,
    __wbg_Error_92b29b0548f8b746: function (arg0, arg1) {
      const ret = Error(getStringFromWasm0(arg0, arg1));
      return ret;
    },
    __wbg_Number_9a4e0ecb0fa16705: function (arg0) {
      const ret = Number(arg0);
      return ret;
    },
    __wbg_String_8564e559799eccda: function (arg0, arg1) {
      const ret = String(arg1);
      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg___wbindgen_bigint_get_as_i64_d968e41184ae354f: function (arg0, arg1) {
      const v = arg1;
      const ret = typeof v === 'bigint' ? v : undefined;
      getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
    },
    __wbg___wbindgen_boolean_get_fa956cfa2d1bd751: function (arg0) {
      const v = arg0;
      const ret = typeof v === 'boolean' ? v : undefined;
      return isLikeNone(ret) ? 0xffffff : ret ? 1 : 0;
    },
    __wbg___wbindgen_debug_string_c25d447a39f5578f: function (arg0, arg1) {
      const ret = debugString(arg1);
      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg___wbindgen_in_aca499c5de7ff5e5: function (arg0, arg1) {
      const ret = arg0 in arg1;
      return ret;
    },
    __wbg___wbindgen_is_bigint_2f76dc55065b4273: function (arg0) {
      const ret = typeof arg0 === 'bigint';
      return ret;
    },
    __wbg___wbindgen_is_null_ea9085d691f535d3: function (arg0) {
      const ret = arg0 === null;
      return ret;
    },
    __wbg___wbindgen_is_object_a27215656b807791: function (arg0) {
      const val = arg0;
      const ret = typeof val === 'object' && val !== null;
      return ret;
    },
    __wbg___wbindgen_is_undefined_c05833b95a3cf397: function (arg0) {
      const ret = arg0 === undefined;
      return ret;
    },
    __wbg___wbindgen_jsval_eq_e659fcf7b0e32763: function (arg0, arg1) {
      const ret = arg0 === arg1;
      return ret;
    },
    __wbg___wbindgen_jsval_loose_eq_db4c3b15f63fc170: function (arg0, arg1) {
      const ret = arg0 == arg1;
      return ret;
    },
    __wbg___wbindgen_memory_de265df8aadd6273: function () {
      const ret = wasm.memory;
      return ret;
    },
    __wbg___wbindgen_module_a22faa8909381977: function () {
      const ret = wasmModule;
      return ret;
    },
    __wbg___wbindgen_number_get_394265ed1e1b84ee: function (arg0, arg1) {
      const obj = arg1;
      const ret = typeof obj === 'number' ? obj : undefined;
      getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
    },
    __wbg___wbindgen_string_get_b0ca35b86a603356: function (arg0, arg1) {
      const obj = arg1;
      const ret = typeof obj === 'string' ? obj : undefined;
      var ptr1 = isLikeNone(ret)
        ? 0
        : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      var len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg___wbindgen_throw_344f42d3211c4765: function (arg0, arg1) {
      throw new Error(getStringFromWasm0(arg0, arg1));
    },
    __wbg_get_with_ref_key_6412cf3094599694: function (arg0, arg1) {
      const ret = arg0[arg1];
      return ret;
    },
    __wbg_instanceof_ArrayBuffer_4480b9e0068a8adb: function (arg0) {
      let result;
      try {
        result = arg0 instanceof ArrayBuffer;
      } catch (_) {
        result = false;
      }
      const ret = result;
      return ret;
    },
    __wbg_instanceof_Uint8Array_309b927aaf7a3fc7: function (arg0) {
      let result;
      try {
        result = arg0 instanceof Uint8Array;
      } catch (_) {
        result = false;
      }
      const ret = result;
      return ret;
    },
    __wbg_instanceof_Window_05ba1ee4f6781663: function (arg0) {
      let result;
      try {
        result = arg0 instanceof Window;
      } catch (_) {
        result = false;
      }
      const ret = result;
      return ret;
    },
    __wbg_isSafeInteger_04f36e4056f1b851: function (arg0) {
      const ret = Number.isSafeInteger(arg0);
      return ret;
    },
    __wbg_length_1f0964f4a5e2c6d8: function (arg0) {
      const ret = arg0.length;
      return ret;
    },
    __wbg_new_32b398fb48b6d94a: function () {
      const ret = new Array();
      return ret;
    },
    __wbg_new_cd45aabdf6073e84: function (arg0) {
      const ret = new Uint8Array(arg0);
      return ret;
    },
    __wbg_new_da52cf8fe3429cb2: function () {
      const ret = new Object();
      return ret;
    },
    __wbg_prototypesetcall_4770620bbe4688a0: function (arg0, arg1, arg2) {
      Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
    },
    __wbg_set_6be42768c690e380: function (arg0, arg1, arg2) {
      arg0[arg1] = arg2;
    },
    __wbg_set_8a16b38e4805b298: function (arg0, arg1, arg2) {
      arg0[arg1 >>> 0] = arg2;
    },
    __wbg_startWorkers_8b582d57e92bd2d4: function (arg0, arg1, arg2) {
      const ret = startWorkers(arg0, arg1, wbg_rayon_PoolBuilder.__wrap(arg2));
      return ret;
    },
    __wbg_static_accessor_GLOBAL_4ef717fb391d88b7: function () {
      const ret = typeof global === 'undefined' ? null : global;
      return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    },
    __wbg_static_accessor_GLOBAL_THIS_8d1badc68b5a74f4: function () {
      const ret = typeof globalThis === 'undefined' ? null : globalThis;
      return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    },
    __wbg_static_accessor_SELF_146583524fe1469b: function () {
      const ret = typeof self === 'undefined' ? null : self;
      return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    },
    __wbg_static_accessor_WINDOW_f2829a2234d7819e: function () {
      const ret = typeof window === 'undefined' ? null : window;
      return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    },
    __wbindgen_cast_0000000000000001: function (arg0) {
      // Cast intrinsic for `F64 -> Externref`.
      const ret = arg0;
      return ret;
    },
    __wbindgen_cast_0000000000000002: function (arg0, arg1) {
      // Cast intrinsic for `Ref(String) -> Externref`.
      const ret = getStringFromWasm0(arg0, arg1);
      return ret;
    },
    __wbindgen_cast_0000000000000003: function (arg0) {
      // Cast intrinsic for `U64 -> Externref`.
      const ret = BigInt.asUintN(64, arg0);
      return ret;
    },
    __wbindgen_init_externref_table: function () {
      const table = wasm.__wbindgen_externrefs;
      const offset = table.grow(4);
      table.set(0, undefined);
      table.set(offset + 0, undefined);
      table.set(offset + 1, null);
      table.set(offset + 2, true);
      table.set(offset + 3, false);
    },
    memory: memory || new WebAssembly.Memory({ initial: 18, maximum: 16384, shared: true }),
  };
  return {
    __proto__: null,
    './bpm_analyzer_wasm_bg.js': import0,
  };
}

const BpmAnalyzerFinalization =
  typeof FinalizationRegistry === 'undefined'
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) => wasm.__wbg_bpmanalyzer_free(ptr, 1));
const wbg_rayon_PoolBuilderFinalization =
  typeof FinalizationRegistry === 'undefined'
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) => wasm.__wbg_wbg_rayon_poolbuilder_free(ptr, 1));

function addToExternrefTable0(obj) {
  const idx = wasm.__externref_table_alloc();
  wasm.__wbindgen_externrefs.set(idx, obj);
  return idx;
}

function debugString(val) {
  // primitive types
  const type = typeof val;
  if (type == 'number' || type == 'boolean' || val == null) {
    return `${val}`;
  }
  if (type == 'string') {
    return `"${val}"`;
  }
  if (type == 'symbol') {
    const description = val.description;
    if (description == null) {
      return 'Symbol';
    } else {
      return `Symbol(${description})`;
    }
  }
  if (type == 'function') {
    const name = val.name;
    if (typeof name == 'string' && name.length > 0) {
      return `Function(${name})`;
    } else {
      return 'Function';
    }
  }
  // objects
  if (Array.isArray(val)) {
    const length = val.length;
    let debug = '[';
    if (length > 0) {
      debug += debugString(val[0]);
    }
    for (let i = 1; i < length; i++) {
      debug += ', ' + debugString(val[i]);
    }
    debug += ']';
    return debug;
  }
  // Test for built-in
  const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
  let className;
  if (builtInMatches && builtInMatches.length > 1) {
    className = builtInMatches[1];
  } else {
    // Failed to match the standard '[object ClassName]'
    return toString.call(val);
  }
  if (className == 'Object') {
    // we're a user defined class or Object
    // JSON.stringify avoids problems with cycles, and is generally much
    // easier than looping through ownProperties of `val`.
    try {
      return 'Object(' + JSON.stringify(val) + ')';
    } catch (_) {
      return 'Object';
    }
  }
  // errors
  if (val instanceof Error) {
    return `${val.name}: ${val.message}\n${val.stack}`;
  }
  // TODO we could test for more things here, like `Set`s and `Map`s.
  return className;
}

function getArrayU8FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
  if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer !== wasm.memory.buffer) {
    cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
  }
  return cachedDataViewMemory0;
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

function isLikeNone(x) {
  return x === undefined || x === null;
}

function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === undefined) {
    const buf = cachedTextEncoder.encode(arg);
    const ptr = malloc(buf.length, 1) >>> 0;
    getUint8ArrayMemory0()
      .subarray(ptr, ptr + buf.length)
      .set(buf);
    WASM_VECTOR_LEN = buf.length;
    return ptr;
  }

  let len = arg.length;
  let ptr = malloc(len, 1) >>> 0;

  const mem = getUint8ArrayMemory0();

  let offset = 0;

  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset);
    if (code > 0x7f) break;
    mem[ptr + offset] = code;
  }
  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset);
    }
    ptr = realloc(ptr, len, (len = offset + arg.length * 3), 1) >>> 0;
    const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
    const ret = cachedTextEncoder.encodeInto(arg, view);

    offset += ret.written;
    ptr = realloc(ptr, len, offset, 1) >>> 0;
  }

  WASM_VECTOR_LEN = offset;
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

const cachedTextEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : undefined;

if (cachedTextEncoder) {
  cachedTextEncoder.encodeInto = function (arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
      read: arg.length,
      written: buf.length,
    };
  };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module, thread_stack_size) {
  wasmInstance = instance;
  wasm = instance.exports;
  wasmModule = module;
  cachedDataViewMemory0 = null;
  cachedUint8ArrayMemory0 = null;
  if (
    typeof thread_stack_size !== 'undefined' &&
    (typeof thread_stack_size !== 'number' ||
      thread_stack_size === 0 ||
      thread_stack_size % 65536 !== 0)
  ) {
    throw new Error('invalid stack size');
  }

  wasm.__wbindgen_start(thread_stack_size);
  return wasm;
}

async function __wbg_load(module, imports) {
  if (typeof Response === 'function' && module instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === 'function') {
      try {
        return await WebAssembly.instantiateStreaming(module, imports);
      } catch (e) {
        const validResponse = module.ok && expectedResponseType(module.type);

        if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
          console.warn(
            '`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n',
            e
          );
        } else {
          throw e;
        }
      }
    }

    const bytes = await module.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  } else {
    const instance = await WebAssembly.instantiate(module, imports);

    if (instance instanceof WebAssembly.Instance) {
      return { instance, module };
    } else {
      return instance;
    }
  }

  function expectedResponseType(type) {
    switch (type) {
      case 'basic':
      case 'cors':
      case 'default':
        return true;
    }
    return false;
  }
}

function initSync(module, memory) {
  if (wasm !== undefined) return wasm;

  let thread_stack_size;
  if (module !== undefined) {
    if (Object.getPrototypeOf(module) === Object.prototype) {
      ({ module, memory, thread_stack_size } = module);
    } else {
      console.warn('using deprecated parameters for `initSync()`; pass a single object instead');
    }
  }

  const imports = __wbg_get_imports(memory);
  if (!(module instanceof WebAssembly.Module)) {
    module = new WebAssembly.Module(module);
  }
  const instance = new WebAssembly.Instance(module, imports);
  return __wbg_finalize_init(instance, module, thread_stack_size);
}

async function __wbg_init(module_or_path, memory) {
  if (wasm !== undefined) return wasm;

  let thread_stack_size;
  if (module_or_path !== undefined) {
    if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
      ({ module_or_path, memory, thread_stack_size } = module_or_path);
    } else {
      console.warn(
        'using deprecated parameters for the initialization function; pass a single object instead'
      );
    }
  }

  if (module_or_path === undefined) {
    module_or_path = new URL('bpm_analyzer_wasm_bg.wasm', import.meta.url);
  }
  const imports = __wbg_get_imports(memory);

  if (
    typeof module_or_path === 'string' ||
    (typeof Request === 'function' && module_or_path instanceof Request) ||
    (typeof URL === 'function' && module_or_path instanceof URL)
  ) {
    module_or_path = fetch(module_or_path);
  }

  const { instance, module } = await __wbg_load(await module_or_path, imports);

  return __wbg_finalize_init(instance, module, thread_stack_size);
}

export { initSync, __wbg_init as default };
