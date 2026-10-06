import { useAtom } from 'jotai';
import { ArrowLeft, Loader2, Save, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToolMode, toolModeAtom } from '@/editor/states/main.ts';
import { metadataEditorDialogAtom } from '@/editor/states/dialogs.ts';
import { EditorMenuBar } from '@/components/review/EditorTopMenu';
import { cn } from '@/lib/utils';

export interface EditorHeaderProps {
  title: string;
  subtitle: string;
  sources: Array<{ key: string; src: string; label: string }>;
  audioIndex: number;
  onAudioIndexChange: (index: number) => void;
  onBack: () => void;
  onSave: () => void;
  saving: boolean;
}

function ToolModeSwitch() {
  const [toolMode, setToolMode] = useAtom(toolModeAtom);

  const items = [
    { value: ToolMode.Edit, label: '编辑' },
    { value: ToolMode.Sync, label: '打轴' },
  ] as const;

  return (
    <div
      className="flex shrink-0 items-center rounded-md border border-border bg-surface p-0.5"
      role="tablist"
      aria-label="编辑模式"
    >
      {items.map((item) => {
        const active = toolMode === item.value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={item.label === '编辑' ? '编辑歌词与属性' : '按音频打轴'}
            onClick={() => setToolMode(item.value)}
            className={cn(
              'rounded px-3 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

// 编辑工作台的顶部操作条
export function LyricEditorHeader({
  title,
  subtitle,
  sources,
  audioIndex,
  onAudioIndexChange,
  onBack,
  onSave,
  saving,
}: EditorHeaderProps) {
  const [, setMetadataEditorDialog] = useAtom(metadataEditorDialogAtom);

  return (
    <div className="z-50 flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBack} title="返回审核详情">
          <ArrowLeft className="size-4" />
          返回
        </Button>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{title}</div>
          <div className="truncate text-[11px] text-ink-3">{subtitle}</div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ToolModeSwitch />
        <EditorMenuBar />
        {/* 分隔：菜单类操作与右侧的「元数据 / 提交」动作按钮区分开 */}
        <div className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMetadataEditorDialog(true)}
          title="编辑歌曲元数据（曲名 / 歌手 / 专辑 / 歌词作者等）"
        >
          <Tags className="size-4" />
          元数据
        </Button>
        {sources.length > 1 && (
          <select
            value={audioIndex}
            onChange={(e) => onAudioIndexChange(Number(e.target.value))}
            className="max-w-40 rounded border border-border bg-background px-2 py-1 text-xs"
            title="切换参考音频"
          >
            {sources.map((s, i) => (
              <option key={s.key} value={i}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        <Button size="sm" onClick={onSave} disabled={saving} title="提交审核结果（Enter）">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          提交
        </Button>
      </div>
    </div>
  );
}
