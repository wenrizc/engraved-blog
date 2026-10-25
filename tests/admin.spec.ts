import { expect, test as base } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { parse } from 'yaml';

const test = base.extend<{}, { admin: { url: string; root: string } }>({
  admin: [
    async ({}, use, workerInfo) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'wenri-admin-test-'));
      for (const dir of [
        'src/content/articles',
        'src/content/photos',
        'src/content/interviews',
        'src/assets/photos'
      ]) {
        await mkdir(path.join(root, dir), { recursive: true });
      }
      const image = await sharp({
        create: { width: 160, height: 100, channels: 3, background: '#94634c' }
      })
        .png()
        .toBuffer();
      for (const name of ['中文 一.png', 'two.png', 'three.png'])
        await writeFile(path.join(root, 'src/assets/photos', name), image);
      await writeFile(
        path.join(root, 'src/content/articles/original-path.md'),
        '---\ntitle: 原始文章\ndate: 2026-10-01\ntags: [设计]\ndraft: false\ncustom:\n  keep: true\n---\n\n原始正文\n'
      );
      await writeFile(
        path.join(root, 'src/content/articles/newer.md'),
        '---\ntitle: 更新的文章\ndate: 2026-10-09\ntags: []\ndraft: true\n---\n\n更新正文\n'
      );
      await writeFile(
        path.join(root, 'src/content/photos/album.md'),
        '---\ntitle: 测试相册\ndate: 2026-10-09\ntags: []\ndraft: false\ncover: ../../assets/photos/two.png\ngallery:\n  - src: ../../assets/photos/中文 一.png\n    caption: 第一张\n  - src: ../../assets/photos/two.png\n    caption: 第二张\n  - src: ../../assets/photos/three.png\n    caption: 第三张\n---\n'
      );
      let server: ChildProcess | undefined;
      try {
        server = spawn(process.execPath, ['local-admin/server.mjs'], {
          env: {
            ...process.env,
            ADMIN_PROJECT_ROOT: root,
            ADMIN_HOST: '127.0.0.1',
            ADMIN_PORT: String(23000 + workerInfo.workerIndex + (process.pid % 5000))
          }
        });
        const url = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Admin did not start')), 10000);
          server!.stdout!.on('data', (chunk) => {
            const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
            if (match) {
              clearTimeout(timer);
              resolve(match[0]);
            }
          });
          server!.on('error', reject);
          server!.stderr!.on('data', (chunk) => console.error(String(chunk)));
        });
        await use({ url, root });
      } finally {
        server?.kill();
        await rm(root, { recursive: true, force: true });
      }
    },
    { scope: 'worker' }
  ]
});

// Each worker uses disposable content and images; the user's library is never touched.
test('saving keeps the selected entry, existing path and additional metadata', async ({
  page,
  admin
}) => {
  await page.goto(admin.url);
  await page.locator('.entry').filter({ hasText: '原始文章' }).click();
  await page.locator('#title').fill('修改后的标题');
  await page.locator('#date').fill('2026-09-01');
  await page.locator('#tags').fill('设计，阅读, 阅读');
  await page.getByRole('button', { name: /保存 Markdown/ }).click();
  await expect(page.locator('#status')).toContainText('已保存 original-path.md');
  await expect(page.locator('#title')).toHaveValue('修改后的标题');
  await expect(page.locator('.entry.active')).toContainText('修改后的标题');
  const markdown = await readFile(
    path.join(admin.root, 'src/content/articles/original-path.md'),
    'utf8'
  );
  const data = parse(markdown.split('---')[1]);
  expect(data.custom.keep).toBe(true);
  expect(data.tags).toEqual(['设计', '阅读']);
  // Restore this worker's fixture for subsequent tests.
  await page.locator('#title').fill('原始文章');
  await page.getByRole('button', { name: /保存 Markdown/ }).click();
  await expect(page.locator('#status')).toContainText('已保存');
});

test('preview renders unsaved Markdown safely, including tables and code', async ({
  page,
  admin
}) => {
  await page.goto(admin.url);
  await page
    .locator('#body')
    .fill(
      '## 即时标题\n\n**粗体内容**\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\nconst value = 1;\n```\n\n<script>window.previewUnsafe = true</script>\n\n[坏链接](javascript:alert(1))'
    );
  await page.getByRole('button', { name: '分屏预览', exact: true }).click();
  await expect(page.locator('#preview-body h2')).toHaveText('即时标题');
  await expect(page.locator('#preview-body strong')).toHaveText('粗体内容');
  await expect(page.locator('#preview-body table')).toBeVisible();
  await expect(page.locator('#preview-body pre')).toContainText('const value = 1;');
  await expect(page.locator('#preview-body script')).toHaveCount(0);
  expect(await page.locator('#preview-body a').getAttribute('href')).toBeNull();
  await page.getByRole('button', { name: '手机', exact: true }).click();
  await expect(page.locator('#preview-document')).toHaveClass(/phone/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `/tmp/admin-preview-${test.info().project.name}.png`,
    fullPage: true
  });
});

