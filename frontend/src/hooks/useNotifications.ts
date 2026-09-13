import { useEffect } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { getDefaultStore } from 'jotai';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import type { Message, MessageType, NotificationListResult } from '@/lib/types';
import {
  bumpServerUnread,
  markAllLocalRead,
  messagesAtom,
  patchMessage,
  removeMessage,
  serverUnreadAtom,
  setServerUnread,
  syncMessages,
} from '@/atoms/message';

const store = getDefaultStore();

/** 所有消息列表 query 的公共前缀 */
const NOTIFICATIONS_ROOT = ['notifications', 'list'] as const;

interface MutationSnapshot {
  queries: [readonly unknown[], NotificationListResult | undefined][];
  atom: Message[];
  serverUnread: number;
}

/** 快照：全部消息列表 query 缓存 + atom + 服务端未读数（onError 回滚用） */
function snapshotAll(qc: QueryClient): MutationSnapshot {
  return {
    queries: qc.getQueriesData<NotificationListResult>({ queryKey: NOTIFICATIONS_ROOT }),
    atom: store.get(messagesAtom),
    serverUnread: store.get(serverUnreadAtom),
  };
}

/** 回滚：恢复三处状态（Query 缓存 + atom + serverUnread） */
function rollbackAll(qc: QueryClient, snap: MutationSnapshot) {
  for (const [key, data] of snap.queries) {
    qc.setQueryData(key, data);
  }
  store.set(messagesAtom, snap.atom);
  store.set(serverUnreadAtom, snap.serverUnread);
  toast.error('操作失败，请重试');
}

/** 在 atom 或任一 query 缓存中查找消息（判断是否未读用） */
function findMessage(qc: QueryClient, id: number): Message | undefined {
  const inAtom = store.get(messagesAtom).find((m) => m.id === id);
  if (inAtom) return inAtom;
  for (const [, data] of qc.getQueriesData<NotificationListResult>({
    queryKey: NOTIFICATIONS_ROOT,
  })) {
    const hit = data?.items.find((m) => m.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** 乐观更新所有消息列表 query 缓存 */
function updateAllQueries(
  qc: QueryClient,
  updater: (old: NotificationListResult) => NotificationListResult
) {
  qc.setQueriesData<NotificationListResult>({ queryKey: NOTIFICATIONS_ROOT }, (old) =>
    old ? updater(old) : old
  );
}

/**
 * 面板消息列表：第 1 页全量 query，结果同步进 messagesAtom（列表即时展示用）。
 * staleTime 0：打开面板即 refetch，兜底 WS 丢推送。
 */
export function usePanelNotifications() {
  const params = { page: 1, limit: 20, type: 'all' as const };
  const q = useQuery({
    queryKey: queryKeys.notifications(params),
    queryFn: () => api.getNotifications(params),
    staleTime: 0,
  });
  useEffect(() => {
    if (q.data) syncMessages(q.data.items);
  }, [q.data]);
  return q;
}

/** 消息页列表：直接读 query（分页/筛选下 atom 语义不对，不共享 atom） */
export function useNotificationsQuery(params: {
  page: number;
  limit: number;
  type?: MessageType | 'all';
}) {
  return useQuery({
    queryKey: queryKeys.notifications(params),
    queryFn: () => api.getNotifications(params),
  });
}

/** 单条已读 */
export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.markNotificationRead(id),
    onMutate: (id) => {
      void qc.cancelQueries({ queryKey: NOTIFICATIONS_ROOT });
      const snap = snapshotAll(qc);
      const target = findMessage(qc, id);
      const wasUnread = !!target && !target.read;
      updateAllQueries(qc, (old) => ({
        ...old,
        items: old.items.map((m) => (m.id === id ? { ...m, read: true } : m)),
        unread: wasUnread ? Math.max(0, old.unread - 1) : old.unread,
      }));
      patchMessage(id, { read: true });
      if (wasUnread) bumpServerUnread(-1);
      return snap;
    },
    onError: (_e, _id, ctx) => {
      // ctx 为空说明 onMutate 就失败了（未写入乐观状态），也要提示，否则点了毫无反应
      if (ctx) rollbackAll(qc, ctx);
      else toast.error('操作失败，请重试');
    },
  });
}

/** 全部已读 */
export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onMutate: () => {
      void qc.cancelQueries({ queryKey: NOTIFICATIONS_ROOT });
      const snap = snapshotAll(qc);
      updateAllQueries(qc, (old) => ({
        ...old,
        items: old.items.map((m) => ({ ...m, read: true })),
        unread: 0,
      }));
      markAllLocalRead();
      setServerUnread(0);
      return snap;
    },
    onError: (_e, _v, ctx) => {
      if (ctx) rollbackAll(qc, ctx);
      else toast.error('操作失败，请重试');
    },
  });
}

/** 删除单条 */
export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteNotification(id),
    onMutate: (id) => {
      void qc.cancelQueries({ queryKey: NOTIFICATIONS_ROOT });
      const snap = snapshotAll(qc);
      const target = findMessage(qc, id);
      const wasUnread = !!target && !target.read;
      updateAllQueries(qc, (old) => ({
        ...old,
        items: old.items.filter((m) => m.id !== id),
        total: Math.max(0, old.total - 1),
        unread: wasUnread ? Math.max(0, old.unread - 1) : old.unread,
      }));
      removeMessage(id);
      if (wasUnread) bumpServerUnread(-1);
      return snap;
    },
    onError: (_e, _id, ctx) => {
      if (ctx) rollbackAll(qc, ctx);
      else toast.error('操作失败，请重试');
    },
  });
}
