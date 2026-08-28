import { useCallback, useEffect, useRef, useState } from 'react';
import type { CaptchaConfig } from '@/lib/auth';

// 阿里云验证码 SDK 全局声明
declare global {
  interface Window {
    AliyunCaptcha?: unknown;
    initAliyunCaptcha?: (config: AliyunCaptchaInitConfig) => void;
    AliyunCaptchaConfig?: { region: string; prefix: string };
  }
}

interface AliyunCaptchaInitConfig {
  SceneId: string;
  mode: 'embed' | 'popup';
  element: string;
  captchaVerifyCallback: (
    data: unknown
  ) =>
    | Promise<{ captchaResult: boolean; bizResult: boolean }>
    | { captchaResult: boolean; bizResult: boolean };
  slideStyle: { width: number; height: number };
  language: string;
  immediate: boolean;
}

interface AliyunCaptchaInstance {
  destroy?: () => void;
  refresh?: () => void;
}

const ALIYUN_SDK_URL = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js';

let sdkLoadPromise: Promise<void> | null = null;

function loadAliyunCaptchaScript(): Promise<void> {
  if (window.initAliyunCaptcha) return Promise.resolve();
  if (sdkLoadPromise) return sdkLoadPromise;
  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = ALIYUN_SDK_URL;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => {
      sdkLoadPromise = null;
      reject(new Error('阿里云验证码脚本加载失败'));
    };
    document.body.appendChild(script);
  });
  return sdkLoadPromise;
}

/**
 * 管理阿里云人机验证码
 */
export function useAliyunCaptcha(
  config: CaptchaConfig | null,
  containerId: string,
  enabled: boolean = true
) {
  const [captchaVerifyParam, setCaptchaVerifyParam] = useState('');
  const [isReady, setIsReady] = useState(false);
  const instanceRef = useRef<AliyunCaptchaInstance | null>(null);
  // 存储 captchaVerifyCallback 的 resolve，等业务方调用 reportResult 后 resolve
  const resolveRef = useRef<
    ((result: { captchaResult: boolean; bizResult: boolean }) => void) | null
  >(null);

  const destroy = useCallback(() => {
    if (instanceRef.current?.destroy) {
      try {
        instanceRef.current.destroy();
      } catch {
        // 忽略销毁异常
      }
    }
    instanceRef.current = null;
    setCaptchaVerifyParam('');
    setIsReady(false);
    resolveRef.current = null;
  }, []);

  useEffect(() => {
    // enabled 为 false 时不初始化
    if (!enabled) return;
    // 无配置或 type 为 none/default/空时不初始化阿里云 SDK
    if (!config) return;
    const t = config.type;
    if (!t || t === 'none' || t === 'default') {
      setIsReady(true);
      return;
    }
    // 仅处理阿里云验证码，其他类型暂不支持
    if (t !== 'Aliyun Captcha') {
      setIsReady(true);
      return;
    }

    let mounted = true;

    const init = async () => {
      try {
        // 设置全局配置：prefix = clientSecret2, region = cn
        window.AliyunCaptchaConfig = {
          region: 'cn',
          prefix: config.clientSecret2 ?? '',
        };
        await loadAliyunCaptchaScript();
        if (!mounted) return;

        destroy();

        // 清理容器
        const el = document.getElementById(containerId);
        if (!el) return;
        el.innerHTML = '';

        window.initAliyunCaptcha!({
          SceneId: config.clientId2 ?? '',
          mode: 'embed',
          element: `#${containerId}`,
          // 返回 Promise，等业务方调用 reportResult 后再 resolve
          // SDK 会根据 resolve 的值显示验证成功/失败 UI
          captchaVerifyCallback: (data: unknown) => {
            return new Promise<{ captchaResult: boolean; bizResult: boolean }>((resolve) => {
              resolveRef.current = resolve;
              setCaptchaVerifyParam(typeof data === 'string' ? data : String(data ?? ''));
            });
          },
          slideStyle: { width: 320, height: 40 },
          language: 'cn',
          immediate: true,
        });

        // SDK 无 getInstance 回调，加载完成即视为 ready
        setIsReady(true);
      } catch {
        // SDK 加载失败，不阻塞后续流程
      }
    };

    init();

    return () => {
      mounted = false;
      destroy();
    };
  }, [config, containerId, enabled, destroy]);

  const refresh = useCallback(() => {
    setCaptchaVerifyParam('');
    instanceRef.current?.refresh?.();
  }, []);

  const reset = useCallback(() => {
    setCaptchaVerifyParam('');
    setIsReady(false);
    destroy();
  }, [destroy]);

  // 业务方调用：sendCode 成功后调 reportResult(true)，失败后调 reportResult(false)
  // SDK 会根据结果显示成功/失败 UI，失败时自动重置供重试
  const reportResult = useCallback((success: boolean) => {
    if (resolveRef.current) {
      resolveRef.current({ captchaResult: success, bizResult: success });
      resolveRef.current = null;
    }
    setCaptchaVerifyParam('');
  }, []);

  return { captchaVerifyParam, isReady, refresh, reset, reportResult };
}
