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
export interface LoginResult {
  token: string;
  user: UserProfile;
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
