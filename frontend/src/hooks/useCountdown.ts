import { useCallback, useEffect, useState } from 'react';

/**
 * 通用验证码/操作倒计时。
 * 替代散落在 AuthDialog / Register / ResetPassword / Profile 中重复的
 * "setTimeout 每秒减一" 逻辑。
 *
 * @example
 * const countdown = useCountdown();
 * countdown.start(60);          // 发送成功后开始 60s 倒计时
 * countdown.running             // 按钮禁用判断
 * `重新获取(${countdown.count}s)` // 展示
 */
export function useCountdown(initial = 0) {
  const [count, setCount] = useState(initial);

  useEffect(() => {
    if (count <= 0) return;
    const timer = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [count]);

  const start = useCallback((seconds = 60) => setCount(seconds), []);
  const reset = useCallback(() => setCount(0), []);

  return { count, running: count > 0, start, reset };
}
