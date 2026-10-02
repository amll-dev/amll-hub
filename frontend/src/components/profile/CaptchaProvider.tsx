import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAliyunCaptcha } from '@/hooks/useAliyunCaptcha';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import type { CaptchaConfig } from '@/lib/auth';
import { CaptchaModal } from './CaptchaModal';
import { CaptchaContext } from './captchaContext';

/** 全页唯一的阿里云验证码挂载点 id  */
const SCENE_ID = 'profile-captcha';

/** 兜底配置：用常量引用，避免每次渲染都产生新对象把 useAliyunCaptcha 的 effect 打断 */
const NO_CAPTCHA: CaptchaConfig = { type: 'none' };

// 人机验证宿主。
export function CaptchaProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  /** 等待 token 的回调，同一时刻只有一个 */
  const pendingRef = useRef<((token: string) => void) | null>(null);

  const captchaQuery = useQuery({
    queryKey: queryKeys.captcha,
    queryFn: () => api.getCaptcha(),
    staleTime: 30 * 60_000,
    retry: false,
  });
  // useMemo 很关键：captchaConfig 引用变化会让 useAliyunCaptcha 的 effect 重跑（destroy + 重新 init）
  const captchaConfig = useMemo<CaptchaConfig>(() => {
    if (captchaQuery.isError || !captchaQuery.data) return NO_CAPTCHA;
    return captchaQuery.data;
  }, [captchaQuery.isError, captchaQuery.data]);

  // enabled 恒 true：SDK 只在挂载时初始化一次，后续开关弹窗不重新初始化
  const { captchaVerifyParam, isReady, reportResult } = useAliyunCaptcha(
    captchaConfig,
    SCENE_ID,
    true
  );
  const needCaptcha =
    !!captchaConfig.type && captchaConfig.type !== 'none' && captchaConfig.type !== 'default';
  const captchaType = needCaptcha ? captchaConfig.type : '';

  const requestCaptcha = useCallback((onToken: (token: string) => void) => {
    pendingRef.current = onToken;
    setOpen(true);
  }, []);

  const closeCaptcha = useCallback(() => {
    setOpen(false);
    pendingRef.current = null;
  }, []);

  // 验证通过：把 token 交给发起方。
  useEffect(() => {
    if (!captchaVerifyParam) return;
    const onToken = pendingRef.current;
    if (!onToken) {
      console.warn('[captcha] 收到 token 但没有等待中的发起方，已丢弃');
      return;
    }
    onToken(captchaVerifyParam);
  }, [captchaVerifyParam]);

  const value = useMemo(
    () => ({ needCaptcha, captchaType, requestCaptcha, closeCaptcha, reportResult }),
    [needCaptcha, captchaType, requestCaptcha, closeCaptcha, reportResult]
  );

  return (
    <CaptchaContext.Provider value={value}>
      {children}
      <CaptchaModal open={open} ready={isReady} onClose={closeCaptcha} sceneId={SCENE_ID} />
    </CaptchaContext.Provider>
  );
}
