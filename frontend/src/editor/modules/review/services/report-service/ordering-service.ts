import { getReviewReportSelectionKey } from './selection-service';
import type { ReviewReportBlock } from './types';

const getStructuredBlockKey = (block: ReviewReportBlock) =>
  block.kind === 'manual' ? null : getReviewReportSelectionKey(block);

export const captureManualReviewReportPlacements = (blocks: ReviewReportBlock[]) =>
  blocks.map((block, index) => {
    if (block.kind !== 'manual') return block;
    const previousBlock = blocks
      .slice(0, index)
      .reverse()
      .find((candidate) => candidate.kind !== 'manual');
    const nextBlock = blocks.slice(index + 1).find((candidate) => candidate.kind !== 'manual');
    return {
      ...block,
      beforeBlockKey: nextBlock ? (getStructuredBlockKey(nextBlock) ?? undefined) : undefined,
      afterBlockKey: previousBlock
        ? (getStructuredBlockKey(previousBlock) ?? undefined)
        : undefined,
    };
  });

export const applyManualReviewReportPlacements = (blocks: ReviewReportBlock[]) => {
  const structuredBlocks = blocks.filter((block) => block.kind !== 'manual');
  const structuredIndexes = new Map<string, number>();
  structuredBlocks.forEach((block, index) => {
    const key = getStructuredBlockKey(block);
    if (key && !structuredIndexes.has(key)) structuredIndexes.set(key, index);
  });

  const manualBuckets = Array.from(
    { length: structuredBlocks.length + 1 },
    () => [] as Extract<ReviewReportBlock, { kind: 'manual' }>[]
  );
  blocks.forEach((block) => {
    if (block.kind !== 'manual') return;
    const beforeIndex = block.beforeBlockKey
      ? structuredIndexes.get(block.beforeBlockKey)
      : undefined;
    const afterIndex = block.afterBlockKey ? structuredIndexes.get(block.afterBlockKey) : undefined;
    const bucketIndex =
      beforeIndex ?? (afterIndex === undefined ? structuredBlocks.length : afterIndex + 1);
    manualBuckets[bucketIndex]?.push(block);
  });

  return structuredBlocks
    .flatMap((block, index) => [...(manualBuckets[index] ?? []), block])
    .concat(manualBuckets[structuredBlocks.length] ?? []);
};
