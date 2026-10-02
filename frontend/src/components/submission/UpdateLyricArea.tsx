import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { AlertTriangle, Check, FileText, Loader2, UploadCloud, X } from 'lucide-react';
import { api } from '@/lib/api';
import { buttonTap } from '@/lib/motion';
import { useUnrearrangedMode } from '@/hooks/useUnrearrangedMode';
import type { TtmlValidationResult } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { UnrearrangedToggle } from './UnrearrangedToggle';

export interface UpdateLyricAreaProps {
  submissionId: number;
  onClose: () => void;
  onSuccess: () => void;
}

/** 更新歌词区 */
export function UpdateLyricArea({ submissionId, onClose, onSuccess }: UpdateLyricAreaProps) {
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<TtmlValidationResult | null>(null);
  const [validateError, setValidateError] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const joinArr = (arr?: string[]) => arr?.filter(Boolean).join('、') || '—';
  const meta = validation?.metadata;

  // 选择文件后立即校验
  const validateMutation = useMutation({
    mutationFn: async (f: File) => api.validateTtml(await f.text()),
    onSuccess: (result) => setValidation(result),
    onError: (err) => setValidateError(err instanceof Error ? err.message : '校验请求失败'),
  });
  const validating = validateMutation.isPending;

  // 未重排模式：与投稿页共用同一份状态与提交门槛逻辑
  const unrearranged = useUnrearrangedMode({
    metaResolved: validation !== null || validateError !== '',
    valid: validation?.valid === true,
  });
  const { isUnrearranged, reasonMissing } = unrearranged;
  const ready = unrearranged.ready;

  // 未重排时原因必填
  const canUpload = file !== null && ready && !reasonMissing;

  // 上传文件并挂到投稿
  const uploadMutation = useMutation({
    mutationFn: async (f: File) => {
      const { fileName } = await api.uploadTtml(f, f.name);
      await api.updateSubmissionFile(submissionId, {
        fileName,
        metadata: {
          title: meta?.title?.[0] ?? f.name.replace(/\.[^.]+$/, ''),
          metadata: (meta ?? {}) as Record<string, unknown>,
          ...unrearranged.submissionFields,
        },
      });
    },
    onMutate: () => setMsg(null),
    onSuccess: () => {
      setMsg({ type: 'success', text: '歌词已更新' });
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1200);
    },
    onError: (err) =>
      setMsg({ type: 'error', text: err instanceof Error ? err.message : '上传失败' }),
  });
  const uploading = uploadMutation.isPending;

  const handleFile = (f: File) => {
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
    validateMutation.mutate(f);
  };

  const reset = () => {
    setFile(null);
    setValidation(null);
    setValidateError('');
    setMsg(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const submit = () => {
    if (!canUpload) return;
    uploadMutation.mutate(file);
  };

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">更新歌词文件</h4>
        <button type="button" onClick={onClose} className="text-ink-3 hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 未重排开关：与投稿页共用同一组件 */}
      <div className="mb-4">
        <UnrearrangedToggle
          mode={unrearranged}
          compact
          description="勾选后不做重排（元数据仍照常解析），.ttml 原样上传；不勾选则会自动校验并重排。"
        />
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
        <p className="mt-1 text-xs text-ink-3">
          {isUnrearranged ? '仅解析元数据，文件原样上传（不做重排）' : '文件将自动校验并重排'}
        </p>
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
          <span className="text-sm text-ink-2">
            {isUnrearranged ? '正在解析元数据…' : '正在校验文件…'}
          </span>
        </div>
      )}

      {/* 未重排提示 */}
      {isUnrearranged && file && !validating && (
        <div className="mt-3 flex items-center gap-1.5 rounded-md border border-amber-500/60 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          未重排模式：元数据照常解析，文件原样上传
        </div>
      )}

      {/* 校验请求失败 */}
      {validateError && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{validateError}</AlertDescription>
        </Alert>
      )}

      {/* 校验未通过 */}
      {validation && !validation.valid && (
        <Alert variant="destructive" className="mt-3">
          <AlertTitle>{isUnrearranged ? '格式校验未通过（不影响提交）' : '校验未通过'}</AlertTitle>
          <AlertDescription>
            {validation.parseError && (
              <p className="text-xs text-red-500">{validation.parseError}</p>
            )}
            {validation.errors.map((err, i) => (
              <p key={i} className="text-xs">
                • {err}
              </p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {/* 元数据：两种模式都会解析，未重排模式不以此为门槛 */}
      {meta && (
        <div className="mt-3 space-y-3">
          <div
            className={`flex items-center gap-1.5 text-sm font-medium ${!isUnrearranged && validation?.valid ? 'text-green-600' : 'text-ink-2'}`}
          >
            {!isUnrearranged && validation?.valid ? (
              <>
                <Check className="h-4 w-4" />
                校验通过，已自动重排
              </>
            ) : (
              <>
                <FileText className="h-4 w-4" />
                已从文件解析元数据（未重排，原样上传）
              </>
            )}
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
        <Alert variant={msg.type === 'success' ? 'success' : 'destructive'} className="mt-3">
          <AlertDescription>{msg.text}</AlertDescription>
        </Alert>
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
          disabled={!file || !ready || reasonMissing || uploading}
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
