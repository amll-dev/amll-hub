import { useCallback, useDeferredValue, useMemo, useRef } from 'react';
import { Bold, Code, ImagePlus, Italic, Link2, List, Quote } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { renderDocsMarkdown } from '@/lib/markdown';

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

/** 给选区所在行的行首加前缀（标题 / 引用 / 列表） */
function prefixLines(value: string, start: number, end: number, prefix: string): string {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const block = value.slice(lineStart, end);
  const patched = block
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
  return `${value.slice(0, lineStart)}${patched}${value.slice(end)}`;
}

interface ToolbarAction {
  key: string;
  label: string;
  icon: typeof Bold;
  run: (value: string, start: number, end: number) => { next: string; caret: number };
}

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  {
    key: 'bold',
    label: '加粗',
    icon: Bold,
    run: (value, start, end) => {
      const selected = value.slice(start, end) || '加粗文字';
      const next = `${value.slice(0, start)}**${selected}**${value.slice(end)}`;
      return { next, caret: start + selected.length + 4 };
    },
  },
  {
    key: 'italic',
    label: '斜体',
    icon: Italic,
    run: (value, start, end) => {
      const selected = value.slice(start, end) || '斜体文字';
      const next = `${value.slice(0, start)}*${selected}*${value.slice(end)}`;
      return { next, caret: start + selected.length + 2 };
    },
  },
  {
    key: 'quote',
    label: '引用',
    icon: Quote,
    run: (value, start, end) => {
      const next = prefixLines(value, start, end, '> ');
      return { next, caret: next.length };
    },
  },
  {
    key: 'list',
    label: '列表',
    icon: List,
    run: (value, start, end) => {
      const next = prefixLines(value, start, end, '- ');
      return { next, caret: next.length };
    },
  },
  {
    key: 'code',
    label: '行内代码',
    icon: Code,
    run: (value, start, end) => {
      const selected = value.slice(start, end) || 'code';
      const next = `${value.slice(0, start)}\`${selected}\`${value.slice(end)}`;
      return { next, caret: start + selected.length + 2 };
    },
  },
  {
    key: 'link',
    label: '链接',
    icon: Link2,
    run: (value, start, end) => {
      const selected = value.slice(start, end) || '链接文字';
      const next = `${value.slice(0, start)}[${selected}](https://)${value.slice(end)}`;
      // 光标落在 (https://) 的右括号前，方便直接粘贴地址
      return { next, caret: start + selected.length + 11 };
    },
  },
];

/**
 * 文档 Markdown 编辑器：左侧 Markdown、右侧用与详情页同一条渲染管线预览。
 *
 * 之前用的是 @uiw/react-md-editor 但关掉了它自带的预览（右侧预览走自己的
 * renderDocsMarkdown），等于把 react-markdown + refractor + prismjs 的整棵依赖树
 * 打进了 vendor-docs-editor（458KB / gzip 133KB）却一行预览代码都没用上。
 * 这里换回原生 textarea + 一排工具栏，行为（输入、粘贴/拖拽图片上传）保持一致。
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
  // 事件回调里读最新值，避免 setState 闭包过期
  const valueRef = useRef(value);
  valueRef.current = value;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 输入时先更新文本域，再把预览延后一帧，避免 40KB 文档每次按键都重排
  const deferredValue = useDeferredValue(value);
  const previewHtml = useMemo(() => renderDocsMarkdown(deferredValue), [deferredValue]);

  /** 改完文本后把光标放回合适位置，否则每点一次工具栏都会跳回开头 */
  const applyText = useCallback(
    (next: string, caret: number) => {
      onChange(next);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(caret, caret);
      });
    },
    [onChange]
  );

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

  /** 从剪贴板 / 拖拽事件里取第一张图片，取到就吞掉默认行为自己上传 */
  const handleFile = useCallback(
    (file: File | undefined, el: HTMLTextAreaElement) => {
      if (!file) return false;
      void uploadAndInsert(file, el);
      return true;
    },
    [uploadAndInsert]
  );

  const runAction = (action: ToolbarAction) => {
    const el = textareaRef.current;
    if (!el) return;
    const { next, caret } = action.run(valueRef.current, el.selectionStart, el.selectionEnd);
    applyText(next, caret);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex h-[620px] flex-col overflow-hidden rounded-md border border-input bg-card focus-within:ring-1 focus-within:ring-primary">
        <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface-2 px-2 py-1.5">
          {TOOLBAR_ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              title={action.label}
              aria-label={action.label}
              onClick={() => runAction(action)}
              className="rounded p-1.5 text-ink-2 transition-colors hover:bg-primary-soft hover:text-primary"
            >
              <action.icon className="h-4 w-4" />
            </button>
          ))}
          <button
            type="button"
            title="插入图片"
            aria-label="插入图片"
            onClick={() => fileInputRef.current?.click()}
            className="rounded p-1.5 text-ink-2 transition-colors hover:bg-primary-soft hover:text-primary"
          >
            <ImagePlus className="h-4 w-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file && textareaRef.current) void uploadAndInsert(file, textareaRef.current);
            }}
          />
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="支持 Markdown；可直接粘贴或拖拽图片上传"
          spellCheck={false}
          className="flex-1 resize-none bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-foreground outline-none"
          onPaste={(e) => {
            const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
            if (handleFile(file, e.currentTarget)) e.preventDefault();
          }}
          onDrop={(e) => {
            const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
            if (handleFile(file, e.currentTarget)) e.preventDefault();
          }}
        />
      </div>

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
