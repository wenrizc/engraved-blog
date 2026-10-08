#!/usr/bin/env node
/**
 * Mirror public-domain prints from The Metropolitan Museum of Art Open Access
 * (CC0) into `src/assets/prints` and emit `src/data/generated/plates.json`.
 *
 * Usage:
 *   node scripts/fetch_plates.mjs [--force]
 *
 * Source: The Met Collection API — https://metmuseum.github.io/
 * License: CC0. Attribution is not required, but the source is recorded for
 * every plate so the credits stay traceable.
 */
import { mkdir, access, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const PRINTS_DIR = path.join(ROOT, 'src/assets/prints');
const DATA_FILE = path.join(ROOT, 'src/data/generated/plates.json');
const CREDITS_FILE = path.join(PRINTS_DIR, 'CREDITS.md');

const API = 'https://collectionapi.metmuseum.org/public/collection/v1';
const SEARCH_API = 'https://collectionapi.metmuseum.org/public/collection/v1.1';
const USER_AGENT = 'engraved-blog/0.1 (plate mirror; contact: local)';

const MIN_PLATES = 150;
const TARGET_PLATES = 165;
const MAX_EDGE = 1800;
const JPEG_QUALITY = 82;
const CONCURRENCY = 4;

const force = process.argv.includes('--force');

// Curated Western printmakers, restricted to the Met's Drawings and Prints
// department (departmentId 9) so the results are print-dense.
const DEPARTMENT_DRAWINGS_AND_PRINTS = 9;
const MAX_SCAN_PER_QUERY = 160;
const QUERIES = [
  { q: 'Albrecht Dürer', want: 14 },
  { q: 'Rembrandt', want: 14 },
  { q: 'Francisco Goya', want: 12 },
  { q: 'Giovanni Battista Piranesi', want: 12 },
  { q: 'Jacques Callot', want: 8 },
  { q: 'William Hogarth', want: 8 },
  { q: 'Honoré Daumier', want: 8 },
  { q: 'William Blake', want: 8 },
  { q: 'Hendrick Goltzius', want: 8 },
  { q: 'Gustave Doré', want: 8 },
  { q: 'Andrea Mantegna', want: 6 },
  { q: 'Lucas van Leyden', want: 6 },
  { q: 'Martin Schongauer', want: 6 },
  { q: 'Adriaen van Ostade', want: 6 },
  { q: 'Giovanni Domenico Tiepolo', want: 6 },
  { q: 'Canaletto', want: 6 },
  { q: 'Stefano della Bella', want: 6 },
  { q: 'Claude Lorrain', want: 6 },
  { q: 'Albrecht Altdorfer', want: 5 },
  { q: 'Israhel van Meckenem', want: 5 },
  { q: 'Katsushika Hokusai', want: 8 },
  { q: 'Utagawa Hiroshige', want: 8 },
  { q: 'Utagawa Kuniyoshi', want: 6 },
  { q: 'Kitagawa Utamaro', want: 6 },
  { q: 'Toshusai Sharaku', want: 4 }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url, retries = 6) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
      });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1);
        await sleep(wait);
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isMirrorablePrint(obj) {
  const medium = String(obj?.medium || '').toLowerCase();
  return Boolean(
    obj &&
    obj.isPublicDomain &&
    typeof obj.primaryImage === 'string' &&
    obj.primaryImage &&
    typeof obj.classification === 'string' &&
    obj.classification.toLowerCase().startsWith('print') &&
    /(etch|engraving|drypoint|aquatint|mezzotint|burin|woodcut|woodblock|wood engraving|intaglio|stipple|roulette|relief print)/.test(
      medium
    )
  );
}

function shortArtist(name) {
  return String(name || '')
    .replace(/\s*\([^)]*\)/g, '')
    .trim();
}

// A few catalogue titles run to hundreds of characters and mix the original
// language and the series name into the record. For display we keep just the
// descriptive English name; only extreme titles are shortened, so ordinary
// titles stay exactly as catalogued.
function cleanTitle(title, maxLength = 200) {
  let value = String(title || '').trim();
  if (value.length <= maxLength) return value;
  const series = value.search(/,\s+from\s+/i);
  if (series > 0) value = value.slice(0, series).trim();
  return value.replace(/\s*\([^()]*\)\s*$/, '').trim();
}

function slugify(text, max = 48) {
  const slug = String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'plate';
}

async function collectPrints() {
  const seen = new Set();
  const objects = [];

  for (const { q, want } of QUERIES) {
    if (objects.length >= TARGET_PLATES) break;
    const searchUrl =
      `${SEARCH_API}/search?hasImages=true&departmentId=${DEPARTMENT_DRAWINGS_AND_PRINTS}&limit=100` +
      `&q=${encodeURIComponent(q)}`;
    const search = await getJson(searchUrl);
    const ids = search?.objectIDs;
    if (!ids?.length) {
      console.warn(`  ${q}: search returned nothing, skipping`);
      continue;
    }

    let taken = 0;
    let scanned = 0;
    for (const id of ids) {
      if (objects.length >= TARGET_PLATES || taken >= want || scanned >= MAX_SCAN_PER_QUERY) break;
      if (seen.has(id)) continue;
      scanned += 1;
      const obj = await getJson(`${API}/objects/${id}`);
      await sleep(120);
      if (!isMirrorablePrint(obj)) continue;
      seen.add(id);
      objects.push(obj);
      taken += 1;
    }
    console.log(`  ${q}: +${taken} (total ${objects.length})`);
  }

  // Deterministic order so captions and filenames stay stable across runs.
  objects.sort(
    (a, b) =>
      shortArtist(a.artistDisplayName).localeCompare(shortArtist(b.artistDisplayName)) ||
      a.objectID - b.objectID
  );
  return objects;
}

