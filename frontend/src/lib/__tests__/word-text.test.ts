/**
 * 逐字 ↔ 整行文本的互转（空格保真）。
 *
 * 这两个函数存在的唯一理由：WASM 解析出的音节 text 不含空格，
 * 空格信息在 endsWithSpace 上。任何 join('') 的写法都会让英文歌词丢空格，
 * 所以这里把行为钉死，防止后续又有人写回join('')。
 */

import { describe, expect, it } from 'vitest';
import { joinWordsToLineText, splitLineTextToWords } from '@/lib/ttml-processor/word-text';
import type { Syllable } from '@/lib/ttml-processor';

function syl(text: string, endsWithSpace = false): Syllable {
  const s: Syllable = { text, startTime: 0, endTime: 0 };
  if (endsWithSpace) s.endsWithSpace = true;
  return s;
}

describe('joinWordsToLineText', () => {
  it('按 endsWithSpace 还原词间空格', () => {
    // 音节本身不含空格，空格只由 endsWithSpace 承载
    expect(joinWordsToLineText([syl('Hello', true), syl('world')])).toBe('Hello world');
    expect(joinWordsToLineText([syl('Never', true), syl('gonna', true), syl('give')])).toBe(
      'Never gonna give'
    );
  });

  it('没有空格标记时直接紧拼（中文场景）', () => {
    expect(joinWordsToLineText([syl('我'), syl('们')])).toBe('我们');
  });

  it('行尾不补空格：TTML 里行尾空格无意义', () => {
    expect(joinWordsToLineText([syl('Hello', true)])).toBe('Hello');
  });

  it('空输入返回空串，不返回 "undefined" 之类', () => {
    expect(joinWordsToLineText([])).toBe('');
    expect(joinWordsToLineText(undefined)).toBe('');
  });

  it('这正是不能直接 join("") 的原因', () => {
    const words = [syl('Hello', true), syl('world')];
    // 反例：直接拼接会把空格吃掉
    expect(words.map((w) => w.text).join('')).toBe('Helloworld');
    expect(joinWordsToLineText(words)).toBe('Hello world');
  });
});

describe('splitLineTextToWords', () => {
  it('按词切分，空格标记到前一个词', () => {
    const words = splitLineTextToWords('Hello world');
    expect(words.map((w) => w.text)).toEqual(['Hello', 'world']);
    expect(words[0]?.endsWithSpace).toBe(true);
    expect(words[1]?.endsWithSpace).toBeFalsy();
  });

  it('空白不会单独成音节（否则渲染/导出多出空格项）', () => {
    const words = splitLineTextToWords('a b  c');
    expect(words.map((w) => w.text)).toEqual(['a', 'b', 'c']);
    expect(words.every((w) => w.text.trim() !== '')).toBe(true);
  });

  it('行尾空白不产生 endsWithSpace', () => {
    const words = splitLineTextToWords('Hello   ');
    expect(words).toHaveLength(1);
    expect(words[0]?.endsWithSpace).toBeFalsy();
  });

  it('与 joinWordsToLineText 互为逆运算（行尾空白除外）', () => {
    for (const src of ['Hello world', '我 爱 你', 'Never gonna give you up']) {
      expect(joinWordsToLineText(splitLineTextToWords(src))).toBe(src);
    }
  });

  it('空串与纯空白返回空数组', () => {
    expect(splitLineTextToWords('')).toEqual([]);
    expect(splitLineTextToWords('   ')).toEqual([]);
  });

  it('时间字段先占位为 0，由调用方按字数比例填充', () => {
    const words = splitLineTextToWords('ab cd');
    expect(words.every((w) => w.startTime === 0 && w.endTime === 0)).toBe(true);
  });
});
