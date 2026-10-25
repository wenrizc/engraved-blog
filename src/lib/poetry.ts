import type { PoetryQuote } from '../data/poetryQuotes';

/**
 * Presentation-layer normalisation for the bilingual poetry archive.
 *
 * The generated data is preserved verbatim: everything here works on copies of
 * the strings at render time. Section numbers, print-edition headings and
 * speaker labels occasionally end up in the body lines of the source EPUB, so
 * pages share these filters instead of each implementing their own.
 */

const SECTION_MARKER = /^[一二三四五六七八九十百〇○零]{1,6}[、.]?$/;
const CHAPTER_HEADING = /^第[一二三四五六七八九十百0-9]+[部卷篇章][：:]?$/;
const SPEAKER_LABEL =
  /^(第?[一二三四五六七八九十]+个?精灵|精灵[一二三四五六七八九十]+|First Spirit\.?|Second Spirit\.?)$/i;

/** Standalone headings that appear between stanzas in the print collection. */
const SECTION_HEADINGS = new Set(['合唱：', '合唱:', '剪影', '月之逃逸']);

/**
 * Two title lines were captured as the first line of their poem/quote in the
 * source extraction. They are allow-listed by id rather than matched by title:
 * many untitled poems legitimately use their first line as the title.
 *
 * The values include both poem ids and quote ids so the same guard works on
 * the poetry page and on the homepage excerpts.
 */
const KNOWN_TITLE_LINES = new Map<string, string>([
  ['5277957ffb15e9', '露西·格瑞'],
  ['7a3230d1ae6a2c', '露西·格瑞'],
  ['eb15657205c3fe', '法兰西'],
  ['0cfd175ae7aa3d', '法兰西']
]);

const CJK = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\u3005\\u3007';
const CJK_PUNCTUATION = '、。，．；：？！“”‘’《》〈〉「」『』（）【】〔〕—…·';
const CJK_OR_PUNCTUATION = `[${CJK}${CJK_PUNCTUATION}]`;
const CJK_SPACE = new RegExp(
  `(${CJK_OR_PUNCTUATION})[ \\u00a0\\u3000]+(?=${CJK_OR_PUNCTUATION})`,
  'g'
);
const TITLE_CJK_SPACE = new RegExp(`([${CJK}])[ \\u00a0\\u3000]+(?=[${CJK}])`, 'g');
const NUMERAL_TITLE_PREFIX =
  /^(?:后[·.])?[〇零一二三四五六七八九十百0-9]+(?:[·][〇零一二三四五六七八九十百0-9]+)?[ \u00a0\u3000]+/;

/** Confirmed translation corrections from the source collection. */
const TITLE_CORRECTIONS = new Map<string, string>([
  ['一旦晨曦不再伫留', '一旦暮色不再锁住'],
  ['二十八 威尔士人进行曲', '二十八 威尔士边境']
]);

export interface PoemLineContext {
  poemId?: string;
  quoteId?: string;
}

export interface PreparedQuote {
  id: string;
  poemId: string;
  text: string;
  lines: string[];
  author: string;
  work: string;
}

function normalizeEllipsis(value: string) {
  return value.replace(/⋯{2,}/g, '……').replace(/⋯/g, '…');
}

/** Collapse spaces that EPUB conversion left inside Chinese prose and verse. */
export function removeChineseInlineSpaces(value: string) {
  return value.replace(CJK_SPACE, '$1');
}

/** Normalise a single Chinese line without touching English spacing. */
export function cleanPoemLine(line: string) {
  return normalizeEllipsis(removeChineseInlineSpaces(line))
    .replace(/\u00a0/g, ' ')
    .trim();
}

/** True for structural labels that are not part of the poem's text. */
export function isNonPoemLine(line: string) {
  const value = line.trim();
  return (
    !value ||
    SECTION_MARKER.test(value) ||
    CHAPTER_HEADING.test(value) ||
    SECTION_HEADINGS.has(value) ||
    SPEAKER_LABEL.test(value)
  );
}

