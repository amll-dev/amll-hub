import { atom } from 'jotai';
export type UpdateStatus =
  'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error';

/** 一次更新的描述（对应 Tauri 的 `Update`，只保留会用到的字段） */
export interface Update {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

export const updateStatusAtom = atom<UpdateStatus>('idle');
export const updateInfoAtom = atom<Update | null>(null);
export const updateProgressAtom = atom<number>(0);
export const updateErrorAtom = atom<string>('');
