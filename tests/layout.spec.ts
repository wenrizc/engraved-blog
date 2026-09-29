import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const poetryData = JSON.parse(
  readFileSync(new URL('../src/data/generated/poetry-poems.json', import.meta.url), 'utf8')
);
const beachPoem = poetryData.poems.find(
  (poem: { titleEn: string }) => poem.titleEn === 'On the Beach at Night'
);
const hawkPoem = poetryData.poems.find((poem: { title: string }) => poem.title === '受伤的鹰');
const beautyPoem = poetryData.poems.find((poem: { title: string }) => poem.title === '赞智力美');

const tabs = ['/article/', '/photography/', '/archive/', '/tags/', '/about/'];
const tabTitles = ['文章', '摄影', '档案', '主题', '关于'];
const navEnglish = ['HOME', 'ARTICLE', 'PHOTOGRAPHY', 'ARCHIVE', 'TAGS', 'ABOUT', 'LINKS'];
const details = [
  '/article/design-notes/',
  '/photography/2026-07-11-stone-garden/',
  '/tags/cat/',
  `/poetry/${poetryData.poems[0].id}/`,
  '/404/'
];

async function rectangles(page: Page, selectors: string[]) {
  return page.evaluate(
    (selectors) =>
      selectors.map((selector) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    selectors
  );
}

async function expectNoOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth
  }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.viewport + 1);
}

test.beforeEach(async ({ page }) => {
  // Keep geometry checks deterministic and cover unavailable external fonts.
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
});

test('tabs share header, navigation, page title and content boundaries', async ({ page }) => {
  let reference: Awaited<ReturnType<typeof rectangles>> | undefined;
  for (const [index, route] of tabs.entries()) {
    await page.goto(route);
    await expect(page.locator('.section-header h1')).toHaveText(tabTitles[index]);
    await expect(page.locator('.section-header__title span')).toHaveCount(0);
    await expect(page).toHaveTitle('文日小栈');
    await expect(page.locator('.site-nav small')).toHaveText(navEnglish);
    const boxes = await rectangles(page, [
      '.site-header',
      '.header-inner',
      'nav',
      '.page-shell',
      '.section-header'
    ]);
    // Page content has different heights, but its top and width are shared.
    boxes[3].height = 0;
    if (reference) expect(boxes, route).toEqual(reference);
    else reference = boxes;
    await expectNoOverflow(page);
    await expect(page.locator('nav a[aria-current="page"]')).toHaveCount(1);
    const nav = await rectangles(page, [
      'nav',
      ...Array.from({ length: 6 }, (_, i) => `nav a:nth-child(${i + 1}) span`)
    ]);
    expect(new Set(nav.slice(1).map((r) => r.y)).size).toBe(1);
    expect(nav.slice(1).every((r) => r.height < 24)).toBe(true);
  }
});

