import { useEffect, useRef, useState } from 'react';
import { getToken } from '@/lib/auth';
import { wsUrl } from '@/lib/ws';

export interface Viewer {
  username: string;
  displayName?: string;
  avatar?: string;
}

interface ViewerPayload {
  count?: number;
  viewers?: Viewer[];
}

/** WebSocket 消息的通用结构 */
type WsMessage = Record<string, unknown>;

/**
 * 观看者 WebSocket 公共实现。
 * 连接 /ws/viewers?<param>=<value>，处理观看者列表消息，
 * 其余消息交给 onMessage 回调。
 */
function useViewerSocket(
  param: string,
  value: string | number,
  onMessage?: (data: WsMessage) => void
) {
  const [count, setCount] = useState(0);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [showModal, setShowModal] = useState(false);
  // 回调放 ref，避免每次渲染生成的新函数触发重连
  const handlerRef = useStableCallback(onMessage);

  useEffect(() => {
    if (!value) return;
    const token = getToken();
    const url = wsUrl(
      `/ws/viewers?${param}=${encodeURIComponent(String(value))}${token ? `&token=${encodeURIComponent(token)}` : ''}`
    );

    // 用局部变量跟踪本 effect 周期的取消状态，
    // 避免 React StrictMode/重挂载时跨周期污染导致重连产生第二个连接。
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;

    const connect = () => {
      if (cancelled) return;
      try {
        ws = new WebSocket(url);
        ws.onopen = () => {
          retries = 0;
        };
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as WsMessage;
            if (
              data.type === 'viewers' ||
              data.type === 'viewers_update' ||
              data.type === 'viewers_list'
            ) {
              const payload = (data.data ?? data) as ViewerPayload;
              const list = payload.viewers || [];
              setCount(payload.count ?? list.length);
              setViewers(list);
              return;
            }
            handlerRef.current?.(data);
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
  }, [param, value, handlerRef]);

  return { count, viewers, showModal, setShowModal };
}

/** 把回调稳定到 ref 里，供 WebSocket 消息处理使用 */
function useStableCallback(callback?: (data: WsMessage) => void) {
  const ref = useRef(callback);
  useEffect(() => {
    ref.current = callback;
  });
  return ref;
}

/**
 * 歌词投稿 / 请愿的观看者 hook
 */
export function useViewers(id: number, kind: 'submission' | 'request' = 'submission') {
  return useViewerSocket(kind === 'request' ? 'requestId' : 'submissionId', id, (data) => {
    // 状态变更：{ type: "submission_changed", submissionId, data: { status, ... } }
    if (data.type === 'submission_changed') {
      const payload = (data.data ?? {}) as { status?: string };
      if (payload.status) {
        window.dispatchEvent(new CustomEvent('submission:status-update', { detail: payload }));
      }
    } else if (data.type === 'status_update' && data.status) {
      window.dispatchEvent(new CustomEvent('submission:status-update', { detail: data.status }));
    }
  });
}

/**
 * 插件详情页 WebSocket：观看者列表 + plugin_changed 状态变更
 * 连接 /ws/viewers?pluginKey=…
 */
export function usePluginViewers(pluginKey: string) {
  const [revision, setRevision] = useState(0);
  const base = useViewerSocket('pluginKey', pluginKey, (data) => {
    if (data.type === 'plugin_changed') setRevision((r) => r + 1);
  });
  return { ...base, revision };
}
