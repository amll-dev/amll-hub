declare module 'browser-id3-writer' {
  interface ApicFrame {
    type: number;
    data: ArrayBuffer;
    description: string;
    useUnicodeEncoding?: boolean;
  }

  export default class ID3Writer {
    constructor(buffer: ArrayBuffer);
    padding: number;
    setFrame(name: string, value: string | number | string[] | ApicFrame): this;
    removeTag(): void;
    addTag(): void;
    getBlob(): Blob;
    getURL(): string;
    revokeURL(): void;
    arrayBuffer: ArrayBuffer;
  }
}
