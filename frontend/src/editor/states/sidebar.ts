import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

/**
 * 侧边栏可显示的标签页 ID
 */
export type SidebarTabId = 'outline' | 'bpm' | 'requirements';

/** 老版本会把已下线的 tab（如 background）留在 localStorage，读的时候先滤掉 */
const VALID_TAB_IDS: SidebarTabId[] = ['outline', 'bpm', 'requirements'];

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
    const validOpen = get(openSidebarTabsAtom).filter((id) => VALID_TAB_IDS.includes(id));
    if (active === 'none') return 'none';
    if (
      !VALID_TAB_IDS.includes(active as SidebarTabId) ||
      !validOpen.includes(active as SidebarTabId)
    ) {
      return validOpen[validOpen.length - 1] ?? 'none';
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
    set(activeSidebarTabAtom, newOpen[newOpen.length - 1] ?? 'none');
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
        set(activeSidebarTabAtom, newOpen[newOpen.length - 1] ?? 'none');
      }
    }
  }
);

/**
 * 左侧边栏的宽度
 */
export const sidebarWidthAtom = atomWithStorage('sidebarWidth', 300);

/**
 * 用于触发编辑器跳转的事件 Atom
 * id 为歌词行 runtime id，或 `__annotation_line__:<lineIndex>` 用于批注聚焦
 */
export const outlineJumpActionAtom = atom<{ id: string; ts: number } | null>(null);
