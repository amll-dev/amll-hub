import { useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import {
  avatarMsgAtom,
  captchaModalOpenAtom,
  editCodeAtom,
  editMsgAtom,
  editTargetAtom,
  editValueAtom,
  profileMsgAtom,
  pwdMsgAtom,
  resetProfileForm,
  type EditTarget,
} from '@/atoms/profileForm';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'framer-motion';
import { Camera, Loader2, KeyRound, Mail, Phone, Save, User, X } from 'lucide-react';
import { z } from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { useAliyunCaptcha } from '@/hooks/useAliyunCaptcha';
import { useCountdown } from '@/hooks/useCountdown';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { buttonTap, fadeUp, staggerContainer } from '@/lib/motion';
import type { CaptchaConfig } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

/** 表单输入框统一样式（在 Input 基础上加表单高度） */
const fieldClass = 'h-11 bg-card px-4';

/** 资料保存 schema */
const profileSchema = z.object({
  displayName: z.string().trim().min(1, '昵称不能为空'),
});
type ProfileValues = z.infer<typeof profileSchema>;

/** 修改密码 schema */
const passwordSchema = z
  .object({
    oldPassword: z.string().min(1, '请输入旧密码'),
    newPassword: z.string().min(1, '请输入新密码').min(6, '密码长度至少 6 位'),
    confirmPassword: z.string().min(1, '请确认新密码'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: '两次输入的新密码不一致',
    path: ['confirmPassword'],
  });
type PasswordValues = z.infer<typeof passwordSchema>;

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div variants={fadeUp}>
      <Card className="gap-0 p-6">
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
          {icon}
          {title}
        </h2>
        {children}
      </Card>
    </motion.div>
  );
}

