import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getToken } from '@/lib/auth';
import { queryKeys } from '@/lib/query';
import { connectWithRetry, wsUrl } from '@/lib/ws';

/**
 * 订阅审核招募变更（登录后的创作中心 / 审核中心使用）。
 * 服务端只推失效信号，收到后重新拉取招募相关查询；未登录不建立连接。
 */
export function useRecruitmentSync(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const token = getToken();
    if (!token) return;

    return connectWithRetry({
      url: wsUrl('/ws/viewers?recruitment=true'),
      protocols: [token],
      onMessage: (event) => {
        try {
          const data = JSON.parse(event.data) as { type?: string };
          if (data.type === 'recruitment_changed') {
            void queryClient.invalidateQueries({ queryKey: queryKeys.recruitmentRoot });
          }
        } catch {
          // 忽略非 JSON 消息
        }
      },
    });
  }, [enabled, queryClient]);
}