async function mirrorImage(obj) {
  const filename = `met-${obj.objectID}-${slugify(shortArtist(obj.artistDisplayName))}-${slugify(obj.title)}.jpg`;
  const dest = path.join(PRINTS_DIR, filename);

  if (!force && (await exists(dest))) {
    return { filename, meta: await sharp(dest).metadata() };
  }

  const res = await fetch(obj.primaryImage, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`image ${obj.objectID}: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await sharp(buffer)
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toFile(dest);
  return { filename, meta: await sharp(dest).metadata() };
}

async function main() {
  await mkdir(PRINTS_DIR, { recursive: true });
  await mkdir(path.dirname(DATA_FILE), { recursive: true });

  // Once reviewed, mirror only approved works. Broad catalogue searches would
  // otherwise reintroduce rejected portraits and replace the Doré collection.
  const curatedFile = path.join(ROOT, 'src/data/plate-curation.json');
  if (await exists(curatedFile)) {
    const manifest = JSON.parse(await readFile(curatedFile, 'utf8'));
    for (const entry of manifest.entries.filter((entry) => entry.decision === 'keep')) {
      const dest = path.join(PRINTS_DIR, entry.record.file);
      if (!force && (await exists(dest))) continue;
      let url = entry.imageUrl;
      if (!url) {
        const obj = await getJson(`${API}/objects/${entry.record.id}`);
        if (!isMirrorablePrint(obj))
          throw new Error(`Approved plate ${entry.record.id} unavailable`);
        url = obj.primaryImage;
      }
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`Approved plate ${entry.record.id}: HTTP ${res.status}`);
      let image = sharp(Buffer.from(await res.arrayBuffer()))
        .rotate()
        .resize({
          width: MAX_EDGE,
          height: MAX_EDGE,
          fit: 'inside',
          withoutEnlargement: true
        });
      if (entry.crop) {
        image = sharp(await image.toBuffer()).extract(entry.crop);
      }
      await image.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toFile(dest);
      console.log(`Mirrored approved plate ${entry.record.id}`);
    }
    const result = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts/sync_curated_plates.mjs')],
      {
        stdio: 'inherit'
      }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Curated collection sync failed');
    return;
  }

  console.log('Collecting prints from The Met (CC0)…');
  const objects = await collectPrints();
  if (objects.length < MIN_PLATES) {
    throw new Error(`Only ${objects.length} plates collected, need at least ${MIN_PLATES}.`);
  }

  console.log(
    `Mirroring ${objects.length} images (max edge ${MAX_EDGE}px, ${CONCURRENCY} at a time)…`
  );
  const mirrored = new Array(objects.length);
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (cursor < objects.length) {
      const index = cursor;
      cursor += 1;
      try {
        mirrored[index] = await mirrorImage(objects[index]);
      } catch (error) {
        console.warn(`\n  plate ${objects[index].objectID} failed: ${error.message}`);
        mirrored[index] = null;
      }
      completed += 1;
      process.stdout.write(`\r  mirrored ${completed}/${objects.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  process.stdout.write('\n');

  const plates = [];
  objects.forEach((obj, index) => {
    const entry = mirrored[index];
    if (!entry) return;
    const { filename, meta } = entry;
    const artist = shortArtist(obj.artistDisplayName) || 'Unknown';
    const displayTitle = cleanTitle(obj.title);
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    plates.push({
      id: String(obj.objectID),
      file: filename,
      title: displayTitle,
      artist,
      date: obj.objectDate,
      medium: obj.medium,
      objectName: obj.objectName,
      orientation: width >= height ? 'landscape' : 'portrait',
      width,
      height,
      caption: `图版 ${String(plates.length + 1).padStart(2, '0')}`,
      meta: `${artist} · ${obj.objectDate}`.trim(),
      credit: 'The Met · CC0',
      alt: `${artist}，${displayTitle}${obj.objectDate ? `，${obj.objectDate}` : ''}${
        obj.medium ? `，${obj.medium}` : ''
      }`,
      sourceUrl: obj.objectURL
    });
  });

  const payload = {
    source: 'The Metropolitan Museum of Art Open Access (CC0)',
    sourceUrl: 'https://www.metmuseum.org/hubs/open-access',
    generatedAt: new Date().toISOString(),
    count: plates.length,
    plates
  };
  await writeFile(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const credits = [
    '# Plate credits',
    '',
    `All plates are public-domain prints from [The Metropolitan Museum of Art Open Access](${payload.sourceUrl})`,
    'collection, released under [CC0](https://creativecommons.org/publicdomain/zero/1.0/).',
    'Images were downloaded from the Met Collection API and resized for the web.',
    '',
    '| 图版 | Work | Artist | Date | Source |',
    '| --- | --- | --- | --- | --- |',
    ...plates.map(
      (p) =>
        `| ${p.caption} | ${p.title.replace(/\|/g, '\\|')} | ${p.artist} | ${p.date} | [${p.id}](${p.sourceUrl}) |`
    ),
    ''
  ].join('\n');
  await writeFile(CREDITS_FILE, credits, 'utf8');

  console.log(`Wrote ${plates.length} plates → ${path.relative(ROOT, DATA_FILE)}`);
  console.log(`Credits → ${path.relative(ROOT, CREDITS_FILE)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
