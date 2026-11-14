// 认证相关类型与本地存储工具

// 后端 GET /api/v1/auth/profile、登录返回的 user 字段
export interface UserProfile {
  name: string;
  displayName: string;
  email: string;
  avatar: string;
  phone?: string;
  /** 是否为审核员 */
  isReviewer?: boolean;
  /** 是否为超级管理员 */
  isAdmin?: boolean;
}

// 后端 POST /api/v1/auth/login | /login-code 返回结构
export interface LoginSuccess {
  token: string;
  user: UserProfile;
}

/** MFA 因子 */
export interface MfaMethod {
  mfaType: 'app' | 'email' | 'sms' | string;
  /** 邮箱/手机号的脱敏展示 */
  maskedDest?: string;
  isPreferred?: boolean;
}

/** 需要二次验证 */
export interface LoginMfaRequired {
  mfaRequired: true;
  mfaChallengeId: string;
  mfaMethods: MfaMethod[];
}

export type LoginResult = LoginSuccess | LoginMfaRequired;

/** 判断登录结果是否需要二次验证 */
export function isMfaRequired(result: LoginResult): result is LoginMfaRequired {
  return 'mfaRequired' in result && result.mfaRequired === true;
}

/** MFA 管理：单个因子的状态 */
export interface MfaStatusItem {
  mfaType: 'app' | 'email' | 'sms' | string;
  enabled: boolean;
  isPreferred: boolean;
}

/** MFA 管理：总览 */
export interface MfaStatus {
  methods: MfaStatusItem[];
  preferred?: string;
}

/** MFA 管理：开始绑定 */
export interface MfaSetupStart {
  challengeId: string;
  mfaType: string;
  /** TOTP 密钥（仅 app） */
  secret?: string;
  /** otpauth URL（仅 app） */
  otpauthUrl?: string;
  /** 脱敏后的收件地址（邮箱/短信） */
  dest?: string;
}

/** MFA 管理：绑定完成 */
export interface MfaSetupResult {
  recoveryCode?: string;
}

// 后端 GET /api/v1/auth/captcha 透传的 Casdoor 验证码配置
// 字段随 Casdoor provider 类型不同而异，这里只声明用到的通用字段
export interface CaptchaConfig {
  /** provider 类型：none / default / aliyun / tencent / geetest 等 */
  type: string;
  subType?: string;
  clientId?: string;
  clientSecret?: string;
  scene?: string;
  appKey?: string;
  clientId2?: string;
  clientSecret2?: string;
  [key: string]: unknown;
}

// 后端 POST /api/v1/auth/qrcode 返回
export interface QrTicket {
  ticket: string;
  /** 塞进二维码的 deep link，形如 amllhub://qrlogin?ticket=xxx */
  qrContent: string;
  expiresIn: number;
}

// 二维码票据状态
export type QrStatus = 'pending' | 'scanned' | 'confirmed' | 'expired';

// 后端 GET /api/v1/auth/qrcode/status?ticket=xxx 返回
export interface QrTicketStatus {
  status: QrStatus;
  /** status为 confirmed 时一次性下发，取走即销毁票据 */
  token?: string;
  user?: UserProfile;
}

const TOKEN_KEY = 'amll_hub_token';
const USER_KEY = 'amll_hub_user';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // 忽略存储异常
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 忽略
  }
}

export function getStoredUser(): UserProfile | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export function setStoredUser(user: UserProfile): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // 忽略
  }
}

export function clearStoredUser(): void {
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    // 忽略
  }
}

// 清空全部登录态
export function clearAuth(): void {
  clearToken();
  clearStoredUser();
}

// 后端 POST /api/v1/auth/github/bind/info 返回（绑定页预填信息）
export interface GithubBindInfo {
  githubLogin: string;
  githubEmail: string;
  githubAvatar: string;
}
