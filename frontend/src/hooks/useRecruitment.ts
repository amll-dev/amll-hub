import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';

/** 当前进行中的审核招募（首页 banner / 投稿表单 / 创作中心共用）。 */
export function useActiveRecruitment(
  options: { enabled?: boolean; refetchInterval?: number } = {}
) {
  return useQuery({
    queryKey: queryKeys.recruitmentActive,
    queryFn: api.reviewerRecruitment.active,
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval,
  });
}

/** 当前用户在招募中的参与记录。 */
export function useRecruitmentMe(username?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.recruitmentMe(username),
    queryFn: api.reviewerRecruitment.me,
    enabled,
  });
}

/** 审核招募仪表板（管理面板 / 审核中心首页共用）。 */
export function useRecruitmentDashboard() {
  return useQuery({
    queryKey: queryKeys.recruitmentDashboard,
    queryFn: api.reviewerRecruitment.dashboard,
  });
}

/** 单篇投稿在招募中的审核进度（编辑器审核报告使用）。 */
export function useSubmissionRecruitmentProgress(id: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.recruitmentProgress(id),
    queryFn: () => api.reviewerRecruitment.progress(id),
    enabled,
  });
}