test('gallery thumbnails, ordering, undo, replacement and cover survive saving', async ({
  page,
  admin
}) => {
  await page.goto(admin.url);
  await page.getByRole('button', { name: '照片', exact: true }).click();
  const cards = page.locator('.gallery-item');
  await expect(cards).toHaveCount(3);
  await expect
    .poll(() =>
      cards
        .first()
        .locator('img')
        .evaluate((image: HTMLImageElement) => image.naturalWidth)
    )
    .toBeGreaterThan(0);
  await cards.first().locator('[data-action="down"]').click();
  await expect(cards.first().locator('[data-caption]')).toHaveValue('第二张');
  await page.locator('#undo-gallery').click();
  await expect(cards.first().locator('[data-caption]')).toHaveValue('第一张');
  await cards.first().locator('[data-position]').fill('3');
  await cards.first().locator('[data-position]').press('Tab');
  await expect(cards.last().locator('[data-caption]')).toHaveValue('第一张');
  await cards.last().locator('[data-action="cover"]').click();
  const newImage = await sharp({
    create: { width: 60, height: 90, channels: 3, background: '#795f50' }
  })
    .png()
    .toBuffer();
  await cards.last().locator('[data-action="replace"]').click();
  await page
    .locator('#replace-photo-file')
    .setInputFiles({ name: '替换.png', mimeType: 'image/png', buffer: newImage });
  await expect(cards.last().locator('.pending-badge')).toBeVisible();
  await expect(cards.last().locator('[data-caption]')).toHaveValue('第一张');
  await expect(cards.last().locator('.cover-badge')).toBeVisible();
  await page.getByRole('button', { name: /保存 Markdown/ }).click();
  await expect(page.locator('#status')).toContainText('已保存 album.md');
  const response = await page.request.get(`${admin.url}/api/entries?type=photography`);
  const album = (await response.json()).find((entry: { slug: string }) => entry.slug === 'album');
  expect(album.data.gallery.map((photo: { caption: string }) => photo.caption)).toEqual([
    '第二张',
    '第三张',
    '第一张'
  ]);
  expect(album.data.cover).toBe(album.data.gallery[2].src);
  await expect(page.locator('.entry.active')).toContainText('测试相册');
  await page.screenshot({
    path: `/tmp/admin-gallery-${test.info().project.name}.png`,
    fullPage: true
  });
});

test('pending photos and text can be stashed and recovered after reloading', async ({
  page,
  admin
}) => {
  await page.goto(admin.url);
  await page.getByRole('button', { name: '照片', exact: true }).click();
  await page.locator('#new-entry').click();
  await page.locator('#title').fill('暂存相册');
  const buffer = await sharp({
    create: { width: 80, height: 50, channels: 3, background: '#527967' }
  })
    .png()
    .toBuffer();
  await page
    .locator('#photo-files')
    .setInputFiles({ name: 'pending.png', mimeType: 'image/png', buffer });
  await expect(page.locator('.gallery-item')).toHaveCount(1);
  await expect(page.locator('#save-state')).toContainText('已暂存本机');
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.locator('#recovery-banner')).toBeVisible();
  await page.locator('#restore-draft').click();
  await expect(page.locator('#title')).toHaveValue('暂存相册');
  await expect
    .poll(() =>
      page.locator('.gallery-item img').evaluate((image: HTMLImageElement) => image.naturalWidth)
    )
    .toBe(80);
  await page.getByRole('button', { name: '文章', exact: true }).click();
  await expect(page.locator('#navigation-dialog')).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.locator('#title')).toHaveValue('暂存相册');
  await page.getByRole('button', { name: /保存 Markdown/ }).click();
  await expect(page.locator('#status')).toContainText('已保存');
  await expect(page.locator('.pending-badge')).toHaveCount(0);
  await expect(page.locator('#recovery-banner')).toBeHidden();
});

