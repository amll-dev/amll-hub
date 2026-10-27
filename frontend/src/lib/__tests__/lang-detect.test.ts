import { describe, expect, it } from 'vitest';
import { detectLanguages } from '@/lib/lang-detect';

/** 只关心语言代码，便于断言 */
const codes = (texts: string[]) =>
  detectLanguages(texts.map((text) => ({ text }))).map((hit) => hit.code);

describe('detectLanguages', () => {
  it('按文字脚本区分中日韩', () => {
    expect(codes(['我很受伤，宝贝', '让我的感情坠入低谷'])).toEqual(['zh']);
    expect(codes(['君のことが好きだ', '永遠に'])).toEqual(['ja']);
    expect(codes(['사랑해', '너를 원해'])).toEqual(['ko']);
  });

  it('拉丁文本按英文虚词判定，非英语归到 others', () => {
    expect(codes(["I'm hurtin' baby", 'I need your lovin', "'I need it now"])).toEqual(['en']);

    expect(codes(["Je t'aime", 'Tu me manques'])).toEqual(['others']);
    expect(codes(['Mi corazón es tuyo', 'Te quiero mucho'])).toEqual(['others']);
    expect(codes(['Ich liebe dich', 'Du bist mein Herz'])).toEqual(['others']);
  });

  it('语气词堆叠的英文行不会被误判', () => {
    expect(codes(['La la la', 'Oh oh oh', 'Na na na'])).toEqual(['en']);
  });

  it('混排歌词主语言在前，占比达标的次要语言一并返回', () => {
    const hits = detectLanguages([
      { text: '我很爱你' },
      { text: '我在这里' },
      { text: '我等你' },
      { text: 'I love you so much' },
    ]);
    expect(hits.map((hit) => hit.code)).toEqual(['zh', 'en']);
    expect(hits[0]?.share).toBeCloseTo(0.75);
  });

  it('背景人声计入统计，翻译不参与', () => {
    const hits = detectLanguages([
      { text: '我爱你', backgroundVocal: { text: 'I love you', startTime: 0, endTime: 1000 } },
      { text: '你爱我', backgroundVocal: { text: 'and you love me', startTime: 0, endTime: 1000 } },
    ]);
    expect(hits.map((hit) => hit.code).sort()).toEqual(['en', 'zh']);
  });

  it('无有效歌词行时返回空', () => {
    expect(codes(['', '♪', '123'])).toEqual([]);
  });
});
