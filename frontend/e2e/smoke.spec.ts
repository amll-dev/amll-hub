import { expect, test, type Page } from '@playwright/test';

/**
 * 后端 API mock：按端点返回确定性数据，其余端点统一 500（页面渲染错误态）。
 * 覆盖首页/排行榜所需端点；profile 返回 401 模拟未登录。
 */
async function mockApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const ok = (data: unknown) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ code: 200, message: 'ok', data }),
      });
    const fail = (status = 500) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ code: status, message: 'mock error' }),
      });

    if (url.includes('/api/v1/auth/profile')) return fail(401);
    if (url.includes('/api/v1/stats'))
      return ok({
        totalSongs: 100,
        totalArtists: 50,
        totalAlbums: 30,
        totalWords: 1000,
        totalLines: 200,
        platformDistribution: { ncm: 80, qq: 20 },
        lastSyncAt: '2026-08-29T00:00:00Z',
      });
    if (url.includes('/api/v1/latest-songs'))
      return ok([
        { id: 1, songId: 1, ncmId: '1', title: '最新歌曲', artist: '歌手', coverUrl: '' },
      ]);
    if (url.includes('/api/v1/daily-recommendations/today')) return ok(null);
    if (url.includes('/api/v1/not-found-ranking'))
      return ok({ total: 0, returned: 0, requestedLimit: 'all', days: 7, items: [] });
    return fail();
  });
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test.describe('首页', () => {
  test('渲染 Hero 标题、导航与页脚', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'AMLL Hub' })).toBeVisible();
    await expect(page.getByText('Apple Music Like Lyrics 歌词社区', { exact: false })).toBeVisible();
    // 顶栏品牌
    await expect(page.getByText('AMLL Hub').first()).toBeVisible();
    // 导航链接存在
    await expect(page.getByRole('link', { name: '歌词搜索' })).toBeVisible();
  });

  test('统计徽章渲染 mock 数据', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('100')).first().toBeVisible();
  });

  test('搜索栏可输入并跳转搜索结果', async ({ page }) => {
    await page.goto('/');
    const input = page.getByPlaceholder(/搜索/);
    await input.fill('测试歌曲');
    await input.press('Enter');
    // 搜索结果视图（SearchResults 挂载，Hero 隐藏）
    await expect(page.getByRole('heading', { level: 1, name: 'AMLL Hub' })).toBeHidden();
  });
});

test.describe('导航', () => {
  test('顶栏跳转歌词搜索页', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: '歌词搜索' }).click();
    await expect(page).toHaveURL(/\/lyrics-search/);
    await expect(page.getByRole('heading', { name: '平台歌词搜索' })).toBeVisible();
  });

  test('直接访问排行榜页渲染标题', async ({ page }) => {
    await page.goto('/ranking');
    await expect(page.getByRole('heading', { name: '无歌词排行榜' })).toBeVisible();
  });
});

test.describe('登录门槛', () => {
  test('未登录访问音乐解析显示登录引导', async ({ page }) => {
    await page.goto('/ncm');
    await expect(page.getByRole('heading', { name: '音乐解析需要登录' })).toBeVisible();
    await expect(page.getByRole('button', { name: '立即登录' })).toBeVisible();
  });
});

test.describe('404', () => {
  test('未知路由显示 404 页', async ({ page }) => {
    await page.goto('/this-page-does-not-exist');
    await expect(page.getByText('404')).toBeVisible();
    await expect(page.getByRole('heading', { name: '页面不存在' })).toBeVisible();
  });
});
