import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import {
  resetStepAtom,
  resetDestAtom,
  resetErrorAtom,
  resetCaptchaOpenAtom,
  resetResetPasswordForm,
} from '@/atoms/resetPasswordForm';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Check, Eye, EyeOff, Loader2, X } from 'lucide-react';
import { z } from 'zod';
import { useAliyunCaptcha } from '@/hooks/useAliyunCaptcha';
import { useCountdown } from '@/hooks/useCountdown';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { buttonTap } from '@/lib/motion';
import type { CaptchaConfig } from '@/lib/auth';
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

type Step = 1 | 2 | 3;

const stepLabels = ['确认账号', '重置密码', '重置成功'];

/** 表单输入框统一样式（在 Input 基础上加表单高度） */
const fieldClass = 'h-11 bg-card px-4';

/** 重置密码表单 schema（step 2） */
const resetSchema = z
  .object({
    newPassword: z.string().min(1, '请输入新密码').min(6, '密码长度至少 6 位'),
    confirmPassword: z.string().min(1, '请再次输入新密码'),
    code: z.string().trim().min(1, '请输入验证码'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: '两次输入的密码不一致',
    path: ['confirmPassword'],
  });
type ResetValues = z.infer<typeof resetSchema>;

/** 顶部三步进度条 */
function StepProgress({ step }: { step: Step }) {
  return (
    <div className="mb-8">
      {/* 圆圈 + 连接线（线对齐圆圈垂直中心）*/}
      <div className="flex items-center">
        {stepLabels.map((_label, i) => {
          const idx = i + 1;
          const isDone = step > idx;
          const isActive = step === idx;
          return (
            <div key={idx} className={idx < 3 ? 'flex flex-1 items-center' : 'flex items-center'}>
              <motion.div
                initial={false}
                animate={{
                  backgroundColor: isDone || isActive ? '#e0303f' : '#ffffff',
                  borderColor: isDone || isActive ? '#e0303f' : '#e6e6eb',
                  scale: isActive ? 1.1 : 1,
                }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2"
              >
                {isDone ? (
                  <Check className="h-4 w-4 text-white" />
                ) : (
                  <span
                    className={
                      isActive ? 'text-xs font-bold text-white' : 'text-xs font-medium text-ink-3'
                    }
                  >
                    {idx}
                  </span>
                )}
              </motion.div>
              {idx < 3 && (
                <div className="mx-2 h-0.5 flex-1 overflow-hidden rounded-full bg-line">
                  <motion.div
                    initial={false}
                    animate={{ width: isDone ? '100%' : '0%' }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                    className="h-full bg-primary"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* 标签行：对齐到圆圈下方 */}
      <div className="mt-1.5 flex">
        {stepLabels.map((label, i) => {
          const idx = i + 1;
          const isActive = step === idx;
          const isDone = step > idx;
          return (
            <div
              key={idx}
              className={idx < 3 ? 'flex flex-1' : 'flex'}
              style={{ flex: idx < 3 ? 1 : 'none' }}
            >
              <span className="block w-8 shrink-0 overflow-visible text-center text-xs whitespace-nowrap">
                <span
                  className={
                    isActive
                      ? 'font-medium text-primary'
                      : isDone
                        ? 'font-medium text-ink-2'
                        : 'text-ink-3'
                  }
                >
                  {label}
                </span>
              </span>
              {idx < 3 && <div className="flex-1" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ResetPassword() {
  // 页面状态存全局 atoms（卸载时复位，语义同原 useState）
  const [step, setStep] = useAtom(resetStepAtom);
  const [dest, setDest] = useAtom(resetDestAtom);
  const [error, setError] = useAtom(resetErrorAtom);

  // 验证码相关
  const [captchaModalOpen, setCaptchaModalOpen] = useAtom(resetCaptchaOpenAtom);
  const countdown = useCountdown();

  // 离开页面时复位
  useEffect(() => () => resetResetPasswordForm(), []);

  // step2 表单
  const form = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { newPassword: '', confirmPassword: '', code: '' },
  });
  const newPassword = form.watch('newPassword');
  const confirmPassword = form.watch('confirmPassword');

  // 验证码配置（与 AuthDialog/Register 共用缓存）
  const captchaQuery = useQuery({
    queryKey: queryKeys.captcha,
    queryFn: () => api.getCaptcha(),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const captchaConfig: CaptchaConfig = captchaQuery.isError
    ? { type: 'none' }
    : (captchaQuery.data ?? { type: 'none' });
  const captchaLoading = captchaQuery.isFetching;

  const {
    captchaVerifyParam,
    isReady: captchaReady,
    reportResult: reportCaptchaResult,
  } = useAliyunCaptcha(captchaConfig, 'reset-captcha', captchaModalOpen);

  const needCaptcha =
    !!captchaConfig &&
    captchaConfig.type !== 'none' &&
    captchaConfig.type !== 'default' &&
    captchaConfig.type !== '';

  // 倒计时由 useCountdown 提供

  // 实际发送验证码
  const sendCodeMutation = useMutation({
    mutationFn: (token: string) => {
      const checkType = dest.includes('@') ? 'email' : 'phone';
      return api.sendCode({
        checkType,
        dest: dest.trim(),
        method: 'reset',
        captchaType: needCaptcha ? (captchaConfig?.type ?? '') : '',
        captchaToken: token,
      });
    },
    onMutate: () => setError(''),
    onSuccess: () => {
      countdown.start(60);
      reportCaptchaResult(true);
      setCaptchaModalOpen(false);
    },
    onError: (e: Error) => {
      const msg = e.message || '验证码发送失败';
      if (msg.includes('认证服务') || msg.includes('不可用')) {
        // 人机验证token被Casdoor拒绝，告诉 SDK 验证失败，SDK 自动重置供重试
        setError('人机验证失败，请重试');
        reportCaptchaResult(false);
      } else {
        // 验证本身通过，是其他错误
        setError(msg);
        reportCaptchaResult(true);
        setCaptchaModalOpen(false);
      }
    },
  });
  const sendingCode = sendCodeMutation.isPending;

  const handleSendCode = () => {
    if (!dest.trim()) {
      setError('请先输入手机号或邮箱');
      return;
    }
    if (captchaLoading) {
      setError('正在加载验证码配置，请稍候');
      return;
    }
    if (needCaptcha) {
      setCaptchaModalOpen(true);
    } else {
      sendCodeMutation.mutate('');
    }
  };

  // 人机验证完成后自动发送
  useEffect(() => {
    if (captchaVerifyParam && captchaModalOpen) {
      sendCodeMutation.mutate(captchaVerifyParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captchaVerifyParam, captchaModalOpen]);

  // Step 1 → 2
  const handleStep1Next = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dest.trim()) {
      setError('请输入手机号或邮箱');
      return;
    }
    setError('');
    setStep(2);
  };

  // Step 2 → 提交重置
  const resetMutation = useMutation({
    mutationFn: (vars: ResetValues) => api.forgotPassword(dest.trim(), vars.code, vars.newPassword),
    onMutate: () => setError(''),
    onSuccess: () => setStep(3),
    onError: (e: Error) => setError(e.message || '重置失败'),
  });
  const submitting = resetMutation.isPending;

  const sendBtnLabel = countdown.running
    ? `${countdown.count}s`
    : sendingCode
      ? '发送中…'
      : '获取验证码';

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <div className="rounded-xl border border-line bg-card p-8 shadow-sm">
        <StepProgress step={step} />

        <AnimatePresence mode="wait">
          {/* Step 1: 确认账号 */}
          {step === 1 && (
            <motion.form
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              onSubmit={handleStep1Next}
              className="space-y-4"
            >
              <p className="text-sm text-ink-2">请输入您绑定的手机号或邮箱，用于重置密码。</p>
              <Input
                type="text"
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                placeholder="手机号或邮箱"
                autoComplete="email"
                className={fieldClass}
                autoFocus
              />
              {error && <p className="text-sm text-error">{error}</p>}
              <motion.button
                type="submit"
                {...buttonTap}
                className={buttonVariants({ className: 'w-full' })}
              >
                下一步
              </motion.button>
              <Link
                to="/"
                className="flex items-center justify-center gap-1 text-sm text-ink-3 transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                返回主页
              </Link>
            </motion.form>
          )}

          {/* Step 2: 重置密码 */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="space-y-4"
            >
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit((v) => resetMutation.mutate(v))}
                  className="space-y-4"
                >
                  {/* 新密码 */}
                  <FormField
                    control={form.control}
                    name="newPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-normal text-ink-2">新密码</FormLabel>
                        <FormControl>
                          <PasswordInput
                            value={field.value}
                            onChange={field.onChange}
                            placeholder="请输入新密码"
                            autoComplete="new-password"
                            fieldClass={fieldClass}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* 确认密码 */}
                  <FormField
                    control={form.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-normal text-ink-2">确认密码</FormLabel>
                        <FormControl>
                          <PasswordInput
                            value={field.value}
                            onChange={field.onChange}
                            placeholder="请再次输入新密码"
                            autoComplete="new-password"
                            fieldClass={fieldClass}
                          />
                        </FormControl>
                        {confirmPassword && confirmPassword !== newPassword && (
                          <p className="mt-1.5 text-xs text-error">两次输入的密码不一致</p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* 手机号/邮箱 */}
                  <div>
                    <label className="mb-1.5 block text-sm text-ink-2">手机号/邮箱</label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        value={dest}
                        readOnly
                        className={`${fieldClass} flex-1 bg-surface-2`}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setError('');
                          form.setValue('code', '');
                          countdown.reset();
                          setStep(1);
                        }}
                        className="h-11 shrink-0 px-4 font-medium text-ink-2"
                      >
                        修改
                      </Button>
                    </div>
                  </div>

                  {/* 验证码 */}
                  <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-normal text-ink-2">验证码</FormLabel>
                        <FormControl>
                          <div className="flex gap-2">
                            <Input
                              type="text"
                              placeholder="请输入验证码"
                              inputMode="numeric"
                              className={`${fieldClass} flex-1`}
                              {...field}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              disabled={countdown.running || sendingCode || !dest.trim()}
                              onClick={handleSendCode}
                              className="h-11 shrink-0 px-4 font-medium text-primary"
                            >
                              {sendBtnLabel}
                            </Button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {error && <p className="text-sm text-error">{error}</p>}

                  <Button type="submit" disabled={submitting} {...buttonTap} className="w-full">
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {submitting ? '重置中…' : '确认重置'}
                  </Button>
                </form>
              </Form>
            </motion.div>
          )}

          {/* Step 3: 重置成功 */}
          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="flex flex-col items-center py-8 text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.4, ease: 'easeOut', delay: 0.1 }}
                className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary"
              >
                <Check className="h-8 w-8 text-white" />
              </motion.div>
              <h3 className="text-lg font-semibold text-foreground">密码重置成功</h3>
              <p className="mt-2 text-sm text-ink-2">请返回主页登录</p>
              <Link
                to="/"
                className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                返回主页
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {/* 人机验证弹窗 */}{' '}
      <AnimatePresence>
        {captchaModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[220] flex items-center justify-center bg-black/40 px-4"
            onClick={() => setCaptchaModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="w-full max-w-sm rounded-lg border border-line bg-card p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">请完成人机验证</span>
                <button
                  type="button"
                  onClick={() => setCaptchaModalOpen(false)}
                  className="text-ink-3 transition-colors hover:text-foreground"
                  aria-label="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-[44px]">
                {!captchaReady && (
                  <div className="flex items-center justify-center py-3">
                    <Loader2 className="h-5 w-5 animate-spin text-ink-3" />
                  </div>
                )}
                <div id="reset-captcha" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 密码输入框：带显示/隐藏切换（RHF 受控） */
function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
  fieldClass,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  fieldClass?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={`${fieldClass ?? ''} pr-10`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 transition-colors hover:text-ink-2"
        aria-label={show ? '隐藏密码' : '显示密码'}
      >
        {show ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </button>
    </div>
  );
}