test('nav links dropdown reveals an external link without navigating', async ({ page }) => {
  await page.goto('/');
  const trigger = page.locator('.nav-links__trigger');
  const menu = page.locator('.nav-links__menu');
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  const before = page.url();
  await trigger.click();
  expect(page.url()).toBe(before);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(menu).toBeVisible();
  await expect(menu.locator('a')).toHaveAttribute(
    'href',
    'https://wenrizc.github.io/technical-article-site/'
  );

  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('detail pages use consistent titles and section labels', async ({ page }) => {
  for (const [route, backLabel] of [
    ['/article/design-notes/', '返回文章'],
    ['/photography/2026-07-11-stone-garden/', '返回摄影']
  ]) {
    await page.goto(route);
    await expect(page.locator('.section-header__title span')).toHaveCount(0);
    await expect(page.locator('.section-header__back')).toContainText(backLabel);
    await expect(page).toHaveTitle('文日小栈');
    await expect(page.locator('.article-header-meta')).toContainText('发布于');
  }
  await page.goto('/archive/');
  const kinds = await page.locator('.archive-list li > span').allTextContents();
  expect(kinds.every((kind) => kind === '文章' || kind === '摄影')).toBe(true);
});

test('home plate is chosen from the mirrored print collection', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.999999;
  });
  await page.goto('/');
  const figure = page.locator('.hero-plate[data-plates]');
  const options = (await figure.evaluate((el) =>
    JSON.parse((el as HTMLElement).dataset.plates || '[]')
  )) as Array<{ title: string; artist: string; alt: string; full: string; src: string }>;
  expect(options.length).toBeGreaterThanOrEqual(50);
  const selected = options.at(-1)!;
  await expect(figure).not.toHaveAttribute('data-plate-pending');
  await expect(figure.locator('[data-plate-title]')).toHaveText(selected.title);
  await expect(figure.locator('[data-plate-artist]')).toHaveText(selected.artist);
  await expect(figure.locator('img')).toHaveAttribute('alt', selected.alt);
  await expect(figure.locator('img')).toHaveAttribute('src', selected.src);

  // The plate opens the shared photo lightbox with its own full-size source.
  const trigger = figure.locator('.plate-zoom-trigger');
  await expect(trigger).toHaveAttribute('data-photo-lightbox-src', selected.full);
  await trigger.click();
  await expect(page.locator('#photo-lightbox')).toBeVisible();
  await expect(page.locator('.photo-lightbox img')).toHaveAttribute('src', selected.full);
  await page.locator('.photo-lightbox-close').click();
  await expect(page.locator('#photo-lightbox')).toBeHidden();
});

test('plate captions keep the following content in place', async ({ page }) => {
  await page.goto('/');
  const selectors = ['.hero-plate', '.home-content'];
  const original = await rectangles(page, selectors);
  for (const title of ['Short title', 'Long title '.repeat(100)]) {
    await page.locator('[data-plate-title]').evaluate((el, value) => {
      el.textContent = value;
    }, title);
    expect(await rectangles(page, selectors)).toEqual(original);
    await expectNoOverflow(page);
  }
});

test('poem changes do not move the title, plate or following content', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('.poem-lines')?.textContent?.trim());
  const selectors = ['#site-title', '.masthead-poem', '.hero-plate', '.home-content'];
  const original = await rectangles(page, selectors);
  for (const content of [
    '短诗',
    '很长的诗句与不能撑开容器的文字'.repeat(500),
    'UnbrokenWord'.repeat(200)
  ]) {
    await page.locator('.poem-lines').evaluate((el, text) => {
      el.textContent = text;
    }, content);
    await page.locator('.poem-meta').evaluate((el) => {
      el.textContent = '作者与作品'.repeat(30);
    });
    expect(await rectangles(page, selectors)).toEqual(original);
    await expectNoOverflow(page);
  }
  const slot = page.locator('.masthead-poem');
  expect(await slot.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await slot.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await slot.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test('home poem is chosen before it becomes visible', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.999999;
  });
  await page.goto('/');
  const poem = page.locator('.masthead-poem');
  const options = await poem.evaluate((el) =>
    JSON.parse((el as HTMLElement).dataset.poems || '[]')
  );
  const selected = options[options.length - 1];
  await expect(poem).not.toHaveAttribute('data-poem-pending');
  await expect(poem).toHaveAttribute('href', `/poetry/${selected.poemId}/`);
  await expect(poem.locator('.poem-lines')).toHaveText(selected.lines.join(''));
  await expect(poem).toBeVisible();
});

test('home poem has a readable fallback without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4330',
    javaScriptEnabled: false
  });
  const page = await context.newPage();
  await page.goto('/');
  const poem = page.locator('.masthead-poem');
  const options = await poem.evaluate((el) =>
    JSON.parse((el as HTMLElement).dataset.poems || '[]')
  );
  await expect(poem).toHaveAttribute('href', `/poetry/${options[0].poemId}/`);
  await expect(poem.locator('.poem-lines')).toHaveText(options[0].lines.join(''));
  await expect(poem).toBeVisible();
  await context.close();
});

