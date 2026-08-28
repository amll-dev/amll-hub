import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2, UploadCloud, X } from 'lucide-react';
import { api } from '@/lib/api';
import { buttonTap } from '@/lib/motion';
import type { TtmlValidationResult } from '@/lib/types';

export interface UpdateLyricAreaProps {
  submissionId: number;
  onClose: () => void;
  onSuccess: () => void;
}

/** 更新歌词区 */
export function UpdateLyricArea({ submissionId, onClose, onSuccess }: UpdateLyricAreaProps) {
  const [file, setFile] = useState<File | null>(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<TtmlValidationResult | null>(null);
  const [validateError, setValidateError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const joinArr = (arr?: string[]) => arr?.filter(Boolean).join('、') || '—';
  const meta = validation?.metadata;

  const handleFile = async (f: File) => {
    if (!f.name.toLowerCase().endsWith('.ttml')) {
      setValidateError('请选择 .ttml 格式的文件');
      setFile(null);
      setValidation(null);
      return;
    }
    setFile(f);
    setValidation(null);
    setValidateError('');
    setMsg(null);
    setValidating(true);
    try {
      const content = await f.text();
      const result = await api.validateTtml(content);
      setValidation(result);
    } catch (err) {
      setValidateError(err instanceof Error ? err.message : '校验请求失败');
    } finally {
      setValidating(false);
    }
  };

  const reset = () => {
    setFile(null);
    setValidation(null);
    setValidateError('');
    setMsg(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const submit = async () => {
    if (!file || !validation?.valid) return;
    setUploading(true);
    setMsg(null);
    try {
      const { fileName } = await api.uploadTtml(file, file.name);
      await api.updateSubmissionFile(submissionId, { fileName });
      setMsg({ type: 'success', text: '歌词已更新' });
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1200);
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : '上传失败' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">更新歌词文件</h4>
        <button type="button" onClick={onClose} className="text-ink-3 hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        className="cursor-pointer rounded-md border-2 border-dashed border-line bg-background py-8 text-center transition-colors hover:border-primary/50"
      >
        <UploadCloud className="mx-auto h-8 w-8 text-ink-3" />
        <p className="mt-2 text-sm text-ink-2">{file ? file.name : '点击或拖拽 .ttml 文件'}</p>
        <p className="mt-1 text-xs text-ink-3">文件将自动校验并重排</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".ttml,text/xml,application/xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />

      {/* 校验中 */}
      {validating && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-line bg-background px-4 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-ink-2">正在校验文件…</span>
        </div>
      )}

      {/* 校验请求失败 */}
      {validateError && (
        <div className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{validateError}</div>
      )}

      {/* 校验未通过 */}
      {validation && !validation.valid && (
        <div className="mt-3 space-y-1 rounded bg-red-50 px-3 py-2">
          <p className="text-sm font-medium text-red-600">校验未通过</p>
          {validation.parseError && <p className="text-xs text-red-500">{validation.parseError}</p>}
          {validation.errors.map((err, i) => (
            <p key={i} className="text-xs text-red-500">
              • {err}
            </p>
          ))}
        </div>
      )}

      {/* 校验通过 */}
      {validation?.valid && meta && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-green-600">
            <Check className="h-4 w-4" />
            校验通过，已自动重排
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded bg-background px-3 py-3 text-sm">
            <div>
              <dt className="text-xs text-ink-3">标题</dt>
              <dd className="text-foreground">{joinArr(meta.title)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">歌手</dt>
              <dd className="text-foreground">{joinArr(meta.artist)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">专辑</dt>
              <dd className="text-foreground">{joinArr(meta.album)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">词曲作者</dt>
              <dd className="text-foreground">{joinArr(meta.songwriters)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">网易云 ID</dt>
              <dd className="text-foreground">{joinArr(meta.platform_ids?.ncm_music_id)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">QQ 音乐 ID</dt>
              <dd className="text-foreground">{joinArr(meta.platform_ids?.qq_music_id)}</dd>
            </div>
          </dl>
        </div>
      )}

      {msg && (
        <div
          className={`mt-3 rounded-md px-4 py-2 text-sm ${
            msg.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        {file && !validating && !uploading && (
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-input bg-card px-4 py-2 text-sm text-ink-2 hover:bg-surface-2"
          >
            重新选择
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-input bg-card px-4 py-2 text-sm text-ink-2 hover:bg-surface-2"
        >
          取消
        </button>
        <motion.button
          type="button"
          onClick={submit}
          disabled={!file || !validation?.valid || uploading}
          {...buttonTap}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          确认更新
        </motion.button>
      </div>
    </div>
  );
}
