import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import {
  loginTabAtom,
  forgotOpenAtom,
  loginCodeTypeAtom,
  loginErrorAtom,
  loginCaptchaOpenAtom,
} from '@/atoms/authDialog';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Eye, EyeOff, Loader2, Mail, X } from 'lucide-react';
import { z } from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { useAliyunCaptcha } from '@/hooks/useAliyunCaptcha';
import { useCountdown } from '@/hooks/useCountdown';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { buttonTap } from '@/lib/motion';
import type { CaptchaConfig } from '@/lib/auth';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

type Tab = 'password' | 'code';

/** 密码登录表单 schema */
const passwordSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
});
type PasswordFormValues = z.infer<typeof passwordSchema>;

/** 验证码登录表单 schema（dest 类型随 codeType 变化，仅做非空校验，格式由后端校验） */
const makeCodeSchema = (codeType: 'phone' | 'email') =>
  z.object({
    dest: z
      .string()
      .trim()
      .min(1, codeType === 'phone' ? '请输入手机号' : '请输入邮箱'),
    code: z.string().trim().min(1, '请输入验证码'),
  });
type CodeFormValues = z.infer<ReturnType<typeof makeCodeSchema>>;

/** 占位二维码*/
function PlaceholderQR() {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    void import('qrcode')
      .then((QRCode) =>
        QRCode.default.toDataURL('居然真的有人来扫这个码o(〃＾▽＾〃)o，此功能暂未上线，敬请期待~', {
          width: 176,
          margin: 1,
          color: { dark: '#1d1d1f', light: '#ffffff' },
        })
      )
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto aspect-square w-44 rounded-lg border border-line bg-white p-3 shadow-sm">
      {dataUrl && <img src={dataUrl} alt="登录二维码" className="h-full w-full" />}
    </div>
  );
}

