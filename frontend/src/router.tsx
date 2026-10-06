import { createBrowserRouter } from 'react-router-dom';
import { Layout } from '@/App';
import { RouteErrorBoundary } from '@/components/ErrorBoundary';
import { LyricEditorShell } from '@/components/review/LyricEditorShell';
import {
  CreatorCenter,
  DailyRecommend,
  Home,
  LyricEditorPage,
  MessagesPage,
  NcmParse,
  NotFound,
  OnlineLyricSearch,
  OnlineViewLyricPage,
  Placeholder,
  ProfileHome,
  ProfileInfo,
  ProfileLayout,
  ProfileSecurity,
  Ranking,
  Register,
  ResetPassword,
  ReviewCenter,
  ReviewerManagePage,
  SubmissionDetailPage,
  Terms,
  Privacy,
  ViewLyricPage,
} from '@/routes';

export const router = createBrowserRouter([
  {
    path: '/review/editor/:id',
    element: (
      <LyricEditorShell>
        <LyricEditorPage />
      </LyricEditorShell>
    ),
    errorElement: <RouteErrorBoundary />,
  },
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
      {
        path: '/profile',
        element: <ProfileLayout />,
        children: [
          { index: true, element: <ProfileHome /> },
          { path: 'info', element: <ProfileInfo /> },
          { path: 'security', element: <ProfileSecurity /> },
        ],
      },
      { path: '/messages', element: <MessagesPage /> },
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
      { path: '/terms', element: <Terms /> },
      { path: '/privacy', element: <Privacy /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
