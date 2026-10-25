import { describe, expect, it } from 'vitest';
import { extractNcmSongId } from '@/lib/ncm';

describe('extractNcmSongId', () => {
  it('纯数字原样返回（去首尾空格）', () => {
    expect(extractNcmSongId(' 1234567 ')).toBe('1234567');
  });

  it('从 ?id= / #/song?id= 中提取', () => {
    expect(extractNcmSongId('https://music.163.com/song?id=1234567&userid=1')).toBe('1234567');
    expect(extractNcmSongId('https://music.163.com/#/song?id=1234567')).toBe('1234567');
    expect(extractNcmSongId('https://y.music.163.com/m/song?id=1234567&uct2=abc')).toBe('1234567');
  });

  it('从 /song/{id} 路径中提取', () => {
    expect(extractNcmSongId('https://music.163.com/song/1234567')).toBe('1234567');
  });

  it('分享文案里夹带的链接也能提取', () => {
    expect(
      extractNcmSongId('分享单曲 https://y.music.163.com/m/song?id=1234567 (@网易云音乐)')
    ).toBe('1234567');
  });

  it('认不出时原样返回', () => {
    expect(extractNcmSongId('hello')).toBe('hello');
    expect(extractNcmSongId('https://example.com/?id=123')).toBe('https://example.com/?id=123');
  });
});
