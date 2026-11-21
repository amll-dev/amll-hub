import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ShieldAlert } from 'lucide-react';
import type { SecurityNotice } from '@/lib/auth';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/** 把后端返回的 RFC3339 时间格式化为本地可读时间 */
function formatTime(raw?: string): string {
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString('zh-CN', { hour12: false });
}

/**
 * 新设备/异地登录提示。
 *
 * 「是我」只关闭弹窗；「不是我」递增服务端会话版本，让包括 App 在内的旧 JWT 立即失效。
 */
export function SecurityNoticeModal({
  notices,
  onClose,
}: {
  notices: SecurityNotice[] | null;
  onClose: () => void;
}) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [revoking, setRevoking] = useState(false);

  const open = !!notices?.length;
  const hasLocation = notices?.some((n) => n.type === 'new_location') ?? false;
  const title = hasLocation ? '检测到异地登录' : '检测到新设备登录';

  const handleReject = async () => {
    if (revoking) return;
    setRevoking(true);
    try {
      // 先踢下线再清本地登录态；即使请求失败也要清掉本地 token
      await api.revokeSessions();
    } catch {
      // 网络异常时不阻塞退出
    } finally {
      setRevoking(false);
      logout();
      onClose();
      navigate('/reset-password');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !revoking && onClose()}>
      <DialogContent className="max-w-[420px] rounded-xl border-line bg-card p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft">
            <ShieldAlert className="h-5 w-5 text-primary" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-3">
              如果这不是你本人的操作，请立即退出所有设备并修改密码。
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3 rounded-lg bg-surface-2 p-4">
          {notices?.map((notice, index) => (
            <div key={`${notice.type}-${index}`} className="space-y-1 text-sm">
              <p className="text-xs font-medium text-ink-3">
                {notice.type === 'new_device' ? '新设备' : '新地点'}
              </p>
              {notice.device && (
                <p className="text-ink-2">
                  设备：<span className="text-foreground">{notice.device}</span>
                </p>
              )}
              {notice.location && (
                <p className="text-ink-2">
                  地点：<span className="text-foreground">{notice.location}</span>
                </p>
              )}
              {notice.time && (
                <p className="text-ink-2">
                  时间：<span className="text-foreground">{formatTime(notice.time)}</span>
                </p>
              )}
              {notice.ip && (
                <p className="text-ink-2">
                  IP：<span className="text-foreground">{notice.ip}</span>
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="mt-5 flex gap-3">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            disabled={revoking}
            onClick={onClose}
          >
            是我
          </Button>
          <Button type="button" className="flex-1" disabled={revoking} onClick={handleReject}>
            {revoking && <Loader2 className="h-4 w-4 animate-spin" />}
            {revoking ? '处理中…' : '不是我'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
