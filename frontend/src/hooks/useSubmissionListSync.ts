import { useEffect, useRef } from 'react';
import { getToken } from '@/lib/auth';
import { connectWithRetry, wsUrl } from '@/lib/ws';
import type { UserInfo } from '@/lib/types';

/** 投稿状态变更推送负载 */
export interface SubmissionChangePayload {
  id?: number;
  submissionId?: number;
  status?: string;
  title?: string;
  reviewer?: string;
  reviewerInfo?: UserInfo;
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
    // 从 VITE_API_BASE 推导 WS 地址；token 走子协议，不进 URL
    const url = wsUrl('/ws/viewers?listPage=true');

    return connectWithRetry({
      url,
      protocols: token ? [token] : undefined,
      onMessage: (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'submission_changed') {
            const payload = (data.data ?? {}) as SubmissionChangePayload;
            cbRef.current({ ...payload, submissionId: data.submissionId ?? payload.id });
          }
        } catch {
          // 忽略解析失败
        }
      },
    });
  }, []);
}
