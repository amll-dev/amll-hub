import { describe, expect, it } from 'vitest';
import { buildAudioUrl, buildEditorAudioSources } from '@/lib/review/audio-sources';
import type { OnlineAudioCandidate } from '@/lib/review/audio-sources';
import type { SubmissionAudio } from '@/lib/types';

function audio(partial: Partial<SubmissionAudio>): SubmissionAudio {
  return {
    id: 1,
    submissionId: 35,
    fileName: 'music/35-1.mp3',
    title: '',
    artist: '',
    album: '',
    platform: '',
    platformId: '',
    uploadedBy: 'u',
    uploadedAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

/** 构造一条已解析成功的在线音源候选 */
function ok(id: string, name = '某首歌'): OnlineAudioCandidate {
  return { id, info: { url: `https://cdn.example/${id}.mp3`, name } };
}

describe('buildAudioUrl', () => {
  it('拼出与详情页一致的播放地址', () => {
    expect(buildAudioUrl({ fileName: 'music/35-1.mp3' }, '')).toBe(
      '/api/v1/uploads/file/music/35-1.mp3'
    );
  });

  it('带 apiBase 时使用绝对地址', () => {
    expect(buildAudioUrl({ fileName: 'music/35-1.mp3' }, 'http://localhost:8080')).toBe(
      'http://localhost:8080/api/v1/uploads/file/music/35-1.mp3'
    );
  });

  it('缺 fileName 返回空串', () => {
    expect(buildAudioUrl({}, '')).toBe('');
  });
});

describe('buildEditorAudioSources', () => {
  it('只有上传音频时，列表只有一条', () => {
    const list = buildEditorAudioSources([audio({})], [], [], '');
    expect(list).toHaveLength(1);
    expect(list[0]!.key).toBe('music/35-1.mp3');
  });

  it('只有网易云时，列表只有网易云那条', () => {
    const list = buildEditorAudioSources([], [ok('1791651504365')], [], '');
    expect(list).toHaveLength(1);
    expect(list[0]!.key).toBe('ncm:1791651504365');
    expect(list[0]!.src).toBe('https://cdn.example/1791651504365.mp3');
    expect(list[0]!.label).toContain('网易云');
  });

  it('同时有上传音频与网易云时，两条都要在（上传在前）', () => {
    const list = buildEditorAudioSources([audio({})], [ok('1791651504365')], [], '');
    expect(list).toHaveLength(2);
    expect(list[0]!.key).toBe('music/35-1.mp3');
    expect(list[1]!.key).toBe('ncm:1791651504365');
  });

  it('多个上传音频按原顺序排在前，在线音源固定在最后', () => {
    const list = buildEditorAudioSources(
      [audio({ id: 1, fileName: 'music/a.mp3' }), audio({ id: 2, fileName: 'music/b.mp3' })],
      [ok('123')],
      [],
      ''
    );
    expect(list.map((s) => s.key)).toEqual(['music/a.mp3', 'music/b.mp3', 'ncm:123']);
  });

  it('网易云解析失败（无 url）时不加入列表，上传音频仍保留', () => {
    const list = buildEditorAudioSources(
      [audio({})],
      [{ id: '123', info: { url: '', name: 'x' } }],
      [],
      ''
    );
    expect(list).toHaveLength(1);
    expect(list[0]!.key).toBe('music/35-1.mp3');
  });

  it('解析结果为 null（请求失败）时不加入列表', () => {
    const list = buildEditorAudioSources([], [{ id: '123', info: null }], [], '');
    expect(list).toHaveLength(0);
  });

  it('缺 fileName 的上传音频被过滤掉', () => {
    const list = buildEditorAudioSources([audio({ fileName: '' })], [], [], '');
    expect(list).toHaveLength(0);
  });

  it('只有 QQ 音乐时，列表只有 QQ 音乐那条', () => {
    const list = buildEditorAudioSources([], [], [ok('m0024abc')], '');
    expect(list).toHaveLength(1);
    expect(list[0]!.key).toBe('qq:m0024abc');
    expect(list[0]!.label).toContain('QQ 音乐');
  });

  it('网易云与 QQ 音乐同时存在时，两者都加入且网易云在前', () => {
    const list = buildEditorAudioSources([], [ok('123')], [ok('m0024abc')], '');
    expect(list.map((s) => s.key)).toEqual(['ncm:123', 'qq:m0024abc']);
  });

  it('QQ 音乐解析失败（无 url）时不加入列表', () => {
    const list = buildEditorAudioSources(
      [audio({})],
      [],
      [{ id: 'm0024abc', info: { url: '', name: 'x' } }],
      ''
    );
    expect(list).toHaveLength(1);
    expect(list[0]!.key).toBe('music/35-1.mp3');
  });

  it('同一平台多个 ID：全部加入，标签带 ID 便于区分', () => {
    const list = buildEditorAudioSources([], [ok('111', '同名歌'), ok('222', '同名歌')], [], '');
    expect(list.map((s) => s.key)).toEqual(['ncm:111', 'ncm:222']);
    expect(list[0]!.label).toBe('网易云 · 同名歌（111）');
    expect(list[1]!.label).toBe('网易云 · 同名歌（222）');
  });

  it('同一平台只有一个 ID 时标签不带 ID', () => {
    const list = buildEditorAudioSources([], [ok('111', '同名歌')], [], '');
    expect(list[0]!.label).toBe('网易云 · 同名歌');
  });

  it('多 ID 里部分解析失败：只保留成功的那些', () => {
    const list = buildEditorAudioSources(
      [],
      [ok('111', 'A'), { id: '222', info: { url: '', name: 'B' } }, ok('333', 'C')],
      [],
      ''
    );
    expect(list.map((s) => s.key)).toEqual(['ncm:111', 'ncm:333']);
    // 有效条目仍是 2 条，标签需要带 ID 区分
    expect(list[0]!.label).toBe('网易云 · A（111）');
  });

  it('label 优先用 title，其次 artist，最后 fileName', () => {
    expect(buildEditorAudioSources([audio({ title: '歌名' })], [], [], '')[0]!.label).toBe('歌名');
    expect(buildEditorAudioSources([audio({ artist: '歌手' })], [], [], '')[0]!.label).toBe('歌手');
    expect(buildEditorAudioSources([audio({})], [], [], '')[0]!.label).toBe('music/35-1.mp3');
  });
});
