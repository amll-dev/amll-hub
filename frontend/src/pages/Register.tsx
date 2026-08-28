import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Camera, Eye, EyeOff, Loader2, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAliyunCaptcha } from '@/hooks/useAliyunCaptcha';
import { api } from '@/lib/api';
import { sendCodeBtnClass } from '@/components/ui';
import { buttonTap } from '@/lib/motion';
import type { CaptchaConfig } from '@/lib/auth';

const inputClass =
  'w-full h-11 rounded-md border border-input bg-card px-4 text-sm text-foreground transition-colors placeholder:text-ink-3 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-[var(--amll-primary-soft)]';

const primaryBtnClass =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60';

export function Register() {
  const navigate = useNavigate();
  const { login } = useAuth();

  // 表单字段
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 验证码相关
  const [captchaConfig, setCaptchaConfig] = useState<CaptchaConfig | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [captchaModalOpen, setCaptchaModalOpen] = useState(false);
  // 记录当前是给哪个目标发送验证码："phone" | "email"
  const [captchaTarget, setCaptchaTarget] = useState<'phone' | 'email'>('phone');
  const [phoneCountdown, setPhoneCountdown] = useState(0);
  const [emailCountdown, setEmailCountdown] = useState(0);
  const [sendingPhoneCode, setSendingPhoneCode] = useState(false);
  const [sendingEmailCode, setSendingEmailCode] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  // 拉取验证码配置
  useEffect(() => {
    if (captchaConfig) return;
    let cancelled = false;
    setCaptchaLoading(true);
    api
      .getCaptcha()
      .then((cfg) => {
        if (!cancelled) setCaptchaConfig(cfg);
      })
      .catch(() => {
        if (!cancelled) setCaptchaConfig({ type: 'none' });
      })
      .finally(() => {
        if (!cancelled) setCaptchaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [captchaConfig]);

  // 倒计时（手机）
  useEffect(() => {
    if (phoneCountdown <= 0) return;
    const timer = setTimeout(() => setPhoneCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [phoneCountdown]);

  // 倒计时（邮箱）
  useEffect(() => {
    if (emailCountdown <= 0) return;
    const timer = setTimeout(() => setEmailCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [emailCountdown]);

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

  // 实际发送验证码
  const sendCodeWithToken = useCallback(
    (token: string) => {
      const target = captchaTarget;
      const handleSuccess = () => {
        reportCaptchaResult(true);
        setCaptchaModalOpen(false);
      };
      const handleError = (e: unknown) => {
        const msg = e instanceof Error ? e.message : '验证码发送失败';
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
      };
      if (target === 'phone') {
        setSendingPhoneCode(true);
        setError('');
        api
          .sendCode({
            checkType: 'phone',
            dest: phone.trim(),
            method: 'signup',
            captchaType: needCaptcha ? (captchaConfig?.type ?? '') : '',
            captchaToken: token,
          })
          .then(() => {
            setPhoneCountdown(60);
            handleSuccess();
          })
          .catch(handleError)
          .finally(() => setSendingPhoneCode(false));
      } else {
        setSendingEmailCode(true);
        setError('');
        api
          .sendCode({
            checkType: 'email',
            dest: email.trim(),
            method: 'signup',
            captchaType: needCaptcha ? (captchaConfig?.type ?? '') : '',
            captchaToken: token,
          })
          .then(() => {
            setEmailCountdown(60);
            handleSuccess();
          })
          .catch(handleError)
          .finally(() => setSendingEmailCode(false));
      }
    },
    [captchaTarget, phone, email, needCaptcha, captchaConfig, reportCaptchaResult]
  );

  // 点击发送手机验证码：先检查账号是否已注册
  const handleSendPhoneCode = useCallback(() => {
    if (!phone.trim()) {
      setError('请先输入手机号');
      return;
    }
    if (captchaLoading) {
      setError('正在加载验证码配置，请稍候');
      return;
    }
    setCaptchaTarget('phone');
    setSendingPhoneCode(true);
    setError('');
    // 1. 先检查账号是否已存在（不需要人机验证）
    api
      .checkUser({
        checkType: 'phone',
        dest: phone.trim(),
        method: 'signup',
      })
      .then(() => {
        // 2. 账号不存在，可以注册，打开人机验证弹窗
        if (needCaptcha) {
          setCaptchaModalOpen(true);
        } else {
          sendCodeWithToken('');
        }
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : '校验失败';
        if (msg.includes('已存在')) {
          setError('该手机号已注册，请直接登录');
        } else {
          setError(msg);
        }
      })
      .finally(() => setSendingPhoneCode(false));
  }, [phone, captchaLoading, needCaptcha, sendCodeWithToken]);

  // 点击发送邮箱验证码：先检查账号是否已注册
  const handleSendEmailCode = useCallback(() => {
    if (!email.trim()) {
      setError('请先输入邮箱');
      return;
    }
    if (captchaLoading) {
      setError('正在加载验证码配置，请稍候');
      return;
    }
    setCaptchaTarget('email');
    setSendingEmailCode(true);
    setError('');
    api
      .checkUser({
        checkType: 'email',
        dest: email.trim(),
        method: 'signup',
      })
      .then(() => {
        if (needCaptcha) {
          setCaptchaModalOpen(true);
        } else {
          sendCodeWithToken('');
        }
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : '校验失败';
        if (msg.includes('已存在')) {
          setError('该邮箱已注册，请直接登录');
        } else {
          setError(msg);
        }
      })
      .finally(() => setSendingEmailCode(false));
  }, [email, captchaLoading, needCaptcha, sendCodeWithToken]);

  // 人机验证完成后自动发送（弹窗保持打开，发送成功后才关闭）
  useEffect(() => {
    if (captchaVerifyParam && captchaModalOpen) {
      sendCodeWithToken(captchaVerifyParam);
    }
  }, [captchaVerifyParam, captchaModalOpen, sendCodeWithToken]);

  // 提交注册
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('请输入用户名');
      return;
    }
    if (!displayName.trim()) {
      setError('请输入显示名称');
      return;
    }
    if (!password) {
      setError('请输入密码');
      return;
    }
    if (password.length < 6) {
      setError('密码长度至少 6 位');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    if (!phone.trim()) {
      setError('请输入手机号');
      return;
    }
    if (!phoneCode.trim()) {
      setError('请输入手机验证码');
      return;
    }
    if (!email.trim()) {
      setError('请输入邮箱');
      return;
    }
    if (!emailCode.trim()) {
      setError('请输入邮箱验证码');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      // 1. 注册
      await api.register({
        username: username.trim(),
        password,
        phone: phone.trim(),
        code: phoneCode.trim(),
        email: email.trim(),
        emailCode: emailCode.trim(),
        displayName: displayName.trim(),
      });
      // 2. 自动登录（用用户名+密码）
      try {
        const result = await api.login(username.trim(), password);
        login(result.token, result.user);
        // 3. 如果选了头像，上传
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
    } catch (e) {
      setError(e instanceof Error ? e.message : '注册失败');
    } finally {
      setSubmitting(false);
    }
  };

  const phoneBtnLabel =
    phoneCountdown > 0 ? `${phoneCountdown}s` : sendingPhoneCode ? '发送中…' : '获取验证码';

  const emailBtnLabel =
    emailCountdown > 0 ? `${emailCountdown}s` : sendingEmailCode ? '发送中…' : '获取验证码';

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="rounded-xl border border-line bg-card p-8 shadow-sm">
        <h1 className="mb-6 text-center text-2xl font-bold tracking-tight text-foreground">
          注册账号
        </h1>

        <form onSubmit={handleRegister} className="space-y-5">
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
            <div>
              <label className="mb-1.5 block text-sm text-ink-2">用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                autoComplete="username"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-ink-2">显示名称</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="请输入显示名称"
                className={inputClass}
              />
            </div>
          </div>

          {/* 两列布局：密码 + 确认密码 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm text-ink-2">密码</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 6 位"
                  autoComplete="new-password"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 transition-colors hover:text-ink-2"
                >
                  {showPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-ink-2">确认密码</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="请再次输入密码"
                  autoComplete="new-password"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 transition-colors hover:text-ink-2"
                >
                  {showConfirmPassword ? (
                    <Eye className="h-4 w-4" />
                  ) : (
                    <EyeOff className="h-4 w-4" />
                  )}
                </button>
              </div>
              {confirmPassword && confirmPassword !== password && (
                <p className="mt-1.5 text-xs text-error">两次输入的密码不一致</p>
              )}
            </div>
          </div>

          {/* 手机号 + 手机验证码 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm text-ink-2">手机号</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="请输入手机号"
                autoComplete="tel"
                inputMode="tel"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-ink-2">手机验证码</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={phoneCode}
                  onChange={(e) => setPhoneCode(e.target.value)}
                  placeholder="短信验证码"
                  inputMode="numeric"
                  className={`${inputClass} flex-1`}
                />
                <button
                  type="button"
                  disabled={phoneCountdown > 0 || sendingPhoneCode || !phone.trim()}
                  onClick={handleSendPhoneCode}
                  className={sendCodeBtnClass}
                >
                  {phoneBtnLabel}
                </button>
              </div>
            </div>
          </div>

          {/* 邮箱 + 邮箱验证码 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm text-ink-2">邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="请输入邮箱"
                autoComplete="email"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-ink-2">邮箱验证码</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value)}
                  placeholder="邮件验证码"
                  inputMode="numeric"
                  className={`${inputClass} flex-1`}
                />
                <button
                  type="button"
                  disabled={emailCountdown > 0 || sendingEmailCode || !email.trim()}
                  onClick={handleSendEmailCode}
                  className={sendCodeBtnClass}
                >
                  {emailBtnLabel}
                </button>
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <motion.button
            type="submit"
            disabled={submitting}
            {...buttonTap}
            className={primaryBtnClass}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? '注册中…' : '注册'}
          </motion.button>

          <Link
            to="/"
            className="flex items-center justify-center gap-1 text-sm text-ink-3 transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            返回主页
          </Link>
        </form>
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
