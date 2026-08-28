import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Check, Eye, EyeOff, Loader2, X } from 'lucide-react';
import { useAliyunCaptcha } from '@/hooks/useAliyunCaptcha';
import { api } from '@/lib/api';
import { sendCodeBtnClass } from '@/components/ui';
import { buttonTap } from '@/lib/motion';
import type { CaptchaConfig } from '@/lib/auth';

type Step = 1 | 2 | 3;

const stepLabels = ['确认账号', '重置密码', '重置成功'];

const inputClass =
  'w-full h-11 rounded-md border border-input bg-card px-4 text-sm text-foreground transition-colors placeholder:text-ink-3 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-[var(--amll-primary-soft)]';

const primaryBtnClass =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60';

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
  const [step, setStep] = useState<Step>(1);
  const [dest, setDest] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
  } = useAliyunCaptcha(captchaConfig, 'reset-captcha', captchaModalOpen);

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

  // 倒计时
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // 实际发送验证码
  const sendCodeWithToken = useCallback(
    (token: string) => {
      setSendingCode(true);
      setError('');
      const checkType = dest.includes('@') ? 'email' : 'phone';
      api
        .sendCode({
          checkType,
          dest: dest.trim(),
          method: 'reset',
          captchaType: needCaptcha ? (captchaConfig?.type ?? '') : '',
          captchaToken: token,
        })
        .then(() => {
          setCountdown(60);
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
    [dest, needCaptcha, captchaConfig, reportCaptchaResult]
  );

  const handleSendCode = useCallback(() => {
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
      sendCodeWithToken('');
    }
  }, [dest, captchaLoading, needCaptcha, sendCodeWithToken]);

  // 人机验证完成后自动发送
  useEffect(() => {
    if (captchaVerifyParam && captchaModalOpen) {
      sendCodeWithToken(captchaVerifyParam);
    }
  }, [captchaVerifyParam, captchaModalOpen, sendCodeWithToken]);

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
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || !confirmPassword) {
      setError('请输入新密码和确认密码');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    if (!code.trim()) {
      setError('请输入验证码');
      return;
    }
    if (newPassword.length < 6) {
      setError('密码长度至少 6 位');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.forgotPassword(dest.trim(), code.trim(), newPassword);
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : '重置失败');
    } finally {
      setSubmitting(false);
    }
  };

  const sendBtnLabel = countdown > 0 ? `${countdown}s` : sendingCode ? '发送中…' : '获取验证码';

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
              <input
                type="text"
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                placeholder="手机号或邮箱"
                autoComplete="email"
                className={inputClass}
                autoFocus
              />
              {error && <p className="text-sm text-error">{error}</p>}
              <motion.button type="submit" {...buttonTap} className={primaryBtnClass}>
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
            <motion.form
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              onSubmit={handleReset}
              className="space-y-4"
            >
              {/* 新密码 */}
              <div>
                <label className="mb-1.5 block text-sm text-ink-2">新密码</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="请输入新密码"
                    autoComplete="new-password"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 transition-colors hover:text-ink-2"
                  >
                    {showNewPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* 确认密码 */}
              <div>
                <label className="mb-1.5 block text-sm text-ink-2">确认密码</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="请再次输入新密码"
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
                {confirmPassword && confirmPassword !== newPassword && (
                  <p className="mt-1.5 text-xs text-error">两次输入的密码不一致</p>
                )}
              </div>

              {/* 手机号/邮箱 */}
              <div>
                <label className="mb-1.5 block text-sm text-ink-2">手机号/邮箱</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={dest}
                    readOnly
                    className={`${inputClass} flex-1 bg-surface-2`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setCode('');
                      setCountdown(0);
                      setStep(1);
                    }}
                    className="inline-flex h-11 shrink-0 items-center justify-center rounded-md border border-input bg-card px-4 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2"
                  >
                    修改
                  </button>
                </div>
              </div>

              {/* 验证码 */}
              <div>
                <label className="mb-1.5 block text-sm text-ink-2">验证码</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="请输入验证码"
                    inputMode="numeric"
                    className={`${inputClass} flex-1`}
                  />
                  <button
                    type="button"
                    disabled={countdown > 0 || sendingCode || !dest.trim()}
                    onClick={handleSendCode}
                    className={sendCodeBtnClass}
                  >
                    {sendBtnLabel}
                  </button>
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
                {submitting ? '重置中…' : '确认重置'}
              </motion.button>
            </motion.form>
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
                <div id="reset-captcha" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
