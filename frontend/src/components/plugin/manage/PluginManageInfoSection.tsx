import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fadeUp } from '@/lib/motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TagInput } from '@/components/ui/tag-input';
import { Textarea } from '@/components/ui/textarea';
import { MetaItem } from '@/components/submission/MetaItem';
import { renderMarkdown } from '@/components/submission/shared';
import type { Plugin } from '@/lib/types';

interface MetadataForm {
  summary: string;
  descriptionMd: string;
  repoUrl: string;
  license: string;
}

/** 插件信息标签 */
export function PluginManageInfoSection({
  plugin,
  isOwner,
  onSaved,
}: {
  plugin: Plugin;
  isOwner: boolean;
  onSaved: () => void;
}) {
  const [editingMeta, setEditingMeta] = useState(false);
  const [form, setForm] = useState<MetadataForm>({
    summary: '',
    descriptionMd: '',
    repoUrl: '',
    license: '',
  });
  const [tags, setTags] = useState<string[]>([]);

  // 切换到另一个插件时退出编辑态
  useEffect(() => {
    setEditingMeta(false);
  }, [plugin.id]);

  // 编辑期间不覆盖用户草稿；退出编辑后再同步服务端最新值
  useEffect(() => {
    if (editingMeta) return;
    setForm({
      summary: plugin.summary,
      descriptionMd: plugin.descriptionMd,
      repoUrl: plugin.repoUrl,
      license: plugin.license,
    });
    setTags(plugin.tags);
  }, [plugin, editingMeta]);

  const descriptionHtml = useMemo(
    () => renderMarkdown(plugin.descriptionMd),
    [plugin.descriptionMd]
  );

  const updateMetaMutation = useMutation({
    mutationFn: () =>
      api.pluginStore.updateMyPlugin(plugin.pluginKey, {
        summary: form.summary,
        descriptionMd: form.descriptionMd,
        // 当前表单不编辑主页，保留插件原有值，避免被清空
        homepage: plugin.homepage,
        repoUrl: form.repoUrl,
        license: form.license,
        tags,
      }),
    onSuccess: () => {
      toast.success('插件资料已更新');
      setEditingMeta(false);
      onSaved();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '保存失败'),
  });

  const addTag = (tag: string) => {
    setTags([...tags, tag]);
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  return (
    <motion.section variants={fadeUp} className="rounded-lg border border-line bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">插件信息</h3>
        {isOwner && (
          <Button variant="ghost" size="sm" onClick={() => setEditingMeta((v) => !v)}>
            <Pencil className="h-4 w-4" />
            {editingMeta ? '收起编辑' : '编辑资料'}
          </Button>
        )}
      </div>

      <motion.div
        key={editingMeta ? 'meta-edit' : 'meta-view'}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
      >
        {!editingMeta ? (
          <>
            <dl>
              <MetaItem label="插件 ID" value={plugin.pluginKey} />
              <MetaItem label="名称" value={plugin.name} />
              <MetaItem label="作者" value={plugin.author} />
              <MetaItem label="许可证" value={plugin.license} />
              <MetaItem label="仓库地址" value={plugin.repoUrl} />
            </dl>
            <div className="mt-3 border-t border-line pt-3">
              <div className="mb-1 text-xs text-ink-3">简介</div>
              <div className="whitespace-pre-wrap text-sm text-foreground">
                {plugin.summary || '—'}
              </div>
            </div>
            <div className="mt-3 border-t border-line pt-3">
              <div className="mb-1 text-xs text-ink-3">详情</div>
              {descriptionHtml ? (
                <div
                  className="comment-markdown text-sm leading-relaxed text-foreground"
                  dangerouslySetInnerHTML={{ __html: descriptionHtml }}
                />
              ) : (
                <p className="text-sm text-ink-3">暂无详情</p>
              )}
            </div>
            {plugin.tags.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="mb-1 text-xs text-ink-3">标签</div>
                <div className="flex flex-wrap gap-1.5">
                  {plugin.tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center rounded-full bg-primary-soft px-2.5 py-0.5 text-xs text-primary"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm sm:col-span-2">
                <span className="text-ink-3">简介</span>
                <Input
                  value={form.summary}
                  maxLength={512}
                  onChange={(e) => setForm({ ...form, summary: e.target.value })}
                />
              </label>
              <label className="grid gap-1.5 text-sm sm:col-span-2">
                <span className="text-ink-3">详情（Markdown）</span>
                <Textarea
                  rows={7}
                  value={form.descriptionMd}
                  onChange={(e) => setForm({ ...form, descriptionMd: e.target.value })}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="text-ink-3">仓库地址</span>
                <Input
                  value={form.repoUrl}
                  placeholder="https://github.com/..."
                  onChange={(e) => setForm({ ...form, repoUrl: e.target.value })}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="text-ink-3">许可证</span>
                <Input
                  value={form.license}
                  maxLength={128}
                  onChange={(e) => setForm({ ...form, license: e.target.value })}
                />
              </label>
            </div>

            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-medium text-ink-2">标签（可选）</label>
              <TagInput tags={tags} onAdd={addTag} onRemove={removeTag} maxTags={12} />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditingMeta(false)}>
                取消
              </Button>
              <Button
                onClick={() => updateMetaMutation.mutate()}
                disabled={updateMetaMutation.isPending}
              >
                {updateMetaMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                保存插件资料
              </Button>
            </div>
          </>
        )}
      </motion.div>
    </motion.section>
  );
}
