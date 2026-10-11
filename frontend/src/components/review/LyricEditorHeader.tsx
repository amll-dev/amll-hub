import { useAtom } from 'jotai';
import { ArrowLeft, Check, ChevronDown, Loader2, Music, Save, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ToolMode, toolModeAtom } from '@/editor/states/main.ts';
import { metadataEditorDialogAtom } from '@/editor/states/dialogs.ts';
import { EditorMenuBar } from '@/components/review/EditorTopMenu';
import { UserMenu } from '@/components/UserMenu';
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

/** 参考音频选择器 */
function AudioSourceSelect({
  sources,
  audioIndex,
  onAudioIndexChange,
}: Pick<EditorHeaderProps, 'sources' | 'audioIndex' | 'onAudioIndexChange'>) {
  if (sources.length <= 1) return null;

  const current = sources[audioIndex] ?? sources[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="切换参考音频"
          className={cn(
            'group flex h-8 max-w-56 items-center gap-1.5 rounded-md border border-input bg-card pl-2 pr-1.5',
            'text-xs font-medium text-ink transition-colors hover:border-primary/60',
            'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
            'data-[state=open]:border-primary'
          )}
        >
          <Music className="size-3.5 shrink-0 text-ink-3" />
          <span className="shrink-0 text-ink-3">参考音频</span>
          <span className="min-w-0 flex-1 truncate text-left">{current?.label ?? '未选择'}</span>
          <ChevronDown
            className="size-3.5 shrink-0 text-ink-3 transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-72">
        {sources.map((source, index) => (
          <DropdownMenuItem
            key={source.key}
            onSelect={() => onAudioIndexChange(index)}
            className="gap-2"
          >
            <Check
              className={cn('size-4 shrink-0 text-primary', index !== audioIndex && 'invisible')}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate" title={source.label}>
              {source.label}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
        <AudioSourceSelect
          sources={sources}
          audioIndex={audioIndex}
          onAudioIndexChange={onAudioIndexChange}
        />
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
        <Button size="sm" onClick={onSave} disabled={saving} title="提交审核结果（Enter）">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          提交
        </Button>
        <UserMenu />
      </div>
    </div>
  );
}
