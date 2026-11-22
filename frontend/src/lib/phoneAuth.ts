import sdkScriptUrl from 'aliyun_numberauthsdk_web/build/numberAuth-web-sdk.js?url';

/**
 * 阿里云号码认证 H5 SDK 的按需加载与 Promise 封装。
 *
 * 该 SDK 是 UMD 包，运行时挂载 window.PhoneNumberServer，内部自带 React 17 渲染授权页。
 * 为了不和站点的 React 19 打架，这里用 <script> 动态加载构建产物，而不是直接 import 包入口。
 */

interface PhoneAuthCallbackResult {
  code: number;
  msg?: string;
  spToken?: string;
}

interface PhoneAuthOptions {
  accessToken: string;
  jwtToken: string;
  timeout?: number;
  success: (res: PhoneAuthCallbackResult) => void;
  error: (res: PhoneAuthCallbackResult) => void;
}

interface LoginTokenOptions {
  authPageOption: Record<string, unknown>;
  timeout?: number;
  success: (res: PhoneAuthCallbackResult) => void;
  error: (res: PhoneAuthCallbackResult) => void;
  watch?: (status: number) => void;
}

export interface PhoneNumberServerInstance {
  checkLoginAvailable(opts: PhoneAuthOptions): void;
  getLoginToken(opts: LoginTokenOptions): void;
}

type PhoneNumberServerCtor = new () => PhoneNumberServerInstance;

declare global {
  interface Window {
    PhoneNumberServer?: PhoneNumberServerCtor;
    /** 授权页「其他登录方式」的全局回调，由 requestSpToken 注入 */
    __amllOneClickSwitch?: () => void;
  }
}

/** 运营商成功码 */
const SUCCESS_CODE = 600000;

/** 授权页上的自定义「其他登录方式」入口 id */
const SWITCH_ELEMENT_ID = 'amll-switch-login';

let loadPromise: Promise<PhoneNumberServerCtor> | null = null;

/** 按需加载 SDK，失败后允许下次重试 */
export function loadPhoneAuthSdk(): Promise<PhoneNumberServerCtor> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('当前环境不支持一键登录'));
  }
  if (window.PhoneNumberServer) {
    return Promise.resolve(window.PhoneNumberServer);
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = sdkScriptUrl;
    script.async = true;
    script.onload = () => {
      if (window.PhoneNumberServer) {
        resolve(window.PhoneNumberServer);
      } else {
        loadPromise = null;
        reject(new Error('一键登录 SDK 初始化失败'));
      }
    };
    script.onerror = () => {
      loadPromise = null;
      reject(new Error('一键登录 SDK 加载失败'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

/** 关闭 SDK 授权页（弹窗和整页两种形态的关闭控件不同） */
function closeAuthPage(): void {
  document.querySelector<HTMLElement>('#J_dialogType .close, #J_pageType .nav-back-icon')?.click();
}

/** 授权页的自定义视图：底部「其他登录方式」 */
function buildAuthPageCustomView() {
  return {
    element: `<div id="${SWITCH_ELEMENT_ID}">其他登录方式</div>`,
    style: `
      #custom-zone { margin-top: 16px; text-align: center; }
      #${SWITCH_ELEMENT_ID} {
        display: inline-block;
        padding: 8px 12px;
        font-family: Inter, 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', system-ui, sans-serif;
        font-size: 14px;
        line-height: 20px;
        color: #8a8a90;
        cursor: pointer;
      }
    `,
    js: `
      (function () {
        var el = document.getElementById('${SWITCH_ELEMENT_ID}');
        if (el) {
          el.addEventListener('click', function () {
            if (window.__amllOneClickSwitch) window.__amllOneClickSwitch();
          });
        }
      })();
    `,
  };
}

/**
 * 走完「鉴权 → 检测本机号码 → 拉起授权页 → 取 spToken」。
 *
 * checkLoginAvailable 通过才会渲染授权页；用户取消、关闭授权页或点「其他登录方式」
 * 时返回 null，由调用方回退到密码/验证码登录。
 */
export async function requestSpToken(
  accessToken: string,
  jwtToken: string
): Promise<string | null> {
  const Ctor = await loadPhoneAuthSdk();
  const server = new Ctor();

  await new Promise<void>((resolve, reject) => {
    server.checkLoginAvailable({
      accessToken,
      jwtToken,
      success: (res) => {
        if (res.code === SUCCESS_CODE) resolve();
        else reject(new Error(res.msg || '当前环境不支持一键登录'));
      },
      error: (res) => reject(new Error(res.msg || '当前环境不支持一键登录')),
    });
  });

  return new Promise<string | null>((resolve) => {
    const origin = window.location.origin;
    let settled = false;
    let pageSeen = false;
    const monitor: { id?: number } = {};
    const safety: { id?: number } = {};

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      if (monitor.id !== undefined) window.clearInterval(monitor.id);
      if (safety.id !== undefined) window.clearTimeout(safety.id);
      delete window.__amllOneClickSwitch;
      closeAuthPage();
      resolve(value);
    };

    // 用户点关闭 X / 点「其他登录方式」时 SDK 只移除授权页节点，不一定回调 error，
    // 这里监听节点消失兜底，避免 Promise 永久挂起。
    monitor.id = window.setInterval(() => {
      const exists = !!document.querySelector('#J_dialogType, #J_pageType');
      if (exists) {
        pageSeen = true;
      } else if (pageSeen) {
        finish(null);
      }
    }, 400);
    // 兜底：极少数情况下 SDK 既不回调也不移除节点，避免登录弹窗一直等
    safety.id = window.setTimeout(() => finish(null), 120_000);

    window.__amllOneClickSwitch = () => finish(null);

    server.getLoginToken({
      // 授权页配置：品牌、协议与文案对齐参考图
      authPageOption: {
        navText: ' ',
        subtitle: '',
        btnText: '一键登录',
        logoImg: `${origin}/logo.png`,
        isHideLogo: false,
        privacyBefore: '我已阅读并同意',
        privacyOne: ['《用户协议》', `${origin}/terms`],
        privacyTwo: ['《隐私政策》', `${origin}/privacy`],
        privacyVenderIndex: 2,
        isShowProtocolDesc: false,
        // 桌面端保持弹窗，移动端用整页授权页（更接近运营商默认样式）
        isDialog: window.matchMedia('(min-width: 768px)').matches,
        manualClose: true,
        showCustomView: true,
        customView: buildAuthPageCustomView(),
      },
      success: (res) => {
        if (res.code === SUCCESS_CODE && res.spToken) {
          finish(res.spToken);
        } else {
          finish(null);
        }
      },
      error: () => finish(null),
    });
  });
}
