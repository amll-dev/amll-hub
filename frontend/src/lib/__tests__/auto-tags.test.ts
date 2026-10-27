import { describe, expect, it } from 'vitest';
import { AutoTag, detectAutoTags } from '@/lib/auto-tags';
import type { TTMLMetadata } from '@/lib/ttml-processor';

const meta = (patch: Partial<TTMLMetadata> = {}): TTMLMetadata => ({ ...patch });
const line = (patch: Partial<Parameters<typeof detectAutoTags>[0]['lines'][number]> = {}) => ({
  text: 'x',
  startTime: 0,
  endTime: 1000,
  ...patch,
});

describe('detectAutoTags', () => {
  it('按 artists 识别厂牌标签', () => {
    expect(
      detectAutoTags({ metadata: meta({ artist: ['Mili (ミリー)', '塞壬唱片-MSR'] }), lines: [] })
    ).toEqual([AutoTag.Msr]);
    expect(detectAutoTags({ metadata: meta({ artist: ['铁痕电台-MSR'] }), lines: [] })).toEqual([
      AutoTag.Msr,
    ]);
    expect(
      detectAutoTags({ metadata: meta({ artist: ['HOYO MiX', 'hoyofair 2024'] }), lines: [] })
    ).toEqual([AutoTag.HoyoMix, AutoTag.HoyoFair]);
    expect(detectAutoTags({ metadata: meta({ artist: ['鸣潮先约电台'] }), lines: [] })).toEqual([
      AutoTag.Wuthering,
    ]);
  });

  it('artists 没有关键词时不打厂牌标签', () => {
    expect(detectAutoTags({ metadata: meta({ artist: ['Glass Animals'] }), lines: [] })).toEqual(
      []
    );
    // 关键词只认 artists，标题/专辑里出现不算
    expect(
      detectAutoTags({ metadata: meta({ title: ['HOYO-MiX 精选'], album: ['MSR'] }), lines: [] })
    ).toEqual([]);
  });

  it('单个元数据字段超过 18 条才打地瓜藤', () => {
    const albums = (n: number) => Array.from({ length: n }, (_, i) => `album-${i}`);
    expect(detectAutoTags({ metadata: meta({ album: albums(18) }), lines: [] })).toEqual([]);
    expect(detectAutoTags({ metadata: meta({ album: albums(19) }), lines: [] })).toEqual([
      AutoTag.Melon,
    ]);
    // 平台 ID 与角色元数据同样计数
    expect(
      detectAutoTags({ metadata: meta({ platformIds: { ncmMusicId: albums(19) } }), lines: [] })
    ).toEqual([AutoTag.Melon]);
    expect(
      detectAutoTags({ metadata: meta({ rawProperties: { vocals: albums(19) } }), lines: [] })
    ).toEqual([AutoTag.Melon]);
  });

  it('译文语种 ≥2 打多语言翻译（简繁各算一种）', () => {
    const two = [
      line({
        translations: [
          { language: 'zh-Hans', text: '甲' },
          { language: 'zh-Hant', text: '甲' },
        ],
      }),
    ];
    expect(detectAutoTags({ metadata: meta(), lines: two })).toEqual([AutoTag.MultiLang]);
    expect(
      detectAutoTags({
        metadata: meta(),
        lines: [line({ translations: [{ language: 'zh-CN', text: '甲' }] })],
      })
    ).toEqual([]);
  });

  it('译文或音译带逐字时间轴即打逐字标签', () => {
    const wordTimed = [
      line({
        translations: [
          {
            language: 'zh-CN',
            text: '甲',
            words: [{ text: '甲', startTime: 0, endTime: 100 }],
          },
        ],
      }),
    ];
    expect(detectAutoTags({ metadata: meta(), lines: wordTimed })).toEqual([AutoTag.WordTimed]);

    const romanized = [
      line({
        romanizations: [{ text: 'a', words: [{ text: 'a', startTime: 0, endTime: 100 }] }],
      }),
    ];
    expect(detectAutoTags({ metadata: meta(), lines: romanized })).toEqual([AutoTag.WordTimed]);
  });

  it('多标签按固定顺序返回且不重复', () => {
    const tags = detectAutoTags({
      metadata: meta({ artist: ['HOYO-MiX'], album: Array.from({ length: 20 }, () => 'a') }),
      lines: [
        line({
          translations: [
            { language: 'zh-Hans', text: '甲' },
            { language: 'en', text: 'a' },
          ],
          romanizations: [{ text: 'a', words: [{ text: 'a', startTime: 0, endTime: 100 }] }],
        }),
      ],
    });
    expect(tags).toEqual([AutoTag.HoyoMix, AutoTag.Melon, AutoTag.MultiLang, AutoTag.WordTimed]);
  });
});
