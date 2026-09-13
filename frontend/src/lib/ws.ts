import type { Message } from './types';

/**
 * 从 VITE_API_BASE 推导 WebSocket 地址。
 * 生产环境 API 与前端跨域部署时，window.location.host 拼 WS 会指向错误的主机，
 * 必须以 API base 为准；dev 无 base 时走同域（vite /ws 代理）。
 */
export function wsUrl(pathWithQuery: string): string {
  const base = import.meta.env.VITE_API_BASE ?? '';
  if (base) return `${base.replace(/^http/, 'ws')}${pathWithQuery}`;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${pathWithQuery}`;
}

/** /ws/notifications 推送消息（对应 backend ws.Message） */
export interface NotificationPush {
  type: 'notification';
  username?: string;
  data: Message;
}
