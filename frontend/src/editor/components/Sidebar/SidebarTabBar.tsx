import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { type FC, type KeyboardEvent, useEffect, useRef } from 'react';
import type { SidebarPanelType } from '$/states/sidebar.ts';
import type { SidebarTab } from './index';
import styles from './SidebarTabBar.module.css';

interface SidebarTabBarProps {
  tabs: SidebarTab[];
  activePanel: SidebarPanelType;
  onSelectTab: (id: Exclude<SidebarPanelType, 'none'>) => void;
  onCloseTab: (id: Exclude<SidebarPanelType, 'none'>) => void;
}

export const SidebarTabBar: FC<SidebarTabBarProps> = ({
  tabs,
  activePanel,
  onSelectTab,
  onCloseTab,
}) => {
  const prevTabIdsRef = useRef<Set<string>>(new Set());

  const prevTabIds = prevTabIdsRef.current;

  useEffect(() => {
    prevTabIdsRef.current = new Set(tabs.map((t) => t.id));
  }, [tabs]);

  // roving tabindex：只有当前 tab 可 Tab 聚焦，方向键在 tab 之间移动
  const handleTabListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (tabs.length === 0) return;
    const currentIndex = tabs.findIndex((t) => t.id === activePanel);
    let nextIndex = -1;
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex < 0) return;
    e.preventDefault();
    const next = tabs[nextIndex];
    if (!next) return;
    onSelectTab(next.id);
    document.getElementById(`sidebar-tab-${next.id}`)?.focus();
  };

  const singleTab = tabs.length === 1 ? tabs[0] : undefined;
  if (singleTab) {
    return (
      <div className={styles.singleTitleContainer}>
        <span className={styles.singleTitle}>{singleTab.title}</span>
      </div>
    );
  }

  return (
    <div
      className={styles.tabBar}
      role="tablist"
      aria-label="侧栏面板"
      aria-orientation="horizontal"
      onKeyDown={handleTabListKeyDown}
    >
      <AnimatePresence mode="popLayout">
        {tabs.map((tab) => {
          const isActive = activePanel === tab.id;
          const isNewTab = !prevTabIds.has(tab.id);

          return (
            <motion.div
              key={tab.id}
              role="presentation"
              className={styles.tabItem}
              data-active={isActive}
              initial={isNewTab ? { y: 16, opacity: 0 } : false}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 12, opacity: 0 }}
              transition={{
                type: 'spring',
                stiffness: 400,
                damping: 28,
              }}
              onClick={() => onSelectTab(tab.id)}
            >
              <button
                type="button"
                role="tab"
                id={`sidebar-tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`sidebar-panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                className={styles.tabButton}
              >
                <span className={styles.tabTitle}>{tab.title}</span>
              </button>
              <button
                type="button"
                className={styles.closeButton}
                aria-label={`关闭 ${tab.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                <X className="size-[15px]" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

export default SidebarTabBar;
