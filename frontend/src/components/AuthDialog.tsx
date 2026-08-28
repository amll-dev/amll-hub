import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Eye, EyeOff, Loader2, Mail, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAliyunCaptcha } from '@/hooks/useAliyunCaptcha';
import { api } from '@/lib/api';
import { buttonTap } from '@/lib/motion';
import type { CaptchaConfig } from '@/lib/auth';

type Tab = 'password' | 'code';

/** 占位二维码*/
function PlaceholderQR() {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    void import('qrcode')
      .then((QRCode) =>
        QRCode.default.toDataURL('amll-hub-login-placeholder', {
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

  const [tab, setTab] = useState<Tab>('password');
  const [forgotOpen, setForgotOpen] = useState(false);
  // 验证码登录类型：phone / email
  const [codeType, setCodeType] = useState<'phone' | 'email'>('phone');

  const tabItems: { key: Tab; label: string }[] = [
    { key: 'password', label: '密码登录' },
    { key: 'code', label: '短信登录' },
  ];
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [dest, setDest] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 验证码相关
  const [captchaConfig, setCaptchaConfig] = useState<CaptchaConfig | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [captchaModalOpen, setCaptchaModalOpen] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);

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
    setUsername('');
    setPassword('');
    setShowPassword(false);
    setDest('');
    setCode('');
    setError('');
    setCaptchaConfig(null);
    setCaptchaModalOpen(false);
    setCountdown(0);
    setSubmitting(false);
    setSendingCode(false);
  }, []);

  const handleClose = useCallback(() => {
    closeLogin();
    setTimeout(resetForm, 250);
  }, [closeLogin, resetForm]);

  const handleForgotOption1 = useCallback(() => {
    setForgotOpen(false);
    setTab('code');
    setError('');
  }, []);

  const handleForgotOption2 = useCallback(() => {
    handleClose();
    navigate('/reset-password');
  }, [handleClose, navigate]);

  // 切到短信登录 Tab 时拉取验证码配置
  useEffect(() => {
    if (!loginOpen || tab !== 'code' || captchaConfig) return;
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
  }, [loginOpen, tab, captchaConfig]);

  // 倒计时
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // 实际发送验证码的 API 调用
  const sendCodeWithToken = useCallback(
    (token: string) => {
      setSendingCode(true);
      setError('');
      api
        .sendCode({
          checkType: codeType,
          dest: dest.trim(),
          method: 'login',
          captchaType: needCaptcha ? (captchaConfig?.type ?? '') : '',
          captchaToken: token,
        })
        .then(() => {
          setCountdown(60);
          // 告诉 SDK 验证成功，关闭弹窗
          reportCaptchaResult(true);
          setCaptchaModalOpen(false);
        })
        .catch((e: unknown) => {
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
        })
        .finally(() => setSendingCode(false));
    },
    [codeType, dest, needCaptcha, captchaConfig, reportCaptchaResult]
  );

  // 点击"获取验证码"后先检查账号存在性，通过后再做人机验证
  const handleSendCode = useCallback(() => {
    if (!dest.trim()) {
      setError(codeType === 'phone' ? '请输入手机号' : '请输入邮箱');
      return;
    }
    if (captchaLoading) {
      setError('正在加载验证码配置，请稍候');
      return;
    }
    setSendingCode(true);
    setError('');
    // 检查账号是否存在
    api
      .checkUser({
        checkType: codeType,
        dest: dest.trim(),
        method: 'login',
      })
      .then(() => {
        // 账号存在，打开人机验证弹窗
        if (needCaptcha) {
          setCaptchaModalOpen(true);
        } else {
          // 无需人机验证，直接发送
          sendCodeWithToken('');
        }
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : '校验失败';
        if (msg.includes('未注册')) {
          setError(
            codeType === 'phone'
              ? '该手机号未绑定账号，请前往注册或绑定'
              : '该邮箱未绑定账号，请前往注册或绑定'
          );
        } else {
          setError(msg);
        }
      })
      .finally(() => setSendingCode(false));
  }, [dest, codeType, captchaLoading, needCaptcha, sendCodeWithToken]);

  // 人机验证完成后自动发送验证码
  useEffect(() => {
    if (captchaVerifyParam && captchaModalOpen) {
      sendCodeWithToken(captchaVerifyParam);
    }
  }, [captchaVerifyParam, captchaModalOpen, sendCodeWithToken]);

  // 密码登录
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const result = await api.login(username.trim(), password);
      login(result.token, result.user);
      finishLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 验证码登录
  const handleCodeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dest.trim() || !code.trim()) {
      setError('请输入手机号和验证码');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const result = await api.loginByCode(dest.trim(), code.trim());
      login(result.token, result.user);
      finishLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  /** 登录成功收尾：关闭弹窗；若带了跳转目标（点击需登录功能进入），自动前往 */
  const finishLogin = () => {
    handleClose();
    if (loginRedirect) {
      navigate(loginRedirect);
      clearLoginRedirect();
    }
  };

  // ESC 关闭
  useEffect(() => {
    if (!loginOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [loginOpen, handleClose]);

  const sendBtnLabel = countdown > 0 ? `${countdown}s` : sendingCode ? '发送中…' : '获取验证码';

  return (
    <>
      <AnimatePresence>
        {loginOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 px-4"
            onClick={handleClose}
          >
            <motion.div
              initial={{ scale: 0.96, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="relative flex w-full max-w-[720px] overflow-hidden rounded-xl border border-line bg-card shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 关闭按钮 */}
              <button
                type="button"
                onClick={handleClose}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-surface-2"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>

              {/* 左侧：二维码登录 */}
              <div className="hidden w-[280px] flex-col items-center justify-center gap-4 border-r border-line bg-surface-2 p-6 md:flex">
                <h4 className="text-base font-semibold text-foreground">扫描二维码登录</h4>
                <PlaceholderQR />
                <p className="text-center text-xs leading-relaxed text-ink-2">
                  请使用 AMLLHub 客户端
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
                    <motion.form
                      key="password-form"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15, ease: 'easeOut' }}
                      onSubmit={handlePasswordLogin}
                      className="flex flex-1 flex-col"
                    >
                      <div>
                        <label className="flex items-center gap-3 border-b border-line py-3">
                          <span className="w-12 shrink-0 text-sm text-ink-2">账号</span>
                          <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="请输入用户名"
                            autoComplete="username"
                            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-ink-3"
                          />
                        </label>
                        <label className="flex items-center gap-3 border-b border-line py-3">
                          <span className="w-12 shrink-0 text-sm text-ink-2">密码</span>
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="请输入密码"
                            autoComplete="current-password"
                            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-ink-3"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className="text-ink-3 transition-colors hover:text-ink-2"
                            aria-label={showPassword ? '隐藏密码' : '显示密码'}
                          >
                            {showPassword ? (
                              <Eye className="h-4 w-4" />
                            ) : (
                              <EyeOff className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            className="whitespace-nowrap text-xs text-primary hover:underline"
                            onClick={() => setForgotOpen(true)}
                          >
                            忘记密码?
                          </button>
                        </label>
                      </div>

                      {error && <p className="mt-3 text-sm text-error">{error}</p>}

                      <div className="mt-auto space-y-3 pt-6">
                        <div className="flex gap-3">
                          <motion.button
                            type="button"
                            {...buttonTap}
                            onClick={() => {
                              handleClose();
                              navigate('/register');
                            }}
                            className="inline-flex h-11 flex-1 items-center justify-center rounded-md border border-input bg-card text-sm font-semibold text-foreground transition-colors hover:bg-surface-2"
                          >
                            注册
                          </motion.button>
                          <motion.button
                            type="submit"
                            disabled={submitting}
                            {...buttonTap}
                            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
                          >
                            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                            {submitting ? '登录中…' : '登录'}
                          </motion.button>
                        </div>
                      </div>
                    </motion.form>
                  )}

                  {/* 短信登录表单*/}
                  {tab === 'code' && (
                    <motion.form
                      key="code-form"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15, ease: 'easeOut' }}
                      onSubmit={handleCodeLogin}
                      className="flex flex-1 flex-col"
                    >
                      <div>
                        {/* {手机号|邮箱} + 获取验证码*/}
                        <label className="flex items-center gap-3 border-b border-line py-3">
                          <span className="w-12 shrink-0 text-sm text-ink-2">
                            {codeType === 'phone' ? '手机号' : '邮箱'}
                          </span>
                          <input
                            type={codeType === 'phone' ? 'text' : 'email'}
                            value={dest}
                            onChange={(e) => setDest(e.target.value)}
                            placeholder={codeType === 'phone' ? '请输入手机号' : '请输入邮箱'}
                            autoComplete={codeType === 'phone' ? 'tel' : 'email'}
                            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-ink-3"
                          />
                          <button
                            type="button"
                            disabled={countdown > 0 || sendingCode || !dest.trim()}
                            onClick={handleSendCode}
                            className="shrink-0 whitespace-nowrap text-xs font-medium text-primary transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {sendBtnLabel}
                          </button>
                        </label>

                        {/* 验证码 */}
                        <label className="flex items-center gap-3 border-b border-line py-3">
                          <span className="w-12 shrink-0 text-sm text-ink-2">验证码</span>
                          <input
                            type="text"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            placeholder="请输入验证码"
                            inputMode="numeric"
                            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-ink-3"
                          />
                        </label>
                      </div>

                      {error && <p className="mt-3 text-sm text-error">{error}</p>}

                      <div className="mt-auto space-y-3 pt-6">
                        <div className="flex gap-3">
                          <motion.button
                            type="button"
                            {...buttonTap}
                            onClick={() => {
                              handleClose();
                              navigate('/register');
                            }}
                            className="inline-flex h-11 flex-1 items-center justify-center rounded-md border border-input bg-card text-sm font-semibold text-foreground transition-colors hover:bg-surface-2"
                          >
                            注册
                          </motion.button>
                          <motion.button
                            type="submit"
                            disabled={submitting}
                            {...buttonTap}
                            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
                          >
                            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                            {submitting ? '登录中…' : '登录'}
                          </motion.button>
                        </div>
                      </div>
                    </motion.form>
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
                        setDest('');
                        setCode('');
                        setCountdown(0);
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