test('image rotation and crop produce a new file while preserving original assets', async ({
  page,
  admin
}) => {
  await page.goto(admin.url);
  await page.getByRole('button', { name: '照片', exact: true }).click();
  await page.locator('#filter').fill('测试相册');
  await page.locator('.entry').click();
  await page.locator('.gallery-item').first().locator('[data-action="edit"]').last().click();
  await expect(page.locator('#image-dialog')).toBeVisible();
  await expect
    .poll(() => page.locator('#image-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width))
    .toBeGreaterThan(1);
  await page.locator('#rotate-right').click();
  await page.locator('#crop-ratio').selectOption('1');
  await page.locator('#apply-image').click();
  await expect(page.locator('#image-dialog')).toBeHidden();
  await expect(page.locator('.gallery-item').first().locator('.pending-badge')).toBeVisible();
  await page.getByRole('button', { name: /保存 Markdown/ }).click();
  await expect(page.locator('#status')).toContainText('已保存');
  const response = await page.request.get(`${admin.url}/api/entries?type=photography`);
  const album = (await response.json()).find((entry: { slug: string }) => entry.slug === 'album');
  const image = await sharp(
    path.join(admin.root, 'src/assets/photos', path.basename(album.data.gallery[0].src))
  ).metadata();
  expect(image.width).toBe(image.height);
  expect((await sharp(path.join(admin.root, 'src/assets/photos/two.png')).metadata()).width).toBe(
    160
  );
});

test('external edits produce a conflict and preserve unsaved work', async ({ page, admin }) => {
  await page.goto(admin.url);
  await page.locator('.entry').filter({ hasText: '原始文章' }).click();
  await page.locator('#body').fill('浏览器中的修改');
  const file = path.join(admin.root, 'src/content/articles/original-path.md');
  const previous = await readFile(file, 'utf8');
  await writeFile(file, previous + '\n外部编辑器修改\n');
  await page.getByRole('button', { name: /保存 Markdown/ }).click();
  await expect(page.locator('#status')).toContainText('文件已被其他窗口');
  await expect(page.locator('#body')).toHaveValue('浏览器中的修改');
  expect(await readFile(file, 'utf8')).toContain('外部编辑器修改');
});

test('import keeps the current unsaved interview note intact', async ({ page, admin }) => {
  await page.goto(admin.url);
  await page.getByRole('button', { name: '面试八股', exact: true }).click();
  await page.locator('#title').fill('正在编写的笔记');
  await page.locator('#body').fill('不能丢失的正文');
  await page.locator('#open-import').click();
  await page.locator('#interview-files').setInputFiles({
    name: 'imported.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 导入标题\n\n导入正文')
  });
  await page.locator('#import-interviews').click();
  await expect(page.locator('#import-results')).toContainText('已导入');
  await page.getByRole('button', { name: '关闭导入', exact: true }).click();
  await expect(page.locator('#title')).toHaveValue('正在编写的笔记');
  await expect(page.locator('#body')).toHaveValue('不能丢失的正文');
  await expect(page.locator('.entry')).toContainText('导入标题');
});

test('drag handles reorder gallery images and removal can be undone', async ({ page, admin }) => {
  test.skip(
    (page.viewportSize()?.width || 0) < 900,
    'Drag handles are checked on desktop; arrows and positions are checked on all devices.'
  );
  await page.goto(admin.url);
  await page.getByRole('button', { name: '照片', exact: true }).click();
  await page.locator('#filter').fill('测试相册');
  await page.locator('.entry').click();
  const cards = page.locator('.gallery-item');
  const caption = await cards.first().locator('[data-caption]').inputValue();
  await cards.first().locator('.drag-handle').dragTo(cards.last());
  await expect(cards.last().locator('[data-caption]')).toHaveValue(caption);
  await cards.last().locator('[data-action="remove"]').click();
  await expect(cards).toHaveCount(2);
  await page.locator('#undo-gallery').click();
  await expect(cards).toHaveCount(3);
  await expect(cards.last().locator('[data-caption]')).toHaveValue(caption);
});

test('a failed save preserves uploaded photos and retry does not upload duplicates', async ({
  page,
  admin
}) => {
  await page.goto(admin.url);
  await page.getByRole('button', { name: '照片', exact: true }).click();
  await page.locator('#new-entry').click();
  await page.locator('#title').fill('重试相册');
  const buffer = await sharp({
    create: { width: 40, height: 30, channels: 3, background: '#796450' }
  })
    .png()
    .toBuffer();
  await page
    .locator('#photo-files')
    .setInputFiles({ name: 'retry.png', mimeType: 'image/png', buffer });
  await expect(page.locator('.gallery-item')).toHaveCount(1);
  let uploads = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/photos')) uploads++;
  });
  await page.route('**/api/entry', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: '模拟保存失败' })
    })
  );
  await page.getByRole('button', { name: /保存 Markdown/ }).click();
  await expect(page.locator('#status')).toContainText('模拟保存失败');
  await expect(page.locator('#title')).toHaveValue('重试相册');
  await page.unroute('**/api/entry');
  await page.getByRole('button', { name: /保存 Markdown/ }).click();
  await expect(page.locator('#status')).toContainText('已保存');
  expect(uploads).toBe(1);
});

