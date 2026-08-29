import { describe, expect, it } from 'vitest';
import type { TargetAndTransition, Variants } from 'framer-motion';
import {
  buttonTap,
  cardHover,
  fadeUp,
  indexedListItem,
  listContainer,
  listItem,
  staggerContainer,
  whileInViewProps,
} from '@/lib/motion';

// Variant 是 TargetAndTransition | TargetResolver 联合类型，
// 业务常量均为静态目标对象，统一收窄后即可安全访问 transition
const show = (v: Variants): TargetAndTransition => v.show as TargetAndTransition;

describe('motion 动效常量', () => {
  it('fadeUp：hidden 隐藏 + show 复位（带缓动配置）', () => {
    expect(fadeUp.hidden).toEqual({ opacity: 0, y: 24 });
    expect(fadeUp.show).toMatchObject({ opacity: 1, y: 0 });
    expect(show(fadeUp).transition).toEqual({ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] });
  });

  it('staggerContainer：子元素错峰入场参数', () => {
    expect(show(staggerContainer).transition).toEqual({
      staggerChildren: 0.08,
      delayChildren: 0.05,
    });
  });

  it('listContainer 为空壳（子项自带延迟）', () => {
    expect(listContainer).toEqual({ hidden: {}, show: {} });
  });

  it('indexedListItem：延迟随索引增长且封顶 0.9s', () => {
    expect(show(indexedListItem(0)).transition?.delay).toBe(0);
    expect(show(indexedListItem(3)).transition?.delay).toBeCloseTo(0.21);
    expect(show(indexedListItem(100)).transition?.delay).toBe(0.9);
  });

  it('listItem：入场位移 16px', () => {
    expect(listItem.hidden).toEqual({ opacity: 0, y: 16 });
    expect(listItem.show).toMatchObject({ opacity: 1, y: 0 });
  });

  it('cardHover / buttonTap 提供交互反馈', () => {
    expect(cardHover.whileHover).toMatchObject({ y: -4 });
    expect(buttonTap.whileHover).toEqual({ scale: 1.02 });
    expect(buttonTap.whileTap).toEqual({ scale: 0.98 });
  });

  it('whileInViewProps：一次性进入触发', () => {
    expect(whileInViewProps.viewport).toEqual({ once: true, margin: '-80px' });
    expect(whileInViewProps.initial).toBe('hidden');
    expect(whileInViewProps.whileInView).toBe('show');
  });
});
