import { lazy } from 'react';

// 路由级页面统一懒加载
// 命名导出的页面在此映射为 lazy 组件；本文件只导出组件，保证 react-refresh 边界干净
export const Home = lazy(() => import('@/pages/Home').then((m) => ({ default: m.Home })));
export const NcmParse = lazy(() =>
  import('@/pages/NcmParse').then((m) => ({ default: m.NcmParse }))
);
export const OnlineLyricSearch = lazy(() =>
  import('@/pages/OnlineLyricSearch').then((m) => ({ default: m.OnlineLyricSearch }))
);
export const Ranking = lazy(() => import('@/pages/Ranking').then((m) => ({ default: m.Ranking })));
export const DailyRecommend = lazy(() =>
  import('@/pages/DailyRecommend').then((m) => ({ default: m.DailyRecommend }))
);
export const ViewLyricPage = lazy(() =>
  import('@/pages/ViewLyricPage').then((m) => ({ default: m.ViewLyricPage }))
);
export const OnlineViewLyricPage = lazy(() =>
  import('@/pages/OnlineViewLyricPage').then((m) => ({ default: m.OnlineViewLyricPage }))
);
export const Profile = lazy(() => import('@/pages/Profile').then((m) => ({ default: m.Profile })));
export const CreatorCenter = lazy(() =>
  import('@/pages/CreatorCenter').then((m) => ({ default: m.CreatorCenter }))
);
export const ReviewCenter = lazy(() =>
  import('@/pages/ReviewCenter').then((m) => ({ default: m.ReviewCenter }))
);
export const SubmissionDetailPage = lazy(() =>
  import('@/pages/SubmissionDetailPage').then((m) => ({ default: m.SubmissionDetailPage }))
);
export const Register = lazy(() =>
  import('@/pages/Register').then((m) => ({ default: m.Register }))
);
export const ResetPassword = lazy(() =>
  import('@/pages/ResetPassword').then((m) => ({ default: m.ResetPassword }))
);
export const ReviewerManagePage = lazy(() =>
  import('@/pages/ReviewerManagePage').then((m) => ({ default: m.ReviewerManagePage }))
);
export const Placeholder = lazy(() =>
  import('@/pages/Placeholder').then((m) => ({ default: m.Placeholder }))
);
export const NotFound = lazy(() =>
  import('@/pages/NotFound').then((m) => ({ default: m.NotFound }))
);
