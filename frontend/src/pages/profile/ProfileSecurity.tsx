import { useState } from 'react';
import { useAtom } from 'jotai';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { KeyRound, Loader2, Mail, Phone } from 'lucide-react';
import { z } from 'zod';
import {
  editCodeAtom,
  editMsgAtom,
  editTargetAtom,
  editValueAtom,
  pwdMsgAtom,
  type EditTarget,
} from '@/atoms/profileForm';
import { useAuth } from '@/hooks/useAuth';
import { useCountdown } from '@/hooks/useCountdown';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { buttonTap, staggerContainer } from '@/lib/motion';
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
import { SectionCard } from '@/components/profile/SectionCard';
import { CaptchaProvider } from '@/components/profile/CaptchaProvider';
import { useCaptcha } from '@/components/profile/captchaContext';
import { IdentityVerifyPanel } from '@/components/profile/IdentityVerifyPanel';
import { fieldClass, useResetProfileForm } from './shared';
import { usePlayProfileIntro } from './intro';

/** 倒计时展示成 mm:ss */
function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const passwordSchema = z
  .object({
    newPassword: z.string().min(6, '密码长度至少 6 位'),
    confirmPassword: z.string().min(1, '请确认新密码'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: '两次输入的新密码不一致',
    path: ['confirmPassword'],
  });
type PasswordValues = z.infer<typeof passwordSchema>;

/** 单个联系方式 / 密码的修改流程阶段 */
type Stage = 'idle' | 'verify' | 'edit';

/**
 * 账号安全
 *
 * 人机验证由页面级 CaptchaProvider 独占（阿里云 SDK 是页面单例），
 * 所以本组件只负责业务流程，实现体在下面的 ProfileSecurityContent。
 */
export function ProfileSecurity() {
  return (
    <CaptchaProvider>
      <ProfileSecurityContent />
    </CaptchaProvider>
  );
}

function ProfileSecurityContent() {
  const { user, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const playIntro = usePlayProfileIntro();
  useResetProfileForm();

  // 每个字段独立的流程阶段，互不干扰
  const [stages, setStages] = useState<Record<'email' | 'phone' | 'password', Stage>>({
    email: 'idle',
    phone: 'idle',
    password: 'idle',
  });
  const setStage = (key: 'email' | 'phone' | 'password', stage: Stage) =>
    setStages((prev) => ({ ...prev, [key]: stage }));

  // ===== 修改密码 =====
  const [pwdMsg, setPwdMsg] = useAtom(pwdMsgAtom);
  const passwordForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });
  const passwordMutation = useMutation({
    // 凭证已由验证环节在后端签发，这里只需带新密码
    mutationFn: (vars: PasswordValues) => api.changePassword('', vars.newPassword),
    onMutate: () => setPwdMsg(null),
    onSuccess: () => {
      setPwdMsg({ ok: true, text: '密码修改成功' });
      passwordForm.reset();
      setStage('password', 'idle');
      // 凭证已一次性作废，后台刷新状态即可
      queryClient.invalidateQueries({ queryKey: queryKeys.identity });
    },
    onError: (e: Error) => {
      setPwdMsg({ ok: false, text: e.message || '密码修改失败' });
      // 凭证可能已过期，刷新状态让 UI 回到「需验证」
      queryClient.invalidateQueries({ queryKey: queryKeys.identity });
    },
  });
  const pwdSaving = passwordMutation.isPending;

  // ===== 联系方式 =====
  const [editTarget, setEditTarget] = useAtom(editTargetAtom);
  const [editValue, setEditValue] = useAtom(editValueAtom);
  const [editCode, setEditCode] = useAtom(editCodeAtom);
  const [editMsg, setEditMsg] = useAtom(editMsgAtom);
  const editCountdown = useCountdown();
  const { needCaptcha, captchaType, requestCaptcha, closeCaptcha, reportResult } = useCaptcha();

  const startEdit = (target: Exclude<EditTarget, null>) => {
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
    if (editTarget) setStage(editTarget, 'idle');
  };

  const sendEditCodeMutation = useMutation({
    mutationFn: (token: string) => {
      if (!editTarget) throw new Error('未选择修改项');
      return api.sendCode({
        checkType: editTarget,
        dest: editValue.trim(),
        // method 必须是 reset：Casdoor 在 reset 分支才会把验证码关联到「当前登录用户」，
        // 之后由 reset-email-or-phone 用新地址校验并落库
        method: 'reset',
        captchaType,
        captchaToken: token,
      });
    },
    onMutate: () => setEditMsg(null),
    onSuccess: () => {
      editCountdown.start(60);
      reportResult(true);
      closeCaptcha();
    },
    onError: (e: Error) => {
      const msg = e.message || '验证码发送失败';
      // 只有人机验证本身没通过才保留弹窗；其余（未配短信服务、频率限制等）
      // 直接展示后端给出的真实原因并关掉弹窗
      if (msg.includes('人机验证')) reportResult(false);
      else {
        setEditMsg({ ok: false, text: msg });
        reportResult(true);
        closeCaptcha();
      }
    },
  });
  const editSendingCode = sendEditCodeMutation.isPending;

  // 点击发送验证码：先检查新地址是否已被占用
  const checkUserMutation = useMutation({
    mutationFn: () => {
      if (!editTarget) throw new Error('未选择修改项');
      return api.checkUser({ checkType: editTarget, dest: editValue.trim(), method: 'signup' });
    },
    onMutate: () => setEditMsg(null),
    onSuccess: () => {
      if (needCaptcha) requestCaptcha((token) => sendEditCodeMutation.mutate(token));
      else sendEditCodeMutation.mutate('');
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

  const saveEditMutation = useMutation({
    mutationFn: () => {
      if (!editTarget) throw new Error('未选择修改项');
      return editTarget === 'email'
        ? api.updateProfile({ email: editValue.trim(), code: editCode.trim() })
        : api.updateProfile({ phone: editValue.trim(), phoneCode: editCode.trim() });
    },
    onMutate: () => setEditMsg(null),
    onSuccess: () => {
      // 先给反馈再刷新：refreshUser / identity 都要走一次 Casdoor 往返，
      // await 完才提示会让「修改」按钮看起来卡住。
      setEditMsg({ ok: true, text: '修改成功' });
      setTimeout(cancelEdit, 1000);
      refreshUser();
      queryClient.invalidateQueries({ queryKey: queryKeys.identity });
    },
    onError: (e: Error) => {
      setEditMsg({ ok: false, text: e.message || '修改失败' });
      queryClient.invalidateQueries({ queryKey: queryKeys.identity });
    },
  });
  const editSaving = saveEditMutation.isPending;

  const editSendBtnLabel = editCountdown.running
    ? formatCountdown(editCountdown.count)
    : editSendingCode
      ? '发送中…'
      : '获取验证码';

  if (!user) return null;

  /**
   * 单个联系方式的整块内容：只读 / 验证 / 修改 三态。
   * 关键点：验证通过后 onVerified 直接把阶段推进到 edit，不跳页。
   */
  const renderContactRow = (target: 'email' | 'phone', label: string, Icon: typeof Mail) => {
    const stage = stages[target];
    const readOnlyValue = target === 'email' ? user.email || '未绑定' : user.phone || '未绑定';

    return (
      <div>
        <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-2">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </label>

        {stage === 'idle' && (
          <div className="flex items-center gap-3">
            <Input
              type="text"
              value={readOnlyValue}
              readOnly
              className={`${fieldClass} flex-1 cursor-not-allowed opacity-70`}
            />
            <Button type="button" variant="secondary" onClick={() => setStage(target, 'verify')}>
              修改
            </Button>
          </div>
        )}

        {stage === 'verify' && (
          <IdentityVerifyPanel
            phone={user.phone}
            email={user.email}
            onVerified={() => {
              startEdit(target);
              setStage(target, 'edit');
            }}
            onCancel={() => setStage(target, 'idle')}
          />
        )}

        {stage === 'edit' && (
          <div className="space-y-2">
            <Input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder={target === 'email' ? '请输入新邮箱' : '请输入新号码'}
              className={fieldClass}
            />
            <div className="flex gap-2">
              <Input
                type="text"
                value={editCode}
                onChange={(e) => setEditCode(e.target.value)}
                placeholder={target === 'email' ? '新邮箱收到的验证码' : '新号码收到的验证码'}
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
                {editSaving ? '提交中…' : '修改'}
              </Button>
              <Button type="button" variant="secondary" onClick={cancelEdit}>
                取消
              </Button>
            </div>
            {editMsg && (
              <p className={`text-sm ${editMsg.ok ? 'text-success' : 'text-error'}`}>
                {editMsg.text}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <motion.div
      variants={staggerContainer}
      initial={playIntro ? 'hidden' : false}
      animate="show"
      className="space-y-6"
    >
      <SectionCard icon={<Mail />} title="联系方式">
        <div className="space-y-5">
          {renderContactRow('email', '邮箱', Mail)}
          {renderContactRow('phone', '手机号', Phone)}
        </div>
      </SectionCard>

      <SectionCard icon={<KeyRound />} title="登录密码">
        {stages.password === 'idle' && (
          <div className="flex items-center gap-3">
            <Input
              type="password"
              value="••••••••"
              readOnly
              className={`${fieldClass} flex-1 cursor-not-allowed opacity-70`}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => setStage('password', 'verify')}
            >
              修改
            </Button>
          </div>
        )}

        {stages.password === 'verify' && (
          <IdentityVerifyPanel
            onVerified={() => setStage('password', 'edit')}
            onCancel={() => setStage('password', 'idle')}
          />
        )}

        {stages.password === 'edit' && (
          <Form {...passwordForm}>
            <form
              onSubmit={passwordForm.handleSubmit((v) => passwordMutation.mutate(v))}
              className="max-w-md space-y-4"
            >
              <FormField
                control={passwordForm.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-ink-2">新密码</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="新密码，至少 6 位"
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
                    <FormLabel className="text-sm font-medium text-ink-2">确认新密码</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="再次输入新密码"
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
                  <KeyRound className="h-4 w-4" />
                  {pwdSaving ? '修改中…' : '修改密码'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setStage('password', 'idle');
                    passwordForm.reset();
                    setPwdMsg(null);
                  }}
                >
                  取消
                </Button>
                {pwdMsg && (
                  <p className={`text-sm ${pwdMsg.ok ? 'text-success' : 'text-error'}`}>
                    {pwdMsg.text}
                  </p>
                )}
              </div>
            </form>
          </Form>
        )}
      </SectionCard>
    </motion.div>
  );
}
