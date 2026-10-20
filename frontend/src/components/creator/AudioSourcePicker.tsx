import { useRef, useState } from 'react';
import { Music, Plus, X } from 'lucide-react';
import { formatBytes } from '@/lib/format';

/** 允许的音频扩展名与上限，与后端 isAllowedAudioExt / SUBMISSION_MAX_AUDIO_SIZE 保持一致 */
const AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.aac'];
export const MAX_AUDIO_COUNT = 5;
const MAX_AUDIO_SIZE = 50 * 1024 * 1024;

// 投稿表单的音源选择区
export function AudioSourcePicker({
  files,
  onChange,
  disabled = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const accepted: File[] = [];
    let wrongExt = 0;
    let tooLarge = 0;
    let overflow = 0;

    for (const f of Array.from(incoming)) {
      const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
      if (!AUDIO_EXTS.includes(ext)) {
        wrongExt++;
        continue;
      }
      if (f.size > MAX_AUDIO_SIZE) {
        tooLarge++;
        continue;
      }
      if (files.length + accepted.length >= MAX_AUDIO_COUNT) {
        overflow++;
        continue;
      }
      // 同名同大小同修改时间视为重复选择，静默跳过
      const dup = [...files, ...accepted].some(
        (x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified
      );
      if (!dup) accepted.push(f);
    }

    if (accepted.length > 0) onChange([...files, ...accepted]);

    const reasons: string[] = [];
    if (wrongExt) reasons.push(`${wrongExt} 个格式不支持`);
    if (tooLarge) reasons.push(`${tooLarge} 个超过 50 MB`);
    if (overflow) reasons.push(`${overflow} 个超出 ${MAX_AUDIO_COUNT} 个上限`);
    setError(reasons.length > 0 ? `已忽略：${reasons.join('、')}` : '');
  };

  const remove = (target: File) => {
    onChange(files.filter((f) => f !== target));
    setError('');
  };

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="block text-sm font-medium text-ink-2">
          音源
          <span className="ml-1.5 text-xs font-normal text-ink-3">可选，可多选</span>
        </label>
        {files.length > 0 && (
          <span className="text-xs text-ink-3">
            {files.length}/{MAX_AUDIO_COUNT}
          </span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={AUDIO_EXTS.join(',')}
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          // 允许重复选择同一个文件时仍触发 change
          e.target.value = '';
        }}
      />

      {files.length === 0 ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (!disabled) addFiles(e.dataTransfer.files);
          }}
          onClick={() => !disabled && inputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed py-8 transition-colors ${
            disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
          } ${dragOver ? 'border-primary bg-primary-soft' : 'border-line bg-surface-2 hover:border-primary/50'}`}
        >
          <Music className="h-6 w-6 text-ink-3" />
          <p className="text-sm text-ink-2">拖拽或点击添加音频文件</p>
          <p className="text-xs text-ink-3">
            MP3 / FLAC / WAV / M4A / OGG / AAC，单个 ≤ 50 MB，最多 {MAX_AUDIO_COUNT} 个
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <ul className="space-y-2">
            {files.map((f) => (
              <li
                key={`${f.name}-${f.size}-${f.lastModified}`}
                className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2"
              >
                <Music className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{f.name}</span>
                <span className="shrink-0 text-xs text-ink-3">{formatBytes(f.size)}</span>
                <button
                  type="button"
                  onClick={() => remove(f)}
                  disabled={disabled}
                  aria-label={`移除 ${f.name}`}
                  className="shrink-0 rounded p-1 text-ink-3 transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>

          {files.length < MAX_AUDIO_COUNT && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-line px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              继续添加
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}
