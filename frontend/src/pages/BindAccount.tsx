import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ArrowLeft, Github, Loader2 } from 'lucide-react';
import { z } from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api';
import { isMfaRequired, type LoginSuccess, type MfaMethod } from '@/lib/auth';
import { buttonTap } from '@/lib/motion';
import { useCountdown } from '@/hooks/useCountdown';
import { CaptchaProvider } from '@/components/profile/CaptchaProvider';
import { useCaptcha } from '@/components/profile/captchaContext';
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

const MFA_LABEL: Record<string, string> = {
  app: '验证器',
  sms: '短信',
  email: '邮箱',
  radius: 'RADIUS',
  push: '推送',
};

/**
 * GitHub 绑定页：GitHub 账号尚未绑定任何站点账号时进入
 *
 * 整页包一层 CaptchaProvider：绑定流程会发邮箱/短信验证码，
 * 启用阿里云验证码的环境需要页面级宿主才能拉滑块。
 */
export function BindAccount() {
  return (
    <CaptchaProvider>
      <BindAccountContent />
    </CaptchaProvider>
  );
}

function BindAccountContent() {
  const navigate = useNavigate();
  const { login } = useAuth();
  // 绑定票据经 URL fragment 回传（不会发送给服务器），从 hash 中读取
  const token = useMemo(() => {
    const hash = window.location.hash.replace(/^#/, '');
    return new URLSearchParams(hash).get('token') ?? '';
  }, []);
  const [error, setError] = useState('');
  /** 需要二次验证时的会话（账号已开 MFA） */
  const [mfa, setMfa] = useState<{ id: string; methods: MfaMethod[] } | null>(null);
  /** 登录成功但绑定失败：进入终态，不再展示登录表单 */
  const [bindFailed, setBindFailed] = useState(false);

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

  /**
   * 登录成功后的收尾：JWT 先落地（api 层从 localStorage 取 token），再调绑定接口。
   *
   * 绑定失败不静默跳走——此时用户已经登录，只是 GitHub 没绑上，
   * 必须把「登录成功、绑定没成功」这件事说清楚。
   */
  const finishBind = useCallback(
    async (result: LoginSuccess) => {
      login(result.token, result.user);
      try {
        await api.completeGithubBind(token);
        // 与后端 HandleCallback 的已绑定分支保持同一个落地页（该页读 githubBound=1 显示成功提示）
        navigate('/profile/migration?githubBound=1');
      } catch (e) {
        const msg = e instanceof Error ? e.message : '绑定失败';
        setError(`已登录，但 GitHub 绑定未完成：${msg}。可在「个人中心 → 数据迁移」重新绑定。`);
        // MFA 挑战已被消费，留在验证面板只会让用户反复点「验证并绑定」
        setMfa(null);
        setBindFailed(true);
      }
    },
    [login, navigate, token]
  );

  const bindMutation = useMutation({
    mutationFn: (v: BindValues) => api.githubBindLogin({ token, ...v }),
    onMutate: () => setError(''),
    onSuccess: (result) => {
      if (isMfaRequired(result)) {
        setMfa({ id: result.mfaChallengeId, methods: result.mfaMethods });
        return;
      }
      void finishBind(result);
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

            {bindFailed ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <AlertCircle className="h-8 w-8 text-error" />
                <p className="text-sm text-error">{error}</p>
                <Link to="/profile/migration" className={buttonVariants()}>
                  前往数据迁移
                </Link>
              </div>
            ) : mfa ? (
              <BindMfaPanel
                challengeId={mfa.id}
                methods={mfa.methods}
                error={error}
                onError={setError}
                onCancel={() => {
                  setMfa(null);
                  setError('');
                }}
                onSuccess={(result) => void finishBind(result)}
              />
            ) : (
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
            )}
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

/**
 * 绑定流程的二次验证面板。
 *
 * 账号开了 MFA 时，密码校验通过后不能再直接登录——第三方 OAuth 凭证属于 GitHub 账号，
 * 不是站点账号的第二因子。用户必须在这里过掉 MFA，拿到 JWT 后才去写绑定。
 */
function BindMfaPanel({
  challengeId,
  methods,
  error,
  onError,
  onCancel,
  onSuccess,
}: {
  challengeId: string;
  methods: MfaMethod[];
  error: string;
  onError: (msg: string) => void;
  onCancel: () => void;
  onSuccess: (result: LoginSuccess) => void;
}) {
  const [mfaType, setMfaType] = useState(
    () => (methods.find((m) => m.isPreferred) ?? methods[0])?.mfaType ?? ''
  );
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const countdown = useCountdown();
  const current = methods.find((m) => m.mfaType === mfaType);
  const { needCaptcha, captchaType, requestCaptcha, closeCaptcha, reportResult } = useCaptcha();

  const verifyMutation = useMutation({
    mutationFn: () =>
      api.verifyLoginMfa({
        challengeId,
        mfaType,
        passcode: useRecovery ? '' : code.trim(),
        recoveryCode: useRecovery ? code.trim() : '',
      }),
    onSuccess: (result) => {
      if (isMfaRequired(result)) {
        // 理论上不会发生（Casdoor 一次只要求一个因子）；真遇到就让用户重来，别静默吞掉
        onError('还需要再完成一次验证，请重新发起 GitHub 登录');
        return;
      }
      onSuccess(result);
    },
    onError: (e: Error) => onError(e.message || '验证失败'),
  });

  const sendMutation = useMutation({
    mutationFn: (captchaToken: string) =>
      api.sendLoginMfaCode({
        challengeId,
        mfaType,
        captchaType: needCaptcha ? captchaType : '',
        captchaToken,
      }),
    onSuccess: () => {
      countdown.start(60);
      onError('');
      reportResult(true);
      closeCaptcha();
    },
    onError: (e: Error) => {
      const text = e.message || '验证码发送失败';
      onError(text);
      // 人机验证没过就让 SDK 重置，用户可以重新拉一次滑块；其他错误说明验证本身已通过
      if (text.includes('人机验证')) {
        reportResult(false);
      } else {
        reportResult(true);
        closeCaptcha();
      }
    },
  });

  const handleSendCode = () => {
    if (countdown.running || sendMutation.isPending) return;
    if (needCaptcha) {
      requestCaptcha((token) => sendMutation.mutate(token));
    } else {
      sendMutation.mutate('');
    }
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onCancel}
        className="flex items-center gap-1 text-sm text-ink-3 transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        返回
      </button>

      <div>
        <h2 className="text-lg font-semibold text-foreground">二次验证</h2>
        <p className="mt-1 text-sm text-ink-3">
          该账号已开启两步验证，请用{MFA_LABEL[mfaType] ?? mfaType}完成验证后再绑定
        </p>
      </div>

      {methods.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {methods.map((m) => (
            <button
              key={m.mfaType}
              type="button"
              onClick={() => {
                setMfaType(m.mfaType);
                setCode('');
                setUseRecovery(false);
                onError('');
              }}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                m.mfaType === mfaType
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-line text-ink-3 hover:border-ink-3'
              }`}
            >
              {MFA_LABEL[m.mfaType] ?? m.mfaType}
            </button>
          ))}
        </div>
      )}

      {current?.maskedDest && <p className="text-xs text-ink-3">发送至 {current.maskedDest}</p>}

      <div className="flex items-center gap-2 border-b border-line">
        <Input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={useRecovery ? '请输入恢复码' : '请输入 6 位验证码'}
          inputMode={useRecovery ? 'text' : 'numeric'}
          maxLength={useRecovery ? 64 : 6}
          className={fieldClass}
        />
        {(mfaType === 'email' || mfaType === 'sms') && !useRecovery && (
          <button
            type="button"
            disabled={countdown.running || sendMutation.isPending}
            onClick={handleSendCode}
            className="shrink-0 whitespace-nowrap text-xs font-medium text-primary transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-60"
          >
            {countdown.running
              ? `${countdown.count}s`
              : sendMutation.isPending
                ? '发送中…'
                : '获取验证码'}
          </button>
        )}
      </div>

      {mfaType === 'app' && (
        <button
          type="button"
          onClick={() => {
            setUseRecovery((v) => !v);
            setCode('');
            onError('');
          }}
          className="text-xs text-primary hover:underline"
        >
          {useRecovery ? '使用验证器验证码' : '使用恢复码'}
        </button>
      )}

      {error && <p className="text-sm text-error">{error}</p>}

      <Button
        type="button"
        disabled={!code.trim() || verifyMutation.isPending}
        onClick={() => verifyMutation.mutate()}
        {...buttonTap}
        className="w-full"
      >
        {verifyMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {verifyMutation.isPending ? '验证中…' : '验证并绑定'}
      </Button>
    </div>
  );
}
