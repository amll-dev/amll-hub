import type { LyricWord } from '$/types/ttml';

export type LineTimingSegmentUpdate = {
  id: string;
  word: string;
  startTime: number;
  endTime: number;
  isRuby?: boolean;
  parentId?: string;
  rubyIndex?: number;
};

export function applyLineTimingSegmentsToWords(
  words: readonly LyricWord[],
  segments: readonly LineTimingSegmentUpdate[]
): LyricWord[] {
  const wordUpdates = new Map<string, LineTimingSegmentUpdate>();
  const rubyUpdates = new Map<string, Map<number, LineTimingSegmentUpdate>>();

  for (const segment of segments) {
    if (segment.isRuby && segment.parentId && typeof segment.rubyIndex === 'number') {
      const updates =
        rubyUpdates.get(segment.parentId) ?? new Map<number, LineTimingSegmentUpdate>();
      updates.set(segment.rubyIndex, segment);
      rubyUpdates.set(segment.parentId, updates);
    } else {
      wordUpdates.set(segment.id, segment);
    }
  }

  return words.map((originalWord) => {
    const wordUpdate = wordUpdates.get(originalWord.id);
    let nextWord = wordUpdate
      ? {
          ...originalWord,
          word: wordUpdate.word,
          startTime: wordUpdate.startTime,
          endTime: wordUpdate.endTime,
        }
      : originalWord;

    const rubyWordUpdates = rubyUpdates.get(originalWord.id);
    if (rubyWordUpdates && nextWord.ruby) {
      const newRuby = nextWord.ruby.map((rubyWord, index) => {
        const rubyUpdate = rubyWordUpdates.get(index);
        if (!rubyUpdate) return rubyWord;
        return {
          ...rubyWord,
          word: rubyUpdate.word,
          startTime: rubyUpdate.startTime,
          endTime: rubyUpdate.endTime,
        };
      });
      const validRuby = newRuby.filter((rubyWord) => rubyWord.endTime > rubyWord.startTime);
      nextWord =
        validRuby.length > 0
          ? {
              ...nextWord,
              startTime: Math.min(...validRuby.map((rubyWord) => rubyWord.startTime)),
              endTime: Math.max(...validRuby.map((rubyWord) => rubyWord.endTime)),
              ruby: newRuby,
            }
          : {
              ...nextWord,
              ruby: newRuby,
            };
    }

    return nextWord;
  });
}
