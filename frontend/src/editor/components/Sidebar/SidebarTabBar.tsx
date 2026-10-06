import { DismissRegular } from '@fluentui/react-icons';
import { AnimatePresence, motion } from 'framer-motion';
import { type FC, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const prevTabIdsRef = useRef<Set<string>>(new Set());

  const prevTabIds = prevTabIdsRef.current;

  useEffect(() => {
    prevTabIdsRef.current = new Set(tabs.map((t) => t.id));
  }, [tabs]);

  if (tabs.length === 1) {
    return (
      <div className={styles.singleTitleContainer}>
        <span className={styles.singleTitle}>{tabs[0].getTitle(t)}</span>
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
              <span className={styles.tabTitle}>{tab.getTitle(t)}</span>
              <button
                type="button"
                className={styles.closeButton}
                aria-label={t('common.close', '关闭')}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                <DismissRegular style={{ fontSize: 15 }} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

export default SidebarTabBar;
