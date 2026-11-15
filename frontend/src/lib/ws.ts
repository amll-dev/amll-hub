import { toast } from 'sonner';
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

/** 重连退避：1s 起指数增长，60s 封顶 */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
/** 连续失败到这个次数才提示，避免中间层空闲断连时每次重连都弹一次 */
const NOTIFY_AFTER_FAILURES = 3;
/** 三条 WS 共用一个 toast id：同时断线只显示一条，不堆叠 */
const REALTIME_STATUS_TOAST_ID = 'ws-realtime-status';

export interface WsRetryOptions {
  url: string;
  protocols?: string | string[];
  onMessage: (event: MessageEvent) => void;
}

/**
 * 建立带自动重连的 WebSocket，返回 effect 的 cleanup。
 *
 * 替代原先三处同构的「线性退避 3/6/9/12/15s、5 次后永久放弃」实现：
 * - 指数退避 + 60s 封顶，不再放弃（审核中心挂机时列表必须继续实时更新）
 * - 页面重新可见 / 网络恢复时立即重连，不必等下一个退避周期
 * - 连续失败 3 次弹一条 toast 提示断开；不提示恢复（三条连接各自恢复的
 *   时机不同，共用一个 id 会由先恢复的那条误报「全部已恢复」）
 */
export function connectWithRetry({ url, protocols, onMessage }: WsRetryOptions) {
  let cancelled = false;
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let notifiedDown = false;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const isConnectingOrOpen = () =>
    ws !== null && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);

  const scheduleReconnect = () => {
    if (cancelled) return;
    failures += 1;
    if (failures === NOTIFY_AFTER_FAILURES && !notifiedDown) {
      notifiedDown = true;
      toast.warning('实时更新已断开，正在自动重连…', { id: REALTIME_STATUS_TOAST_ID });
    }
    const backoff = Math.min(RECONNECT_BASE_MS * 2 ** (failures - 1), RECONNECT_MAX_MS);
    // ±50% 抖动：服务端重启时三条连接（通知 / 观看者 / 列表）不会在同一毫秒重连
    const delay = Math.round(backoff * (0.5 + Math.random()));
    clearTimer();
    timer = setTimeout(connect, delay);
  };

  const connect = () => {
    if (cancelled) return;
    clearTimer();
    // visibilitychange / online 可能与退避定时器撞在一起，避免建出第二条连接
    if (isConnectingOrOpen()) return;
    // 旧连接可能还停在 CLOSING：先解绑再关，否则它的 onclose 会把新连接
    // 的引用抹掉并额外排一次重连。
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
      ws = null;
    }
    try {
      ws = new WebSocket(url, protocols);
    } catch {
      ws = null;
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      failures = 0;
      // 重置提示闸门：下次再出现持续断线时还能提示一次。
      notifiedDown = false;
    };
    ws.onmessage = onMessage;
    ws.onerror = () => {
      // 连接错误统一交给 onclose 处理重连
    };
    ws.onclose = () => {
      ws = null;
      scheduleReconnect();
    };
  };

  const reconnectNow = () => {
    if (cancelled || document.hidden || isConnectingOrOpen()) return;
    clearTimer();
    connect();
  };
  const onVisibilityChange = () => {
    if (!document.hidden) reconnectNow();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('online', reconnectNow);
  connect();

  return () => {
    cancelled = true;
    clearTimer();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('online', reconnectNow);
    if (ws) {
      // 主动 close 不该触发 onclose 里的重连
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
      ws = null;
    }
  };
}
