import { describe, expect, it, vi, beforeEach } from 'vitest';
import { downloadText, sanitizeFileName } from '@/lib/download';

beforeEach(() => {
  // jsdom 无 createObjectURL/revokeObjectURL，stub 之
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => 'blob:mock'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

describe('sanitizeFileName', () => {
  it('替换 Windows/Unix 非法字符', () => {
    expect(sanitizeFileName('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('替换 Unicode 控制字符（含换行）', () => {
    expect(sanitizeFileName('line1\nline2\tend')).toBe('line1_line2_end');
  });

  it('斜杠替换为下划线（非空不触发回退）', () => {
    expect(sanitizeFileName('a/b/c')).toBe('a_b_c');
  });

  it('清理后为空时回退为"未知"', () => {
    expect(sanitizeFileName('   ')).toBe('未知');
    expect(sanitizeFileName('')).toBe('未知');
  });

  it('合法文件名保持原样（含中日文）', () => {
    expect(sanitizeFileName('歌曲 - 歌手name')).toBe('歌曲 - 歌手name');
  });
});

describe('downloadText', () => {
  it('创建带 download 属性的 <a> 并触发点击', () => {
    const click = vi.fn();
    const anchor = { click, remove: vi.fn(), href: '', download: '' };
    const created = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor as unknown as HTMLAnchorElement);
    const appendSpy = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementation(() => null as never);

    downloadText('hello', 'test.txt', 'text/plain');

    expect(anchor.download).toBe('test.txt');
    expect(click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    created.mockRestore();
    appendSpy.mockRestore();
  });
});
