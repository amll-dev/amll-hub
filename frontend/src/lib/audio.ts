/** 允许的音频扩展名与上限，与后端 isAllowedAudioExt / SUBMISSION_MAX_AUDIO_SIZE 保持一致 */
export const AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.aac'];
export const MAX_AUDIO_COUNT = 5;
export const MAX_AUDIO_SIZE = 150 * 1024 * 1024;

/** 取文件名的小写扩展名 */
export function audioExt(name: string): string {
  return name.slice(name.lastIndexOf('.')).toLowerCase();
}
