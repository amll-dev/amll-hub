import { lazy } from 'react';

// 路由级页面统一懒加载
// 命名导出的页面在此映射为 lazy 组件；本文件只导出组件，保证 react-refresh 边界干净
const loadHome = () => import('@/pages/Home').then((m) => ({ default: m.Home }));
const loadNcmParse = () => import('@/pages/NcmParse').then((m) => ({ default: m.NcmParse }));
const loadOnlineLyricSearch = () =>
  import('@/pages/OnlineLyricSearch').then((m) => ({ default: m.OnlineLyricSearch }));
const loadRanking = () => import('@/pages/Ranking').then((m) => ({ default: m.Ranking }));
const loadDailyRecommend = () =>
  import('@/pages/DailyRecommend').then((m) => ({ default: m.DailyRecommend }));
const loadViewLyricPage = () =>
  import('@/pages/ViewLyricPage').then((m) => ({ default: m.ViewLyricPage }));
const loadOnlineViewLyricPage = () =>
  import('@/pages/OnlineViewLyricPage').then((m) => ({ default: m.OnlineViewLyricPage }));
const loadProfile = () => import('@/pages/Profile').then((m) => ({ default: m.Profile }));
const loadCreatorCenter = () =>
  import('@/pages/CreatorCenter').then((m) => ({ default: m.CreatorCenter }));
const loadReviewCenter = () =>
  import('@/pages/ReviewCenter').then((m) => ({ default: m.ReviewCenter }));
const loadSubmissionDetailPage = () =>
  import('@/pages/SubmissionDetailPage').then((m) => ({ default: m.SubmissionDetailPage }));
const loadRegister = () => import('@/pages/Register').then((m) => ({ default: m.Register }));
const loadResetPassword = () =>
  import('@/pages/ResetPassword').then((m) => ({ default: m.ResetPassword }));
const loadReviewerManagePage = () =>
  import('@/pages/ReviewerManagePage').then((m) => ({ default: m.ReviewerManagePage }));
const loadPlaceholder = () =>
  import('@/pages/Placeholder').then((m) => ({ default: m.Placeholder }));
const loadNotFound = () => import('@/pages/NotFound').then((m) => ({ default: m.NotFound }));

export const Home = lazy(loadHome);
export const NcmParse = lazy(loadNcmParse);
export const OnlineLyricSearch = lazy(loadOnlineLyricSearch);
export const Ranking = lazy(loadRanking);
export const DailyRecommend = lazy(loadDailyRecommend);
export const ViewLyricPage = lazy(loadViewLyricPage);
export const OnlineViewLyricPage = lazy(loadOnlineViewLyricPage);
export const Profile = lazy(loadProfile);
export const CreatorCenter = lazy(loadCreatorCenter);
export const ReviewCenter = lazy(loadReviewCenter);
export const SubmissionDetailPage = lazy(loadSubmissionDetailPage);
export const Register = lazy(loadRegister);
export const ResetPassword = lazy(loadResetPassword);
export const ReviewerManagePage = lazy(loadReviewerManagePage);
export const Placeholder = lazy(loadPlaceholder);
export const NotFound = lazy(loadNotFound);

/** path → 页面 chunk 加载器，供导航链接 hover/focus 时预取（Vite 对重复 import 幂等） */
export const pagePreloads: Record<string, () => Promise<unknown>> = {
  '/': loadHome,
  '/ncm': loadNcmParse,
  '/lyrics-search': loadOnlineLyricSearch,
  '/ranking': loadRanking,
  '/daily': loadDailyRecommend,
  '/lyric/:filename': loadViewLyricPage,
  '/online-lyric/:platform/:songId': loadOnlineViewLyricPage,
  '/stats': loadPlaceholder,
  '/docs': loadPlaceholder,
  '/profile': loadProfile,
  '/creator': loadCreatorCenter,
  '/creator/lyrics/detail': loadSubmissionDetailPage,
  '/review': loadReviewCenter,
  '/review/detail': loadSubmissionDetailPage,
  '/register': loadRegister,
  '/reset-password': loadResetPassword,
  '/admin/reviewers': loadReviewerManagePage,
};

/** 预取路由 chunk（幂等，可安全重复调用） */
export function preloadRoute(path: string): void {
  pagePreloads[path]?.().catch(() => {});
}
