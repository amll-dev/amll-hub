import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn', () => {
  it('拼接多个 class', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('过滤假值条件 class', () => {
    expect(cn('a', false && 'b', undefined, null, 'c')).toBe('a c');
  });

  it('尾部 class 覆盖前面的冲突工具类（twMerge）', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-sm', 'text-base')).toBe('text-base');
  });

  it('对象语法条件拼接', () => {
    expect(cn('base', { active: true, disabled: false })).toBe('base active');
  });
});