test('invalid images are rejected and gallery works without secure-context randomUUID', async ({
  page,
  admin
}) => {
  await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }));
  await page.goto(admin.url);
  await page.getByRole('button', { name: '照片', exact: true }).click();
  await page.locator('#filter').fill('测试相册');
  await page.locator('.entry').click();
  await expect(page.locator('.gallery-item')).toHaveCount(3);
  await page.locator('#photo-files').setInputFiles({
    name: 'broken.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('not an image')
  });
  await expect(page.locator('#status')).toContainText('无法读取');
  await expect(page.locator('.gallery-item')).toHaveCount(3);
  const response = await page.request.post(`${admin.url}/api/photos`, {
    data: { files: [{ name: 'broken.jpg', data: Buffer.from('not an image').toString('base64') }] }
  });
  expect(response.ok()).toBe(false);
});

test('existing mixed-case filenames stay stable and concurrent saves detect conflicts', async ({
  request,
  admin
}) => {
  const file = path.join(admin.root, 'src/content/articles/Existing_File.md');
  await writeFile(file, '---\ntitle: 保留路径\ndate: 2026-10-09\ntags: []\ndraft: true\n---\n');
  const response = await request.get(`${admin.url}/api/entries?type=article`);
  const entry = (await response.json()).find(
    (item: { slug: string }) => item.slug === 'Existing_File'
  );
  const payload = {
    type: 'article',
    slug: entry.slug,
    originalSlug: entry.slug,
    revision: entry.revision,
    data: entry.data,
    body: '并发修改'
  };
  const results = await Promise.all([
    request.post(`${admin.url}/api/entry`, { data: payload }),
    request.post(`${admin.url}/api/entry`, { data: payload })
  ]);
  expect(results.map((result) => result.status()).sort()).toEqual([200, 409]);
  expect(await readFile(file, 'utf8')).toContain('并发修改');
  await rm(file);
});

test('admin rejects cross-origin writes, simple form requests and DNS rebinding', async ({
  request,
  admin
}) => {
  const file = path.join(admin.root, 'src/content/articles/original-path.md');
  const before = await readFile(file, 'utf8');
  const payload = { type: 'article', slug: 'original-path' };
  const blockedHeaders: Record<string, string>[] = [
    { origin: 'https://untrusted.example' },
    { origin: 'null' },
    { 'sec-fetch-site': 'cross-site' },
    { host: `untrusted.example:${new URL(admin.url).port}` }
  ];
  for (const headers of blockedHeaders) {
    const response = await request.post(`${admin.url}/api/delete`, { headers, data: payload });
    expect(response.status()).toBe(403);
  }
  const form = await request.post(`${admin.url}/api/delete`, {
    headers: { 'content-type': 'text/plain' },
    data: JSON.stringify(payload)
  });
  expect(form.status()).toBe(415);
  expect(await readFile(file, 'utf8')).toBe(before);
  const allowed = await request.post(`${admin.url}/api/preview`, {
    headers: { origin: admin.url },
    data: { body: '**同源请求**' }
  });
  expect(allowed.status()).toBe(200);
  expect((await allowed.json()).html).toContain('<strong>同源请求</strong>');
});

test('photo uploads strip private metadata and rasterize SVG scripts', async ({
  request,
  admin
}) => {
  const image = await sharp({
    create: { width: 20, height: 30, channels: 3, background: '#527967' }
  })
    .jpeg()
    .withExif({ IFD0: { Artist: 'Private photographer', ImageDescription: 'Private metadata' } })
    .toBuffer();
  expect((await sharp(image).metadata()).exif).toBeTruthy();
  const response = await request.post(`${admin.url}/api/photos`, {
    data: {
      files: [
        { name: 'private.jpg', data: image.toString('base64') },
        {
          name: 'active.svg',
          data: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><script>alert(1)</script><rect width="20" height="30" fill="red"/></svg>'
          ).toString('base64')
        }
      ]
    }
  });
  expect(response.status()).toBe(200);
  const { gallery } = await response.json();
  const original = await sharp(
    path.join(admin.root, 'src/assets/photos', path.basename(gallery[0].src))
  ).metadata();
  expect(original.exif).toBeUndefined();
  expect(original.xmp).toBeUndefined();
  expect(original.iptc).toBeUndefined();
  expect(gallery[1].src).toMatch(/\.png$/);
  const svg = await sharp(
    path.join(admin.root, 'src/assets/photos', path.basename(gallery[1].src))
  ).metadata();
  expect(svg.format).toBe('png');
});

test('publish endpoint is exposed but refuses a non-git project root', async ({ page, admin }) => {
  await page.goto(admin.url);
  await expect(page.locator('#publish-site')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true
  );
  const response = await page.request.post(`${admin.url}/api/publish`, { data: {} });
  expect(response.status()).toBe(500);
  expect((await response.text()).toLowerCase()).toContain('git');
});