test('bilingual poem stanzas and source lines stay aligned', async ({ page }) => {
  for (const poem of [beachPoem, hawkPoem, beautyPoem]) {
    await page.goto(`/poetry/${poem.id}/`);
    const pairs = page.locator('.poetry-stanza-pair');
    await expect(pairs).toHaveCount(poem.stanzas.length);
    for (let index = 0; index < poem.stanzas.length; index++) {
      const pair = pairs.nth(index);
      const languages = pair.locator('.poetry-language');
      await expect(languages).toHaveCount(2);
      const tops = await languages.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().top)
      );
      if (page.viewportSize()!.width > 760) expect(tops[0]).toBe(tops[1]);
      const noWrappedLines = await pair.locator('.poetry-line').evaluateAll((lines) =>
        lines.every((line) => {
          const style = getComputedStyle(line);
          return style.whiteSpace === 'pre' && line.clientHeight === 32;
        })
      );
      expect(noWrappedLines).toBe(true);
    }
    await expectNoOverflow(page);
  }
  await page.goto(`/poetry/${hawkPoem.id}/`);
  const first = page.locator('.poetry-stanza-pair').first();
  await expect(first.locator('.poetry-section-label')).toHaveText('一');
  await expect(
    first.locator('.poetry-language').first().locator('.poetry-line').first()
  ).toHaveText('翅膀骨头从凝着血块的肩上撕开了，');
  await expect(first.locator('.poetry-language').last().locator('.poetry-line').first()).toHaveText(
    'The broken pillar of the wing jags from the clotted shoulder,'
  );
  await page.goto(`/poetry/${beautyPoem.id}/`);
  await expect(page.locator('.poetry-inline-marker')).toHaveCount(6);
  await expect(page.locator('.poetry-language').first().locator('.poetry-line')).toHaveCount(84);
});

test('detail pages and long content stay inside the viewport', async ({ page }) => {
  for (const route of details) {
    await page.goto(route);
    await expectNoOverflow(page);
    await page.locator('main h1').evaluate((el) => {
      el.textContent = '长标题LongUnbrokenTitle'.repeat(20);
    });
    await expectNoOverflow(page);
    const [heading] = await rectangles(page, ['main h1']);
    expect(heading.x + heading.width).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth)
    );
  }
  await page.goto('/article/design-notes/');
  await page.locator('.article-content').evaluate((el) => {
    const p = document.createElement('p');
    p.textContent = 'https://example.com/' + 'long'.repeat(200);
    const pre = document.createElement('pre');
    pre.textContent = 'unwrapped_code'.repeat(100);
    const table = document.createElement('table');
    const row = table.insertRow();
    for (let i = 0; i < 20; i++) row.insertCell().textContent = 'A wide table column';
    el.append(p, pre, table);
  });
  await expectNoOverflow(page);
});

test('short pages keep footer at the bottom without unnecessary scrolling', async ({ page }) => {
  await page.goto('/about/');
  const footer = await page.locator('.site-footer').boundingBox();
  expect(footer!.y + footer!.height).toBeCloseTo(page.viewportSize()!.height, 0);
});

test('image loading preserves the plate geometry', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/_image?**', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const before = await rectangles(page, ['.hero-plate', '.home-content']);
  release();
  await page.waitForFunction(() => {
    const img = document.querySelector('.hero-plate img') as HTMLImageElement;
    return img.complete && img.naturalWidth > 0;
  });
  expect(await rectangles(page, ['.hero-plate', '.home-content'])).toEqual(before);
});

test('responsive breakpoints do not overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Sweep viewport boundaries once.');
  for (const width of [390, 480, 640, 641, 760, 761, 1024, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/photography/', '/archive/']) {
      await page.goto(route);
      await expectNoOverflow(page);
    }
  }
});
