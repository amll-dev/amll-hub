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
import { atomWithStorage, selectAtom } from 'jotai/utils';
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
import type { TTMLLyric, TTMLVocalTag } from '../types/ttml';

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
 * 只读派生层：把对「整棵歌词树」的订阅拆成组件各自需要的切片。
 *
 * lyricLinesAtom 是 Immer atom，任何一行改动都会产生新的顶层对象；直接
 * useAtomValue(lyricLinesAtom) 的组件（尤其是 200 个行组件）会全部重渲染、memo 失效。
 * 下面的派生 atom 读整树、但只暴露「相关且稳定」的值：Jotai 用 Object.is 比较
 * 派生结果，字段没变就不通知订阅者。写入语义完全不变（仍写 lyricLinesAtom）。
 */

/** vocalTags 缺省时复用的稳定引用，避免 `?? []` 每次派生都产生新数组。 */
const EMPTY_VOCAL_TAGS: TTMLVocalTag[] = [];

/** 演唱者标签：只在 vocalTags 本身变化时改变引用，行组件据此决定是否重渲染。 */
export const vocalTagsAtom = atom((get) => get(lyricLinesAtom).vocalTags ?? EMPTY_VOCAL_TAGS);

/** 是否定义了 Agent：行组件只用它判断「该行缺 agent 是否告警」，布尔值天然稳定。 */
export const hasAgentsAtom = atom((get) => (get(lyricLinesAtom).agents?.length ?? 0) > 0);

export interface LineTimelineEntry {
  id: string;
  startTime: number;
  endTime: number;
}

const lineTimelineEqual = (a: LineTimelineEntry[], b: LineTimelineEntry[]) =>
  a.length === b.length &&
  a.every((entry, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      entry.id === other.id &&
      entry.startTime === other.startTime &&
      entry.endTime === other.endTime
    );
  });

/** 行时间轴：音频进度条只需 id 与起止时间；改歌词文字（不动时间）时保持旧引用。 */
export const lineTimelineAtom = selectAtom(
  lyricLinesAtom,
  (s): LineTimelineEntry[] =>
    s.lyricLines.map((line) => ({
      id: line.id,
      startTime: line.startTime,
      endTime: line.endTime,
    })),
  lineTimelineEqual
);

export interface OutlineLine {
  id: string;
  text: string;
  isBG: boolean;
  isDuet: boolean;
}

const outlineLinesEqual = (a: OutlineLine[], b: OutlineLine[]) =>
  a.length === b.length &&
  a.every((line, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      line.id === other.id &&
      line.text === other.text &&
      line.isBG === other.isBG &&
      line.isDuet === other.isDuet
    );
  });

/** 大纲行：预先拼好文本（原来渲染时对每行 words.join），文本/标记不变则引用不变。 */
export const outlineLinesAtom = selectAtom(
  lyricLinesAtom,
  (s): OutlineLine[] =>
    s.lyricLines.map((line) => ({
      id: line.id,
      text: line.words.map((w) => w.word).join(''),
      isBG: line.isBG,
      isDuet: line.isDuet,
    })),
  outlineLinesEqual
);

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

/**
 * 保存时记下的 lyricLinesAtom 对象引用。
 *
 * lyricLinesAtom 是 Immer / withHistory atom，任何一行写入都会产生新的顶层对象，
 * 因此脏检查可以退化成 O(1) 的引用比较，不必再对整份 TTMLLyric 做 JSON.stringify。
 * 原来 isDirtyAtom 与 markLyricLinesSavedAtom 各序列化一次，
 * 逐字编辑 / 拖拽时间轴时每帧都要分配数十 KB 的字符串。
 * 撤销回到保存点时引用一致，也会被正确判定为「不脏」。
 */
export const savedLyricBaselineAtom = atom<TTMLLyric | null>(null);

export const markLyricLinesSavedAtom = atom(null, (get, set) => {
  set(savedLyricBaselineAtom, get(lyricLinesAtom));
});

export const isDirtyAtom = atom((get) => {
  const baseline = get(savedLyricBaselineAtom);
  if (baseline === null) return false;
  return get(lyricLinesAtom) !== baseline;
});
export const reviewOperationLogAtom = atom<ReviewOperationRecord[]>([]);
export const reviewOperationRedoStackAtom = atom<ReviewOperationRecord[]>([]);

const cloneLyric = (data: TTMLLyric): TTMLLyric => JSON.parse(JSON.stringify(data)) as TTMLLyric;

/** 歌词状态指纹：只在压栈 / 撤销时各算一次，用来 O(n) 判断「这一步是不是 review 操作」 */
const lyricStateHash = (data: TTMLLyric) => JSON.stringify(data);

/**
 * 判断 `state` 是否就是该操作执行前的状态。
 *
 * 旧实现是「深拷贝 before → 回放操作 → 与 after 做两次 stringify 比较」，
 * 1000 行歌词下每次撤销要 15–30ms，手感发钝。入栈时记指纹后只剩两次
 * stringify，且不用再回放整个操作。没有指纹的旧记录回退到回放比较。
 */
const isStateBeforeOperation = (state: TTMLLyric, operation: ReviewOperationRecord) => {
  if (operation.beforeStateHash) return operation.beforeStateHash === lyricStateHash(state);
  const replayed = cloneLyric(state);
  applyReviewOperation(replayed, operation);
  return JSON.stringify(replayed) === JSON.stringify(state);
};

export const undoLyricLinesAtom = atom(null, (get, set) => {
  const operations = get(reviewOperationLogAtom);
  const lastOperation = operations[operations.length - 1];
  set(undoableLyricLinesAtom, UNDO);
  if (!lastOperation) return;

  const afterUndo = get(lyricLinesAtom);
  if (!isStateBeforeOperation(afterUndo, lastOperation)) return;

  set(reviewOperationLogAtom, operations.slice(0, -1));
  set(reviewOperationRedoStackAtom, (prev) => [...prev, lastOperation]);
});
export const redoLyricLinesAtom = atom(null, (get, set) => {
  const beforeRedo = get(lyricLinesAtom);
  const redoStack = get(reviewOperationRedoStackAtom);
  const nextOperation = redoStack[redoStack.length - 1];
  set(undoableLyricLinesAtom, REDO);
  if (!nextOperation) return;

  if (!isStateBeforeOperation(beforeRedo, nextOperation)) return;

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
export const pushReviewOperationAtom = atom(null, (get, set, operation: ReviewOperationRecord) => {
  // 调用方都是「先 push 再写 lyricLines」，所以此刻读到的就是操作前的状态
  const beforeStateHash = lyricStateHash(get(lyricLinesAtom));
  set(reviewOperationLogAtom, (prev) => [...prev, { ...operation, beforeStateHash }]);
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
