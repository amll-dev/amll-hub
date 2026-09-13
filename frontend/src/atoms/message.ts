import { atom, getDefaultStore } from 'jotai';
import type { Message } from '@/lib/types';

// ===== 消息中心 atoms =====

/** 面板已加载的消息（只装当前页，列表页用 TanStack Query，不共享本 atom） */
export const messagesAtom = atom<Message[]>([]);

/** 派生：已加载列表中的未读数（可能低估，仅兜底展示用） */
export const unreadCountAtom = atom((get) =>
  get(messagesAtom).reduce((n, m) => n + (m.read ? 0 : 1), 0)
);

/** 服务端权威未读总数（30s 轮询 + WS 推送维护） */
export const serverUnreadAtom = atom(0);

/** 铃铛红点：任一来源 > 0 即显示 */
export const hasUnreadAtom = atom((get) => get(serverUnreadAtom) > 0 || get(unreadCountAtom) > 0);

/** 消息面板是否展开（抑制 WS 推送 toast 用） */
export const messagePanelOpenAtom = atom(false);

const store = getDefaultStore();

// ===== 命令式动作（与 atoms/auth.ts 同风格，组件外可直接调用） =====

/** 列表 query 结果同步进 atom */
export function syncMessages(list: Message[]): void {
  store.set(messagesAtom, list);
}

/** WS 推送插顶部（按 id 去重） */
export function prependMessage(m: Message): void {
  const cur = store.get(messagesAtom);
  if (cur.some((x) => x.id === m.id)) return;
  store.set(messagesAtom, [m, ...cur]);
}

/** 局部更新单条（乐观已读等） */
export function patchMessage(id: number, p: Partial<Message>): void {
  store.set(
    messagesAtom,
    store.get(messagesAtom).map((m) => (m.id === id ? { ...m, ...p } : m))
  );
}

/** 本地移除单条 */
export function removeMessage(id: number): void {
  store.set(
    messagesAtom,
    store.get(messagesAtom).filter((m) => m.id !== id)
  );
}

/** 全部标记已读（本地） */
export function markAllLocalRead(): void {
  store.set(
    messagesAtom,
    store.get(messagesAtom).map((m) => ({ ...m, read: true }))
  );
}

/** 服务端未读数校正 */
export function setServerUnread(n: number): void {
  store.set(serverUnreadAtom, Math.max(0, n));
}

/** 服务端未读数增减（WS +1 / 乐观已读 -1），下限 0 */
export function bumpServerUnread(delta = 1): void {
  store.set(serverUnreadAtom, Math.max(0, store.get(serverUnreadAtom) + delta));
}

/** 退出登录时清空（防串号） */
export function resetMessages(): void {
  store.set(messagesAtom, []);
  store.set(serverUnreadAtom, 0);
}
