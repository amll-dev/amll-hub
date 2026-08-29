import { createBrowserRouter } from 'react-router-dom';
import { Layout } from '@/App';
import { RouteErrorBoundary } from '@/components/ErrorBoundary';
import {
  CreatorCenter,
  DailyRecommend,
  Home,
  NcmParse,
  NotFound,
  OnlineLyricSearch,
  OnlineViewLyricPage,
  Placeholder,
  Profile,
  Ranking,
  Register,
  ResetPassword,
  ReviewCenter,
  ReviewerManagePage,
  SubmissionDetailPage,
  ViewLyricPage,
} from '@/routes';

export const router = createBrowserRouter([
  {
    element: <Layout />,
    // 懒加载页面抛错 / chunk 加载失败时整树兜底，避免白屏
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/ncm', element: <NcmParse /> },
      { path: '/lyrics-search', element: <OnlineLyricSearch /> },
      { path: '/ranking', element: <Ranking /> },
      { path: '/daily', element: <DailyRecommend /> },
      { path: '/lyric/:filename', element: <ViewLyricPage /> },
      { path: '/online-lyric/:platform/:songId', element: <OnlineViewLyricPage /> },
      { path: '/stats', element: <Placeholder title="统计" /> },
      { path: '/docs', element: <Placeholder title="文档" /> },
      { path: '/profile', element: <Profile /> },
      { path: '/creator', element: <CreatorCenter /> },
      {
        path: '/creator/lyrics/detail',
        element: (
          <SubmissionDetailPage isReviewer={false} backPath="/creator" backLabel="返回创作中心" />
        ),
      },
      { path: '/review', element: <ReviewCenter /> },
      {
        path: '/review/detail',
        element: (
          <SubmissionDetailPage isReviewer={true} backPath="/review" backLabel="返回审核中心" />
        ),
      },
      { path: '/register', element: <Register /> },
      { path: '/reset-password', element: <ResetPassword /> },
      { path: '/admin/reviewers', element: <ReviewerManagePage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
