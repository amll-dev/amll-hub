if (typeof globalThis.TextDecoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- polyfill
  (globalThis as any).TextDecoder = class TextDecoder {
    decode(arr?: Uint8Array) {
      if (!arr) return '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- polyfill
      return String.fromCharCode.apply(null, arr as any);
    }
  };
}
