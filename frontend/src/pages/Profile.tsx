import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Camera, Loader2, KeyRound, Mail, Phone, Save, User, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAliyunCaptcha } from '@/hooks/useAliyunCaptcha';
import { api } from '@/lib/api';
import { sendCodeBtnClass } from '@/components/ui';
import { buttonTap, fadeUp, staggerContainer } from '@/lib/motion';
import type { CaptchaConfig } from '@/lib/auth';

const inputClass =
  'w-full h-11 rounded-md border border-input bg-card px-4 text-sm text-foreground transition-colors placeholder:text-ink-3 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-[var(--amll-primary-soft)]';

const primaryBtnClass =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60';

const secondaryBtnClass =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md border border-input bg-card px-5 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 disabled:opacity-60';

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
      <div className="bg-card border border-line rounded-lg p-6">
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
          {icon}
          {title}
        </h2>
        {children}
      </div>
    </motion.div>
  );
}

type EditTarget = 'email' | 'phone' | null;

export function Profile() {
  const { user, refreshUser, openLogin } = useAuth();

  // 头像
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 基本信息
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 改密
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 邮箱/手机号修改
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [editValue, setEditValue] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editCountdown, setEditCountdown] = useState(0);
  const [editSendingCode, setEditSendingCode] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editMsg, setEditMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 人机验证
  const [captchaConfig, setCaptchaConfig] = useState<CaptchaConfig | null>(null);
  const [captchaModalOpen, setCaptchaModalOpen] = useState(false);
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

  // 拉取验证码配置（按需）
  useEffect(() => {
    if (captchaConfig) return;
    let cancelled = false;
    api
      .getCaptcha()
      .then((cfg) => {
        if (!cancelled) setCaptchaConfig(cfg);
      })
      .catch(() => {
        if (!cancelled) setCaptchaConfig({ type: 'none' });
      });
    return () => {
      cancelled = true;
    };
  }, [captchaConfig]);

  // 倒计时
  useEffect(() => {
    if (editCountdown <= 0) return;
    const timer = setTimeout(() => setEditCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [editCountdown]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    setAvatarMsg(null);
    try {
      await api.uploadAvatar(file);
      await refreshUser();
      setAvatarMsg({ ok: true, text: '头像更新成功' });
    } catch (err) {
      setAvatarMsg({
        ok: false,
        text: err instanceof Error ? err.message : '头像更新失败',
      });
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveProfile = async () => {
    if (!displayName.trim()) {
      setProfileMsg({ ok: false, text: '昵称不能为空' });
      return;
    }
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      await api.updateProfile({ displayName: displayName.trim() });
      await refreshUser();
      setProfileMsg({ ok: true, text: '资料保存成功' });
    } catch (err) {
      setProfileMsg({
        ok: false,
        text: err instanceof Error ? err.message : '保存失败',
      });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!oldPwd || !newPwd) {
      setPwdMsg({ ok: false, text: '请填写旧密码和新密码' });
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdMsg({ ok: false, text: '两次输入的新密码不一致' });
      return;
    }
    setPwdSaving(true);
    setPwdMsg(null);
    try {
      await api.changePassword(oldPwd, newPwd);
      setPwdMsg({ ok: true, text: '密码修改成功' });
      setOldPwd('');
      setNewPwd('');
      setConfirmPwd('');
    } catch (err) {
      setPwdMsg({
        ok: false,
        text: err instanceof Error ? err.message : '密码修改失败',
      });
    } finally {
      setPwdSaving(false);
    }
  };

  // ===== 邮箱/手机号修改 =====

  const startEdit = (target: EditTarget) => {
    setEditTarget(target);
    setEditValue('');
    setEditCode('');
    setEditCountdown(0);
    setEditMsg(null);
  };

  const cancelEdit = () => {
    setEditTarget(null);
    setEditValue('');
    setEditCode('');
    setEditCountdown(0);
    setEditMsg(null);
  };

  // 实际发送验证码
  const sendEditCodeWithToken = useCallback(
    (token: string) => {
      if (!editTarget || !editValue.trim()) return;
      setEditSendingCode(true);
      setEditMsg(null);
      const checkType = editTarget; // "email" | "phone"
      api
        .sendCode({
          checkType,
          dest: editValue.trim(),
          method: 'signup',
          captchaType: needCaptcha ? (captchaConfig?.type ?? '') : '',
          captchaToken: token,
        })
        .then(() => {
          setEditCountdown(60);
          reportCaptchaResult(true);
          setCaptchaModalOpen(false);
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : '验证码发送失败';
          if (msg.includes('认证服务') || msg.includes('不可用')) {
            setEditMsg({ ok: false, text: '人机验证失败，请重试' });
            reportCaptchaResult(false);
          } else {
            setEditMsg({ ok: false, text: msg });
            reportCaptchaResult(true);
            setCaptchaModalOpen(false);
          }
        })
        .finally(() => setEditSendingCode(false));
    },
    [editTarget, editValue, needCaptcha, captchaConfig, reportCaptchaResult]
  );

  // 点击发送验证码：先检查账号是否已存在
  const handleSendEditCode = useCallback(() => {
    if (!editTarget || !editValue.trim()) {
      setEditMsg({ ok: false, text: `请输入${editTarget === 'phone' ? '手机号' : '邮箱'}` });
      return;
    }
    setEditSendingCode(true);
    setEditMsg(null);
    api
      .checkUser({
        checkType: editTarget,
        dest: editValue.trim(),
        method: 'signup',
      })
      .then(() => {
        if (needCaptcha) {
          setCaptchaModalOpen(true);
        } else {
          sendEditCodeWithToken('');
        }
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : '校验失败';
        if (msg.includes('已存在')) {
          setEditMsg({
            ok: false,
            text: editTarget === 'phone' ? '该手机号已注册' : '该邮箱已注册',
          });
        } else {
          setEditMsg({ ok: false, text: msg });
        }
      })
      .finally(() => setEditSendingCode(false));
  }, [editTarget, editValue, needCaptcha, sendEditCodeWithToken]);

  // 人机验证完成后自动发送
  useEffect(() => {
    if (captchaVerifyParam && captchaModalOpen) {
      sendEditCodeWithToken(captchaVerifyParam);
    }
  }, [captchaVerifyParam, captchaModalOpen, sendEditCodeWithToken]);

  // 保存邮箱/手机号修改
  const handleSaveEdit = async () => {
    if (!editTarget || !editValue.trim() || !editCode.trim()) {
      setEditMsg({ ok: false, text: '请填写完整信息' });
      return;
    }
    setEditSaving(true);
    setEditMsg(null);
    try {
      if (editTarget === 'email') {
        await api.updateProfile({ email: editValue.trim(), code: editCode.trim() });
      } else {
        await api.updateProfile({ phone: editValue.trim(), phoneCode: editCode.trim() });
      }
      await refreshUser();
      setEditMsg({ ok: true, text: '修改成功' });
      setTimeout(cancelEdit, 1000);
    } catch (err) {
      setEditMsg({
        ok: false,
        text: err instanceof Error ? err.message : '修改失败',
      });
    } finally {
      setEditSaving(false);
    }
  };

  const editSendBtnLabel =
    editCountdown > 0 ? `${editCountdown}s` : editSendingCode ? '发送中…' : '获取验证码';

  // 未登录
  if (!user) {
    return (
      <div className="mx-auto max-w-[1200px] px-6 py-32 text-center">
        <h1 className="text-2xl font-bold tracking-tight">请先登录</h1>
        <p className="mt-3 text-ink-2">登录后可查看和管理个人资料</p>
        <motion.button
          type="button"
          onClick={() => openLogin()}
          {...buttonTap}
          className="mt-8 inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          去登录
        </motion.button>
      </div>
    );
  }

  const initial = (user.displayName || user.name || '?').charAt(0).toUpperCase();

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
                  onChange={handleAvatarChange}
                  className="hidden"
                />
                <motion.button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={avatarUploading}
                  {...buttonTap}
                  className={secondaryBtnClass}
                >
                  {avatarUploading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {avatarUploading ? '上传中…' : '更换头像'}
                </motion.button>
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
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-2">昵称</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="输入昵称"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-2">用户名</label>
                <input
                  type="text"
                  value={user.name}
                  readOnly
                  className={`${inputClass} cursor-not-allowed opacity-70`}
                />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <motion.button
                type="button"
                onClick={handleSaveProfile}
                disabled={profileSaving}
                {...buttonTap}
                className={primaryBtnClass}
              >
                {profileSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                <Save className="h-4 w-4" />
                {profileSaving ? '保存中…' : '保存'}
              </motion.button>
              {profileMsg && (
                <p className={`text-sm ${profileMsg.ok ? 'text-success' : 'text-error'}`}>
                  {profileMsg.text}
                </p>
              )}
            </div>
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
                {editTarget === 'email' ? (
                  <div className="space-y-2">
                    <input
                      type="email"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      placeholder="请输入新邮箱"
                      className={inputClass}
                    />
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editCode}
                        onChange={(e) => setEditCode(e.target.value)}
                        placeholder="验证码"
                        inputMode="numeric"
                        className={`${inputClass} flex-1`}
                      />
                      <button
                        type="button"
                        disabled={editCountdown > 0 || editSendingCode || !editValue.trim()}
                        onClick={handleSendEditCode}
                        className={sendCodeBtnClass}
                      >
                        {editSendBtnLabel}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <motion.button
                        type="button"
                        onClick={handleSaveEdit}
                        disabled={editSaving}
                        {...buttonTap}
                        className={primaryBtnClass}
                      >
                        {editSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                        {editSaving ? '保存中…' : '保存'}
                      </motion.button>
                      <button type="button" onClick={cancelEdit} className={secondaryBtnClass}>
                        取消
                      </button>
                    </div>
                    {editMsg && (
                      <p className={`text-sm ${editMsg.ok ? 'text-success' : 'text-error'}`}>
                        {editMsg.text}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <input
                      type="email"
                      value={user.email || '未绑定'}
                      readOnly
                      className={`${inputClass} flex-1 cursor-not-allowed opacity-70`}
                    />
                    <button
                      type="button"
                      onClick={() => startEdit('email')}
                      className={secondaryBtnClass}
                    >
                      修改
                    </button>
                  </div>
                )}
              </div>

              {/* 手机号 */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-2">
                  <Phone className="h-3.5 w-3.5" />
                  手机号
                </label>
                {editTarget === 'phone' ? (
                  <div className="space-y-2">
                    <input
                      type="tel"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      placeholder="请输入新手机号"
                      inputMode="tel"
                      className={inputClass}
                    />
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editCode}
                        onChange={(e) => setEditCode(e.target.value)}
                        placeholder="验证码"
                        inputMode="numeric"
                        className={`${inputClass} flex-1`}
                      />
                      <button
                        type="button"
                        disabled={editCountdown > 0 || editSendingCode || !editValue.trim()}
                        onClick={handleSendEditCode}
                        className={sendCodeBtnClass}
                      >
                        {editSendBtnLabel}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <motion.button
                        type="button"
                        onClick={handleSaveEdit}
                        disabled={editSaving}
                        {...buttonTap}
                        className={primaryBtnClass}
                      >
                        {editSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                        {editSaving ? '保存中…' : '保存'}
                      </motion.button>
                      <button type="button" onClick={cancelEdit} className={secondaryBtnClass}>
                        取消
                      </button>
                    </div>
                    {editMsg && (
                      <p className={`text-sm ${editMsg.ok ? 'text-success' : 'text-error'}`}>
                        {editMsg.text}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <input
                      type="tel"
                      value={user.phone || '未绑定'}
                      readOnly
                      className={`${inputClass} flex-1 cursor-not-allowed opacity-70`}
                    />
                    <button
                      type="button"
                      onClick={() => startEdit('phone')}
                      className={secondaryBtnClass}
                    >
                      修改
                    </button>
                  </div>
                )}
              </div>
            </div>
          </Section>

          {/* 修改密码 */}
          <Section icon={<KeyRound className="h-4 w-4" />} title="修改密码">
            <div className="space-y-3">
              <input
                type="password"
                value={oldPwd}
                onChange={(e) => setOldPwd(e.target.value)}
                placeholder="旧密码"
                autoComplete="current-password"
                className={inputClass}
              />
              <input
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="新密码"
                autoComplete="new-password"
                className={inputClass}
              />
              <input
                type="password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="确认新密码"
                autoComplete="new-password"
                className={inputClass}
              />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <motion.button
                type="button"
                onClick={handleChangePassword}
                disabled={pwdSaving}
                {...buttonTap}
                className={primaryBtnClass}
              >
                {pwdSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {pwdSaving ? '修改中…' : '修改密码'}
              </motion.button>
              {pwdMsg && (
                <p className={`text-sm ${pwdMsg.ok ? 'text-success' : 'text-error'}`}>
                  {pwdMsg.text}
                </p>
              )}
            </div>
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
