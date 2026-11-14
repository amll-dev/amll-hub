import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Loader2, Mail, MessageSquare, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { buttonTap } from '@/lib/motion';
import { cn } from '@/lib/utils';
import type { MfaSetupStart, MfaStatus, MfaStatusItem } from '@/lib/auth';
import { useCountdown } from '@/hooks/useCountdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SectionCard } from './SectionCard';
import { useCaptcha } from './captchaContext';

const MFA_META = [
  {
    type: 'app',
    label: '身份验证器',
    desc: '使用身份验证器 App 生成的 6 位验证码',
    icon: KeyRound,
  },
  {
    type: 'email',
    label: '邮箱验证码',
    desc: '登录时向已绑定邮箱发送验证码',
    icon: Mail,
  },
  {
    type: 'sms',
    label: '短信验证码',
    desc: '登录时向已绑定手机号发送验证码',
    icon: MessageSquare,
  },
] as const;

type Msg = { ok: boolean; text: string };

/** 账号安全页的 MFA 管理板块 */
export function MfaSection() {
  const queryClient = useQueryClient();
  const { needCaptcha, captchaType, requestCaptcha, closeCaptcha, reportResult } = useCaptcha();
  const countdown = useCountdown();

  const [setup, setSetup] = useState<MfaSetupStart | null>(null);
  const [step, setStep] = useState<'verify' | 'done'>('verify');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [msg, setMsg] = useState<Msg | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [confirmDisable, setConfirmDisable] = useState(false);

  const statusQuery = useQuery({
    queryKey: queryKeys.mfaStatus,
    queryFn: () => api.getMfaStatus(),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const methods = statusQuery.data?.methods ?? [];
  const enabledCount = methods.filter((m) => m.enabled).length;

  /** 立即改写本地缓存，让开关状态先于接口返回刷新 */
  const patchStatus = (updater: (methods: MfaStatusItem[]) => MfaStatusItem[]) => {
    queryClient.setQueryData<MfaStatus>(queryKeys.mfaStatus, (old) => {
      if (!old) return old;
      const next = updater(old.methods);
      return {
        ...old,
        methods: next,
        preferred: next.find((m) => m.isPreferred)?.mfaType ?? '',
      };
    });
  };

  /** 变更成功后：先本地刷新，再以服务端结果为准 */
  const syncStatus = () => queryClient.refetchQueries({ queryKey: queryKeys.mfaStatus });

  // TOTP 二维码
  useEffect(() => {
    if (!setup?.otpauthUrl) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    void import('qrcode')
      .then((QRCode) =>
        QRCode.default.toDataURL(setup.otpauthUrl!, {
          width: 176,
          margin: 1,
          color: { dark: '#1d1d1f', light: '#ffffff' },
        })
      )
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [setup?.otpauthUrl]);

  const startMutation = useMutation({
    mutationFn: (mfaType: string) => api.startMfaSetup(mfaType),
    onMutate: () => setMsg(null),
    onSuccess: (res) => {
      setSetup(res);
      setStep('verify');
      setCode('');
      setRecoveryCode('');
      setMsg(null);
      countdown.reset();
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || '初始化失败' }),
  });

  const sendCodeMutation = useMutation({
    mutationFn: (token: string) => {
      if (!setup) throw new Error('绑定会话已失效');
      return api.sendMfaSetupCode({
        challengeId: setup.challengeId,
        captchaType: needCaptcha ? captchaType : '',
        captchaToken: token,
      });
    },
    onMutate: () => setMsg(null),
    onSuccess: () => {
      countdown.start(60);
      setMsg({ ok: true, text: '验证码已发送' });
      reportResult(true);
      closeCaptcha();
    },
    onError: (e: Error) => {
      const text = e.message || '验证码发送失败';
      if (text.includes('人机验证')) {
        setMsg({ ok: false, text });
        reportResult(false);
      } else {
        setMsg({ ok: false, text });
        reportResult(true);
        closeCaptcha();
      }
    },
  });

  const completeMutation = useMutation({
    mutationFn: () => {
      if (!setup) throw new Error('绑定会话已失效');
      return api.completeMfaSetup({ challengeId: setup.challengeId, passcode: code.trim() });
    },
    onMutate: () => setMsg(null),
    onSuccess: (res) => {
      setRecoveryCode(res.recoveryCode ?? '');
      setStep('done');
      setCode('');
      const mfaType = setup?.mfaType;
      patchStatus((list) => {
        const hasEnabled = list.some((m) => m.enabled);
        return list.map((m) =>
          m.mfaType === mfaType
            ? { ...m, enabled: true, isPreferred: m.isPreferred || !hasEnabled }
            : m
        );
      });
      void syncStatus();
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || '验证失败' }),
  });

  const preferredMutation = useMutation({
    mutationFn: (mfaType: string) => api.setPreferredMfa(mfaType),
    onSuccess: (_data, mfaType) => {
      patchStatus((list) =>
        list.map((m) => ({ ...m, isPreferred: m.mfaType === mfaType && m.enabled }))
      );
      void syncStatus();
    },
  });

  const disableMutation = useMutation({
    mutationFn: () => api.disableMfa(),
    onSuccess: () => {
      setConfirmDisable(false);
      patchStatus((list) => list.map((m) => ({ ...m, enabled: false, isPreferred: false })));
      void syncStatus();
    },
  });

  const closeSetup = () => {
    if (completeMutation.isPending) return;
    setSetup(null);
    setStep('verify');
    setCode('');
    setRecoveryCode('');
    setMsg(null);
    countdown.reset();
  };

  const handleSendCode = () => {
    if (countdown.running || sendCodeMutation.isPending) return;
    if (needCaptcha) {
      requestCaptcha((token) => sendCodeMutation.mutate(token));
    } else {
      sendCodeMutation.mutate('');
    }
  };

  const copyRecoveryCode = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setMsg({ ok: true, text: '恢复码已复制' });
    } catch {
      setMsg({ ok: false, text: '复制失败，请手动保存' });
    }
  };

  const setupLabel = MFA_META.find((m) => m.type === setup?.mfaType)?.label ?? '';

  return (
    <SectionCard
      icon={<ShieldCheck />}
      title="多因素认证"
      description="开启后，登录时除密码外还需要第二重验证。"
    >
      <div className="space-y-3">
        {MFA_META.map((meta) => {
          const item = methods.find((m) => m.mfaType === meta.type);
          const Icon = meta.icon;
          const enabled = !!item?.enabled;
          return (
            <div
              key={meta.type}
              className="flex items-center justify-between gap-4 rounded-lg border border-line p-4"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-2">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {meta.label}
                    {enabled && item?.isPreferred && (
                      <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        首选
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-3">{meta.desc}</p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {enabled ? (
                  <>
                    <span className="flex items-center gap-1 text-xs text-success">
                      <Check className="h-3.5 w-3.5" />
                      已开启
                    </span>
                    {!item?.isPreferred && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={preferredMutation.isPending}
                        onClick={() => preferredMutation.mutate(meta.type)}
                      >
                        设为首选
                      </Button>
                    )}
                  </>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={startMutation.isPending}
                    onClick={() => startMutation.mutate(meta.type)}
                  >
                    {startMutation.isPending && startMutation.variables === meta.type ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    开启
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {enabledCount > 0 && (
        <div className="mt-4 flex items-center justify-between gap-4 border-t border-line pt-4">
          <p className="text-xs text-ink-3">关闭后，登录将不再要求第二重验证。</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="shrink-0 text-error hover:text-error"
            onClick={() => setConfirmDisable(true)}
          >
            关闭多因素认证
          </Button>
        </div>
      )}

      {startMutation.isError && msg && (
        <p className={cn('mt-3 text-sm', msg.ok ? 'text-success' : 'text-error')}>{msg.text}</p>
      )}

      {/* 绑定弹窗 */}
      <Dialog open={!!setup} onOpenChange={(open) => !open && closeSetup()}>
        <DialogContent className="max-w-[440px] gap-0 rounded-xl border-line bg-card p-6">
          {step === 'done' ? (
            <div className="flex flex-col gap-4">
              <h3 className="text-lg font-semibold text-foreground">{setupLabel}已开启</h3>
              <p className="text-sm text-ink-2">
                请保存下面的恢复码。设备丢失或无法获取验证码时，可用它关闭多因素认证。
              </p>
              <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 p-3">
                <code className="min-w-0 flex-1 break-all font-mono text-sm text-foreground">
                  {recoveryCode || '（Casdoor 未返回恢复码）'}
                </code>
                {recoveryCode && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => void copyRecoveryCode()}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {msg && (
                <p className={cn('text-sm', msg.ok ? 'text-success' : 'text-error')}>{msg.text}</p>
              )}
              <Button type="button" className="w-full" {...buttonTap} onClick={closeSetup}>
                完成
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <h3 className="text-lg font-semibold text-foreground">开启{setupLabel}</h3>

              {setup?.mfaType === 'app' ? (
                <>
                  <p className="text-sm text-ink-2">
                    使用身份验证器 App 扫描二维码，然后输入 App 显示的 6 位验证码。
                  </p>
                  {qrDataUrl ? (
                    <div className="mx-auto rounded-lg border border-line bg-white p-3">
                      <img src={qrDataUrl} alt="MFA 二维码" className="h-44 w-44" />
                    </div>
                  ) : (
                    <div className="flex h-44 items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-ink-3" />
                    </div>
                  )}
                  <div>
                    <p className="mb-1.5 text-xs text-ink-3">无法扫码？手动输入密钥：</p>
                    <code className="block break-all rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-ink-2">
                      {setup.secret}
                    </code>
                  </div>
                </>
              ) : (
                <p className="text-sm text-ink-2">
                  验证码将发送至 <span className="font-medium text-foreground">{setup?.dest}</span>
                </p>
              )}

              <div className="flex gap-2">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="请输入 6 位验证码"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  className="h-11 flex-1"
                />
                {setup?.mfaType !== 'app' && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={countdown.running || sendCodeMutation.isPending}
                    onClick={handleSendCode}
                    className="h-11 shrink-0 px-4 font-medium text-primary"
                  >
                    {countdown.running
                      ? `${countdown.count}s`
                      : sendCodeMutation.isPending
                        ? '发送中…'
                        : '获取验证码'}
                  </Button>
                )}
              </div>

              {msg && (
                <p className={cn('text-sm', msg.ok ? 'text-success' : 'text-error')}>{msg.text}</p>
              )}

              <Button
                type="button"
                className="w-full"
                disabled={!code.trim() || completeMutation.isPending}
                {...buttonTap}
                onClick={() => completeMutation.mutate()}
              >
                {completeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {completeMutation.isPending ? '验证中…' : '验证并开启'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 关闭全部 MFA 确认 */}
      <AlertDialog open={confirmDisable} onOpenChange={setConfirmDisable}>
        <AlertDialogContent className="rounded-xl border-line bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>关闭多因素认证？</AlertDialogTitle>
            <AlertDialogDescription>
              将同时关闭身份验证器、邮箱验证码和短信验证码，之后登录只需要密码。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={disableMutation.isPending}
              onClick={(e) => {
                // 关闭动作是异步的，先别让 Radix 立刻收起弹窗
                e.preventDefault();
                disableMutation.mutate();
              }}
            >
              {disableMutation.isPending ? '关闭中…' : '确认关闭'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}
