import { expect, test, type Page } from '@playwright/test';

interface HomepageQuote {
  id: string;
  poemId: string;
  text: string;
  lines: string[];
  author: string;
  work: string;
}

async function homepageQuotes(page: Page): Promise<HomepageQuote[]> {
  const raw = await page.locator('.masthead-poem[data-poems]').getAttribute('data-poems');
  expect(raw).toBeTruthy();
  return JSON.parse(raw ?? '[]') as HomepageQuote[];
}

const chineseSpacing =
  /(\p{Script=Han}|[、。，．；：？！“”‘’《》〈〉「」『』（）【】—…·])[ \u00a0\u3000]+(?=\p{Script=Han}|[、。，．；：？！“”‘’《》〈〉「」『』（）【】—…·])/u;

test('homepage excerpts contain only verse lines with clean Chinese spacing', async ({ page }) => {
  await page.goto('/');
  const poems = await homepageQuotes(page);
  expect(poems.length).toBeGreaterThan(0);

  const nonVerse: string[] = [];
  const spacing: string[] = [];
  const sectionMarker = /^[一二三四五六七八九十百〇○零]{1,6}[、.]?$/;
  const chapterHeading = /^第[一二三四五六七八九十百0-9]+[部卷篇章][：:]?$/;
  const speaker =
    /^(第?[一二三四五六七八九十]+个?精灵|精灵[一二三四五六七八九十]+|First Spirit\.?|Second Spirit\.?)$/i;
  const headings = new Set(['剪影', '月之逃逸', '合唱：', '合唱:']);

  for (const poem of poems) {
    expect(Array.isArray(poem.lines)).toBe(true);
    for (const line of poem.lines) {
      const value = line.trim();
      if (
        sectionMarker.test(value) ||
        chapterHeading.test(value) ||
        speaker.test(value) ||
        headings.has(value)
      ) {
        nonVerse.push(`${poem.id}: ${line}`);
      }
      if (chineseSpacing.test(line)) spacing.push(`${poem.id}: ${line}`);
    }
  }

  expect(nonVerse).toEqual([]);
  expect(spacing).toEqual([]);
});

test('the Donne page does not render the section number as a verse line', async ({ page }) => {
  await page.goto('/poetry/899e00fb3cb4ea/');
  await expect(page.locator('h1.poetry-title')).toHaveText('您造就了我');
  const lines = await page
    .locator('.poetry-language[aria-label="中文"] .poetry-line')
    .allTextContents();
  expect(lines.length).toBeGreaterThan(0);
  expect(lines.map((line) => line.trim())).not.toContain('一');
});

test('Shakespeare sonnet 18 uses the collection title', async ({ page }) => {
  await page.goto('/poetry/ebc6c3b88d3333/');
  await expect(page.locator('h1.poetry-title')).toHaveText('十四行诗第18首');
});

test('the rose excerpt is shown without the source word-splitting space', async ({ page }) => {
  await page.goto('/');
  const poems = await homepageQuotes(page);
  const rose = poems.find((poem) => poem.id === 'ef01c9c7b79b4f');
  expect(rose).toBeTruthy();
  expect(rose!.lines.some((line) => line.includes('玫瑰'))).toBe(true);
  expect(rose!.lines.filter((line) => chineseSpacing.test(line))).toEqual([]);
});

test('untitled poems that open with their title line keep that line', async ({ page }) => {
  await page.goto('/');
  const poems = await homepageQuotes(page);
  const excerpt = poems.find((poem) => poem.id === 'df4271d6a769d7');
  expect(excerpt).toBeTruthy();
  expect(excerpt!.lines[0]).toBe('当我还没在生活里');
});