function knownTitleLine(context: PoemLineContext | undefined) {
  if (!context) return undefined;
  return (
    (context.quoteId ? KNOWN_TITLE_LINES.get(context.quoteId) : undefined) ??
    (context.poemId ? KNOWN_TITLE_LINES.get(context.poemId) : undefined)
  );
}

/** Clean lines, drop non-poem labels, and remove the two known title intrusions. */
export function filterPoemLines(lines: string[], context?: PoemLineContext) {
  const knownTitle = knownTitleLine(context);
  const cleaned = lines.map(cleanPoemLine);
  const firstContentIndex = cleaned.findIndex((line) => line && !isNonPoemLine(line));

  return cleaned.filter((line, index) => {
    if (!line || isNonPoemLine(line)) return false;
    if (index === firstContentIndex && knownTitle && line === knownTitle) return false;
    return true;
  });
}

/** Strip or convert the book-title marks that surround a title. */
function normalizeBookTitleMarks(value: string, asWork = false) {
  const wrapped = value.startsWith('《') && value.endsWith('》');
  if (wrapped) {
    const inner = value.slice(1, -1);
    return `《${inner.replaceAll('《', '〈').replaceAll('》', '〉')}》`;
  }
  if (asWork) {
    return value.replaceAll('《', '〈').replaceAll('》', '〉');
  }
  return value;
}

/**
 * Normalise a displayed title.
 *
 * - Pure numeric Shakespeare/Browning sonnets get their collection title.
 * - Print-edition numbering such as “三 新兵” or “后·五 掷弹兵” is preserved.
 * - Chinese word-splitting spaces are removed; bullets become “·”.
 * - Nested book-title marks use 〈〉 for the inner title.
 */
export function normalizeTitle(title: string, author = '', options: { asWork?: boolean } = {}) {
  let value = title.trim();
  if (!value) return value;

  const correction = TITLE_CORRECTIONS.get(value);
  if (correction) return correction;

  // Donne's Holy Sonnets are numbered in the print edition; the number is a
  // section marker rather than part of the poem's title.
  if (author.includes('但恩')) {
    value = value.replace(/^[一二三四五六七八九十百]+、/, '');
  }

  const numeric = value.match(/^([0-9]+)$/);
  if (numeric) {
    const number = String(Number(numeric[1]));
    if (author.includes('莎士比亚')) return `十四行诗第${number}首`;
    if (author.includes('勃朗宁')) return `葡萄牙人十四行诗第${number}首`;
  }

  value = value.replace(/[•・]/g, '·');
  value = normalizeBookTitleMarks(value, options.asWork);

  // Keep the print edition's section-number spacing (e.g. “三 新兵”).
  const numeralPrefix = value.match(NUMERAL_TITLE_PREFIX);
  if (numeralPrefix) {
    return numeralPrefix[0] + value.slice(numeralPrefix[0].length).replace(TITLE_CJK_SPACE, '$1');
  }

  return value.replace(TITLE_CJK_SPACE, '$1');
}

/** Normalise author typography without changing the name itself. */
export function normalizeAuthor(author: string) {
  return author
    .trim()
    .replace(/－/g, '·')
    .replace(/([A-Z])\.\s*([A-Z])\./g, '$1. $2.')
    .replace(/([A-Z])\.(?=[\u3400-\u4dbf\u4e00-\u9fff])/g, '$1. ');
}

function normalizeWork(work: string, author: string) {
  const value = work.trim();
  const match = value.match(/^《([\s\S]*)》$/);
  const inner = match ? match[1] : value;
  return `《${normalizeTitle(inner, author, { asWork: true })}》`;
}

/**
 * Convert one homepage excerpt to its display form.
 * Returns null only when no content line survives filtering.
 */
export function prepareQuote(quote: PoetryQuote): PreparedQuote | null {
  const lines = filterPoemLines(quote.lines, {
    poemId: quote.poemId,
    quoteId: quote.id
  });
  if (lines.length === 0) return null;

  const author = normalizeAuthor(quote.author);
  return {
    id: quote.id,
    poemId: quote.poemId,
    text: lines.join('\n'),
    lines,
    author,
    work: normalizeWork(quote.work, author)
  };
}
