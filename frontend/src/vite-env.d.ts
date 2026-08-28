/// <reference types="vite/client" />

declare module 'sound-processor' {
  export interface SoundProcessorOptions {
    sampleRate?: number;
    fftSize?: number;
    startFrequency?: number;
    endFrequency?: number;
    outBandsQty?: number;
    tWeight?: boolean;
    aWeight?: boolean;
    filterParams?: { sigma?: number; radius?: number };
  }
  export class SoundProcessor {
    constructor(options: SoundProcessorOptions);
    /** 就地处理 FFT 字节数据 */
    process(frequencies: Uint8Array): number[];
  }
}
