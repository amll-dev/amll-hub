import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api';
import { clearAuth, getToken, setToken } from '@/lib/auth';

/** 构造 fetch mock 返回值（request 只用 status / json） */
function res(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearAuth();
});

describe('api.request 管道', () => {
  it('code=200 时返回 data 字段', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(res(200, { code: 200, message: 'ok', data: { total: 42 } }) as never);
    await expect(api.getStats()).resolves.toEqual({ total: 42 });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/stats', expect.anything());
  });

  it('业务码非 200 抛 ApiError（含 code）', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(res(200, { code: 500, message: '服务器错误' }) as never);
    await expect(api.getStats()).rejects.toMatchObject({
      name: 'ApiError',
      code: 500,
      message: '服务器错误',
    });
  });

  it('有 token 时注入 Authorization 头', async () => {
    setToken('tk');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(res(200, { code: 200, data: null }) as never);
    await api.getStats();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tk');
  });

  it('401 带 token：清登录态 + 派发 auth:unauthorized 事件', async () => {
    setToken('tk');
    const events: string[] = [];
    window.addEventListener('auth:unauthorized', () => events.push('fired'));
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(res(401, { code: 401, message: 'token 过期' }) as never);
    await expect(api.getStats()).rejects.toBeInstanceOf(ApiError);
    expect(getToken()).toBeNull();
    expect(events).toEqual(['fired']);
  });

  it('401 无 token：仅抛错，不派发事件', async () => {
    const handler = vi.fn();
    window.addEventListener('auth:unauthorized', handler);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(401) as never);
    await expect(api.getStats()).rejects.toMatchObject({ code: 401 });
    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener('auth:unauthorized', handler);
  });

  it('响应体非 JSON 抛"请求失败"', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue({
        ok: true,
        status: 502,
        json: async () => Promise.reject(new Error('x')),
      } as never);
    await expect(api.getStats()).rejects.toThrow('请求失败：HTTP 502');
  });
});

describe('query 参数拼装（buildQuery）', () => {
  it('undefined 与空串参数被过滤', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(res(200, { code: 200, data: {} }) as never);
    await api.getNotFoundRanking({ days: 7 });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('days=7');
    expect(String(url)).toContain('limit=all');
    expect(String(url)).not.toContain('platform');
  });
});
