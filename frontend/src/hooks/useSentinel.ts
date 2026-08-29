import { useEffect, useRef } from 'react';

/**
 * 无限滚动哨兵：元素进入视口（含 rootMargin 提前量）时触发 onLoadMore。
 * 配合 useInfiniteQuery 的 fetchNextPage 使用。
 */
export function useSentinel(
  onLoadMore: () => void,
  enabled: boolean,
  rootMargin = '240px'
) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cbRef = useRef(onLoadMore);
  cbRef.current = onLoadMore;

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cbRef.current();
      },
      { rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, rootMargin]);

  return ref;
}
