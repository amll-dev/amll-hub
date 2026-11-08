import { useSearchParams } from 'react-router-dom';
import { Package } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePluginViewers } from '@/hooks/useViewers';
import { DetailTopBar } from '@/components/detail/DetailTopBar';
import { PageContainer } from '@/components/PageContainer';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/button';
import { PluginManageDetail } from '@/components/plugin/PluginManageDetail';

/** 插件投稿详情页 */
export function PluginManageDetailPage({ reviewMode = false }: { reviewMode?: boolean }) {
  const [searchParams] = useSearchParams();
  const pluginKey = searchParams.get('key') ?? '';
  const { user, openLogin } = useAuth();
  const { count, viewers, showModal, setShowModal, revision } = usePluginViewers(
    user ? pluginKey : ''
  );

  return (
    <div className="min-h-screen bg-background">
      <DetailTopBar
        pageTitle={reviewMode ? '审核中心' : '创作中心'}
        backPath={reviewMode ? '/review' : '/creator/plugins'}
        backLabel={reviewMode ? '返回审核中心' : '返回插件管理'}
        count={count}
        viewers={viewers}
        showModal={showModal}
        setShowModal={setShowModal}
      />
      <PageContainer width="lg" className="py-6">
        {!user ? (
          <EmptyState
            icon={Package}
            title="请先登录"
            description={reviewMode ? '登录后可以审核插件' : '登录后可以管理自己发布的插件'}
            action={<Button onClick={() => openLogin()}>登录</Button>}
          />
        ) : !pluginKey ? (
          <EmptyState icon={Package} title="缺少插件参数" />
        ) : (
          <PluginManageDetail pluginKey={pluginKey} revision={revision} reviewMode={reviewMode} />
        )}
      </PageContainer>

      <footer className="flex items-center justify-center gap-2 border-t border-line py-4">
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
          测试版
        </span>
        <span className="text-xs text-ink-3">测试版本，不代表最终品质</span>
      </footer>
    </div>
  );
}
