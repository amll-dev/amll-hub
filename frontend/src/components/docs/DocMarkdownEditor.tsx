import { lazy, Suspense, useCallback, useDeferredValue, useMemo, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { renderDocsMarkdown } from '@/lib/markdown';
import { resolvedThemeAtom } from '@/atoms/theme';
import { Skeleton } from '@/components/ui/Skeleton';
import '@uiw/react-md-editor/markdown-editor.css';

// 编辑器只在文档编辑页加载，避免进入首屏 bundle
const MDEditor = lazy(() => import('@uiw/react-md-editor/nohighlight'));

/** 在光标处插入文本；没有光标信息时追加到末尾 */
function insertAt(
  value: string,
  start: number | null,
  end: number | null,
  snippet: string
): string {
  if (start === null || end === null) {
    return `${value}${value.endsWith('\n') || !value ? '' : '\n'}${snippet}`;
  }
  return `${value.slice(0, start)}${snippet}${value.slice(end)}`;
}

/**
 * 文档 Markdown 编辑器：左侧 Markdown、右侧用与详情页同一条渲染管线预览
 * （不用 MDEditor 自带预览，避免 prism/hljs 两套高亮与样式分叉）。
 */
export function DocMarkdownEditor({
  value,
  onChange,
  slug,
}: {
  value: string;
  onChange: (next: string) => void;
  slug?: string;
}) {
  const theme = useAtomValue(resolvedThemeAtom);
  // 事件回调里读最新值，避免 setState 闭包过期
  const valueRef = useRef(value);
  valueRef.current = value;

  // 输入时先更新文本域，再把预览延后一帧，避免 40KB 文档每次按键都重排
  const deferredValue = useDeferredValue(value);
  const previewHtml = useMemo(() => renderDocsMarkdown(deferredValue), [deferredValue]);

  const uploadAndInsert = useCallback(
    async (file: File, target: HTMLTextAreaElement | null) => {
      const toastId = toast.loading('正在上传图片…');
      try {
        const { key } = await api.docs.uploadImage(file, slug);
        const snippet = `![${file.name.replace(/\.[^.]+$/, '')}](${api.uploadFileUrl(key)})`;
        const next = insertAt(
          valueRef.current,
          target?.selectionStart ?? null,
          target?.selectionEnd ?? null,
          snippet
        );
        onChange(next);
        toast.success('图片已插入', { id: toastId });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '图片上传失败', { id: toastId });
      }
    },
    [onChange, slug]
  );

  return (
    <div data-color-mode={theme} className="docs-editor grid gap-4 lg:grid-cols-2">
      <Suspense fallback={<Skeleton className="h-[620px] w-full rounded-md" />}>
        <MDEditor
          value={value}
          onChange={(next) => onChange(next ?? '')}
          height={620}
          preview="edit"
          visibleDragbar={false}
          textareaProps={{
            placeholder: '支持 Markdown；可直接粘贴或拖拽图片上传',
            onPaste: (e) => {
              const file = Array.from(e.clipboardData.files).find((f) =>
                f.type.startsWith('image/')
              );
              if (!file) return;
              e.preventDefault();
              void uploadAndInsert(file, e.currentTarget);
            },
            onDrop: (e) => {
              const file = Array.from(e.dataTransfer.files).find((f) =>
                f.type.startsWith('image/')
              );
              if (!file) return;
              e.preventDefault();
              void uploadAndInsert(file, e.currentTarget);
            },
          }}
        />
      </Suspense>

      <div className="h-[620px] overflow-y-auto rounded-md border border-input bg-card px-5 py-4">
        {previewHtml ? (
          <div
            className="prose legal-prose docs-prose"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        ) : (
          <p className="text-sm text-ink-3">预览区：开始输入后显示渲染结果</p>
        )}
      </div>
    </div>
  );
}
