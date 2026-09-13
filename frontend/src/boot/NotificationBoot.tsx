import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtomValue, getDefaultStore } from 'jotai';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { wsUrl, type NotificationPush } from '@/lib/ws';
import type { NotificationListResult } from '@/lib/types';
import { getToken } from '@/lib/auth';
import { userAtom } from '@/atoms/auth';
import {
  bumpServerUnread,
  messagePanelOpenAtom,
  prependMessage,
  setServerUnread,
} from '@/atoms/message';

const store = getDefaultStore();

/** 面板第 1 页缓存 key（WS 推送精确更新用） */
const firstPageKey = queryKeys.notifications({ page: 1, limit: 20, type: 'all' });

/**
 * 消息中心引导（全局副作用宿主，渲染 null）：
 * 1. 登录后建立 /ws/notifications 连接，实时接收新消息推送
 * 2. 30s 轮询未读数兜底（Redis Pub/Sub at-most-once 可能丢推送）
 * 未登录不建连；退出登录连接随 effect 清理关闭。
 */
export function NotificationBoot() {
  const user = useAtomValue(userAtom);
  const queryClient = useQueryClient();

  // 30s 轮询服务端权威未读数
  const unreadQuery = useQuery({
    queryKey: queryKeys.notificationUnread,
    queryFn: () => api.getUnreadCount(),
    refetchInterval: 30_000,
    enabled: !!user,
  });
  useEffect(() => {
    if (unreadQuery.data) setServerUnread(unreadQuery.data.unread);
  }, [unreadQuery.data]);

  const userName = user?.name;
  useEffect(() => {
    if (!userName) return;
    const token = getToken();
    if (!token) return;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;
    // 重连期间可能收到重复推送，按 id 去重
    const seen = new Set<number>();

    const connect = () => {
      if (cancelled) return;
      try {
        ws = new WebSocket(wsUrl(`/ws/notifications?token=${encodeURIComponent(token)}`));
        ws.onopen = () => {
          retries = 0;
        };
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data) as NotificationPush;
            if (msg.type !== 'notification' || !msg.data?.id) return;
            const m = msg.data;
            if (seen.has(m.id)) return;
            seen.add(m.id);
            // 1) atom 插顶部（按 id 去重）
            prependMessage(m);
            // 2) 权威未读 +1
            bumpServerUnread(1);
            // 3) 精确更新第 1 页缓存（不用 invalidate：staleTime 30s 内会立刻冲掉刚插的数据）
            queryClient.setQueryData<NotificationListResult>(firstPageKey, (old) =>
              old
                ? {
                    ...old,
                    items: [m, ...old.items.filter((x) => x.id !== m.id)],
                    total: old.total + 1,
                    unread: old.unread + 1,
                  }
                : old
            );
            // 4) 面板打开时正在看列表，不再弹 toast 打扰
            if (!store.get(messagePanelOpenAtom)) {
              toast.info(m.title, { description: m.content });
            }
          } catch {
            // 忽略解析失败
          }
        };
        ws.onclose = () => {
          if (cancelled) return;
          // 指数退避重连，与 useViewers 一致（最多 5 次）
          if (retries < 5) {
            retries += 1;
            reconnectTimer = setTimeout(connect, 3000 * retries);
          }
        };
        ws.onerror = () => {
          // 连接错误交由 onclose 的重连逻辑处理
        };
      } catch {
        // WebSocket 构造失败（如 URL 非法），静默放弃
      }
    };
    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      ws = null;
    };
  }, [userName, queryClient]);

  return null;
}