export function Profile() {
  const { user, refreshUser, openLogin } = useAuth();

  // 页面状态存全局 atoms（卸载时复位，语义同原 useState）
  useEffect(() => () => resetProfileForm(), []);

  // 头像
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarMsg, setAvatarMsg] = useAtom(avatarMsgAtom);

  // 邮箱/手机号修改
  const [editTarget, setEditTarget] = useAtom(editTargetAtom);
  const [editValue, setEditValue] = useAtom(editValueAtom);
  const [editCode, setEditCode] = useAtom(editCodeAtom);
  const editCountdown = useCountdown();
  const [editMsg, setEditMsg] = useAtom(editMsgAtom);

  // 两套 RHF 表单：基本信息 / 修改密码
  const profileForm = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: user?.displayName ?? '' },
  });
  const passwordForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { oldPassword: '', newPassword: '', confirmPassword: '' },
  });

  // 人机验证
  const [captchaModalOpen, setCaptchaModalOpen] = useAtom(captchaModalOpenAtom);
  const captchaQuery = useQuery({
    queryKey: queryKeys.captcha,
    queryFn: () => api.getCaptcha(),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const captchaConfig: CaptchaConfig = captchaQuery.isError
    ? { type: 'none' }
    : (captchaQuery.data ?? { type: 'none' });
  const {
    captchaVerifyParam,
    isReady: captchaReady,
    reportResult: reportCaptchaResult,
  } = useAliyunCaptcha(captchaConfig, 'profile-captcha', captchaModalOpen);

  const needCaptcha =
    !!captchaConfig &&
    captchaConfig.type !== 'none' &&
    captchaConfig.type !== 'default' &&
    captchaConfig.type !== '';

  // 倒计时由 useCountdown 提供

  const [profileMsg, setProfileMsg] = useAtom(profileMsgAtom);
  const [pwdMsg, setPwdMsg] = useAtom(pwdMsgAtom);

  const avatarMutation = useMutation({
    mutationFn: (file: File) => api.uploadAvatar(file),
    onMutate: () => setAvatarMsg(null),
    onSuccess: async () => {
      await refreshUser();
      setAvatarMsg({ ok: true, text: '头像更新成功' });
    },
    onError: (err: Error) => setAvatarMsg({ ok: false, text: err.message || '头像更新失败' }),
    onSettled: () => {
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const profileMutation = useMutation({
    mutationFn: (vars: ProfileValues) => api.updateProfile({ displayName: vars.displayName }),
    onMutate: () => setProfileMsg(null),
    onSuccess: async () => {
      await refreshUser();
      setProfileMsg({ ok: true, text: '资料保存成功' });
    },
    onError: (err: Error) => setProfileMsg({ ok: false, text: err.message || '保存失败' }),
  });
  const profileSaving = profileMutation.isPending;

  const passwordMutation = useMutation({
    mutationFn: (vars: PasswordValues) => api.changePassword(vars.oldPassword, vars.newPassword),
    onMutate: () => setPwdMsg(null),
    onSuccess: () => {
      setPwdMsg({ ok: true, text: '密码修改成功' });
      passwordForm.reset();
    },
    onError: (err: Error) => setPwdMsg({ ok: false, text: err.message || '密码修改失败' }),
  });
  const pwdSaving = passwordMutation.isPending;

  // ===== 邮箱/手机号修改 =====

  const startEdit = (target: EditTarget) => {
    setEditTarget(target);
    setEditValue('');
    setEditCode('');
    editCountdown.reset();
    setEditMsg(null);
  };

  const cancelEdit = () => {
    setEditTarget(null);
    setEditValue('');
    setEditCode('');
    editCountdown.reset();
    setEditMsg(null);
  };

  // 实际发送验证码
  const sendEditCodeMutation = useMutation({
    mutationFn: (token: string) => {
      if (!editTarget) throw new Error('未选择修改项');
      return api.sendCode({
        checkType: editTarget,
        dest: editValue.trim(),
        method: 'signup',
        captchaType: needCaptcha ? (captchaConfig?.type ?? '') : '',
        captchaToken: token,
      });
    },
    onMutate: () => setEditMsg(null),
    onSuccess: () => {
      editCountdown.start(60);
      reportCaptchaResult(true);
      setCaptchaModalOpen(false);
    },
    onError: (e: Error) => {
      const msg = e.message || '验证码发送失败';
      if (msg.includes('认证服务') || msg.includes('不可用')) {
        setEditMsg({ ok: false, text: '人机验证失败，请重试' });
        reportCaptchaResult(false);
      } else {
        setEditMsg({ ok: false, text: msg });
        reportCaptchaResult(true);
        setCaptchaModalOpen(false);
      }
    },
  });
  const editSendingCode = sendEditCodeMutation.isPending;

  // 点击发送验证码：先检查账号是否已存在
  const checkUserMutation = useMutation({
    mutationFn: () => {
      if (!editTarget) throw new Error('未选择修改项');
      return api.checkUser({
        checkType: editTarget,
        dest: editValue.trim(),
        method: 'signup',
      });
    },
    onMutate: () => setEditMsg(null),
    onSuccess: () => {
      if (needCaptcha) {
        setCaptchaModalOpen(true);
      } else {
        sendEditCodeMutation.mutate('');
      }
    },
    onError: (e: Error) => {
      const msg = e.message || '校验失败';
      if (msg.includes('已存在')) {
        setEditMsg({
          ok: false,
          text: editTarget === 'phone' ? '该手机号已注册' : '该邮箱已注册',
        });
      } else {
        setEditMsg({ ok: false, text: msg });
      }
    },
  });

  const handleSendEditCode = () => {
    if (!editTarget || !editValue.trim()) {
      setEditMsg({ ok: false, text: `请输入${editTarget === 'phone' ? '手机号' : '邮箱'}` });
      return;
    }
    checkUserMutation.mutate();
  };

  // 人机验证完成后自动发送
  useEffect(() => {
    if (captchaVerifyParam && captchaModalOpen) {
      sendEditCodeMutation.mutate(captchaVerifyParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captchaVerifyParam, captchaModalOpen]);

  // 保存邮箱/手机号修改
  const saveEditMutation = useMutation({
    mutationFn: () => {
      if (!editTarget) throw new Error('未选择修改项');
      return editTarget === 'email'
        ? api.updateProfile({ email: editValue.trim(), code: editCode.trim() })
        : api.updateProfile({ phone: editValue.trim(), phoneCode: editCode.trim() });
    },
    onMutate: () => setEditMsg(null),
    onSuccess: async () => {
      await refreshUser();
      setEditMsg({ ok: true, text: '修改成功' });
      setTimeout(cancelEdit, 1000);
    },
    onError: (e: Error) => setEditMsg({ ok: false, text: e.message || '修改失败' }),
  });
  const editSaving = saveEditMutation.isPending;

  const editSendBtnLabel = editCountdown.running
    ? `${editCountdown.count}s`
    : editSendingCode
      ? '发送中…'
      : '获取验证码';

  // 未登录
  if (!user) {
    return (
      <div className="mx-auto max-w-[1200px] px-6 py-32 text-center">
        <h1 className="text-2xl font-bold tracking-tight">请先登录</h1>
        <p className="mt-3 text-ink-2">登录后可查看和管理个人资料</p>
        <Button {...buttonTap} onClick={() => openLogin()} className="mt-8">
          去登录
        </Button>
      </div>
    );
  }

  const initial = (user.displayName || user.name || '?').charAt(0).toUpperCase();

  /** 邮箱/手机号编辑区（两种 target 结构相同，仅文案不同） */
  const renderEditArea = (target: Exclude<EditTarget, null>, readOnlyValue: string) =>
    editTarget === target ? (
      <div className="space-y-2">
        <Input
          type={target === 'email' ? 'text' : 'text'}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          placeholder={target === 'email' ? '请输入新邮箱' : '请输入新手机号'}
          className={fieldClass}
        />
        <div className="flex gap-2">
          <Input
            type="text"
            value={editCode}
            onChange={(e) => setEditCode(e.target.value)}
            placeholder="验证码"
            inputMode="numeric"
            className={`${fieldClass} flex-1`}
          />
          <Button
            type="button"
            variant="outline"
            disabled={editCountdown.running || editSendingCode || !editValue.trim()}
            onClick={handleSendEditCode}
            className="h-11 shrink-0 px-4 font-medium text-primary"
          >
            {editSendBtnLabel}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            {...buttonTap}
            onClick={() => saveEditMutation.mutate()}
            disabled={editSaving}
          >
            {editSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editSaving ? '保存中…' : '保存'}
          </Button>
          <Button type="button" variant="secondary" onClick={cancelEdit}>
            取消
          </Button>
        </div>
        {editMsg && (
          <p className={`text-sm ${editMsg.ok ? 'text-success' : 'text-error'}`}>{editMsg.text}</p>
        )}
      </div>
    ) : (
      <div className="flex items-center gap-3">
        <Input
          type="text"
          value={readOnlyValue}
          readOnly
          className={`${fieldClass} flex-1 cursor-not-allowed opacity-70`}
        />
        <Button type="button" variant="secondary" onClick={() => startEdit(target)}>
          修改
        </Button>
      </div>
    );

  return (
    <>
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="mx-auto max-w-2xl px-6 py-12"
      >
        <motion.h1
          variants={fadeUp}
          className="mb-8 text-2xl font-bold tracking-tight text-foreground"
        >
          个人资料
        </motion.h1>

        <div className="space-y-6">
          {/* 头像 */}
          <Section icon={<Camera className="h-4 w-4" />} title="头像">
            <div className="flex items-center gap-5">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-primary text-2xl font-semibold text-primary-foreground">
                {user.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.displayName || user.name}
                    className="h-20 w-20 rounded-full object-cover"
                  />
                ) : (
                  initial
                )}
              </div>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) avatarMutation.mutate(file);
                  }}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="secondary"
                  {...buttonTap}
                  disabled={avatarMutation.isPending}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {avatarMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {avatarMutation.isPending ? '上传中…' : '更换头像'}
                </Button>
                <p className="mt-2 text-xs text-ink-3">支持 JPG / PNG / WebP，最大 50MB</p>
              </div>
            </div>
            {avatarMsg && (
              <p className={`mt-3 text-sm ${avatarMsg.ok ? 'text-success' : 'text-error'}`}>
                {avatarMsg.text}
              </p>
            )}
          </Section>

          {/* 基本信息 */}
          <Section icon={<User className="h-4 w-4" />} title="基本信息">
            <Form {...profileForm}>
              <form
                onSubmit={profileForm.handleSubmit((v) => profileMutation.mutate(v))}
                className="space-y-3"
              >
                <FormField
                  control={profileForm.control}
                  name="displayName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-ink-2">昵称</FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          placeholder="输入昵称"
                          className={fieldClass}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ink-2">用户名</label>
                  <Input
                    type="text"
                    value={user.name}
                    readOnly
                    className={`${fieldClass} cursor-not-allowed opacity-70`}
                  />
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <Button type="submit" disabled={profileSaving} {...buttonTap}>
                    {profileSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                    <Save className="h-4 w-4" />
                    {profileSaving ? '保存中…' : '保存'}
                  </Button>
                  {profileMsg && (
                    <p className={`text-sm ${profileMsg.ok ? 'text-success' : 'text-error'}`}>
                      {profileMsg.text}
                    </p>
                  )}
                </div>
              </form>
            </Form>
          </Section>

          {/* 联系方式 */}
          <Section icon={<Mail className="h-4 w-4" />} title="联系方式">
            <div className="space-y-4">
              {/* 邮箱 */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-2">
                  <Mail className="h-3.5 w-3.5" />
                  邮箱
                </label>
                {renderEditArea('email', user.email || '未绑定')}
              </div>

              {/* 手机号 */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-2">
                  <Phone className="h-3.5 w-3.5" />
                  手机号
                </label>
                {renderEditArea('phone', user.phone || '未绑定')}
              </div>
            </div>
          </Section>

          {/* 修改密码 */}
          <Section icon={<KeyRound className="h-4 w-4" />} title="修改密码">
            <Form {...passwordForm}>
              <form
                onSubmit={passwordForm.handleSubmit((v) => passwordMutation.mutate(v))}
                className="space-y-3"
              >
                <FormField
                  control={passwordForm.control}
                  name="oldPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="旧密码"
                          autoComplete="current-password"
                          className={fieldClass}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={passwordForm.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="新密码"
                          autoComplete="new-password"
                          className={fieldClass}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={passwordForm.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="确认新密码"
                          autoComplete="new-password"
                          className={fieldClass}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex items-center gap-3 pt-1">
                  <Button type="submit" disabled={pwdSaving} {...buttonTap}>
                    {pwdSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                    {pwdSaving ? '修改中…' : '修改密码'}
                  </Button>
                  {pwdMsg && (
                    <p className={`text-sm ${pwdMsg.ok ? 'text-success' : 'text-error'}`}>
                      {pwdMsg.text}
                    </p>
                  )}
                </div>
              </form>
            </Form>
          </Section>
        </div>
      </motion.div>

      {/* 人机验证弹窗 */}
      {captchaModalOpen && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/40 px-4"
          onClick={() => setCaptchaModalOpen(false)}
        >
          <div
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
              <div id="profile-captcha" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
