import type { StructuredReviewValue } from '$/types/structured-review-report';

/** 是否为可安全放进结构化报告 JSON 的值（生成端与读取端共用同一判定）。 */
export const isStructuredValue = (value: unknown): value is StructuredReviewValue => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isStructuredValue);
  if (typeof value !== 'object') return false;
  return Object.values(value).every(isStructuredValue);
};

/** 结构等价比较；path 定位的值都来自 JSON，可直接按序列化结果比对。 */
export const valuesEqual = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

/** 尽力转成可序列化值；无法表达时返回 null。 */
export const toStructuredValue = (value: unknown): StructuredReviewValue | null => {
  if (isStructuredValue(value)) return value;
  try {
    const cloned = JSON.parse(JSON.stringify(value)) as unknown;
    return isStructuredValue(cloned) ? cloned : null;
  } catch {
    return null;
  }
};
