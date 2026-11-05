import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { RequestForm } from './RequestForm';
import type { LyricRequestPayload } from '@/lib/types';

/** 提交请愿 */
export function RequestSubmitPanel({
  onSuccess,
}: {
  onSuccess: (result: { id: number; merged: boolean }) => void;
}) {
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (payload: LyricRequestPayload) => api.createLyricRequest(payload),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['lyric-requests'] });
      toast.success(res.merged ? '这首歌已经有请愿了，已为你增加一次请愿' : '请愿已发布');
      onSuccess({ id: res.id, merged: res.merged });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '提交失败'),
  });

  return (
    <RequestForm submitting={mutation.isPending} onSubmit={(payload) => mutation.mutate(payload)} />
  );
}
