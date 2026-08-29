import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, CloudUpload, FileText, Loader2, Upload, X } from 'lucide-react';
import { api } from '@/lib/api';
import { buttonTap, fadeUp, staggerContainer } from '@/lib/motion';
import { useFormDraft } from '@/hooks/useFormDraft';
import type { TtmlValidationResult } from '@/lib/types';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

// 从 TTML 元数据自动推断语言代码（模块级常量，保持引用稳定）
const LANG_MAP: Record<string, string> = {
  zh: 'zh',
  cn: 'zh',
  chs: 'zh',
  zh_cn: 'zh',
  'zh-CN': 'zh',
  'zh-Hans': 'zh',
  en: 'en',
  en_US: 'en',
  'en-US': 'en',
  ja: 'ja',
  jp: 'ja',
  ja_JP: 'ja',
  'ja-JP': 'ja',
  ko: 'ko',
  kr: 'ko',
  ko_KR: 'ko',
  'ko-KR': 'ko',
};

/** 歌词投稿表单 */
export function LyricSubmitForm({ onSuccess }: { onSuccess?: () => void }) {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<TtmlValidationResult | null>(null);
  const [validateError, setValidateError] = useState('');
  // 表单草稿：刷新/关页后自动恢复（文件本体无法持久化，重选后需重新校验）
  const {
    restored: draft,
    set: setDraft,
    clearDraft,
  } = useFormDraft<{
    notes: string;
    language: string;
    tags: string[];
  }>('lyric-submit');
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [language, setLanguage] = useState(draft?.language ?? '');
  const [tags, setTags] = useState<string[]>(draft?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [submitMsg, setSubmitMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [dragOver, setDragOver] = useState(false);
  const [showTtml, setShowTtml] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 选择文件后立即校验
  const validateMutation = useMutation({
    mutationFn: async (f: File) => api.validateTtml(await f.text()),
    onSuccess: (result) => setValidation(result),
    onError: (err) => setValidateError(err instanceof Error ? err.message : '校验请求失败'),
  });
  const validating = validateMutation.isPending;

  // 上传文件并创建投稿（status: pending=提交审核 / draft=存草稿）
  const submitMutation = useMutation({
    mutationFn: async (params: { file: File; status: 'pending' | 'draft' }) => {
      const { fileName } = await api.uploadTtml(params.file, params.file.name);
      const title = validation?.metadata?.title?.[0] ?? params.file.name.replace(/\.ttml$/i, '');
      return api.createSubmission({
        title,
        metadata: (validation?.metadata ?? {}) as Record<string, unknown>,
        fileName,
        notes: notes.trim() || undefined,
        language: language || undefined,
        tags: tags.length > 0 ? tags : undefined,
        status: params.status,
      });
    },
    onMutate: () => setSubmitMsg(null),
    onSuccess: (result, { status }) => {
      setSubmitMsg({
        type: 'success',
        text: status === 'draft' ? '草稿已保存，正在跳转…' : '投稿成功，正在跳转…',
      });
      reset();
      setTimeout(() => {
        setSubmitMsg(null);
        onSuccess?.();
        if (result?.id) {
          navigate(`/creator/lyrics/detail?id=${result.id}`, { replace: true });
        }
      }, 1200);
    },
    onError: (err) => {
      setSubmitMsg({ type: 'error', text: err instanceof Error ? err.message : '提交失败' });
    },
  });
  const submitting = submitMutation.isPending;

  const reset = () => {
    setFile(null);
    setValidation(null);
    setValidateError('');
    setSubmitMsg(null);
    setNotes('');
    setLanguage('');
    setTags([]);
    setTagInput('');
    setShowTtml(false);
    clearDraft();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 草稿自动保存：空表单不写
  useEffect(() => {
    if (!notes && !language && tags.length === 0) return;
    setDraft({ notes, language, tags });
  }, [notes, language, tags, setDraft, clearDraft]);

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) {
      setTags([...tags, t]);
    }
    setTagInput('');
  };

  const removeTag = (t: string) => {
    setTags(tags.filter((x) => x !== t));
  };

  const handleFile = (f: File) => {
    if (!f.name.toLowerCase().endsWith('.ttml')) {
      setValidateError('请选择 .ttml 格式的文件');
      return;
    }
    setFile(f);
    setValidation(null);
    setValidateError('');
    setSubmitMsg(null);
    validateMutation.mutate(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  // 语言选项：value 为后端枚举代码，label 为中文
  const LANG_OPTIONS: { value: string; label: string }[] = [
    { value: 'zh', label: '汉语' },
    { value: 'en', label: '英语' },
    { value: 'ja', label: '日语' },
    { value: 'ko', label: '韩语' },
    { value: 'others', label: '其他' },
  ];
  useEffect(() => {
    if (!validation?.valid) return;
    const raw = validation.metadata?.language?.trim();
    if (raw) {
      const matched = LANG_MAP[raw] || LANG_MAP[raw.toLowerCase()];
      if (matched) setLanguage(matched);
    }
  }, [validation]);

  const doSubmit = (status: 'pending' | 'draft') => {
    if (!file || !validation?.valid) return;
    submitMutation.mutate({ file, status });
  };

  const canSubmit = file !== null && validation?.valid === true && !submitting;

  // 元数据辅助
  const meta = validation?.metadata;
  const joinArr = (arr?: string[]) => arr?.filter(Boolean).join('、') || '—';
  const pid = (key: 'ncm_music_id' | 'qq_music_id' | 'spotify_id' | 'apple_music_id') =>
    joinArr(meta?.platform_ids?.[key]);

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-5">
      {/* 文件上传区 */}
      <motion.div variants={fadeUp}>
        <label className="mb-1.5 block text-sm font-medium text-ink-2">歌词文件 (TTML)</label>

        {!file && !validating && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed py-12 transition-colors ${
              dragOver
                ? 'border-primary bg-primary-soft'
                : 'border-line bg-surface-2 hover:border-primary/50'
            }`}
          >
            <CloudUpload className="h-8 w-8 text-ink-3" />
            <p className="text-sm text-ink-2">拖拽 .ttml 文件到此处，或点击选择</p>
            <p className="text-xs text-ink-3">文件将自动校验并重排</p>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".ttml,text/xml,application/xml"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />

        {validating && (
          <div className="flex items-center gap-3 rounded-md border border-line bg-surface-2 px-4 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-ink-2">正在校验文件…</span>
          </div>
        )}

        {file && !validating && (
          <div className="rounded-md border border-line bg-surface-2 p-4">
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate text-sm text-foreground">{file.name}</span>
              </div>
              <button
                type="button"
                onClick={reset}
                className="shrink-0 rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 校验失败 */}
            {validateError && (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{validateError}</AlertDescription>
              </Alert>
            )}

            {validation && !validation.valid && (
              <Alert variant="destructive" className="mt-3">
                <AlertTitle>校验未通过</AlertTitle>
                <AlertDescription>
                  {validation.parseError && <p className="text-xs">{validation.parseError}</p>}
                  {validation.errors.map((err, i) => (
                    <p key={i} className="text-xs">
                      • {err}
                    </p>
                  ))}
                </AlertDescription>
              </Alert>
            )}

            {/* 校验成功 */}
            {validation?.valid && meta && (
              <div className="mt-3 space-y-3">
                <div className="flex items-center gap-1.5 text-sm font-medium text-green-600">
                  <Check className="h-4 w-4" />
                  校验通过，已自动填充元数据
                </div>

                {/* 元数据预览 */}
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
                    <dd className="text-foreground">{pid('ncm_music_id')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-3">QQ 音乐 ID</dt>
                    <dd className="text-foreground">{pid('qq_music_id')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-3">Apple Music ID</dt>
                    <dd className="text-foreground">{pid('apple_music_id')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-3">Spotify ID</dt>
                    <dd className="text-foreground">{pid('spotify_id')}</dd>
                  </div>
                  {meta.language && (
                    <div>
                      <dt className="text-xs text-ink-3">语言</dt>
                      <dd className="text-foreground">{meta.language}</dd>
                    </div>
                  )}
                  {meta.isrc?.length ? (
                    <div>
                      <dt className="text-xs text-ink-3">ISRC</dt>
                      <dd className="text-foreground">{joinArr(meta.isrc)}</dd>
                    </div>
                  ) : null}
                </dl>

                {/* TTML 预览 */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowTtml(!showTtml)}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ChevronDown
                      className={`h-3 w-3 transition-transform ${showTtml ? 'rotate-180' : ''}`}
                    />
                    {showTtml ? '隐藏' : '查看'}重排后 TTML
                  </button>
                  <AnimatePresence>
                    {showTtml && (
                      <motion.pre
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="mt-2 max-h-64 overflow-auto rounded bg-background p-3 text-xs leading-relaxed text-ink-2"
                      >
                        {validation.regeneratedTtml}
                      </motion.pre>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>

      {/* 语言选择 */}
      {validation?.valid && (
        <motion.div variants={fadeUp}>
          <label className="mb-1.5 block text-sm font-medium text-ink-2">语言</label>
          <div className="flex flex-wrap gap-2">
            {LANG_OPTIONS.map((lang) => (
              <button
                key={lang.value}
                type="button"
                onClick={() => setLanguage(lang.value)}
                className={`rounded-md px-4 py-2 text-sm transition-colors ${
                  language === lang.value
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-input bg-surface-2 text-ink-2 hover:text-foreground'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* 备注 */}
      {validation?.valid && (
        <motion.div variants={fadeUp}>
          <label className="mb-1.5 block text-sm font-medium text-ink-2">备注（可选）</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="给审核员的留言，如特殊处理说明等"
            className="w-full resize-none bg-surface-2 px-4 py-2.5"
          />
        </motion.div>
      )}

      {/* 标签 */}
      {validation?.valid && (
        <motion.div variants={fadeUp}>
          <label className="mb-1.5 block text-sm font-medium text-ink-2">标签（可选）</label>
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="输入标签后按回车添加"
            className="h-10 w-full rounded-md border border-input bg-surface-2 px-4 text-sm outline-none focus:border-primary"
          />
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1 text-xs text-primary"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => removeTag(t)}
                    className="text-primary/60 hover:text-primary"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* 提交消息 */}
      {submitMsg && (
        <Alert variant={submitMsg.type === 'success' ? 'success' : 'destructive'}>
          <AlertDescription>{submitMsg.text}</AlertDescription>
        </Alert>
      )}

      {/* 操作按钮 */}
      {validation?.valid && (
        <motion.div variants={fadeUp} className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => doSubmit('draft')}
            disabled={!canSubmit}
            className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-card px-5 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            存为草稿
          </button>
          <motion.button
            type="button"
            onClick={() => doSubmit('pending')}
            disabled={!canSubmit}
            {...buttonTap}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            提交审核
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}
