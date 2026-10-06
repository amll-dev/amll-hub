import type { JsError } from './types';

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8');

export function generateRustcStyleLog(
  error: JsError,
  rawText?: string,
  suggestion?: string
): string {
  const lines: string[] = [];

  lines.push(`error[${error.kind}]: ${error.message}`);

  const lineNumStr = (error.lineId ?? 1).toString();
  const marginLen = lineNumStr.length + 2;
  const emptyMargin = `${' '.repeat(marginLen)}|`;
  const numMargin = ` ${lineNumStr} |`;
  const noteMargin = `${' '.repeat(marginLen)}=`;

  const arrowPadLen = Math.max(0, marginLen - 3);
  const arrowMargin = `${' '.repeat(arrowPadLen)}-->`;

  const offsetParts = [];
  if (error.byteOffset !== undefined) offsetParts.push(`Byte Offset: ${error.byteOffset}`);
  if (error.lineId) offsetParts.push(`Line: ${error.lineId}`);

  if (offsetParts.length > 0) {
    lines.push(`${arrowMargin} ${offsetParts.join(' | ')}`);
  }

  let hasSnippet = false;

  if (rawText && error.byteOffset !== undefined) {
    hasSnippet = appendRawTextSnippet(lines, error, rawText, emptyMargin, numMargin);
  }

  if (error.tagStack && error.tagStack.length > 0) {
    if (!hasSnippet) lines.push(emptyMargin);
    const stackPath = error.tagStack.map((t) => `${t}`).join(' > ');
    lines.push(`${noteMargin} note: tag stack: ${stackPath}`);
  }

  if (suggestion) {
    const suggestionLines = suggestion.split('\n');
    lines.push(`${noteMargin} help: ${suggestionLines[0]}`);
    for (let i = 1; i < suggestionLines.length; i++) {
      lines.push(`${emptyMargin}       ${suggestionLines[i]}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function appendRawTextSnippet(
  lines: string[],
  error: JsError,
  rawText: string,
  emptyMargin: string,
  numMargin: string
): boolean {
  if (error.byteOffset === undefined) return false;

  const bytes = UTF8_ENCODER.encode(rawText);
  const offset = error.byteOffset;

  if (offset > bytes.length) return false;

  let start = offset;
  while (start > 0 && bytes[start - 1] !== 10) start--;

  let end = offset;
  while (end < bytes.length && bytes[end] !== 10 && bytes[end] !== 13) end++;

  const beforeBytes = bytes.subarray(start, offset);
  const lineBytes = bytes.subarray(start, end);

  let caretIndex = UTF8_DECODER.decode(beforeBytes).length;
  let lineText = UTF8_DECODER.decode(lineBytes);
  let caretLength = Math.max(1, error.offendingString?.length ?? 1);

  // 一般情况下的 byteOffset 和真实引发错误的位置都相差甚远，
  // 例如标签内引发错误，但 byteOffset 可能指向标签末尾
  // 不过针对这两个错误类别，我们有精确的引发错误的文本可以匹配
  const EXACT_MATCH_ERRORS = ['InvalidTimestamp', 'EntityError'];
  if (EXACT_MATCH_ERRORS.includes(error.kind) && error.offendingString) {
    const textBeforeOffset = lineText.substring(0, caretIndex);
    const exactMatchIndex = textBeforeOffset.lastIndexOf(error.offendingString);

    if (exactMatchIndex !== -1) {
      caretIndex = exactMatchIndex;
      caretLength = error.offendingString.length;
    }
  }

  const MAX_LEN = 100;
  if (lineText.length > MAX_LEN) {
    const keepLeft = 40;
    const keepRight = 60;

    const cutStart = Math.max(0, caretIndex - keepLeft);
    const cutEnd = Math.min(lineText.length, caretIndex + keepRight);

    let displayStr = lineText.substring(cutStart, cutEnd);
    let displayCaret = caretIndex - cutStart;

    if (cutStart > 0) {
      displayStr = `...${displayStr}`;
      displayCaret += 3;
    }
    if (cutEnd < lineText.length) {
      displayStr = `${displayStr}...`;
    }

    lineText = displayStr;
    caretIndex = displayCaret;
  }

  if (lineText.trim().length === 0) return false;

  lines.push(emptyMargin);
  lines.push(`${numMargin}       ${lineText}`);
  lines.push(`${emptyMargin}       ${' '.repeat(caretIndex)}${'^'.repeat(caretLength)}`);
  lines.push(emptyMargin);

  return true;
}
