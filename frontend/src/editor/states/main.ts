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

import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { REDO, UNDO, withHistory } from 'jotai-history';
import { enableMapSet } from 'immer';
import { uid } from 'uid';
import { identifyProject } from '$/modules/project/logic/project-info';
import {
  applyReviewOperation,
  type ReviewOperationRecord,
} from '$/modules/review/services/operation-log-service';
import type { ReviewReport } from '$/modules/review/services/report-service/types';
import type { ReviewStructuredSnapshot } from '$/modules/review/services/structured-snapshot';
import type { TTMLLyric } from '../types/ttml';

/**
 * 启用 Immer 的 Map/Set 插件 —— **必须在任何 atom 写入之前**执行。
 *
 * ## 症状
 *
 * 在时间轴上拖选/试听时控制台抛：
 *
 *   Uncaught Error: [Immer] The plugin for 'MapSet' has not been loaded into Immer.
 *     at defaultWrite → BUILDING_BLOCK_storeSet → Object.set
 *
 * `withHistory`（jotai-history）内部用 Immer 的 `produce` 来算增量与历史，
 * 一旦它遍历到的状态里出现 `Map` 或 `Set`，没有插件就会直接 `die()`。
 *
 * 典型触发点：编辑器的选区状态是 `new Set<string>()`
 * （`selectedLinesAtom` / `selectedWordsAtom`），以及各处的
 * `useSetImmerAtom`。这些结构在 tool 原版能跑，是因为它的入口
 * 初始化时启过插件；我们只搬了 `src/editor/**` 子目录，
 * 那句初始化没跟着过来。
 *
 * 放在本文件模块顶层：`main.ts` 里定义了 `withHistory(lyricLinesAtom, …)`，
 * 模块求值早于任何组件渲染与写入，是最早也最稳妥的时机。
 */
enableMapSet();

export enum DarkMode {
  Auto = 'auto',
  Light = 'light',
  Dark = 'dark',
}

export enum ToolMode {
  Edit = 'edit',
  Sync = 'sync',
  Preview = 'preview',
}

export const toolModeAtom = atom(ToolMode.Edit);
export const darkModeAtom = atomWithStorage('darkMode', DarkMode.Auto);
export const isDarkThemeAtom = atom((get) => {
  if (get(darkModeAtom) === DarkMode.Auto) return get(autoDarkModeAtom);
  return get(darkModeAtom) === DarkMode.Dark;
});
export const autoDarkModeAtom = atom(true);

// 歌词行编辑上下文
export const lyricLinesAtom = atom({
  lyricLines: [],
  metadata: [],
  vocalTags: [],
  agents: [],
} as TTMLLyric);

/**
 * @description 当前项目的唯一标识符
 *
 * - 打开应用和新建文件时会生成一个随机的 UUID
 * - 打开文件时会尝试与数据库中的历史项目进行匹配，如果匹配成功，则复用旧项目的 ID，否则生成新 ID
 */
export const projectIdAtom = atom(uid());

/**
 * @description 当前项目的显示身份信息，主要用于在 UI 上显示项目名称
 * @readonly
 */
export const projectIdentityAtom = atom((get) => {
  const lyrics = get(lyricLinesAtom);
  return identifyProject(lyrics);
});

/**
 * @description 自动保存的状态
 */
export enum SaveStatus {
  /**
   * @description 已保存，当前编辑器的内容和数据库的一致
   */
  Saved = 'saved',
  /**
   * @description 等待保存
   */
  Pending = 'pending',
  /**
   * @description 正在保存
   */
  Saving = 'saving',
}

/**
 * @description 当前自动保存的状态
 */
export const saveStatusAtom = atom<SaveStatus>(SaveStatus.Saved);

/**
 * @description 上次自动保存的时间戳
 */
export const lastSavedTimeAtom = atom<number | null>(null);

export const undoableLyricLinesAtom = withHistory(lyricLinesAtom, 256);
export const isDirtyAtom = atom((get) => get(undoableLyricLinesAtom).canUndo);
export const reviewOperationLogAtom = atom<ReviewOperationRecord[]>([]);
export const reviewOperationRedoStackAtom = atom<ReviewOperationRecord[]>([]);

const cloneLyric = (data: TTMLLyric): TTMLLyric => JSON.parse(JSON.stringify(data)) as TTMLLyric;

const areLyricsEqual = (left: TTMLLyric, right: TTMLLyric) =>
  JSON.stringify(left) === JSON.stringify(right);

const doesOperationTransformLyric = (
  before: TTMLLyric,
  after: TTMLLyric,
  operation: ReviewOperationRecord
) => {
  const replayed = cloneLyric(before);
  applyReviewOperation(replayed, operation);
  return areLyricsEqual(replayed, after);
};

