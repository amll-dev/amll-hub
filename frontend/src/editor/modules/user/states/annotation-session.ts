import { atom } from 'jotai';

/** 批注会话的最小形状。审核页永远为 null，这里只保留类型让组件能编译过。 */
export interface AnnotationSession {
  /** 批注所属的稿件标识 */
  targetId: string;
  /** 批注人 */
  author?: string;
}

/** 单条批注挂在行上的位置与内容 */
export interface LineAnnotation {
  lineId: string;
  /** 批注正文 */
  text: string;
}

/** 批注的采纳状态 */
export type AnnotationDecision = 'pending' | 'accepted' | 'rejected';

export const annotationSessionAtom = atom<AnnotationSession | null>(null);

export const annotationsByLineAtom = atom<Map<string, LineAnnotation[]>>(new Map());

export const annotationDecisionMapAtom = atom<Map<string, AnnotationDecision>>(new Map());

export const focusAnnotationAtom = atom<string | null>(null);
