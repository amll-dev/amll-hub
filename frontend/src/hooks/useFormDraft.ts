import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 表单草稿自动保存（localStorage）。
 * 创作中心写一半刷新/关页不丢：value 变化后 debounce 写入，卸载不清除，
 * 提交成功后调用 clearDraft()。
 *
 * 注意：只能存可 JSON 序列化的字段（文本/数组），File 对象无法持久化。
 *
 * @example
 * const [draft, setDraft, clearDraft] = useFormDraft('lyric-submit', { notes: '', language: '' });
 * // 表单初始化时用 draft 做初值；onChange 时 setDraft(next)；
 * // 提交成功后 clearDraft()
 */
export function useFormDraft<T>(key: string, debounceMs = 500) {
  const storageKey = `amll_hub_draft_${key}`;

  // 初始化时一次性读出已保存的草稿
  const [restored] = useState<T | null>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  });

  const timer = useRef<number | null>(null);
  // 最后一次 set 的值。T 本身可能是 null，所以用单独的 pending 标记区分「尚未修改」。
  const lastRef = useRef<T | null>(null);
  const pendingRef = useRef(false);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (!pendingRef.current) return;
    pendingRef.current = false;
    try {
      localStorage.setItem(storageKey, JSON.stringify(lastRef.current));
    } catch {
      // 存储满/隐私模式：草稿保存失败不影响主流程
    }
  }, [storageKey]);

  const set = useCallback(
    (next: T) => {
      lastRef.current = next;
      pendingRef.current = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, debounceMs);
    },
    [flush, debounceMs]
  );

  const clearDraft = useCallback(() => {
    // 先清 pending，否则提交成功后卸载组件会把旧草稿又写回去。
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    pendingRef.current = false;
    lastRef.current = null;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // 忽略
    }
  }, [storageKey]);

  // 卸载时把未落盘的最后一次修改立即写入，而不是只把计时器丢掉。
  useEffect(() => flush, [flush]);

  return { restored, set, clearDraft };
}
