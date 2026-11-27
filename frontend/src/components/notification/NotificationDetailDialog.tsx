import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtom } from 'jotai';
import { Loader2 } from 'lucide-react';
import { notificationDetailAtom } from '@/atoms/message';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/** 把 RFC3339 时间格式化为本地可读时间 */
function formatDateTime(raw?: string): string {
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString('zh-CN', { hour12: false });
}

/** 消息详情弹窗 */
export function NotificationDetailDialog() {
  const [message, setMessage] = useAtom(notificationDetailAtom);
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [revoking, setRevoking] = useState(false);

  const action = message?.action;
  const isSecurity = message?.result === 'login_security';

  const close = () => setMessage(null);

  const go = (path: string) => {
    close();
    navigate(path);
  };

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
      close();
      navigate('/reset-password');
    }
  };

  return (
    <Dialog open={!!message} onOpenChange={(next) => !next && !revoking && close()}>
      <DialogContent className="max-w-[480px] rounded-xl border-line bg-card p-6 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="pr-6">{message?.title}</DialogTitle>
          {message?.createdAt && (
            <p className="text-xs text-ink-3">{formatDateTime(message.createdAt)}</p>
          )}
        </DialogHeader>

        <div className="max-h-[50vh] overflow-y-auto whitespace-pre-line break-words text-sm leading-relaxed text-ink-2">
          {message?.content}
        </div>

        <DialogFooter>
          {action && (
            <Button type="button" variant="outline" onClick={() => go(action.path)}>
              {action.label}
            </Button>
          )}
          {isSecurity ? (
            <Button type="button" variant="destructive" disabled={revoking} onClick={handleReject}>
              {revoking && <Loader2 className="h-4 w-4 animate-spin" />}
              {revoking ? '处理中…' : '不是我'}
            </Button>
          ) : (
            !action && (
              <Button type="button" variant="outline" onClick={close}>
                关闭
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
