/** 参与审核招募的投稿标签，与后端 model.RecruitmentTag 保持一致 */
export const RECRUITMENT_TAG = '参与审核招募';

/** 招募可选的投稿语言，顺序与后端一致 */
export const RECRUITMENT_LANGUAGES = ['zh', 'en', 'ja', 'ko', 'others'] as const;

/** 是否为审核招募标签 */
export function isRecruitmentTag(tag: string): boolean {
  return tag === RECRUITMENT_TAG;
}

/** 投稿标签中是否包含审核招募标识 */
export function hasRecruitmentTag(tags?: readonly string[] | null): boolean {
  return Boolean(tags?.some(isRecruitmentTag));
}
