import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FilePlus2, FileText, PencilLine, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { DOC_GROUP_OPTIONS, DOC_STATUS_LABEL, DOC_STATUS_OPTIONS, groupLabel } from '@/lib/docs';
import { formatDate } from '@/lib/format';
import { queryKeys } from '@/lib/query';
import type { DocGroup, DocStatus } from '@/lib/types';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { DocSelect } from '@/components/docs/DocSelect';
import { ListPagination } from '@/components/ui/list-pagination';
import { Skeleton } from '@/components/ui/Skeleton';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** 文档管理面板：表格 + 筛选 + 上传，由审核中心的「文档管理」使用 */
export function DocManagePanel({
  onCreate,
  onEdit,
}: {
  onCreate: () => void;
  onEdit: (slug: string) => void;
}) {
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('');
  const [group, setGroup] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.docManage({ status, group, q, page }),
    queryFn: () => api.docs.manageList({ status, group, q, page, pageSize: 20 }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.docs.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['docs'] });
      toast.success('文档已删除');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '删除失败'),
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / 20));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">文档管理</h1>
          <p className="mt-1 text-xs text-ink-3">
            共 {data?.total ?? 0} 篇
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" />
            上传 .md
          </Button>
          <Button size="sm" onClick={onCreate}>
            <FilePlus2 className="h-4 w-4" />
            新建文档
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="搜索标题或 slug"
          className="h-8 w-52"
        />
        <DocSelect
          className="w-auto"
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[{ value: '', label: '全部状态' }, ...DOC_STATUS_OPTIONS]}
        />
        <DocSelect
          className="w-auto"
          value={group}
          onValueChange={(v) => {
            setGroup(v);
            setPage(1);
          }}
          options={[{ value: '', label: '全部分组' }, ...DOC_GROUP_OPTIONS]}
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-md" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={FileText} title="没有匹配的文档" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs text-ink-3">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">标题</th>
                  <th className="px-4 py-2.5 text-left font-medium">分组</th>
                  <th className="px-4 py-2.5 text-left font-medium">状态</th>
                  <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">slug</th>
                  <th className="hidden px-4 py-2.5 text-left font-medium md:table-cell">更新</th>
                  <th className="px-4 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((item) => (
                  <tr key={item.id} className="hover:bg-surface-2/60">
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/docs/${item.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-foreground hover:text-primary"
                      >
                        {item.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">{groupLabel(item.group)}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={item.status === 'published' ? 'success' : 'secondary'}>
                        {DOC_STATUS_LABEL[item.status]}
                      </Badge>
                    </td>
                    <td className="hidden px-4 py-2.5 font-mono text-xs text-ink-3 sm:table-cell">
                      {item.slug}
                    </td>
                    <td className="hidden px-4 py-2.5 text-xs text-ink-3 md:table-cell">
                      {formatDate(item.updatedAt)}
                      {item.updatedBy ? ` · ${item.updatedBy}` : ''}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => onEdit(item.slug)}>
                          <PencilLine className="h-3.5 w-3.5" />
                          编辑
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-error">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>删除「{item.title}」？</AlertDialogTitle>
                              <AlertDialogDescription>
                                文档与全部历史版本都会被删除，无法恢复。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteMutation.mutate(item.id)}>
                                确认删除
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="mt-4">
              <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </>
      )}

      <DocUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={onEdit} />
    </div>
  );
}

const emptyUpload = {
  mode: 'create' as 'create' | 'overwrite',
  docId: '',
  slug: '',
  title: '',
  group: 'lyrics' as DocGroup,
  status: 'published' as DocStatus,
};

/** 上传 .md：新建或覆盖现有文档 */
function DocUploadDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: (slug: string) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyUpload);
  const [file, setFile] = useState<File | null>(null);

  const { data: docList } = useQuery({
    queryKey: queryKeys.docManage({ status: '', group: '', q: '', page: 1 }),
    queryFn: () => api.docs.manageList({ pageSize: 50 }),
    enabled: open,
  });

  const uploadMutation = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', file as File);
      fd.append('mode', form.mode);
      if (form.mode === 'overwrite') {
        fd.append('docId', form.docId);
      } else {
        fd.append('slug', form.slug.trim());
        fd.append('title', form.title.trim());
        fd.append('group', form.group);
        fd.append('status', form.status);
      }
      return api.docs.uploadMarkdown(fd);
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['docs'] });
      toast.success(form.mode === 'create' ? '文档已创建' : '.md 已覆盖');
      onOpenChange(false);
      setForm(emptyUpload);
      setFile(null);
      onUploaded(res.slug);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '上传失败'),
  });

  const canSubmit =
    Boolean(file) &&
    (form.mode === 'overwrite' ? Boolean(form.docId) : form.slug.trim().length >= 2);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>上传 Markdown</DialogTitle>
          <DialogDescription>
            图片请先在编辑器里上传；这里的 .md 只包含正文与相对图片引用。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>方式</Label>
            <DocSelect
              className="h-10"
              value={form.mode}
              onValueChange={(v) => setForm((f) => ({ ...f, mode: v as 'create' | 'overwrite' }))}
              options={[
                { value: 'create', label: '新建文档' },
                { value: 'overwrite', label: '覆盖现有文档' },
              ]}
            />
          </div>

          {form.mode === 'overwrite' ? (
            <div className="space-y-1.5">
              <Label>目标文档</Label>
              <DocSelect
                className="h-10"
                value={form.docId}
                onValueChange={(v) => setForm((f) => ({ ...f, docId: v }))}
                placeholder="选择要覆盖的文档"
                options={(docList?.items ?? []).map((item) => ({
                  value: String(item.id),
                  label: `${item.title}（${item.slug}）`,
                }))}
              />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>标题</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="留空则取文件名"
                />
              </div>
              <div className="space-y-1.5">
                <Label>slug</Label>
                <Input
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                  placeholder="upload-guide"
                />
              </div>
              <div className="space-y-1.5">
                <Label>分组</Label>
                <DocSelect
                  className="h-10"
                  value={form.group}
                  onValueChange={(v) => setForm((f) => ({ ...f, group: v as DocGroup }))}
                  options={DOC_GROUP_OPTIONS}
                />
              </div>
              <div className="space-y-1.5">
                <Label>状态</Label>
                <DocSelect
                  className="h-10"
                  value={form.status}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v as DocStatus }))}
                  options={DOC_STATUS_OPTIONS}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>文件</Label>
            <label className="flex cursor-pointer items-center justify-between rounded-md border-2 border-dashed border-line bg-surface-2 px-3 py-6 text-sm text-ink-3 hover:border-primary/50">
              <span className="truncate">{file ? file.name : '选择 .md 文件'}</span>
              <input
                type="file"
                accept=".md,text/markdown"
                className="hidden"
                onChange={(e) => {
                  const picked = e.target.files?.[0] ?? null;
                  if (picked && !picked.name.toLowerCase().endsWith('.md')) {
                    toast.error('只支持 .md 文件');
                    return;
                  }
                  setFile(picked);
                }}
              />
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit || uploadMutation.isPending}
            onClick={() => uploadMutation.mutate()}
          >
            {uploadMutation.isPending ? '上传中…' : '上传'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
