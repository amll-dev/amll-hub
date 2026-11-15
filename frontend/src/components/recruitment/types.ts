import type { RecruitmentConditions } from '@/lib/types';

export const conditionFields = [
  { key: 'validSubmissions', label: '有效投稿数', min: 1 },
  { key: 'approvalsPerSubmission', label: '单份投稿通过数', min: 1 },
  { key: 'revisionsPerSubmission', label: '单份投稿修改数', min: 0 },
  { key: 'submissionsPerLanguage', label: '单一语种投稿数', min: 1 },
  { key: 'maxAttempts', label: '最多尝试次数', min: 1 },
] as const;

export interface RecruitmentDraft {
  announcement: string;
  languages: string[];
  conditions: RecruitmentConditions;
  endsOn?: string;
  targetMembers?: number;
}
export interface RecruitmentRecord extends RecruitmentDraft {
  id: string;
  createdAt: string;
}
