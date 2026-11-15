import { motion } from 'framer-motion';
import { useAtom, type WritableAtom } from 'jotai';
import { X } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import styles from './ResizableSidebar.module.css';

const SNAP_CLOSE_THRESHOLD = 20;
type SetPanelAction<Panel> = Panel | ((prev: Panel) => Panel);

export type ResizableSidebarProps<Panel extends string> = {
  /** 停靠边；决定拖拽方向与边框侧。 */
  side: 'left' | 'right';
  panelAtom: WritableAtom<Panel, [SetPanelAction<Panel>], void>;
  widthAtom: WritableAtom<number, [SetPanelAction<number>], void>;
  /** 关闭态的哨兵值。 */
  closedPanel: Panel;
  minWidth: number;
  /** 绝对上限，可选；总会再按 maxWidthRatio 收一次。 */
  maxWidth?: number;
  maxWidthRatio: number;
  /** 面板标题；未命中时不显示原始面板名。 */
  titles: Partial<Record<Panel, ReactNode>>;
  /** 单标签页标题态。 */
  headerSingle?: boolean;
  children: ReactNode;
};

/**
 * 可拖拽调宽 / 贴边吸附关闭的侧边栏外壳。
 * 左右两侧共用，避免两份逐字重复的拖拽与动画逻辑各自漂移。
 */
export const ResizableSidebar = <Panel extends string>({
  side,
  panelAtom,
  widthAtom,
  closedPanel,
  minWidth,
  maxWidth,
  maxWidthRatio,
  titles,
  headerSingle,
  children,
}: ResizableSidebarProps<Panel>) => {
  const [activePanel, setActivePanel] = useAtom(panelAtom);
  const [savedWidth, setSavedWidth] = useAtom(widthAtom);

  const [isDragging, setIsDragging] = useState(false);
  const [tempWidth, setTempWidth] = useState(savedWidth);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const contentWidth = tempWidth > 0 ? tempWidth : savedWidth;
  const isOpen = activePanel !== closedPanel;

  const ratioLimit = window.innerWidth * maxWidthRatio;
  const maxAllowedWidth = maxWidth === undefined ? ratioLimit : Math.min(maxWidth, ratioLimit);
  const clampWidth = useCallback(
    (w: number) => Math.min(Math.max(w, minWidth), maxAllowedWidth),
    [minWidth, maxAllowedWidth]
  );

  const close = useCallback(() => setActivePanel(closedPanel), [closedPanel, setActivePanel]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging || !sidebarRef.current) return;
      // 左右两侧都用相对 sidebar 边缘的量，不假设侧边栏贴住视口 left: 0。
      const rect = sidebarRef.current.getBoundingClientRect();
      const newWidth = side === 'left' ? e.clientX - rect.left : rect.right - e.clientX;

      if (newWidth <= SNAP_CLOSE_THRESHOLD) {
        setTempWidth(0);
      } else {
        setTempWidth(clampWidth(newWidth));
      }
    },
    [isDragging, side, clampWidth]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      setIsDragging(false);
      // pointercancel 时浏览器已释放隐式捕获，无条件 release 会抛 NotFoundError
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }

      if (tempWidth <= SNAP_CLOSE_THRESHOLD) {
        close();
        setTempWidth(savedWidth);
      } else {
        setSavedWidth(tempWidth);
      }
    },
    [isDragging, tempWidth, savedWidth, close, setSavedWidth]
  );

  useEffect(() => {
    if (!isDragging) setTempWidth(savedWidth);
  }, [savedWidth, isDragging]);

  const resizer = isOpen && (
    <div
      className={styles.resizer}
      data-dragging={isDragging}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(tempWidth)}
      aria-valuemin={minWidth}
      aria-valuemax={Math.round(maxAllowedWidth)}
      aria-label="调整侧边栏宽度"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={(e) => {
        // 按 ARIA separator 模式补键盘操作，键盘用户也能调整宽度
        const step = e.shiftKey ? 50 : 10;
        let next: number | null = null;
        if (e.key === 'ArrowLeft') next = clampWidth(tempWidth - step);
        else if (e.key === 'ArrowRight') next = clampWidth(tempWidth + step);
        else if (e.key === 'Home') next = minWidth;
        else if (e.key === 'End') next = Math.round(maxAllowedWidth);
        if (next === null) return;
        e.preventDefault();
        setTempWidth(next);
        setSavedWidth(next);
      }}
    />
  );

  return (
    <div className={styles.root} data-side={side}>
      {side === 'right' && resizer}
      <motion.div
        ref={sidebarRef}
        className={styles.sidebarContainer}
        initial={false}
        animate={{
          width: isOpen ? tempWidth : 0,
          opacity: isOpen ? 1 : 0,
          ...(side === 'left'
            ? { borderRightWidth: isOpen ? 1 : 0 }
            : { borderLeftWidth: isOpen ? 1 : 0 }),
        }}
        transition={{
          type: 'tween',
          ease: [0.12, 0.84, 0.27, 0.98],
          duration: isDragging ? 0 : 0.25,
        }}
      >
        <div className={styles.inner} style={{ width: contentWidth, minWidth: contentWidth }}>
          <div className={styles.header} data-single-tab={headerSingle}>
            <div className={styles.title}>{isOpen ? (titles[activePanel] ?? null) : null}</div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 rounded-full"
              onClick={close}
              aria-label="关闭"
            >
              <X className="size-4" />
            </Button>
          </div>
          <div
            className={styles.content}
            id={isOpen ? `sidebar-panel-${activePanel}` : undefined}
            role={isOpen ? 'tabpanel' : undefined}
            aria-labelledby={isOpen ? `sidebar-tab-${activePanel}` : undefined}
          >
            {children}
          </div>
        </div>
      </motion.div>
      {side === 'left' && resizer}
    </div>
  );
};
