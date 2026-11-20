import type { RecruitmentPayload } from '@/lib/types';

export const conditionFields = [
  { key: 'validSubmissions', label: '有效投稿数', min: 1 },
  { key: 'approvalsPerSubmission', label: '单份投稿通过数', min: 1 },
  { key: 'revisionsPerSubmission', label: '单份投稿修改数', min: 0 },
  { key: 'submissionsPerLanguage', label: '单一语种投稿数', min: 1 },
  { key: 'maxAttempts', label: '最多尝试次数', min: 1 },
] as const;

/** 发起招募时还没有 id，由前端生成 UUID 作为幂等键。 */
export type RecruitmentDraft = Omit<RecruitmentPayload, 'id'>;
