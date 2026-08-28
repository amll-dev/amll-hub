import type { Transition, Variants } from 'framer-motion';

// 与设计稿一致的缓动 cubic-bezier(.2,.8,.2,1)
const easeOut: Transition = { duration: 0.5, ease: [0.2, 0.8, 0.2, 1] };

// 淡入 + 上移
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: easeOut },
};

// 容器：子元素错峰入场
export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

// 长列表容器：不做整体错峰，子项自带索引延迟
export const listContainer: Variants = {
  hidden: {},
  show: {},
};

// 长列表项：前若干项按索引错峰s，其后统一封顶延迟
export const indexedListItem = (i: number): Variants => ({
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { ...easeOut, delay: Math.min(i * 0.07, 0.9) } },
});

// 列表项入场
export const listItem: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: easeOut },
};

// 卡片 hover 上浮
export const cardHover = {
  whileHover: { y: -4, transition: { duration: 0.2 } },
};

// 按钮 hover/tap 反馈
export const buttonTap = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.98 },
};

// 滚动进入视口配置
export const whileInViewProps = {
  initial: 'hidden' as const,
  whileInView: 'show' as const,
  viewport: { once: true, margin: '-80px' },
};
