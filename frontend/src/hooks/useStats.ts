import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Stats } from '@/lib/types';

interface State {
  data: Stats | null;
  loading: boolean;
  error: string | null;
}

export function useStats() {
  const [state, setState] = useState<State>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .getStats()
      .then((data) => {
        if (active) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (active)
          setState((s) => ({
            ...s,
            loading: false,
            error: err instanceof Error ? err.message : '加载失败',
          }));
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
