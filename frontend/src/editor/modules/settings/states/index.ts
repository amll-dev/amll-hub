import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

export * from './amll';

export enum SyncJudgeMode {
  FirstKeyDownTime = 'first-keydown-time',
  FirstKeyDownTimeLegacy = 'first-keydown-time-legacy',
  LastKeyUpTime = 'last-keyup-time',
  MiddleKeyTime = 'middle-key-time',
}

export enum LayoutMode {
  Simple = 'simple',
  Advance = 'advance',
}

export const latencyTestBPMAtom = atomWithStorage('latencyTestBPM', 120);

export const syncJudgeModeAtom = atomWithStorage('syncJudgeMode', SyncJudgeMode.FirstKeyDownTime);

export const layoutModeAtom = atomWithStorage('layoutMode', LayoutMode.Simple);

export const showWordRomanizationInputAtom = atomWithStorage('showWordRomanizationInput', false);

export const displayRomanizationInSyncAtom = atomWithStorage('displayRomanizationInSync', false);

export const showLineTranslationAtom = atomWithStorage('showLineTranslation', true);

export const showLineRomanizationAtom = atomWithStorage('showLineRomanization', true);

export const hideSubmitAMLLDBWarningAtom = atomWithStorage('hideSubmitAMLLDBWarning', false);
export const generateNameFromMetadataAtom = atomWithStorage('generateNameFromMetadata', true);

export const autosaveEnabledAtom = atomWithStorage('autosaveEnabled', true);
export const autosaveIntervalAtom = atomWithStorage('autosaveInterval', 10);
export const autosaveLimitAtom = atomWithStorage('autosaveLimit', 10);

export const defaultTtmlAuthorGithubAtom = atomWithStorage('defaultTtmlAuthorGithub', '');

export const defaultTtmlAuthorGithubLoginAtom = atomWithStorage('defaultTtmlAuthorGithubLogin', '');

export const showTimestampsAtom = atomWithStorage('showTimestamps', true);

export const highlightActiveWordAtom = atomWithStorage('highlightActiveWord', true);

export const highlightErrorsAtom = atomWithStorage('highlightErrors', false);

export const smartFirstWordAtom = atomWithStorage('smartFirstWord', false);
export const smartLastWordAtom = atomWithStorage('smartLastWord', false);

export const enableAutoRomanizationPredictionAtom = atomWithStorage(
  'enableAutoRomanizationPrediction',
  false
);

export const githubPatAtom = atomWithStorage('githubPat', '');
export const githubLoginAtom = atomWithStorage('githubLogin', '');
export const githubAmlldbAccessAtom = atomWithStorage('githubAmlldbAccess', false);
export const githubRiskConfirmedAtom = atomWithStorage('githubRiskConfirmed', false);
export type NeteaseProfile = {
  userId: number;
  nickname: string;
  avatarUrl: string;
  vipType: number;
  signature?: string;
};
export const neteaseCookieAtom = atomWithStorage('neteaseCookie', '');
export const neteaseUserAtom = atomWithStorage<NeteaseProfile | null>('neteaseUser', null);
export const neteaseRiskConfirmedAtom = atomWithStorage('neteaseRiskConfirmed', false);
export const reviewHiddenLabelsAtom = atomWithStorage<string[]>('reviewHiddenLabels', []);
export const reviewHiddenUsersAtom = atomWithStorage<string[]>('reviewHiddenUsers', []);
export const reviewHiddenUsersModeAtom = atomWithStorage<'any' | 'all'>(
  'reviewHiddenUsersMode',
  'all'
);
export const reviewSelectedLabelsAtom = atomWithStorage<string[]>('reviewSelectedLabels', []);
export const reviewPendingFilterAtom = atomWithStorage('reviewPendingFilter', false);
export const reviewUpdatedFilterAtom = atomWithStorage('reviewUpdatedFilter', false);
export const reviewRefreshTokenAtom = atom(0);
export type ReviewLabel = {
  name: string;
  color: string;
};
export const reviewLabelsAtom = atom<ReviewLabel[]>([]);

// 歌词站登录状态
export type LyricsSiteUser = {
  username: string;
  displayName: string;
  avatarUrl: string;
  reviewPermission: 0 | 1;
};
export const lyricsSiteTokenAtom = atomWithStorage<string>('lyricsSiteToken', '');
export const lyricsSiteUserAtom = atomWithStorage<LyricsSiteUser | null>('lyricsSiteUser', null);
export const lyricsSiteLoginPendingAtom = atomWithStorage<boolean>('lyricsSiteLoginPending', false);

export const audioProxyUrlAtom = atomWithStorage<string>(
  'audioProxyUrl',
  'https://tooldl.bikonoo.com'
);
