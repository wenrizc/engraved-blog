import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';

test.describe.configure({ mode: 'serial' });

let admin: ChildProcess;
let adminUrl: string;
let folder: string;

test.beforeAll(async ({}, testInfo) => {
  folder = `test-interview-${testInfo.project.name}-${process.pid}`;
  admin = spawn(process.execPath, ['local-admin/server.mjs'], {
    env: {
      ...process.env,
      ADMIN_HOST: '127.0.0.1',
      ADMIN_PORT: String(19000 + (process.pid % 10000))
    }
  });
  adminUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Admin did not start')), 10000);
    admin.stdout!.on('data', (chunk) => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    admin.on('error', reject);
  });
});

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  // Importing content triggers Vite reloads that can interrupt link clicks.
  // Each navigation still requests the current content from the dev server.
  await page.routeWebSocket('**', (socket) => socket.close());
});

test.afterAll(async () => {
  admin?.kill();
  if (folder) {
    await rm(`src/content/interviews/${folder}`, { recursive: true, force: true });
    await rm(`src/content/interviews/${folder}-upload.md`, { force: true });
    for (const file of await readdir('.local-admin-trash').catch(() => [])) {
      if (file.startsWith(`interview-${folder}-`)) await rm(`.local-admin-trash/${file}`);
    }
  }
});

test('admin imports nested Markdown into an isolated interview library', async ({
  page,
  request
}) => {
  await page.goto(adminUrl);
  await page.getByRole('button', { name: '面试八股', exact: true }).click();
  await expect(page.locator('#import-interviews')).toBeVisible();
  const markdown = `---\ntitle: 面试目录验证\ndate: 2026-10-02\ntags:\n  - ${folder}\ndraft: false\n---\n\n## 问答\n\ninterview-search-${folder}\n`;
  await page.locator('#interview-files').setInputFiles({
    name: `${folder}-upload.md`,
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      markdown.replace('面试目录验证', '导入草稿验证').replace('draft: false', 'draft: true')
    )
  });
  await page.getByRole('button', { name: '导入面试文章', exact: true }).click();
  await expect(page.locator('#import-results')).toContainText('已导入');
  // The API retains folder paths from directory selections.
  const payload = {
    files: [
      { path: `${folder}/Java/并发/thread.md`, markdown },
      { path: `${folder}/Java/draft.md`, markdown: markdown.replace('draft: false', 'draft: true') }
    ]
  };
  const imported = await request.post(`${adminUrl}/api/interviews/import`, { data: payload });
  expect(imported.ok()).toBe(true);
  expect((await imported.json()).results.every((entry: { saved: boolean }) => entry.saved)).toBe(
    true
  );
  const duplicate = await request.post(`${adminUrl}/api/interviews/import`, { data: payload });
  expect((await duplicate.json()).results.every((entry: { saved: boolean }) => !entry.saved)).toBe(
    true
  );
  const invalid = await request.post(`${adminUrl}/api/interviews/import`, {
    data: { files: [{ path: '../escape.md', markdown }] }
  });
  expect((await invalid.json()).results[0].saved).toBe(false);

  await page.reload();
  await page.getByRole('button', { name: '面试八股', exact: true }).click();
  await page.locator('#filter').fill(folder);
  await expect(page.locator('#entries .entry')).toHaveCount(3);
  await page.locator('#entries .entry').filter({ hasText: '/并发/thread' }).click();
  await expect(page.locator('#directory')).toHaveValue(`${folder}/java/并发`);
  await page.locator('#description').fill('后台编辑验证');
  await page.getByRole('button', { name: '保存 Markdown', exact: true }).click();
  await expect(page.locator('#status')).toContainText('已保存');

  // Wait for Astro's content watcher to pick up the imported files.
  await expect
    .poll(async () => {
      const response = await request.get('/interview/');
      return (await response.text()).includes(`/interview/article/${folder}/`);
    })
    .toBe(true);
  await page.goto('/interview/');
  await expect(page.locator('.site-nav small')).toHaveCount(0);
  await expect(page.locator('.site-nav > a')).toHaveText(['文章', '主题', '搜索']);
  await expect(
    page
      .locator('details')
      .filter({ has: page.getByRole('link', { name: '面试目录验证', exact: true }) })
      .first()
  ).toBeVisible();
  const article = page.getByRole('link', { name: '面试目录验证', exact: true });
  await expect(article).toHaveCount(1);
  await article.click();
  await expect(page.locator('.article-content')).toContainText(`interview-search-${folder}`);
  await expect(page.locator('.tag-row a')).toHaveAttribute('href', `/interview/topics/${folder}/`);
  await page.locator('.tag-row a').click();
  await expect(page.locator('.section-header h1')).toHaveText(folder);
  await expect(page.getByRole('link', { name: '面试目录验证', exact: true })).toHaveCount(1);
  await page.locator('nav a[href="/interview/search/"]').click();
  await page.locator('#interview-query').fill(`interview-search-${folder}`);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('[data-search-status]')).toHaveText('找到 1 篇文章');
  await expect(page.locator('[data-search-results] a')).toHaveCount(1);
  await page.locator('#interview-query').fill('no-such-interview-keyword');
  await expect(page.locator('[data-search-status]')).toHaveText('没有找到匹配的文章。');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);
  await page.goto('/article/');
  await expect(page.getByRole('link', { name: '面试目录验证', exact: true })).toHaveCount(0);

  const deleted = await request.post(`${adminUrl}/api/delete`, {
    data: { type: 'interview', slug: `${folder}/java/并发/thread` }
  });
  expect((await deleted.json()).deleted).toBe(true);
});
