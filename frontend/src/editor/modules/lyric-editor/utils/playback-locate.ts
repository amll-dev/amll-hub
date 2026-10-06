import { atom } from 'jotai';
import { lyricLinesAtom } from '$/states/main.ts';
import type { LyricLine } from '$/types/ttml.ts';

// Let scrolling arrive slightly before the line becomes active so short first words
// are not visually consumed by the list jumping into place.
const PLAYBACK_SCROLL_LOOKAHEAD_MS = 250;
const PLAYBACK_LINE_HIGHLIGHT_BRIDGE_GAP_MS = 280;

export const playbackCurrentTimeAtom = atom(0);

export const hasCompleteLineTiming = (line: LyricLine) =>
  Number.isFinite(line.startTime) && Number.isFinite(line.endTime) && line.endTime > line.startTime;

export const isLineActiveAtTime = (line: LyricLine, currentTime: number) =>
  hasCompleteLineTiming(line) && currentTime >= line.startTime && currentTime < line.endTime;

const findActiveLineIndex = (
  lines: LyricLine[],
  currentTime: number,
  predicate?: (line: LyricLine) => boolean
) => {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (predicate && !predicate(line)) continue;
    if (isLineActiveAtTime(line, currentTime)) {
      return i;
    }
  }
  return -1;
};

const findLocatedLineIndex = (
  lines: LyricLine[],
  currentTime: number,
  predicate?: (line: LyricLine) => boolean
) => {
  let previousIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (predicate && !predicate(line)) continue;
    if (!hasCompleteLineTiming(line)) continue;
    if (currentTime < line.startTime) {
      return previousIndex !== -1 ? previousIndex : i;
    }
    if (currentTime < line.endTime) {
      return i;
    }
    previousIndex = i;
  }
  return previousIndex;
};

const findTimedLineWindow = (
  lines: LyricLine[],
  currentTime: number,
  predicate?: (line: LyricLine) => boolean
) => {
  let previousIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (predicate && !predicate(line)) continue;
    if (!hasCompleteLineTiming(line)) continue;
    if (currentTime < line.startTime) {
      return {
        previousIndex,
        nextIndex: i,
      };
    }
    previousIndex = i;
  }
  return {
    previousIndex,
    nextIndex: -1,
  };
};

const findBridgedLineIndex = (
  lines: LyricLine[],
  currentTime: number,
  predicate?: (line: LyricLine) => boolean
) => {
  const { previousIndex, nextIndex } = findTimedLineWindow(lines, currentTime, predicate);
  if (previousIndex === -1 || nextIndex === -1) return -1;
  const previousLine = lines[previousIndex];
  const nextLine = lines[nextIndex];
  if (!previousLine || !nextLine) return -1;
  const gap = nextLine.startTime - previousLine.endTime;
  if (gap <= 0 || gap > PLAYBACK_LINE_HIGHLIGHT_BRIDGE_GAP_MS) return -1;
  if (currentTime < previousLine.endTime || currentTime >= nextLine.startTime) {
    return -1;
  }
  return previousIndex;
};

export const findPlaybackLocatedLineIndex = (lines: LyricLine[], currentTime: number) => {
  const locateTime = currentTime + PLAYBACK_SCROLL_LOOKAHEAD_MS;
  const mainIndex = findLocatedLineIndex(lines, locateTime, (line) => !line.isBG);
  if (mainIndex !== -1) return mainIndex;
  return findLocatedLineIndex(lines, locateTime);
};

export const findPlaybackActiveLineIndex = (lines: LyricLine[], currentTime: number) => {
  const mainIndex = findActiveLineIndex(lines, currentTime, (line) => !line.isBG);
  if (mainIndex !== -1) return mainIndex;
  return findActiveLineIndex(lines, currentTime);
};

export const findPlaybackHighlightedLineIndex = (lines: LyricLine[], currentTime: number) => {
  const activeIndex = findPlaybackActiveLineIndex(lines, currentTime);
  if (activeIndex !== -1) return activeIndex;

  const bridgedMainIndex = findBridgedLineIndex(lines, currentTime, (line) => !line.isBG);
  if (bridgedMainIndex !== -1) return bridgedMainIndex;

  return findBridgedLineIndex(lines, currentTime);
};

export const playbackLocatedLineIndexAtom = atom((get) => {
  const lines = get(lyricLinesAtom).lyricLines;
  const currentTime = get(playbackCurrentTimeAtom);
  const index = findPlaybackLocatedLineIndex(lines, currentTime);
  return index === -1 ? undefined : index;
});

export const playbackActiveLineIdAtom = atom((get) => {
  const lines = get(lyricLinesAtom).lyricLines;
  const currentTime = get(playbackCurrentTimeAtom);
  const index = findPlaybackActiveLineIndex(lines, currentTime);
  if (index === -1) return;
  return lines[index]?.id;
});

export const playbackHighlightedLineIdAtom = atom((get) => {
  const lines = get(lyricLinesAtom).lyricLines;
  const currentTime = get(playbackCurrentTimeAtom);
  const index = findPlaybackHighlightedLineIndex(lines, currentTime);
  if (index === -1) return;
  return lines[index]?.id;
});
