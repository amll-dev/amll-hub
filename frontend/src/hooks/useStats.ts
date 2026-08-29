import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';

export function useStats() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.stats,
    queryFn: () => api.getStats(),
    staleTime: 60_000,
  });

  return {
    data: data ?? null,
    loading: isPending,
    error: error ? (error instanceof Error ? error.message : '加载失败') : null,
  };
}
