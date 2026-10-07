import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logout } from '@/atoms/auth';
import { setToken } from '@/lib/auth';
import { Button, buttonVariants } from '@/components/ui/button';
import { PageContainer } from '@/components/PageContainer';

/**
 * GitHub OAuth 回调落地页。
 * 后端已绑定站点账号时 302 到 /auth/github/callback#token=<JWT>。
 * 令牌放在 fragment 中（不会发送给服务器），本页从 hash 读取并写入，
 * 随后由 AuthBoot 拉取 profile 并写入登录态。
 */
export function GithubCallback() {
  const navigate = useNavigate();
  const token = useMemo(() => {
    const hash = window.location.hash.replace(/^#/, '');
    return new URLSearchParams(hash).get('token') ?? '';
  }, []);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) {
      setFailed(true);
      return;
    }
    // 换账号登录：先清掉旧登录态与缓存，再写入新 token
    logout();
    setToken(token);
    navigate('/', { replace: true });
  }, [token, navigate]);

  return (
    <PageContainer className="py-32 text-center">
      {failed ? (
        <>
          <h1 className="text-2xl font-bold tracking-tight">登录失败</h1>
          <p className="mt-3 text-ink-2">未获取到登录凭证，请重新发起 GitHub 登录</p>
          <Link to="/" className={buttonVariants({ className: 'mt-8' })}>
            返回首页
          </Link>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold tracking-tight">正在登录…</h1>
          <p className="mt-3 text-ink-2">正在完成 GitHub 授权，请稍候</p>
          <Button variant="outline" className="mt-8" onClick={() => navigate('/', { replace: true })}>
            返回首页
          </Button>
        </>
      )}
    </PageContainer>
  );
}
