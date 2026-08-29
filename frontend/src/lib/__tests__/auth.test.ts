import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAuth,
  clearStoredUser,
  clearToken,
  getStoredUser,
  getToken,
  setStoredUser,
  setToken,
  type UserProfile,
} from '@/lib/auth';

const user: UserProfile = {
  name: 'alice',
  displayName: 'Alice',
  email: 'a@b.c',
  avatar: 'https://example.com/a.png',
};

beforeEach(() => {
  localStorage.clear();
});

describe('token 存取', () => {
  it('set 后 get 返回原值', () => {
    setToken('t123');
    expect(getToken()).toBe('t123');
  });

  it('未设置时返回 null', () => {
    expect(getToken()).toBeNull();
  });

  it('clear 后返回 null', () => {
    setToken('t123');
    clearToken();
    expect(getToken()).toBeNull();
  });
});

describe('user 存取', () => {
  it('set 后 get 返回结构化对象', () => {
    setStoredUser(user);
    expect(getStoredUser()).toEqual(user);
  });

  it('未设置时返回 null', () => {
    expect(getStoredUser()).toBeNull();
  });

  it('损坏 JSON 返回 null 而不抛错', () => {
    localStorage.setItem('amll_hub_user', '{invalid json');
    expect(getStoredUser()).toBeNull();
  });

  it('clear 后返回 null', () => {
    setStoredUser(user);
    clearStoredUser();
    expect(getStoredUser()).toBeNull();
  });
});

describe('clearAuth', () => {
  it('同时清空 token 与 user', () => {
    setToken('t');
    setStoredUser(user);
    clearAuth();
    expect(getToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });
});
