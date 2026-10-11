import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Github, Loader2 } from 'lucide-react';
import { z } from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api';
import { buttonTap } from '@/lib/motion';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { PageContainer } from '@/components/PageContainer';

const bindSchema = z.object({
  account: z.string().trim().min(1, '请输入用户名或邮箱'),
  password: z.string().min(1, '请输入密码'),
});
type BindValues = z.infer<typeof bindSchema>;

const fieldClass = 'h-11 bg-card px-4';

/**
 * GitHub 绑定页：GitHub 账号尚未绑定任何站点账号时进入
 */
export function BindAccount() {
  const navigate = useNavigate();
  const { login } = useAuth();
  // 绑定票据经 URL fragment 回传（不会发送给服务器），从 hash 中读取
  const token = useMemo(() => {
    const hash = window.location.hash.replace(/^#/, '');
    return new URLSearchParams(hash).get('token') ?? '';
  }, []);
  const [error, setError] = useState('');

  const infoQuery = useQuery({
    queryKey: ['github-bind-info', token],
    queryFn: () => api.getGithubBindInfo(token),
    enabled: !!token,
    retry: false,
  });

  const expired = infoQuery.error instanceof ApiError && infoQuery.error.code === 410;
  const info = infoQuery.data;

  const form = useForm<BindValues>({
    resolver: zodResolver(bindSchema),
    defaultValues: { account: '', password: '' },
  });

  const bindMutation = useMutation({
    mutationFn: (v: BindValues) => api.githubBindLogin({ token, ...v }),
    onMutate: () => setError(''),
    onSuccess: (result) => {
      login(result.token, result.user);
      navigate('/profile');
    },
    onError: (e: Error) => setError(e.message || '绑定失败'),
  });

  return (
    <PageContainer width="form">
      <div className="rounded-xl border border-line bg-card p-8 shadow-sm">
        <h1 className="mb-2 text-center text-2xl font-bold tracking-tight text-foreground">
          绑定 GitHub 账号
        </h1>
        <p className="mb-6 text-center text-sm text-ink-3">
          该 GitHub 账号尚未绑定站点账号，请选择登录已有账号或注册新账号
        </p>

        {/* GitHub 账号信息 */}
        {infoQuery.isPending && !!token && (
          <div className="flex items-center justify-center py-6 text-ink-3">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {expired && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <AlertCircle className="h-8 w-8 text-error" />
            <p className="text-sm text-error">授权已过期，请重新登录</p>
            <a href={api.githubLoginURL()} className={buttonVariants()}>
              重新使用 GitHub 登录
            </a>
          </div>
        )}

        {!token && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <AlertCircle className="h-8 w-8 text-error" />
            <p className="text-sm text-error">缺少绑定凭证，请重新发起 GitHub 登录</p>
            <a href={api.githubLoginURL()} className={buttonVariants()}>
              使用 GitHub 登录
            </a>
          </div>
        )}

        {info && (
          <>
            <div className="mb-6 flex items-center gap-3 rounded-lg border border-line bg-surface-2 p-4">
              {info.githubAvatar ? (
                <img
                  src={info.githubAvatar}
                  alt={info.githubLogin}
                  className="h-12 w-12 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-card">
                  <Github className="h-6 w-6 text-ink-2" />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{info.githubLogin}</p>
                {info.githubEmail && (
                  <p className="truncate text-xs text-ink-3">{info.githubEmail}</p>
                )}
              </div>
            </div>

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((v) => bindMutation.mutate(v))}
                className="space-y-5"
              >
                <FormField
                  control={form.control}
                  name="account"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-normal text-ink-2">
                        用户名或邮箱
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          placeholder="请输入用户名或邮箱"
                          autoComplete="username"
                          className={fieldClass}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-normal text-ink-2">密码</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="请输入密码"
                          autoComplete="current-password"
                          className={fieldClass}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {error && <p className="text-sm text-error">{error}</p>}

                <Button
                  type="submit"
                  disabled={bindMutation.isPending}
                  {...buttonTap}
                  className="w-full"
                >
                  {bindMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {bindMutation.isPending ? '绑定中…' : '登录并绑定'}
                </Button>

                <div className="flex items-center gap-3">
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-xs text-ink-3">或</span>
                  <span className="h-px flex-1 bg-line" />
                </div>

                <Link
                  to={`/register#token=${encodeURIComponent(token)}`}
                  className={buttonVariants({ variant: 'outline', className: 'w-full' })}
                >
                  注册新账号并绑定
                </Link>

                <Link
                  to="/reset-password"
                  className="block text-center text-xs text-primary hover:underline"
                >
                  忘记密码？
                </Link>
              </form>
            </Form>
          </>
        )}

        {infoQuery.isError && !expired && (
          <p className="mt-4 text-center text-sm text-error">
            {infoQuery.error instanceof Error ? infoQuery.error.message : '加载失败'}
          </p>
        )}
      </div>
    </PageContainer>
  );
}
