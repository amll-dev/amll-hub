import { createContext, useContext } from 'react';

/** 人机验证宿主的对外能力（实现见 CaptchaProvider.tsx） */
export interface CaptchaContextValue {
  /** 是否需要人机验证（后端下发的验证码类型是否为阿里云） */
  needCaptcha: boolean;
  /** 后端下发的验证码类型，原样传给发码接口 */
  captchaType: string;
  /** 打开人机验证弹窗；验证通过后用 token 回调 onToken */
  requestCaptcha: (onToken: (token: string) => void) => void;
  /** 关闭弹窗 */
  closeCaptcha: () => void;
  /** 告知 SDK 本次业务结果：成功关闭、失败由 SDK 内部重置供重试 */
  reportResult: (ok: boolean) => void;
}

export const CaptchaContext = createContext<CaptchaContextValue | null>(null);

/** 在 CaptchaProvider 内使用：申请一次人机验证 */
export function useCaptcha(): CaptchaContextValue {
  const ctx = useContext(CaptchaContext);
  if (!ctx) throw new Error('useCaptcha 必须在 CaptchaProvider 内使用');
  return ctx;
}