export function AuthDialog() {
  const { loginOpen, closeLogin, login, loginRedirect, clearLoginRedirect } = useAuth();
  const navigate = useNavigate();

  // 弹窗状态存全局 atoms（常驻 Layout，关闭时由 resetForm 复位）
  const [tab, setTab] = useAtom(loginTabAtom);
  const [forgotOpen, setForgotOpen] = useAtom(forgotOpenAtom);
  // 验证码登录类型：phone / email
  const [codeType, setCodeType] = useAtom(loginCodeTypeAtom);

  const [error, setError] = useAtom(loginErrorAtom);

  // 验证码相关
  const [captchaModalOpen, setCaptchaModalOpen] = useAtom(loginCaptchaOpenAtom);
  const countdown = useCountdown();

  // 两套登录表单
  const passwordForm = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { username: '', password: '' },
  });
  const codeForm = useForm<CodeFormValues>({
    resolver: zodResolver(makeCodeSchema(codeType)),
    defaultValues: { dest: '', code: '' },
  });

  // 切到验证码登录 tab 时拉取验证码配置（Query 缓存，弹窗期间去重）
  const captchaQuery = useQuery({
    queryKey: queryKeys.captcha,
    queryFn: () => api.getCaptcha(),
    enabled: loginOpen && tab === 'code',
    staleTime: 10 * 60_000,
    retry: false,
  });
  // 配置拉取失败视为无需人机验证（旧行为）
  const captchaConfig: CaptchaConfig = captchaQuery.isError
    ? { type: 'none' }
    : (captchaQuery.data ?? { type: 'none' });
  const captchaLoading = captchaQuery.isFetching;

  const {
    captchaVerifyParam,
    isReady: captchaReady,
    reportResult: reportCaptchaResult,
  } = useAliyunCaptcha(captchaConfig, 'auth-captcha', captchaModalOpen);

  const needCaptcha =
    !!captchaConfig &&
    captchaConfig.type !== 'none' &&
    captchaConfig.type !== 'default' &&
    captchaConfig.type !== '';

  const resetForm = useCallback(() => {
    setTab('password');
    setForgotOpen(false);
    setCodeType('phone');
    passwordForm.reset();
    codeForm.reset();
    setError('');
    setCaptchaModalOpen(false);
    countdown.reset();
  }, [
    passwordForm,
    codeForm,
    countdown,
    setTab,
    setForgotOpen,
    setCodeType,
    setError,
    setCaptchaModalOpen,
  ]);

  const handleClose = useCallback(() => {
    closeLogin();
    setTimeout(resetForm, 250);
  }, [closeLogin, resetForm]);

  const handleForgotOption1 = useCallback(() => {
    setForgotOpen(false);
    setTab('code');
    setError('');
  }, [setForgotOpen, setTab, setError]);

  const handleForgotOption2 = useCallback(() => {
    handleClose();
    navigate('/reset-password');
  }, [handleClose, navigate]);

  // 倒计时逻辑由 useCountdown 提供

  // 实际发送验证码的 API 调用
  const sendCodeMutation = useMutation({
    mutationFn: (token: string) => {
      const dest = codeForm.getValues('dest');
      return api.sendCode({
        checkType: codeType,
        dest: dest.trim(),
        method: 'login',
        captchaType: needCaptcha ? (captchaConfig?.type ?? '') : '',
        captchaToken: token,
      });
    },
    onSuccess: () => {
      countdown.start(60);
      // 告诉 SDK 验证成功，关闭弹窗
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

  // 点击"获取验证码"后先检查账号存在性，通过后再做人机验证
  const checkUserMutation = useMutation({
    mutationFn: () => {
      const dest = codeForm.getValues('dest');
      return api.checkUser({ checkType: codeType, dest: dest.trim(), method: 'login' });
    },
    onMutate: () => {
      setError('');
    },
    onSuccess: () => {
      // 账号存在，打开人机验证弹窗
      if (needCaptcha) {
        setCaptchaModalOpen(true);
      } else {
        // 无需人机验证，直接发送
        sendCodeMutation.mutate('');
      }
    },
    onError: (e: Error) => {
      const msg = e.message || '校验失败';
      if (msg.includes('未注册')) {
        setError(
          codeType === 'phone'
            ? '该手机号未绑定账号，请前往注册或绑定'
            : '该邮箱未绑定账号，请前往注册或绑定'
        );
      } else {
        setError(msg);
      }
    },
  });

  const handleSendCode = () => {
    const dest = codeForm.getValues('dest').trim();
    if (!dest) {
      setError(codeType === 'phone' ? '请输入手机号' : '请输入邮箱');
      return;
    }
    if (captchaLoading) {
      setError('正在加载验证码配置，请稍候');
      return;
    }
    checkUserMutation.mutate();
  };

  // 人机验证完成后自动发送验证码
  useEffect(() => {
    if (captchaVerifyParam && captchaModalOpen) {
      sendCodeMutation.mutate(captchaVerifyParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captchaVerifyParam, captchaModalOpen]);

  // 密码登录
  const passwordLoginMutation = useMutation({
    mutationFn: (vars: PasswordFormValues) => api.login(vars.username, vars.password),
    onSuccess: (result) => {
      login(result.token, result.user);
      finishLogin();
    },
    onError: (e: Error) => setError(e.message || '登录失败'),
  });

  // 验证码登录
  const codeLoginMutation = useMutation({
    mutationFn: (vars: CodeFormValues) => api.loginByCode(vars.dest, vars.code),
    onSuccess: (result) => {
      login(result.token, result.user);
      finishLogin();
    },
    onError: (e: Error) => setError(e.message || '登录失败'),
  });

  /** 登录成功收尾：关闭弹窗；若带了跳转目标（点击需登录功能进入），自动前往 */
  const finishLogin = () => {
    handleClose();
    if (loginRedirect) {
      navigate(loginRedirect);
      clearLoginRedirect();
    }
  };

  const submitting = passwordLoginMutation.isPending || codeLoginMutation.isPending;

  const tabItems: { key: Tab; label: string }[] = [
    { key: 'password', label: '密码登录' },
    { key: 'code', label: '短信登录' },
  ];

  const sendBtnLabel = countdown.running
    ? `${countdown.count}s`
    : sendingCode
      ? '发送中…'
      : '获取验证码';
  const destValue = codeForm.watch('dest');

  return (
    <>
      <Dialog open={loginOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="flex max-w-[720px] gap-0 overflow-hidden rounded-xl border-line bg-card p-0 shadow-2xl">
          {/* 左侧：二维码登录 */}
          <div className="hidden w-[280px] flex-col items-center justify-center gap-4 border-r border-line bg-surface-2 p-6 md:flex">
            <h4 className="text-base font-semibold text-foreground">扫描二维码登录</h4>
            <PlaceholderQR />
            <p className="text-center text-xs leading-relaxed text-ink-2">
              请使用 AMLL Hub 客户端
              <br />
              扫码登录或扫码下载 APP
            </p>
          </div>

          {/* 右侧：表单 */}
          <div className="flex flex-1 flex-col p-6 sm:p-8">
            {/* Tab 切换 */}
            <div className="mb-6 flex items-center justify-center gap-8">
              {tabItems.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTab(t.key);
                    setError('');
                    // 切到短信登录 tab 时默认 phone
                    if (t.key === 'code') setCodeType('phone');
                  }}
                  className="py-1.5 text-base font-medium transition-colors"
                >
                  <span
                    className={
                      tab === t.key && !(t.key === 'code' && codeType === 'email')
                        ? 'text-primary'
                        : 'text-ink-3 hover:text-ink-2'
                    }
                  >
                    {t.label}
                  </span>
                </button>
              ))}
            </div>

            {/* 表单内容：统一用 AnimatePresence 管理所有视图切换 */}
            <AnimatePresence mode="wait">
              {/* 忘记密码菜单 */}
              {tab === 'password' && forgotOpen && (
                <motion.div
                  key="forgot-menu"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="flex flex-1 flex-col"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setForgotOpen(false);
                      setError('');
                    }}
                    className="mb-4 flex items-center gap-1 text-sm text-ink-3 transition-colors hover:text-foreground"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    返回登录
                  </button>

                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={handleForgotOption1}
                      className="w-full rounded-lg border border-line bg-card p-4 text-left transition-colors hover:border-primary hover:bg-primary-soft"
                    >
                      <p className="text-sm font-medium text-foreground">发送短信快速登录</p>
                      <p className="mt-1 text-xs text-ink-3">使用绑定的手机号登陆账号</p>
                    </button>
                    <button
                      type="button"
                      onClick={handleForgotOption2}
                      className="w-full rounded-lg border border-line bg-card p-4 text-left transition-colors hover:border-primary hover:bg-primary-soft"
                    >
                      <p className="text-sm font-medium text-foreground">去找回密码</p>
                      <p className="mt-1 text-xs text-ink-3">通过绑定的手机号/邮箱重置密码</p>
                    </button>
                  </div>
                </motion.div>
              )}

              {/* 密码登录表单 */}
              {tab === 'password' && !forgotOpen && (
                <motion.div
                  key="password-form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="flex flex-1 flex-col"
                >
                  <Form {...passwordForm}>
                    <form
                      onSubmit={passwordForm.handleSubmit((v) => passwordLoginMutation.mutate(v))}
                      className="flex flex-1 flex-col"
                    >
                      <FormField
                        control={passwordForm.control}
                        name="username"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="sr-only">账号</FormLabel>
                            <FormControl>
                              <label className="flex items-center gap-3 border-b border-line py-3">
                                <span className="w-12 shrink-0 text-sm text-ink-2">账号</span>
                                <Input
                                  type="text"
                                  placeholder="请输入用户名"
                                  autoComplete="username"
                                  className="h-auto flex-1 rounded-none border-none bg-transparent px-0 py-0 focus-visible:ring-0 focus-visible:border-none aria-invalid:ring-0 aria-invalid:border-none"
                                  {...field}
                                />
                              </label>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={passwordForm.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="sr-only">密码</FormLabel>
                            <FormControl>
                              <label className="flex items-center gap-3 border-b border-line py-3">
                                <span className="w-12 shrink-0 text-sm text-ink-2">密码</span>
                                <PasswordInput value={field.value} onChange={field.onChange} />
                              </label>
                            </FormControl>
                            <div className="flex items-center justify-end">
                              <button
                                type="button"
                                className="whitespace-nowrap text-xs text-primary hover:underline"
                                onClick={() => setForgotOpen(true)}
                              >
                                忘记密码?
                              </button>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {error && <p className="mt-3 text-sm text-error">{error}</p>}

                      <div className="mt-auto space-y-3 pt-6">
                        <div className="flex gap-3">
                          <Button
                            type="button"
                            variant="outline"
                            {...buttonTap}
                            onClick={() => {
                              handleClose();
                              navigate('/register');
                            }}
                            className="flex-1 text-foreground"
                          >
                            注册
                          </Button>
                          <Button
                            type="submit"
                            disabled={submitting}
                            {...buttonTap}
                            className="flex-1"
                          >
                            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                            {submitting ? '登录中…' : '登录'}
                          </Button>
                        </div>
                      </div>
                    </form>
                  </Form>
                </motion.div>
              )}

              {/* 验证码登录表单*/}
              {tab === 'code' && (
                <motion.div
                  key="code-form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="flex flex-1 flex-col"
                >
                  <Form {...codeForm}>
                    <form
                      onSubmit={codeForm.handleSubmit((v) => codeLoginMutation.mutate(v))}
                      className="flex flex-1 flex-col"
                    >
                      <div>
                        {/* {手机号|邮箱} + 获取验证码*/}
                        <FormField
                          control={codeForm.control}
                          name="dest"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="sr-only">
                                {codeType === 'phone' ? '手机号' : '邮箱'}
                              </FormLabel>
                              <FormControl>
                                <label className="flex items-center gap-3 border-b border-line py-3">
                                  <span className="w-12 shrink-0 text-sm text-ink-2">
                                    {codeType === 'phone' ? '手机号' : '邮箱'}
                                  </span>
                                  <Input
                                    type={codeType === 'phone' ? 'text' : 'email'}
                                    placeholder={
                                      codeType === 'phone' ? '请输入手机号' : '请输入邮箱'
                                    }
                                    autoComplete={codeType === 'phone' ? 'tel' : 'email'}
                                    className="h-auto flex-1 rounded-none border-none bg-transparent px-0 py-0 focus-visible:ring-0 focus-visible:border-none aria-invalid:ring-0 aria-invalid:border-none"
                                    {...field}
                                  />
                                  <button
                                    type="button"
                                    disabled={countdown.running || sendingCode || !destValue.trim()}
                                    onClick={handleSendCode}
                                    className="shrink-0 whitespace-nowrap text-xs font-medium text-primary transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {sendBtnLabel}
                                  </button>
                                </label>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* 验证码 */}
                        <FormField
                          control={codeForm.control}
                          name="code"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="sr-only">验证码</FormLabel>
                              <FormControl>
                                <label className="flex items-center gap-3 border-b border-line py-3">
                                  <span className="w-12 shrink-0 text-sm text-ink-2">验证码</span>
                                  <Input
                                    type="text"
                                    placeholder="请输入验证码"
                                    inputMode="numeric"
                                    className="h-auto flex-1 rounded-none border-none bg-transparent px-0 py-0 focus-visible:ring-0 focus-visible:border-none aria-invalid:ring-0 aria-invalid:border-none"
                                    {...field}
                                  />
                                </label>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      {error && <p className="mt-3 text-sm text-error">{error}</p>}

                      <div className="mt-auto space-y-3 pt-6">
                        <div className="flex gap-3">
                          <Button
                            type="button"
                            variant="outline"
                            {...buttonTap}
                            onClick={() => {
                              handleClose();
                              navigate('/register');
                            }}
                            className="flex-1 text-foreground"
                          >
                            注册
                          </Button>
                          <Button
                            type="submit"
                            disabled={submitting}
                            {...buttonTap}
                            className="flex-1"
                          >
                            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                            {submitting ? '登录中…' : '登录'}
                          </Button>
                        </div>
                      </div>
                    </form>
                  </Form>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 其他方式登录 */}
            <div className="mt-6">
              <div className="relative mb-4 flex items-center justify-center">
                <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
                <span className="relative bg-card px-3 text-xs text-ink-3">其他方式登录</span>
              </div>
              <div className="flex items-center justify-center gap-6">
                <button
                  type="button"
                  className="flex flex-col items-center gap-1 text-ink-3 transition-colors hover:text-primary"
                  onClick={() => {
                    setTab('code');
                    setCodeType('email');
                    setError('');
                    codeForm.reset({ dest: '', code: '' });
                    countdown.reset();
                  }}
                >
                  <Mail className="h-6 w-6" />
                  <span className="text-[10px]">邮箱登录</span>
                </button>
              </div>
            </div>

            {/* 协议 */}
            <p className="mt-5 text-center text-[11px] leading-relaxed text-ink-3">
              登录或完成注册即代表你同意
              <button type="button" className="text-primary hover:underline">
                用户协议
              </button>
              和
              <button type="button" className="text-primary hover:underline">
                隐私政策
              </button>
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* 人机验证弹窗*/}
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
                <div id="auth-captcha" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** 密码输入框：带显示/隐藏切换（RHF 受控） */
function PasswordInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <Input
        type={show ? 'text' : 'password'}
        placeholder="请输入密码"
        autoComplete="current-password"
        className="h-auto flex-1 rounded-none border-none bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 focus-visible:border-none aria-invalid:ring-0 aria-invalid:border-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="text-ink-3 transition-colors hover:text-ink-2"
        aria-label={show ? '隐藏密码' : '显示密码'}
      >
        {show ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </button>
    </>
  );
}
