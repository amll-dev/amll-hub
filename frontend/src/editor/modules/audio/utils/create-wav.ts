/**
 * 动态创建一个时长为 10 秒的 8kHz 单声道 PCM 8-bit 静音 WAV Blob
 */
export function createSilentWavBlob(durationSeconds = 10): Blob {
  const sampleRate = 8000;
  const numSamples = sampleRate * durationSeconds;
  const buffer = new ArrayBuffer(44 + numSamples);
  const view = new DataView(buffer);

  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + numSamples, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // fmt chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);

  // data chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, numSamples, true);

  // 8-bit unsigned PCM 的无声静止电平为 128 (0x80)
  const samples = new Uint8Array(buffer, 44, numSamples);
  samples.fill(0x80);

  return new Blob([buffer], { type: 'audio/wav' });
}
