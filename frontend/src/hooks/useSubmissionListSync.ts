import { useEffect, useRef } from 'react';
import { getToken } from '@/lib/auth';
import { wsUrl } from '@/lib/ws';

/** 投稿状态变更推送负载 */
export interface SubmissionChangePayload {
  id?: number;
  submissionId?: number;
  status?: string;
  title?: string;
  reviewer?: string;
  updatedAt?: string;
}

/**
 * 订阅全局投稿状态变更（列表页 WebSocket，submissionID = 0）。
 * 收到 submission_changed 消息时调用 onChanged。
 */
export function useSubmissionListSync(onChanged: (payload: SubmissionChangePayload) => void) {
  const cbRef = useRef(onChanged);
  cbRef.current = onChanged;

  useEffect(() => {
    const token = getToken();
    // 从 VITE_API_BASE 推导 WS 地址
    const url = wsUrl(
      `/ws/viewers?listPage=true${token ? `&token=${encodeURIComponent(token)}` : ''}`
    );
    let ws: WebSocket | null = null;
    let cancelled = false;
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
            const data = JSON.parse(event.data);
            if (data.type === 'submission_changed') {
              const payload = (data.data ?? {}) as SubmissionChangePayload;
              cbRef.current({ ...payload, submissionId: data.submissionId ?? payload.id });
            }
          } catch {
            // 忽略解析失败
          }
        };
        ws.onclose = () => {
          if (cancelled) return;
          if (retries < 5) {
            retries += 1;
            reconnectTimer = setTimeout(connect, 3000 * retries);
          }
        };
      } catch {
        // 忽略连接异常
      }
    };
    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      ws = null;
    };
  }, []);
}
