import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ArrowLeft, Save, Shield, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { DOC_GROUP_OPTIONS, DOC_SLUG_PATTERN, DOC_STATUS_OPTIONS } from '@/lib/docs';
import { queryKeys } from '@/lib/query';
import { useAuth } from '@/hooks/useAuth';
import type { DocGroup, DocStatus } from '@/lib/types';
import { DocMarkdownEditor } from '@/components/docs/DocMarkdownEditor';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DocSelect } from '@/components/docs/DocSelect';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface DocForm {
  slug: string;
  title: string;
  group: DocGroup;
  status: DocStatus;
  sortOrder: number;
  note: string;
  content: string;
}

const emptyForm: DocForm = {
  slug: '',
  title: '',
  group: 'lyrics',
  status: 'draft',
  sortOrder: 0,
  note: '',
  content: '',
};

export function DocEditorPanel({
  slug,
  onSaved,
  onCancel,
  onDeleted,
}: {
  slug?: string;
  onSaved: (slug: string) => void;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const isEdit = Boolean(slug);
  const queryClient = useQueryClient();
  const { user, openLogin } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.docDetail(slug ?? ''),
    queryFn: () => api.docs.detail(slug as string),
    enabled: isEdit,
  });
  const doc = data?.document;
  const canEdit = data?.canEdit ?? Boolean(user?.isReviewer || user?.isAdmin);

  const [form, setForm] = useState<DocForm>(emptyForm);
  useEffect(() => {
    if (!doc) return;
    setForm({
      slug: doc.slug,
      title: doc.title,
      group: doc.group,
      status: doc.status,
      sortOrder: doc.sortOrder,
      note: '',
      content: doc.content,
    });
  }, [doc]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['docs'] });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        slug: form.slug.trim(),
        title: form.title.trim(),
        group: form.group,
        status: form.status,
        sortOrder: form.sortOrder,
        content: form.content,
        note: form.note.trim(),
      };
      return isEdit ? api.docs.update(doc!.id, payload) : api.docs.create(payload);
    },
    onSuccess: (res) => {
      void invalidate();
      toast.success('已保存');
      onSaved(res.slug);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '保存失败'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.docs.remove(doc!.id),
    onSuccess: () => {
      void invalidate();
      toast.success('文档已删除');
      onDeleted();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '删除失败'),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', 'overwrite');
      fd.append('docId', String(doc!.id));
      fd.append('note', form.note.trim() || `上传 ${file.name} 覆盖`);
      return api.docs.uploadMarkdown(fd);
    },
    onSuccess: () => {
      void invalidate();
      toast.success('.md 已覆盖，旧内容已存入历史版本');
      onSaved(slug as string);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '上传失败'),
  });

  const slugInvalid = form.slug.trim().length > 0 && !DOC_SLUG_PATTERN.test(form.slug.trim());
  const canSubmit =
    form.title.trim().length > 0 &&
    form.slug.trim().length >= 2 &&
    !slugInvalid &&
    (form.status === 'draft' || form.content.trim().length > 0);

  if (isEdit && isLoading) {
    return <p className="py-12 text-center text-sm text-ink-3">加载中…</p>;
  }

  if (!canEdit) {
    if (!user) {
      return (
        <EmptyState
          icon={Shield}
          title="请先登录"
          description="编辑文档需要审核员或超级管理员权限"
          action={
            <Button size="sm" onClick={() => openLogin('/review')}>
              登录
            </Button>
          }
        />
      );
    }
    return <EmptyState icon={Shield} title="需要审核员或超级管理员权限" />;
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <ArrowLeft className="h-4 w-4" />
            返回
          </Button>
          <h1 className="text-lg font-semibold text-foreground">
            {isEdit ? `编辑：${doc?.title ?? ''}` : '新建文档'}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isEdit && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs text-ink-2 hover:bg-surface-2">
              <Upload className="h-3.5 w-3.5" />
              上传 .md 覆盖
              <input
                type="file"
                accept=".md,text/markdown"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  if (!file.name.toLowerCase().endsWith('.md')) {
                    toast.error('只支持 .md 文件');
                    return;
                  }
                  uploadMutation.mutate(file);
                }}
              />
            </label>
          )}
          {isEdit && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-error">
                  <Trash2 className="h-4 w-4" />
                  删除
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>删除这篇文档？</AlertDialogTitle>
                  <AlertDialogDescription>
                    «{doc?.title}» 及其全部历史版本都会被删除，无法恢复。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteMutation.mutate()}>
                    确认删除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button
            size="sm"
            disabled={!canSubmit || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            <Save className="h-4 w-4" />
            {saveMutation.isPending ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="doc-title">标题</Label>
          <Input
            id="doc-title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="例如：上传歌词"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="doc-slug">slug（URL，小写字母/数字/中划线）</Label>
          <Input
            id="doc-slug"
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            placeholder="upload-guide"
            className={slugInvalid ? 'border-error' : ''}
          />
          {slugInvalid && <p className="text-xs text-error">slug 格式不合法</p>}
        </div>
        <div className="grid grid-cols-3 gap-3 sm:col-span-2">
          <div className="space-y-1.5">
            <Label htmlFor="doc-group">分组</Label>
            <DocSelect
              id="doc-group"
              className="h-10"
              value={form.group}
              onValueChange={(v) => setForm((f) => ({ ...f, group: v as DocGroup }))}
              options={DOC_GROUP_OPTIONS}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-status">状态</Label>
            <DocSelect
              id="doc-status"
              className="h-10"
              value={form.status}
              onValueChange={(v) => setForm((f) => ({ ...f, status: v as DocStatus }))}
              options={DOC_STATUS_OPTIONS}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-order">排序</Label>
            <Input
              id="doc-order"
              type="number"
              value={form.sortOrder}
              onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) || 0 }))}
            />
          </div>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="doc-note">本次修改备注（写入版本历史，可留空）</Label>
          <Input
            id="doc-note"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="例如：补充逐字音译说明"
          />
        </div>
      </div>

      <DocMarkdownEditor
        value={form.content}
        onChange={(content) => setForm((f) => ({ ...f, content }))}
        slug={form.slug || slug}
      />
      <p className="mt-2 text-xs text-ink-3">
        正文 {new Blob([form.content]).size} 字节，上限 1 MiB；草稿可留空。
      </p>
    </div>
  );
}
