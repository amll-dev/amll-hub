import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { type FC, useEffect, useRef } from 'react';
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

  const singleTab = tabs.length === 1 ? tabs[0] : undefined;
  if (singleTab) {
    return (
      <div className={styles.singleTitleContainer}>
        <span className={styles.singleTitle}>{singleTab.title}</span>
      </div>
    );
  }

  return (
    <div className={styles.tabBar} role="tablist">
      <AnimatePresence mode="popLayout">
        {tabs.map((tab) => {
          const isActive = activePanel === tab.id;
          const isNewTab = !prevTabIds.has(tab.id);

          return (
            <motion.div
              key={tab.id}
              role="tab"
              tabIndex={0}
              aria-selected={isActive}
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
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  onSelectTab(tab.id);
                }
              }}
            >
              <span className={styles.tabTitle}>{tab.title}</span>
              <button
                type="button"
                className={styles.closeButton}
                aria-label="关闭"
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
