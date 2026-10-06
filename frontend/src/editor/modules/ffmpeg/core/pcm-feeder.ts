import type { AudioWriter } from '../queue';
const MIN_SPACE_REQ_FRAMES = 8192;

/** 单次写入的帧数上限。不限制的话一次 `writePartial` 会写满整个环，
 *  期间主线程无法响应 seek —— 分批让出控制权。
 */
const WRITE_CHUNK_FRAMES = 16384;

export class PcmFeeder {
  private writer: AudioWriter;
  private channels: Float32Array[] = [];
  private totalFrames = 0;
  /** 下一个要写入环的源帧号 */
  private sourceOffset = 0;
  private running = false;
  /** 每次 seek / 换源自增，用来让挂起中的旧循环自行退出 */
  private sessionId = 0;
  /** 源已读完且环已排空 */
  private drained = false;
  private destroyed = false;

  constructor(
    writer: AudioWriter,
    private onDrained: () => void
  ) {
    this.writer = writer;
  }
  public setBuffer(buffer: AudioBuffer): void {
    this.sessionId++;
    this.running = false;
    this.drained = false;
    this.channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      this.channels.push(buffer.getChannelData(c));
    }
    this.totalFrames = buffer.length;
    this.sourceOffset = 0;
  }

  public get channelCount(): number {
    return this.channels.length;
  }

  /** 源是否已读完且环已排空 */
  public get isDrained(): boolean {
    return this.drained;
  }

  public seek(targetSeconds: number, sampleRate: number): void {
    const wasRunning = this.running;

    this.sessionId++;
    this.running = false;
    this.drained = false;
    const frame = Math.max(0, Math.min(Math.floor(targetSeconds * sampleRate), this.totalFrames));
    this.sourceOffset = frame;
    this.writer.beginSeek();
    this.writer.endSeek();

    if (wasRunning) {
      this.play();
    }
  }

  public play(): void {
    if (this.destroyed || this.running || this.drained) return;
    this.running = true;
    void this.pump(this.sessionId);
  }

  public pause(): void {
    this.running = false;
  }

  public destroy(): void {
    this.destroyed = true;
    this.sessionId++;
    this.running = false;
    this.channels = [];
    this.totalFrames = 0;
  }

  private async pump(session: number): Promise<void> {
    while (
      this.running &&
      !this.destroyed &&
      session === this.sessionId &&
      this.channels.length > 0
    ) {
      if (this.sourceOffset >= this.totalFrames) {
        await this.finishIfDrained(session);
        return;
      }

      const wait = this.writer.waitForSpaceAsync(MIN_SPACE_REQ_FRAMES);
      if (wait.async) {
        if (!wait.promise) return;
        await wait.promise;
        if (!this.running || this.destroyed || session !== this.sessionId) {
          return;
        }
        continue;
      }

      const remaining = this.totalFrames - this.sourceOffset;
      const want = Math.min(remaining, WRITE_CHUNK_FRAMES);
      const written = this.writer.writePartial(this.channels, this.sourceOffset, want);

      if (written === 0) {
        const retry = this.writer.waitForSpaceAsync(1);
        if (retry.async && retry.promise) {
          await retry.promise;
        }
        continue;
      }

      this.sourceOffset += written;
    }
  }

  private async finishIfDrained(session: number): Promise<void> {
    while (!this.destroyed && session === this.sessionId) {
      const drain = this.writer.waitForDrainAsync();
      if (drain.isDrained) {
        this.drained = true;
        this.running = false;
        this.onDrained();
        return;
      }
      if (!drain.promise) {
        // 既没排空也没给出 promise：等下一次 play() 重新驱动
        return;
      }
      await drain.promise;
    }
  }
}
