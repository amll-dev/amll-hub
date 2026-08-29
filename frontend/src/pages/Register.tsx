import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import {
  avatarFileAtom,
  avatarPreviewAtom,
  registerErrorAtom,
  registerCaptchaOpenAtom,
  registerCaptchaTargetAtom,
  resetRegisterForm,
} from '@/atoms/registerForm';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Camera, Eye, EyeOff, Loader2, X } from 'lucide-react';
import { z } from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { useAliyunCaptcha } from '@/hooks/useAliyunCaptcha';
import { useCountdown } from '@/hooks/useCountdown';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { buttonTap } from '@/lib/motion';
import type { CaptchaConfig } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import type { Control, FieldPath } from 'react-hook-form';
import type { ReactNode } from 'react';

/** 注册表单 schema：字段必填 + 密码长度 + 两次密码一致 */
const registerSchema = z
  .object({
    username: z.string().trim().min(1, '请输入用户名'),
    displayName: z.string().trim().min(1, '请输入显示名称'),
    password: z.string().min(6, '密码长度至少 6 位'),
    confirmPassword: z.string().min(1, '请再次输入密码'),
    phone: z.string().trim().min(1, '请输入手机号'),
    phoneCode: z.string().trim().min(1, '请输入手机验证码'),
    email: z.string().trim().min(1, '请输入邮箱').email('邮箱格式不正确'),
    emailCode: z.string().trim().min(1, '请输入邮箱验证码'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: '两次输入的密码不一致',
    path: ['confirmPassword'],
  });
type RegisterValues = z.infer<typeof registerSchema>;

/** 表单输入框统一样式（在 Input 基础上加表单高度） */
const fieldClass = 'h-11 bg-card px-4';

export function Register() {
  const navigate = useNavigate();
  const { login } = useAuth();

  // 页面状态存全局 atoms（卸载时复位，语义同原 useState）
  const [avatarFile, setAvatarFile] = useAtom(avatarFileAtom);
  const [avatarPreview, setAvatarPreview] = useAtom(avatarPreviewAtom);
  const [error, setError] = useAtom(registerErrorAtom);

  // 验证码相关
  const [captchaModalOpen, setCaptchaModalOpen] = useAtom(registerCaptchaOpenAtom);
  // 记录当前是给哪个目标发送验证码："phone" | "email"
  const [captchaTarget, setCaptchaTarget] = useAtom(registerCaptchaTargetAtom);
  const phoneCountdown = useCountdown();
  const emailCountdown = useCountdown();

  // 离开页面时复位（含撤销头像预览的 objectURL）
  useEffect(() => () => resetRegisterForm(), []);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: '',
      displayName: '',
      password: '',
      confirmPassword: '',
      phone: '',
      phoneCode: '',
      email: '',
      emailCode: '',
    },
  });
  const password = form.watch('password');
  const confirmPassword = form.watch('confirmPassword');
  const phone = form.watch('phone');
  const email = form.watch('email');

  // 验证码配置（与 AuthDialog 共用缓存）
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
  } = useAliyunCaptcha(captchaConfig, 'register-captcha', captchaModalOpen);

  const needCaptcha =
    !!captchaConfig &&
    captchaConfig.type !== 'none' &&
    captchaConfig.type !== 'default' &&
    captchaConfig.type !== '';

  // 倒计时由 useCountdown 提供

  // 头像选择
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError('图片大小不能超过 50MB');
      return;
    }
    setError('');
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  // 实际发送验证码（target: phone / email）
  const sendCodeMutation = useMutation({
    mutationFn: (vars: { target: 'phone' | 'email'; dest: string; token: string }) =>
      api.sendCode({
        checkType: vars.target,
        dest: vars.dest,
        method: 'signup',
        captchaType: needCaptcha ? (captchaConfig?.type ?? '') : '',
        captchaToken: vars.token,
      }),
    onSuccess: (_d, vars) => {
      if (vars.target === 'phone') phoneCountdown.start(60);
      else emailCountdown.start(60);
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

  // 点击发送验证码：先检查账号是否已注册，再走人机验证
  const checkUserMutation = useMutation({
    mutationFn: (vars: { target: 'phone' | 'email'; dest: string }) =>
      api.checkUser({ checkType: vars.target, dest: vars.dest, method: 'signup' }),
    onMutate: () => setError(''),
    onSuccess: (_d, vars) => {
      if (needCaptcha) {
        setCaptchaModalOpen(true);
      } else {
        sendCodeMutation.mutate({ target: vars.target, dest: vars.dest, token: '' });
      }
    },
    onError: (e: Error, vars) => {
      const msg = e.message || '校验失败';
      if (msg.includes('已存在')) {
        setError(
          vars.target === 'phone' ? '该手机号已注册，请直接登录' : '该邮箱已注册，请直接登录'
        );
      } else {
        setError(msg);
      }
    },
  });

  const handleSendCode = (target: 'phone' | 'email') => {
    const dest = (target === 'phone' ? phone : email).trim();
    if (!dest) {
      setError(target === 'phone' ? '请先输入手机号' : '请先输入邮箱');
      return;
    }
    if (captchaLoading) {
      setError('正在加载验证码配置，请稍候');
      return;
    }
    setCaptchaTarget(target);
    setError('');
    checkUserMutation.mutate({ target, dest });
  };

  // 人机验证完成后自动发送（弹窗保持打开，发送成功后才关闭）
  useEffect(() => {
    if (captchaVerifyParam && captchaModalOpen) {
      const dest = (captchaTarget === 'phone' ? phone : email).trim();
      sendCodeMutation.mutate({ target: captchaTarget, dest, token: captchaVerifyParam });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captchaVerifyParam, captchaModalOpen]);

  // 提交注册：注册 → 自动登录 → 上传头像（失败不阻塞）
  const registerMutation = useMutation({
    mutationFn: async (vars: RegisterValues) => {
      await api.register({
        username: vars.username,
        password: vars.password,
        phone: vars.phone,
        code: vars.phoneCode,
        email: vars.email,
        emailCode: vars.emailCode,
        displayName: vars.displayName,
      });
      return { username: vars.username, password: vars.password };
    },
    onMutate: () => setError(''),
    onSuccess: async ({ username, password: pwd }) => {
      try {
        const result = await api.login(username, pwd);
        login(result.token, result.user);
        if (avatarFile) {
          try {
            await api.uploadAvatar(avatarFile);
          } catch {
            // 头像上传失败不阻塞
          }
        }
        navigate('/profile');
      } catch {
        setError('注册成功，请手动登录');
      }
    },
    onError: (e: Error) => setError(e.message || '注册失败'),
  });

  const submitting = registerMutation.isPending;
  const sendingPhoneCode =
    (checkUserMutation.isPending && captchaTarget === 'phone') ||
    (sendCodeMutation.isPending && sendCodeMutation.variables?.target === 'phone');
  const sendingEmailCode =
    (checkUserMutation.isPending && captchaTarget === 'email') ||
    (sendCodeMutation.isPending && sendCodeMutation.variables?.target === 'email');

  const phoneBtnLabel = phoneCountdown.running
    ? `${phoneCountdown.count}s`
    : sendingPhoneCode
      ? '发送中…'
      : '获取验证码';

  const emailBtnLabel = emailCountdown.running
    ? `${emailCountdown.count}s`
    : sendingEmailCode
      ? '发送中…'
      : '获取验证码';

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="rounded-xl border border-line bg-card p-8 shadow-sm">
        <h1 className="mb-6 text-center text-2xl font-bold tracking-tight text-foreground">
          注册账号
        </h1>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => registerMutation.mutate(v))}
            className="space-y-5"
          >
            {/* 头像（可选）*/}
            <div className="flex justify-center">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-2 border-line bg-surface-2 transition-colors hover:border-primary"
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt="头像预览" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-ink-3">
                    <Camera className="h-5 w-5" />
                    <span className="text-xs">头像</span>
                  </div>
                )}
              </button>
            </div>
            <p className="-mt-2 text-center text-xs text-ink-3">头像可选，其余均为必填</p>

            {/* 两列布局：用户名 + 显示名称 */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormFields
                control={form.control}
                name="username"
                label="用户名"
                fieldClass={fieldClass}
              />
              <FormFields
                control={form.control}
                name="displayName"
                label="显示名称"
                fieldClass={fieldClass}
              />
            </div>

            {/* 两列布局：密码 + 确认密码 */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormFieldPassword
                control={form.control}
                name="password"
                label="密码"
                placeholder="至少 6 位"
                fieldClass={fieldClass}
              />
              <FormFieldPassword
                control={form.control}
                name="confirmPassword"
                label="确认密码"
                placeholder="请再次输入密码"
                fieldClass={fieldClass}
                hint={
                  confirmPassword && confirmPassword !== password ? (
                    <p className="mt-1.5 text-xs text-error">两次输入的密码不一致</p>
                  ) : undefined
                }
              />
            </div>

            {/* 手机号 + 手机验证码 */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormFieldPhone control={form.control} name="phone" fieldClass={fieldClass} />
              <div>
                <label className="mb-1.5 block text-sm text-ink-2">手机验证码</label>
                <div className="flex gap-2">
                  <FormFields
                    control={form.control}
                    name="phoneCode"
                    placeholder="短信验证码"
                    inputMode="numeric"
                    fieldClass={`${fieldClass} flex-1`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={phoneCountdown.running || sendingPhoneCode || !phone.trim()}
                    onClick={() => handleSendCode('phone')}
                    className="h-11 shrink-0 px-4 font-medium"
                  >
                    {phoneBtnLabel}
                  </Button>
                </div>
              </div>
            </div>

            {/* 邮箱 + 邮箱验证码 */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormFieldEmail control={form.control} name="email" fieldClass={fieldClass} />
              <div>
                <label className="mb-1.5 block text-sm text-ink-2">邮箱验证码</label>
                <div className="flex gap-2">
                  <FormFields
                    control={form.control}
                    name="emailCode"
                    placeholder="邮件验证码"
                    inputMode="numeric"
                    fieldClass={`${fieldClass} flex-1`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={emailCountdown.running || sendingEmailCode || !email.trim()}
                    onClick={() => handleSendCode('email')}
                    className="h-11 shrink-0 px-4 font-medium"
                  >
                    {emailBtnLabel}
                  </Button>
                </div>
              </div>
            </div>

            {error && <p className="text-sm text-error">{error}</p>}

            <Button type="submit" disabled={submitting} {...buttonTap} className="w-full">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? '注册中…' : '注册'}
            </Button>

            <Link
              to="/"
              className="flex items-center justify-center gap-1 text-sm text-ink-3 transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              返回主页
            </Link>
          </form>
        </Form>
      </div>

      {/* 人机验证弹窗 */}
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
                <div id="register-captcha" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 注册表单字段公共 props */
interface RegisterFieldProps {
  control: Control<RegisterValues>;
  name: FieldPath<RegisterValues>;
  label?: string;
  placeholder?: string;
  fieldClass?: string;
  type?: string;
  autoComplete?: string;
  inputMode?: 'text' | 'tel' | 'email' | 'numeric';
  hint?: ReactNode;
}

/** 通用文本字段：label + Input + 错误信息 */
function FormFields({
  control,
  name,
  label,
  placeholder,
  fieldClass,
  type = 'text',
  autoComplete,
  inputMode,
}: RegisterFieldProps) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          {label && <FormLabel className="text-sm font-normal text-ink-2">{label}</FormLabel>}
          <FormControl>
            <Input
              type={type}
              placeholder={placeholder ?? (label ? `请输入${label}` : '')}
              autoComplete={autoComplete}
              inputMode={inputMode}
              className={fieldClass}
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** 密码字段：带显示/隐藏切换 */
function FormFieldPassword({
  control,
  name,
  label,
  placeholder,
  fieldClass,
  hint,
}: RegisterFieldProps) {
  const [show, setShow] = useState(false);
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          {label && <FormLabel className="text-sm font-normal text-ink-2">{label}</FormLabel>}
          <FormControl>
            <div className="relative">
              <Input
                type={show ? 'text' : 'password'}
                placeholder={placeholder}
                autoComplete="new-password"
                className={`${fieldClass} pr-10`}
                {...field}
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
          </FormControl>
          {hint}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** 手机号字段 */
function FormFieldPhone(props: RegisterFieldProps) {
  return <FormFields {...props} type="text" autoComplete="tel" inputMode="tel" />;
}

/** 邮箱字段 */
function FormFieldEmail(props: RegisterFieldProps) {
  return <FormFields {...props} type="text" autoComplete="email" inputMode="email" />;
}
