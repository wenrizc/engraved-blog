import { expect, test } from '@playwright/test';

const solidImage = (width: number, height: number, color: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`
  )}`;

async function replaceImage(
  selector: string,
  page: import('@playwright/test').Page,
  src: string,
  aspect?: number
) {
  await page.locator(selector).evaluate(
    async (image, { source, aspect }) => {
      if (!(image instanceof HTMLImageElement)) throw new Error('Expected image');
      image.removeAttribute('srcset');
      image.src = source;
      if (aspect)
        image.style.setProperty('--photo-aspect', String(Math.min(2.2, Math.max(1, aspect))));
      await image.decode();
    },
    { source: src, aspect }
  );
}

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
});

test('landscape, portrait, square and panorama covers stay visible', async ({ page }, testInfo) => {
  await page.goto('/photography/');
  const covers = [
    { width: 1600, height: 900, color: '#a95c50' },
    { width: 600, height: 900, color: '#687b8d' },
    { width: 900, height: 900, color: '#89946d' }
  ];
  for (const [index, cover] of covers.entries()) {
    await replaceImage(
      `.photo-list .photo-card:nth-child(${index + 1}) img`,
      page,
      solidImage(cover.width, cover.height, cover.color),
      cover.width / cover.height
    );
  }

  const cards = await page.locator('.photo-list .photo-card').evaluateAll((nodes) =>
    nodes.map((card) => {
      const image = card.querySelector('img')!;
      const box = image.getBoundingClientRect();
      const row = card.getBoundingClientRect();
      return {
        fit: getComputedStyle(image).objectFit,
        width: box.width,
        height: box.height,
        rowY: row.y,
        rowHeight: row.height
      };
    })
  );
  expect(cards).toHaveLength(3);
  expect(cards.every((card) => card.fit === 'contain')).toBe(true);
  expect(cards[0].rowY + cards[0].rowHeight).toBeLessThanOrEqual(cards[1].rowY + 1);
  expect(cards[1].rowY + cards[1].rowHeight).toBeLessThanOrEqual(cards[2].rowY + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1
  );
  await page.screenshot({
    path: testInfo.outputPath('photo-list-orientations.png'),
    fullPage: true
  });

  await replaceImage(
    '.photo-list .photo-card:first-child img',
    page,
    solidImage(2000, 500, '#988469'),
    4
  );
  await page.screenshot({ path: testInfo.outputPath('photo-list-panorama.png'), fullPage: true });
});

test('portrait detail fits the page and lightbox uses a larger source', async ({
  page
}, testInfo) => {
  await page.goto('/photography/2026-07-11-stone-garden/');
  const trigger = page.locator('.photo-zoom-trigger');
  const fullSource = await trigger.getAttribute('data-photo-lightbox-src');
  expect(fullSource).toBeTruthy();
  const inlineSource = await trigger.locator('img').evaluate((image) => {
    if (!(image instanceof HTMLImageElement)) throw new Error('Expected image');
    return image.currentSrc;
  });
  expect(new URL(fullSource!, page.url()).href).not.toBe(inlineSource);
  const inlineWidth = await trigger.locator('img').evaluate((image) => {
    if (!(image instanceof HTMLImageElement)) throw new Error('Expected image');
    return image.naturalWidth;
  });
  await trigger.click();
  const fullWidth = await page.locator('.photo-lightbox img').evaluate(async (image) => {
    if (!(image instanceof HTMLImageElement)) throw new Error('Expected image');
    await image.decode();
    return image.naturalWidth;
  });
  expect(fullWidth).toBeGreaterThan(inlineWidth);
  await page.locator('.photo-lightbox-close').click();

  const portrait = solidImage(600, 900, '#687b8d');
  await replaceImage('.photo-frame img', page, portrait);
  await page.locator('.photo-frame').evaluate((frame) => frame.classList.add('is-portrait'));
  const inline = await page.locator('.photo-frame img').evaluate((image) => {
    const box = image.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
  expect(inline.height).toBeLessThanOrEqual(Math.min(page.viewportSize()!.height * 0.8, 900) + 1);
  expect(inline.width / inline.height).toBeCloseTo(2 / 3, 1);
  await page.screenshot({ path: testInfo.outputPath('photo-detail-portrait.png'), fullPage: true });

  await trigger.evaluate((button, src) => {
    if (button instanceof HTMLElement) button.dataset.photoLightboxSrc = src;
  }, portrait);
  await trigger.click();
  await expect(page.locator('.photo-lightbox')).toBeVisible();
  const lightbox = await page.locator('.photo-lightbox img').evaluate(async (image) => {
    if (!(image instanceof HTMLImageElement)) throw new Error('Expected image');
    await image.decode();
    const box = image.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
  expect(lightbox.width / lightbox.height).toBeCloseTo(2 / 3, 1);
  expect(lightbox.height).toBeLessThanOrEqual(page.viewportSize()!.height * 0.92);
  await page.screenshot({ path: testInfo.outputPath('photo-lightbox-portrait.png') });
});
