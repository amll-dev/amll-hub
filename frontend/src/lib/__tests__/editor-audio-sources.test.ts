import { describe, expect, it } from 'vitest';
import { buildAudioUrl, buildEditorAudioSources } from '@/lib/review/audio-sources';
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

const NCM = { url: 'https://ncm.example/song.mp3', name: '某首歌' };

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
    const list = buildEditorAudioSources([audio({})], '', null, '');
    expect(list).toHaveLength(1);
    expect(list[0]!.key).toBe('music/35-1.mp3');
  });

  it('只有网易云时，列表只有网易云那条', () => {
    const list = buildEditorAudioSources([], '1791651504365', NCM, '');
    expect(list).toHaveLength(1);
    expect(list[0]!.key).toBe('ncm:1791651504365');
    expect(list[0]!.src).toBe(NCM.url);
    expect(list[0]!.label).toContain('网易云');
  });

  it('同时有上传音频与网易云时，两条都要在（上传在前）', () => {
    const list = buildEditorAudioSources([audio({})], '1791651504365', NCM, '');
    expect(list).toHaveLength(2);
    expect(list[0]!.key).toBe('music/35-1.mp3');
    expect(list[1]!.key).toBe('ncm:1791651504365');
  });

  it('多个上传音频按原顺序排在前，网易云固定在最后', () => {
    const list = buildEditorAudioSources(
      [audio({ id: 1, fileName: 'music/a.mp3' }), audio({ id: 2, fileName: 'music/b.mp3' })],
      '123',
      NCM,
      ''
    );
    expect(list.map((s) => s.key)).toEqual(['music/a.mp3', 'music/b.mp3', 'ncm:123']);
  });

  it('网易云解析失败（无 url）时不加入列表，上传音频仍保留', () => {
    const list = buildEditorAudioSources([audio({})], '123', { url: '', name: 'x' }, '');
    expect(list).toHaveLength(1);
    expect(list[0]!.key).toBe('music/35-1.mp3');
  });

  it('没有 ncmId 时即使有解析结果也不加网易云', () => {
    const list = buildEditorAudioSources([audio({})], '', NCM, '');
    expect(list).toHaveLength(1);
  });

  it('缺 fileName 的上传音频被过滤掉', () => {
    const list = buildEditorAudioSources([audio({ fileName: '' })], '', null, '');
    expect(list).toHaveLength(0);
  });

  it('label 优先用 title，其次 artist，最后 fileName', () => {
    expect(buildEditorAudioSources([audio({ title: '歌名' })], '', null, '')[0]!.label).toBe(
      '歌名'
    );
    expect(buildEditorAudioSources([audio({ artist: '歌手' })], '', null, '')[0]!.label).toBe(
      '歌手'
    );
    expect(buildEditorAudioSources([audio({})], '', null, '')[0]!.label).toBe('music/35-1.mp3');
  });
});
