import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { NotificationBellResponsive } from '@/components/notification/NotificationBellResponsive';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Viewer } from '@/hooks/useViewers';

/** 在线观看者指示器 */
function ViewersIndicator({
  count,
  viewers,
  showModal,
  setShowModal,
}: {
  count: number;
  viewers: Viewer[];
  showModal: boolean;
  setShowModal: (v: boolean) => void;
}) {
  return (
    <Popover open={showModal} onOpenChange={setShowModal}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-primary/40 hover:text-primary"
        >
          <Users className="h-3.5 w-3.5" />
          {count > 0 ? `${count} 人正在看` : '当前无人观看'}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">正在查看（{count}）</h3>
          <button
            type="button"
            onClick={() => setShowModal(false)}
            className="text-ink-3 hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {viewers.length === 0 ? (
          <p className="py-4 text-center text-xs text-ink-3">暂无其他人在看</p>
        ) : (
          <ScrollArea className="max-h-72">
            <ul className="space-y-2 pr-2">
              {viewers.map((v) => (
                <li key={v.username} className="flex items-center gap-2">
                  {v.avatar ? (
                    <img
                      src={v.avatar}
                      alt=""
                      className="h-6 w-6 rounded-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-xs text-ink-3">
                      {(v.displayName || v.username).slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span className="text-sm text-foreground">{v.displayName || v.username}</span>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function DetailTopBar({
  pageTitle,
  backPath,
  backLabel,
  count,
  viewers,
  showModal,
  setShowModal,
}: {
  pageTitle: string;
  backPath: string;
  backLabel: string;
  count: number;
  viewers: Viewer[];
  showModal: boolean;
  setShowModal: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-card/80 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative flex shrink-0 items-center gap-3">
            <Link to="/">
              <img src="/logo.png" alt="AMLL-Hub" className="h-8 w-8 rounded-md object-contain" />
            </Link>
            <span className="text-lg font-bold tracking-tight text-foreground">
              AMLL Hub {pageTitle}
            </span>
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
              测试版
            </span>
            <span className="absolute inset-x-0 top-full mt-0.5 whitespace-nowrap text-center text-[9px] leading-none text-ink-3">
              测试版本，不代表最终品质
            </span>
          </div>
          <Separator orientation="vertical" className="mx-1 hidden h-5 sm:block" />
          <button
            type="button"
            onClick={() => navigate(backPath)}
            className="inline-flex shrink-0 items-center gap-1 text-sm text-ink-2 transition-colors hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{backLabel}</span>
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {user && <NotificationBellResponsive />}
          <ViewersIndicator
            count={count}
            viewers={viewers}
            showModal={showModal}
            setShowModal={setShowModal}
          />
        </div>
      </div>
    </header>
  );
}
