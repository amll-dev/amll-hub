import type { TFunction } from 'i18next';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { type FC, useMemo } from 'react';
import {
  activeSidebarTabAtom,
  closeTabAtom,
  openSidebarTabsAtom,
  type SidebarPanelType,
  sidebarWidthAtom,
} from '$/states/sidebar.ts';
import { BpmPanel } from './BpmPanel';
import { OutlinePanel } from './OutlinePanel';
import { ResizableSidebar } from './ResizableSidebar';
import { SidebarTabBar } from './SidebarTabBar';

const MIN_WIDTH = 200;
const MAX_WIDTH = 650;

export interface SidebarTab {
  id: Exclude<SidebarPanelType, 'none'>;
  getTitle: (t: TFunction) => string;
  component: FC;
}

export const SIDEBAR_TABS: SidebarTab[] = [
  {
    id: 'outline',
    getTitle: (t) => t('sidebar.outline.title', '大纲'),
    component: OutlinePanel,
  },
  {
    id: 'bpm',
    getTitle: (t) => t('sidebar.bpm.title', 'BPM'),
    component: BpmPanel,
  },
];

export const Sidebar = () => {
  const openTabs = useAtomValue(openSidebarTabsAtom);
  const [activePanel, setActivePanel] = useAtom(activeSidebarTabAtom);
  const closeTab = useSetAtom(closeTabAtom);

  const visibleTabs = useMemo(
    () =>
      openTabs
        .map((id) => SIDEBAR_TABS.find((tab) => tab.id === id))
        .filter((tab): tab is SidebarTab => tab !== undefined),
    [openTabs]
  );

  const tabBar = (
    <SidebarTabBar
      tabs={visibleTabs}
      activePanel={activePanel}
      onSelectTab={(id) => setActivePanel(id)}
      onCloseTab={(id) => closeTab(id)}
    />
  );

  return (
    <ResizableSidebar
      side="left"
      panelAtom={activeSidebarTabAtom}
      widthAtom={sidebarWidthAtom}
      closedPanel="none"
      minWidth={MIN_WIDTH}
      maxWidth={MAX_WIDTH}
      maxWidthRatio={0.5}
      titles={{ outline: tabBar, bpm: tabBar }}
      headerSingle={visibleTabs.length === 1}
    >
      {SIDEBAR_TABS.map((tab) => {
        if (activePanel !== tab.id) return null;
        const Comp = tab.component;
        return <Comp key={tab.id} />;
      })}
    </ResizableSidebar>
  );
};

export default Sidebar;
