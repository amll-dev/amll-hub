import { atom } from 'jotai';
import type { ReviewReport } from './services/report-service/types';

export const autoReviewReportAtom = atom<ReviewReport | null>(null);
export const editedReviewReportAtom = atom<ReviewReport | null>(null);
export const reviewManualNoteAtom = atom<string>('');
export const reviewUploadTtmlAtom = atom<boolean>(true);

/** 审核结论 */
export const reviewActionAtom = atom<'approve' | 'revision' | 'reject' | 'missing_audio'>(
  'revision'
);

export const reviewSaveDialogOpenAtom = atom<boolean>(false);
export const effectiveReviewReportAtom = atom<ReviewReport | null>((get) => {
  const edited = get(editedReviewReportAtom);
  if (edited) return edited;
  return get(autoReviewReportAtom);
});
export const reviewReportDialogAtom = atom<{
  open: boolean;
  title: string;
}>({
  open: false,
  title: '',
});
