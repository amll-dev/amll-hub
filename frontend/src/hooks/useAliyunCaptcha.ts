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

/**
 * 加载阿里云验证码 SDK。
 *
 * 这个 URL 不带版本号，内容随阿里云发版变化，构建期无法固定 SRI 哈希：
 * 写死 integrity 会在对方更新后直接让验证码整体失效。折中做法：
 * - 只允许 https + 固定官方域名（不做协议相对，避免被降级到 http）；
 * - 加 crossOrigin："anonymous" 走 CORS 请求，CDN 被劫持/替换成非 CORS 响应时浏览器会拒绝执行；
 * - 若将来阿里云提供带版本号的固定地址，把 hash 填进 script.integrity 即可启用完整 SRI。
 * 同时建议在反向代理层加 CSP：script-src 'self' https://o.alicdn.com（本次未改部署配置）。
 */
function loadAliyunCaptchaScript(): Promise<void> {
  if (window.initAliyunCaptcha) return Promise.resolve();
  if (sdkLoadPromise) return sdkLoadPromise;
  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = ALIYUN_SDK_URL;
    script.async = false;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve();
    script.onerror = () => {
      // crossOrigin 依赖 CDN 返回 CORS 头；被企业代理改写时可能加载失败，
      // 这里降级成普通脚本再试一次，避免验证码在整个环境不可用
      if (script.crossOrigin) {
        script.removeAttribute('crossorigin');
        // 重新赋 src 才会重新发起请求
        script.src = ALIYUN_SDK_URL;
        return;
      }
      sdkLoadPromise = null;
      reject(new Error('阿里云验证码脚本加载失败'));
    };
    document.body.appendChild(script);
  });
  return sdkLoadPromise;
}

/**
 * 等待挂载点出现在 DOM 中。
 *
 * 容器由 React 渲染，effect 执行时可能还没 commit（首帧 / 条件渲染切换）。
 */
function waitForElement(containerId: string, timeoutMs = 3000): Promise<HTMLElement | null> {
  const existing = document.getElementById(containerId);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const el = document.getElementById(containerId);
      if (el || Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        resolve(el);
      }
    }, 50);
  });
}

type CaptchaVerifyResult = { captchaResult: boolean; bizResult: boolean };

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
  // 存储 captchaVerifyCallback 的 resolve，等业务方调用 reportResult 后 resolve。
  // 用队列而不是单个 ref：SDK 连续回调两次（拖拽失败后立刻重试）时，
  // 后者会覆盖前者，第一个 Promise 就永久 pending，SDK 停在「验证中」。
  const resolveQueueRef = useRef<Array<(result: CaptchaVerifyResult) => void>>([]);

  /** 一次性 resolve 队列里的所有 Promise（失败/销毁时也要 resolve，不能让 SDK 挂着） */
  const flushResolvers = useCallback((result: CaptchaVerifyResult) => {
    const queue = resolveQueueRef.current;
    resolveQueueRef.current = [];
    for (const resolve of queue) resolve(result);
  }, []);

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
    flushResolvers({ captchaResult: false, bizResult: false });
  }, [flushResolvers]);

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

        // 挂载点可能尚未 commit（首帧 / 条件渲染切换），等它出现
        const el = await waitForElement(containerId);
        if (!mounted) return;
        if (!el) {
          console.warn('[aliyun-captcha] 挂载点未出现：', containerId);
          return;
        }

        destroy();
        el.innerHTML = '';

        window.initAliyunCaptcha!({
          SceneId: config.clientId2 ?? '',
          mode: 'embed',
          element: `#${containerId}`,
          // 返回 Promise，等业务方调用 reportResult 后再 resolve
          // SDK 会根据 resolve 的值显示验证成功/失败 UI
          captchaVerifyCallback: (data: unknown) => {
            return new Promise<CaptchaVerifyResult>((resolve) => {
              resolveQueueRef.current.push(resolve);
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
  const reportResult = useCallback(
    (success: boolean) => {
      flushResolvers({ captchaResult: success, bizResult: success });
      setCaptchaVerifyParam('');
    },
    [flushResolvers]
  );

  return { captchaVerifyParam, isReady, refresh, reset, reportResult };
}
