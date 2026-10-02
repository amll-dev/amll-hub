import { useCallback, useState } from 'react';

/** 未重排歌词模式的共享状态与派生逻辑  */
export interface UseUnrearrangedModeOptions {
  /** /validate 已返回结果（不论 valid），即元数据解析已完成 */
  metaResolved: boolean;
  /** 校验模式下是否通过了校验 */
  valid: boolean;
}

export interface UnrearrangedMode {
  /** 是否勾选了「上传未重排歌词」 */
  isUnrearranged: boolean;
  setUnrearranged: (on: boolean) => void;
  /** 未重排原因（必填） */
  reason: string;
  setReason: (value: string) => void;
  /** true 表示走校验模式，以 valid 作为提交门槛 */
  requireValid: boolean;
  /** 勾了未重排但原因还没填 */
  reasonMissing: boolean;
  /** 表单是否达到可提交状态（不含文件是否存在） */
  ready: boolean;
  /** 直接展开到 createSubmission / updateSubmissionFile 的参数里 */
  submissionFields: {
    isUnrearranged?: boolean;
    unrearrangedReason?: string;
  };
  /** 重置为未勾选、原因清空 */
  reset: () => void;
}

export function useUnrearrangedMode({
  metaResolved,
  valid,
}: UseUnrearrangedModeOptions): UnrearrangedMode {
  // 不从任何持久化草稿恢复：草稿恢复后 File 必然为 null
  const [isUnrearranged, setIsUnrearranged] = useState(false);
  const [reason, setReason] = useState('');

  const requireValid = !isUnrearranged;
  const reasonMissing = isUnrearranged && reason.trim().length === 0;
  const ready = requireValid ? valid : metaResolved;

  const setUnrearranged = useCallback((on: boolean) => {
    setIsUnrearranged(on);
    // 刻意不清空 validation：元数据两种模式共用，切模式只是换提交门槛
  }, []);

  const reset = useCallback(() => {
    setIsUnrearranged(false);
    setReason('');
  }, []);

  // 未重排才带这两个字段；不勾选时不传，后端会清掉旧标记
  const submissionFields = isUnrearranged
    ? {
        isUnrearranged: true,
        unrearrangedReason: reason.trim() || undefined,
      }
    : {};

  return {
    isUnrearranged,
    setUnrearranged,
    reason,
    setReason,
    requireValid,
    reasonMissing,
    ready,
    submissionFields,
    reset,
  };
}
