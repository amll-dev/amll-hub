import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Loader2, Mail, MessageSquare, type LucideIcon } from 'lucide-react';
import { useCountdown } from '@/hooks/useCountdown';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { buttonTap } from '@/lib/motion';
import { cn } from '@/lib/utils';
import type { IdentityMethod } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useCaptcha } from './captchaContext';
import { fieldClass } from '@/pages/profile/shared';

interface MethodMeta {
  method: IdentityMethod;
  label: string;
  icon: LucideIcon;
}

const METHOD_META: Record<IdentityMethod, MethodMeta> = {
  phone: { method: 'phone', label: '手机验证', icon: MessageSquare },
  email: { method: 'email', label: '邮箱验证', icon: Mail },
};

interface IdentityVerifyProps {
  /** 账号已绑定的手机号，仅用于「手机验证」时展示收件地址 */
  phone?: string;
  /** 账号已绑定的邮箱，仅用于「邮箱验证」时展示收件地址 */
  email?: string;
  /** 验证成功后回调：父级直接把面板切成修改表单 */
  onVerified: () => void;
  /** 取消验证，回到只读状态 */
  onCancel: () => void;
  className?: string;
}

/** 身份验证面板 */
export function IdentityVerifyPanel({
  phone,
  email,
  onVerified,
  onCancel,
  className,
}: IdentityVerifyProps) {
  const queryClient = useQueryClient();
  const { needCaptcha, captchaType, requestCaptcha, closeCaptcha, reportResult } = useCaptcha();
  const [method, setMethod] = useState<IdentityMethod | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const countdown = useCountdown();

  const statusQuery = useQuery({
    queryKey: queryKeys.identity,
    queryFn: () => api.getIdentityStatus(),
    retry: false,
  });

  const verifyMutation = useMutation({
    mutationFn: (vars: { method: IdentityMethod; code: string }) =>
      api.verifyIdentity({ method: vars.method, code: vars.code }),
    onMutate: () => setMsg(null),
    onSuccess: () => {
      // 先切到修改表单，再后台刷新凭证状态
      onVerified();
      queryClient.invalidateQueries({ queryKey: queryKeys.identity });
    },
    onError: (e: Error) => {
      setMsg({ ok: false, text: e.message || '验证失败' });
    },
  });

  const sendCodeMutation = useMutation({
    mutationFn: (token: string) => {
      if (!method) throw new Error('未选择验证方式');
      return api.sendIdentityCode({ method, captchaType, captchaToken: token });
    },
    onMutate: () => setMsg(null),
    onSuccess: () => {
      // 人机验证通过后弹窗关闭即代表已发送，不再额外提示
      countdown.start(60);
      reportResult(true);
      closeCaptcha();
    },
    onError: (e: Error) => {
      const text = e.message || '验证码发送失败';
      setMsg({ ok: false, text });
      // 人机验证本身没通过时保留弹窗让用户重试
      if (text.includes('人机验证')) reportResult(false);
      else {
        reportResult(true);
        closeCaptcha();
      }
    },
  });

  const pickMethod = (m: IdentityMethod) => {
    setMethod(m);
    setCode('');
    setMsg(null);
    countdown.reset();
  };

  const back = () => {
    setMethod(null);
    setCode('');
    setMsg(null);
    countdown.reset();
  };

  const handleSendCode = () => {
    if (needCaptcha) requestCaptcha((token) => sendCodeMutation.mutate(token));
    else sendCodeMutation.mutate('');
  };

  // ===== 未选方式：只列可用的（已绑定的手机 / 邮箱）=====
  if (!method) {
    const methods = statusQuery.data?.methods ?? [];
    return (
      <Card className={cn('gap-0 p-4', className)}>
        <p className="mb-3 text-xs text-ink-3">请选择一种验证方式完成身份验证</p>
        {statusQuery.isPending ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-ink-3">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : methods.length === 0 ? (
          <p className="py-4 text-center text-xs text-error">
            账号尚未绑定手机号或邮箱，无法进行身份验证
          </p>
        ) : (
          <div className="space-y-2">
            {methods.map((m) => {
              const meta = METHOD_META[m];
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => pickMethod(m)}
                  className="flex w-full items-center gap-3 rounded-md border border-line px-4 py-3 text-left transition-colors hover:border-primary hover:bg-primary-tint/40"
                >
                  <meta.icon className="h-4 w-4 shrink-0 text-ink-2" />
                  <span className="text-sm font-medium text-foreground">{meta.label}</span>
                </button>
              );
            })}
          </div>
        )}
        <Button type="button" variant="ghost" className="mt-3" onClick={onCancel}>
          取消
        </Button>
      </Card>
    );
  }

  // ===== 已选方式：方式列表已隐藏，只剩该方式的验证码 =====
  const meta = METHOD_META[method];
  // 收件地址跟随**所选的验证方式**，而不是父级正在编辑的字段：
  const destHint = method === 'phone' ? phone : email;
  return (
    <Card className={cn('gap-0 p-4', className)}>
      <div className="mb-3 flex items-center gap-2">
        <Button type="button" variant="ghost" className="h-auto p-0" onClick={back}>
          <ChevronLeft className="h-4 w-4" />
          重选
        </Button>
        <span className="text-sm font-medium text-foreground">{meta.label}</span>
      </div>

      <p className="mb-3 text-xs text-ink-3">
        验证码将发送到账号绑定的{method === 'phone' ? '手机号' : '邮箱'}
        {destHint ? `：${destHint}` : ''}
      </p>

      <div className="flex gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="验证码"
          inputMode="numeric"
          className={`${fieldClass} flex-1`}
        />
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
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button
          type="button"
          {...buttonTap}
          disabled={verifyMutation.isPending || !code.trim()}
          onClick={() => verifyMutation.mutate({ method, code: code.trim() })}
        >
          {verifyMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {verifyMutation.isPending ? '验证中…' : '验证'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            closeCaptcha();
            onCancel();
          }}
        >
          取消
        </Button>
        {msg && <p className={`text-sm ${msg.ok ? 'text-success' : 'text-error'}`}>{msg.text}</p>}
      </div>
    </Card>
  );
}
