import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

/**
 * 侧边栏可显示的标签页 ID
 */
export type SidebarTabId = 'outline' | 'bpm';

/**
 * 侧边栏可能显示的面板类型
 *
 * "none" 表示侧边栏关闭
 */
export type SidebarPanelType = 'none' | SidebarTabId;

/**
 * 当前打开的侧边栏标签页列表
 */
export const openSidebarTabsAtom = atomWithStorage<SidebarTabId[]>('openSidebarTabs', ['outline']);

const baseActiveSidebarTabAtom = atomWithStorage<SidebarPanelType>('activeSidebarTab', 'outline');

/**
 * 当前激活和选中的面板
 *
 * 设为 "none" 关闭侧边栏并清空 openSidebarTabsAtom
 */
export const activeSidebarTabAtom = atom(
  (get) => {
    const active = get(baseActiveSidebarTabAtom);
    const openTabs = get(openSidebarTabsAtom);
    if (active !== 'none' && !openTabs.includes(active as SidebarTabId)) {
      return openTabs.length > 0 ? openTabs[openTabs.length - 1] : 'none';
    }
    return active;
  },
  (get, set, update: SidebarPanelType | ((prev: SidebarPanelType) => SidebarPanelType)) => {
    const nextValue = typeof update === 'function' ? update(get(baseActiveSidebarTabAtom)) : update;
    set(baseActiveSidebarTabAtom, nextValue);
    if (nextValue === 'none') {
      set(openSidebarTabsAtom, []);
    }
  }
);

/**
 * 打开并激活指定标签页
 */
export const openTabAtom = atom(null, (get, set, tabId: SidebarTabId) => {
  const currentOpen = get(openSidebarTabsAtom);
  if (!currentOpen.includes(tabId)) {
    set(openSidebarTabsAtom, [...currentOpen, tabId]);
  }
  set(activeSidebarTabAtom, tabId);
});

/**
 * 关闭指定标签页
 */
export const closeTabAtom = atom(null, (get, set, tabId: SidebarTabId) => {
  const currentOpen = get(openSidebarTabsAtom);
  const newOpen = currentOpen.filter((id) => id !== tabId);
  set(openSidebarTabsAtom, newOpen);

  const activeTab = get(activeSidebarTabAtom);
  if (activeTab === tabId) {
    if (newOpen.length > 0) {
      set(activeSidebarTabAtom, newOpen[newOpen.length - 1]);
    } else {
      set(activeSidebarTabAtom, 'none');
    }
  }
});

/**
 * 切换指定标签页的打开/关闭状态
 */
export const toggleTabAtom = atom(
  null,
  (get, set, { tabId, open }: { tabId: SidebarTabId; open: boolean }) => {
    if (open) {
      const currentOpen = get(openSidebarTabsAtom);
      if (!currentOpen.includes(tabId)) {
        set(openSidebarTabsAtom, [...currentOpen, tabId]);
      }
      set(activeSidebarTabAtom, tabId);
    } else {
      const currentOpen = get(openSidebarTabsAtom);
      const newOpen = currentOpen.filter((id) => id !== tabId);
      set(openSidebarTabsAtom, newOpen);

      const activeTab = get(activeSidebarTabAtom);
      if (activeTab === tabId) {
        if (newOpen.length > 0) {
          set(activeSidebarTabAtom, newOpen[newOpen.length - 1]);
        } else {
          set(activeSidebarTabAtom, 'none');
        }
      }
    }
  }
);

/**
 * 左侧边栏的宽度
 */
export const sidebarWidthAtom = atomWithStorage('sidebarWidth', 300);

/**
 * 右侧边栏可能显示的面板类型
 */
export type RightSidebarPanelType = 'none' | 'annotations';

/**
 * 当前激活的右侧面板
 */
export const rightSidebarPanelAtom = atom<RightSidebarPanelType>('none');

/**
 * 右侧边栏的宽度（最大不超过视口 40%，在组件内钳制）
 */
export const rightSidebarWidthAtom = atomWithStorage('rightSidebarWidth', 320);

/**
 * 用于触发编辑器跳转的事件 Atom
 * id 为歌词行 runtime id，或 `__annotation_line__:<lineIndex>` 用于批注聚焦
 */
export const outlineJumpActionAtom = atom<{ id: string; ts: number } | null>(null);
