import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  FileArchive,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { buttonTap, fadeUp, staggerContainer } from '@/lib/motion';
import { useFormDraft } from '@/hooks/useFormDraft';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TagInput } from '@/components/ui/tag-input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { PluginChannel, PluginIssue } from '@/lib/types';

const MAX_ARTIFACT_BYTES = 48 * 1024 * 1024;

interface FormState {
  summary: string;
  descriptionMd: string;
  repoUrl: string;
  license: string;
}

interface DraftState extends FormState {
  tags: string[];
}

const emptyForm: FormState = {
  summary: '',
  descriptionMd: '',
  repoUrl: '',
  license: '',
};

function extractIssues(err: unknown): PluginIssue[] {
  if (!(err instanceof ApiError)) return [];
  const data = err.details as { issues?: PluginIssue[] } | undefined;
  return Array.isArray(data?.issues) ? data.issues : [];
}

/** 更新已有插件时沿用的展示信息 */
export interface ExistingPluginInfo {
  pluginKey: string;
  summary: string;
  descriptionMd: string;
  repoUrl: string;
  license: string;
  tags: string[];
}

/** 创作中心内的插件投稿表单 */
export function PluginSubmitForm({
  onSuccess,
  existingPlugin,
}: {
  onSuccess: () => void;
  /** 传入后为「更新插件」模式：沿用已有资料，只上传新版本 ZIP */
  existingPlugin?: ExistingPluginInfo;
}) {
  const versionOnly = Boolean(existingPlugin);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { restored: draft, set: setDraft, clearDraft } = useFormDraft<DraftState>('plugin-submit');

  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState<FormState>({
    summary: existingPlugin?.summary ?? draft?.summary ?? '',
    descriptionMd: existingPlugin?.descriptionMd ?? draft?.descriptionMd ?? '',
    repoUrl: existingPlugin?.repoUrl ?? draft?.repoUrl ?? '',
    license: existingPlugin?.license ?? draft?.license ?? '',
  });
  const [tags, setTags] = useState<string[]>(existingPlugin?.tags ?? draft?.tags ?? []);
  const [dragging, setDragging] = useState(false);
  const [issues, setIssues] = useState<PluginIssue[]>([]);
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [kind, setKind] = useState<PluginChannel | ''>('');
  const [iconDetected, setIconDetected] = useState(false);
  const [iconPreview, setIconPreview] = useState('');
  const [submitMsg, setSubmitMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const updateForm = (patch: Partial<FormState>) => {
    const next = { ...form, ...patch };
    setForm(next);
    setDraft({ ...next, tags });
  };

  const addTag = (tag: string) => {
    const next = [...tags, tag];
    setTags(next);
    setDraft({ ...form, tags: next });
  };

  const removeTag = (tag: string) => {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    setDraft({ ...form, tags: next });
  };

  const buildForm = (targetFile?: File | null) => {
    const fd = new FormData();
    const upload = targetFile === undefined ? file : targetFile;
    if (upload) fd.append('file', upload);
    if (existingPlugin) fd.append('target_plugin_key', existingPlugin.pluginKey);
    fd.append('summary', form.summary);
    fd.append('description_md', form.descriptionMd);
    fd.append('repo_url', form.repoUrl);
    fd.append('license', form.license);
    fd.append('tags', JSON.stringify(tags));
    return fd;
  };

  const validateMutation = useMutation({
    mutationFn: (targetFile?: File | null) =>
      api.pluginStore.validateSubmission(buildForm(targetFile)),
    onMutate: () => setSubmitMsg(null),
    onSuccess: (result) => {
      setIssues(result.issues ?? []);
      setManifest(result.manifest);
      setKind(result.kind);
      setIconDetected(Boolean(result.iconDetected));
      setIconPreview(result.iconPreview ?? '');
      if (result.ok) {
        setSubmitMsg({
          type: 'success',
          text: versionOnly ? '包校验通过，可以提交更新' : '包校验通过，可以填写展示信息',
        });
      } else {
        setSubmitMsg({ type: 'error', text: '包校验未通过，请根据下方问题修改后重新选择文件' });
      }
    },
    onError: (err) => {
      setIssues(extractIssues(err));
      setSubmitMsg({ type: 'error', text: err instanceof Error ? err.message : '校验失败' });
    },
  });

  const submitMutation = useMutation({
    mutationFn: () => api.pluginStore.createSubmission(buildForm()),
    onMutate: () => setSubmitMsg(null),
    onSuccess: (result) => {
      // 更新已有插件时不清除「新投稿」草稿
      if (!versionOnly) clearDraft();
      const baseText = versionOnly
        ? `插件已更新：${result.pluginKey} v${result.version}，等待审核`
        : `投稿成功：${result.pluginKey} v${result.version}，等待审核`;
      setSubmitMsg({
        type: result.iconUploadFailed ? 'error' : 'success',
        text: result.iconUploadFailed
          ? `${baseText}，但包内图标写入失败，请检查图标后重新提交`
          : baseText,
      });
      setFile(null);
      setIssues([]);
      setManifest(null);
      setKind('');
      setIconDetected(false);
      setIconPreview('');
      window.setTimeout(onSuccess, result.iconUploadFailed ? 3000 : 600);
    },
    onError: (err) => {
      setIssues(extractIssues(err));
      setSubmitMsg({ type: 'error', text: err instanceof Error ? err.message : '投稿失败' });
    },
  });

  const pickFile = (picked: File | null | undefined) => {
    if (!picked) return;
    if (picked.size > MAX_ARTIFACT_BYTES) {
      setSubmitMsg({ type: 'error', text: `插件包超过 ${formatBytes(MAX_ARTIFACT_BYTES)}` });
      return;
    }
    setFile(picked);
    setIssues([]);
    setManifest(null);
    setKind('');
    setIconDetected(false);
    setIconPreview('');
    setSubmitMsg(null);
    validateMutation.reset();
    // 与歌词投稿一致：选包后自动校验，通过后才展开展示信息
    validateMutation.mutate(picked);
  };

  const reset = () => {
    setFile(null);
    setForm(emptyForm);
    setTags([]);
    setIssues([]);
    setManifest(null);
    setKind('');
    setIconDetected(false);
    setIconPreview('');
    setSubmitMsg(null);
    validateMutation.reset();
    clearDraft();
  };

  const busy = validateMutation.isPending || submitMutation.isPending;
  const formReady = Boolean(file && validateMutation.data?.ok) && !validateMutation.isPending;
  const canSubmit = formReady && !busy;
  const canValidate = Boolean(file) && !busy;

  const manifestText = (key: string) => {
    const value = manifest?.[key];
    return typeof value === 'string' && value.trim() ? value : '';
  };

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="min-w-0 space-y-5"
    >
      {/* 插件包 */}
      <motion.div variants={fadeUp}>
        <label className="mb-1.5 block text-sm font-medium text-ink-2">插件包 (ZIP)</label>

        {!file && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pickFile(e.dataTransfer.files?.[0]);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed py-12 transition-colors ${
              dragging
                ? 'border-primary bg-primary-soft'
                : 'border-line bg-surface-2 hover:border-primary/50'
            }`}
          >
            <CloudUpload className="h-8 w-8 text-ink-3" />
            <p className="text-sm text-ink-2">拖拽 ZIP 文件到此处，或点击选择</p>
            <p className="text-xs text-ink-3">
              id / name / version / channel 从包内 manifest 读取，上限{' '}
              {formatBytes(MAX_ARTIFACT_BYTES)}
            </p>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />

        {file && (
          <div className="rounded-md border border-line bg-surface-2 p-4">
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <FileArchive className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate text-sm text-foreground">{file.name}</span>
                <span className="shrink-0 text-xs text-ink-3">{formatBytes(file.size)}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setIssues([]);
                  setManifest(null);
                  setKind('');
                  setIconDetected(false);
                  setSubmitMsg(null);
                }}
                className="shrink-0 rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-foreground"
                aria-label="移除文件"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {manifest && kind && (
              <>
                <p className="mt-3 flex items-center gap-1.5 text-sm text-primary">
                  <CheckCircle2 className="h-4 w-4" />
                  已识别为 {kind === 'theme' ? '主题包' : '功能插件'}
                </p>
                <div className="mt-2 grid gap-x-6 gap-y-1.5 border-t border-line pt-3 text-sm sm:grid-cols-2">
                  <p>
                    <span className="text-ink-3">插件 ID：</span>
                    <span className="break-all font-mono">{manifestText('id') || '—'}</span>
                  </p>
                  <p>
                    <span className="text-ink-3">名称：</span>
                    <span className="text-foreground">{manifestText('name') || '—'}</span>
                  </p>
                  <p>
                    <span className="text-ink-3">版本：</span>
                    <span className="font-mono">
                      {manifestText('version') ? `v${manifestText('version')}` : '—'}
                    </span>
                  </p>
                  <p>
                    <span className="text-ink-3">Channel：</span>
                    <span className="font-mono">{manifestText('channel') || kind || '—'}</span>
                  </p>
                </div>
                {iconDetected && (
                  <div className="mt-2 flex items-center gap-3 border-t border-line pt-3">
                    {iconPreview && (
                      <img
                        src={iconPreview}
                        alt="插件图标"
                        className="h-12 w-12 shrink-0 rounded-md border border-line object-cover"
                      />
                    )}
                    <p className="text-sm text-ink-2">已检测到包内图标，将作为插件图标。</p>
                  </div>
                )}
              </>
            )}

            {validateMutation.isPending && (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-ink-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在校验插件包…
              </p>
            )}

            {!validateMutation.isPending && validateMutation.data && !validateMutation.data.ok && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-sm text-error">校验未通过，请参考下方问题</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canValidate}
                  onClick={() => validateMutation.mutate(file)}
                >
                  重新校验
                </Button>
              </div>
            )}
          </div>
        )}
      </motion.div>

      {formReady && (
        <>
          {/* 展示信息 */}
          {!versionOnly && (
            <>
              <motion.div variants={fadeUp} className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm sm:col-span-2">
                  <span className="text-ink-2">简介</span>
                  <Input
                    value={form.summary}
                    maxLength={512}
                    placeholder="一句话介绍这个插件"
                    onChange={(e) => updateForm({ summary: e.target.value })}
                  />
                </label>
                <label className="grid gap-1.5 text-sm sm:col-span-2">
                  <span className="text-ink-2">详情（Markdown）</span>
                  <Textarea
                    rows={7}
                    value={form.descriptionMd}
                    placeholder="详细说明功能、使用方式、注意事项"
                    onChange={(e) => updateForm({ descriptionMd: e.target.value })}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-ink-2">仓库地址</span>
                  <Input
                    value={form.repoUrl}
                    placeholder="https://github.com/..."
                    onChange={(e) => updateForm({ repoUrl: e.target.value })}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-ink-2">许可证</span>
                  <Input
                    value={form.license}
                    maxLength={128}
                    placeholder="MIT / Apache-2.0"
                    onChange={(e) => updateForm({ license: e.target.value })}
                  />
                </label>
              </motion.div>

              {/* 标签 */}
              <motion.div variants={fadeUp}>
                <label className="mb-1.5 block text-sm font-medium text-ink-2">标签（可选）</label>
                <TagInput
                  tags={tags}
                  onAdd={addTag}
                  onRemove={removeTag}
                  maxTags={12}
                  hint="最多 12 个标签，每个标签最长 32 个字符"
                />
              </motion.div>
            </>
          )}
        </>
      )}

      {/* 校验问题 */}
      {issues.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>校验未通过（{issues.length} 项）</AlertTitle>
          <AlertDescription>
            <ul className="space-y-1">
              {issues.map((issue, i) => (
                <li key={`${issue.path}-${i}`} className="break-all">
                  <code className="font-mono">{issue.path || '/'}</code>：{issue.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* 提交消息 */}
      {submitMsg && (
        <Alert variant={submitMsg.type === 'success' ? 'success' : 'destructive'}>
          <AlertDescription>{submitMsg.text}</AlertDescription>
        </Alert>
      )}

      {/* 操作按钮 */}
      {formReady && (
        <motion.div variants={fadeUp} className="flex items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-card px-5 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            重置
          </button>
          <motion.button
            type="button"
            onClick={() => submitMutation.mutate()}
            disabled={!canSubmit}
            {...buttonTap}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {submitMutation.isPending ? (
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
