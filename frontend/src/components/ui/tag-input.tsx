import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';

/** 与后端 normalizePluginTags 对齐：单标签超过 32 字会被丢弃，前端先截断，
 *  避免用户看到「加了但没保存」的黑洞 */
const MAX_TAG_LEN = 32;

/** 标签输入 */
export function TagInput({
  tags,
  onAdd,
  onRemove,
  autoTags = [],
  maxTags,
  hint,
}: {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  /** 自动识别的标签，用于星标展示与说明 */
  autoTags?: string[];
  /** 最多可添加的标签数；不传表示不限制 */
  maxTags?: number;
  /** 输入框下方的补充说明 */
  hint?: string;
}) {
  const [input, setInput] = useState('');

  /** 批量添加：粘贴「流行,摇滚」时按逗号/顿号拆成多个标签 */
  const addMany = (raw: string) => {
    const parts = raw
      .split(/[,，、]/)
      .map((part) => part.trim().slice(0, MAX_TAG_LEN))
      .filter(Boolean);
    // tags 是父组件的 props，连续 onAdd 期间不会即时更新，本地再记一份去重
    const added: string[] = [];
    let remaining = maxTags ? Math.max(0, maxTags - tags.length) : Number.POSITIVE_INFINITY;
    for (const part of parts) {
      if (remaining <= 0) break;
      if (tags.includes(part)) continue;
      if (added.includes(part)) continue;
      onAdd(part);
      added.push(part);
      remaining -= 1;
    }
  };

  const add = () => {
    if (!input.trim()) return;
    addMany(input);
    setInput('');
  };

  return (
    <>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onPaste={(e) => {
          // 只有带分隔符的粘贴才接管：普通文本继续走默认行为，避免选区/撤销被破坏
          const text = e.clipboardData.getData('text');
          if (!text || !/[,，、]/.test(text)) return;
          e.preventDefault();
          addMany(`${input}${text}`);
          setInput('');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        placeholder="输入标签后按回车添加"
        className="h-10 w-full rounded-md border border-input bg-surface-2 px-4 text-sm outline-none focus:border-primary"
      />
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {tags.map((tag) => {
            const auto = autoTags.includes(tag);
            return (
              <span
                key={tag}
                title={auto ? '根据歌词文件自动识别，可删除' : undefined}
                className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1 text-xs text-primary"
              >
                {auto && <Sparkles className="h-3 w-3" aria-hidden />}
                {tag}
                <button
                  type="button"
                  onClick={() => onRemove(tag)}
                  className="text-primary/60 hover:text-primary"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      {autoTags.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-3">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          带星标的标签由文件元数据与歌词特性自动识别，可手动删除
        </p>
      )}
      {hint && <p className="mt-2 text-xs text-ink-3">{hint}</p>}
    </>
  );
}