export const undoLyricLinesAtom = atom(null, (get, set) => {
  const beforeUndo = get(lyricLinesAtom);
  const operations = get(reviewOperationLogAtom);
  const lastOperation = operations[operations.length - 1];
  set(undoableLyricLinesAtom, UNDO);
  if (!lastOperation) return;

  const afterUndo = get(lyricLinesAtom);
  if (!doesOperationTransformLyric(afterUndo, beforeUndo, lastOperation)) return;

  set(reviewOperationLogAtom, operations.slice(0, -1));
  set(reviewOperationRedoStackAtom, (prev) => [...prev, lastOperation]);
});
export const redoLyricLinesAtom = atom(null, (get, set) => {
  const beforeRedo = get(lyricLinesAtom);
  const redoStack = get(reviewOperationRedoStackAtom);
  const nextOperation = redoStack[redoStack.length - 1];
  set(undoableLyricLinesAtom, REDO);
  if (!nextOperation) return;

  const afterRedo = get(lyricLinesAtom);
  if (!doesOperationTransformLyric(beforeRedo, afterRedo, nextOperation)) return;

  set(reviewOperationLogAtom, (prev) => [...prev, nextOperation]);
  set(reviewOperationRedoStackAtom, redoStack.slice(0, -1));
});
export const editingWordStateAtom = atom({
  wordIndex: -1,
  lineIndex: -1,
  word: '',
});
export const newLyricLinesAtom = atom(
  null,
  (
    _get,
    set,
    newState: TTMLLyric = {
      lyricLines: [],
      metadata: [],
      vocalTags: [],
      agents: [],
    }
  ) => {
    set(lyricLinesAtom, newState);
    set(selectedLinesAtom, new Set());
    set(selectedWordsAtom, new Set());
  }
);
export const selectedLinesAtom = atom(new Set<string>());
export const selectedWordsAtom = atom(new Set<string>());

/** 原始打开文件的文本，用于审阅报告闭环导出。 */
export const sourceFileContentAtom = atom<string | null>(null);

export const saveFileNameAtom = atom('lyric.ttml');

export const showUnselectedLinesAtom = atomWithStorage('showUnselectedLines', true);
export const bgLyricIgnoreSyncAtom = atom(false);
export const showEndTimeAsDurationAtom = atom(false);

export interface EditingTimeFieldState {
  isWord: boolean;
  field: 'startTime' | 'endTime';
}

export const editingTimeFieldAtom = atom<EditingTimeFieldState | null>(null);

export const requestFocusAtom = atom<string | null>(null);

export type ReviewSessionSource = 'review' | 'update' | 'lyrics-site';

export type AudioSource = 'user-upload' | 'netease';

export type ReviewSession = {
  prNumber: number;
  prTitle: string;
  fileName: string;
  source: ReviewSessionSource;
  audioSource?: AudioSource;
  audioFileName?: string;
  audioTitle?: string;
  ncmIds?: string[];
};

export const reviewSessionAtom = atom<ReviewSession | null>(null);
export type FileUpdateSession = {
  prNumber: number;
  prTitle: string;
  fileName: string;
};
export const fileUpdateSessionAtom = atom<FileUpdateSession | null>(null);
export type ReviewSnapshot = {
  prNumber: number;
  fileName: string;
  data: TTMLLyric;
  structure: ReviewStructuredSnapshot;
  historyId: string;
  originalTtml: string;
};
export const reviewFreezeAtom = atom<ReviewSnapshot | null>(null);
export const pushReviewOperationAtom = atom(null, (_get, set, operation: ReviewOperationRecord) => {
  set(reviewOperationLogAtom, (prev) => [...prev, operation]);
  set(reviewOperationRedoStackAtom, []);
});
export type ReviewReportDraft = {
  id: string;
  prNumber: number | null;
  prTitle: string;
  report: ReviewReport;
  createdAt: string;
  source?: 'github' | 'lyrics-site';
};
export const reviewReportDraftsAtom = atom<ReviewReportDraft[]>([]);
export const reviewReviewedPrsAtom = atomWithStorage<Record<number, boolean>>(
  'reviewReviewedPrs',
  {}
);
export const reviewSingleRefreshAtom = atom<number | null>(null);

/**
 * @description 用于控制全局文件拖拽遮罩层的显示
 */
export const isGlobalFileDraggingAtom = atom(false);

/**
 * 是否正在拖拽歌词行
 */
export const isDraggingGlobalAtom = atom(false);

/**
 * 当前正在拖拽的行数量
 */
export const draggedCountAtom = atom(0);

/**
 * 拖拽操作是哪里触发的
 */
export const dragSourceAtom = atom<'main' | 'outline' | null>(null);

/**
 * 当前拖拽是否为复制模式
 */
export const isCopyModeAtom = atom(false);

/**
 * 用于触发定位当前行事件的 Atom
 */
export const locateActionAtom = atom(0);
