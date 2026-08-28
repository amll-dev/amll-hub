import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';

export interface Viewer {
  username: string;
  displayName?: string;
  avatar?: string;
}

/**
 * WebSocket 观看者 hook。
 * 连接 /ws/viewers?submissionId=…，上报并接收“正在查看该投稿的用户列表”
 */
export function useViewers(submissionId: number) {
  const [count, setCount] = useState(0);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (!submissionId) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getToken();
    const wsUrl = `${protocol}//${window.location.host}/ws/viewers?submissionId=${submissionId}${token ? `&token=${encodeURIComponent(token)}` : ''}`;

    // 用局部变量跟踪本 effect 周期的取消状态，
    // 避免 React StrictMode/重挂载时跨周期污染导致重连产生第二个连接。
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;

    const connect = () => {
      if (cancelled) return;
      try {
        // token 通过 query 参数传递
        ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          retries = 0;
        };
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            // 后端观众列表消息：{ type: "viewers", submissionId, data: { viewers: [...] } }
            if (
              data.type === 'viewers' ||
              data.type === 'viewers_update' ||
              data.type === 'viewers_list'
            ) {
              const payload = data.data ?? data;
              const list = payload.viewers || [];
              const c = payload.count ?? list.length;
              setCount(c);
              setViewers(list);
            } else if (data.type === 'submission_changed') {
              // 状态变更：{ type: "submission_changed", submissionId, data: { status, ... } }
              const payload = data.data ?? {};
              if (payload.status) {
                window.dispatchEvent(
                  new CustomEvent('submission:status-update', { detail: payload })
                );
              }
            } else if (data.type === 'status_update' && data.status) {
              window.dispatchEvent(
                new CustomEvent('submission:status-update', { detail: data.status })
              );
            }
          } catch {
            // 忽略解析失败
          }
        };
        ws.onclose = () => {
          // 卸载后不再重连，避免创建多个连接
          if (!cancelled && retries < 5) {
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
  }, [submissionId]);

  return { count, viewers, showModal, setShowModal };
}
