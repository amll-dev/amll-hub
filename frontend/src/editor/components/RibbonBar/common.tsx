/*
 * Copyright 2023-2025 Steve Xiao (stevexmh@qq.com) and contributors.
 *
 * 本源代码文件是属于 AMLL TTML Tool 项目的一部分。
 * This source code file is a part of AMLL TTML Tool project.
 * 本项目的源代码的使用受到 GNU GENERAL PUBLIC LICENSE version 3 许可证的约束，具体可以参阅以下链接。
 * Use of this source code is governed by the GNU GPLv3 license that can be found through the following link.
 *
 * https://github.com/amll-dev/amll-ttml-tool/blob/main/LICENSE
 */

import { motion } from 'framer-motion';
import {
  type FC,
  forwardRef,
  type PropsWithChildren,
  useImperativeHandle,
  useRef,
  useCallback,
} from 'react';

export const RibbonSection: FC<PropsWithChildren<{ label: string }>> = ({ children, label }) => (
  <>
    <div className="flex shrink-0 flex-col gap-1 self-stretch">
      <div className="flex flex-1 items-center justify-center">{children}</div>
      <span className="whitespace-nowrap text-center text-xs leading-none text-ink-3">{label}</span>
    </div>
    <div aria-hidden className="w-px shrink-0 self-stretch bg-line" />
  </>
);

export const RibbonFrame = forwardRef<HTMLDivElement, PropsWithChildren>(({ children }, ref) => {
  const frameRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => frameRef.current as HTMLDivElement, []);

  // 处理鼠标滚轮横向滚动
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (frameRef.current) {
      e.preventDefault();
      frameRef.current.scrollLeft += e.deltaY;
    }
  }, []);

  return (
    <motion.div
      initial={{ x: 10, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -10, opacity: 0 }}
      layout
      ref={frameRef}
      onWheel={handleWheel}
      className="flex h-full flex-row items-center gap-3 overflow-x-auto overflow-y-visible p-3"
    >
      {children}
    </motion.div>
  );
});
