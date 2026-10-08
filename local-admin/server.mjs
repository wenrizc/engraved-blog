import http from 'node:http';
import { parse as parseYaml } from 'yaml';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const adminDir = __dirname;
const articlesDir = path.join(root, 'src', 'content', 'articles');
const interviewsDir = path.join(root, 'src', 'content', 'interviews');
const photosDir = path.join(root, 'src', 'content', 'photos');
const assetPhotosDir = path.join(root, 'src', 'assets', 'photos');
const trashDir = path.join(root, '.local-admin-trash');
const preferredPort = Number(process.env.ADMIN_PORT || 9797);
const preferredHost = process.env.ADMIN_HOST || '127.0.0.1';

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.avif') return 'image/avif';
  return 'application/octet-stream';
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data, null, 2));
}

function slugify(input) {
  const normalized = input
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || `entry-${randomUUID().slice(0, 8)}`;
}

function safeJoin(base, target) {
  const resolved = path.resolve(base, target);
  if (resolved !== path.resolve(base) && !resolved.startsWith(path.resolve(base) + path.sep)) {
    throw new Error('Path escapes content directory.');
  }
  return resolved;
}

function parseFrontmatter(markdown) {
  const normalized = markdown.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return { data: {}, body: normalized.trim() };
  const data = parseYaml(match[1]) || {};
  if (typeof data !== 'object' || Array.isArray(data))
    throw new Error('Markdown 元数据必须是对象。');
  return { data, body: normalized.slice(match[0].length).trim() };
}

function collectionDir(type) {
  return { article: articlesDir, photography: photosDir, interview: interviewsDir }[type];
}

function entrySlug(type, input) {
  if (type !== 'interview') return slugify(input);
  const parts = String(input).replace(/\\/g, '/').split('/');
  if (parts.some((part) => !part.trim() || part === '.' || part === '..')) {
    throw new Error('目录路径无效。');
  }
  return parts.map(slugify).join('/');
}

async function markdownFiles(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory())
      files.push(...(await markdownFiles(path.join(dir, entry.name), relative + '/')));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(relative);
  }
  return files;
}

function quoteString(value) {
  return JSON.stringify(value ?? '');
}

function yamlValue(value) {
  if (Array.isArray(value)) return `[${value.map(quoteString).join(', ')}]`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === undefined || value === null || value === '') return '""';
  return quoteString(value);
}

function toMarkdown(data, body = '') {
  const lines = Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${yamlValue(value)}`);
  const normalizedBody = typeof body === 'string' ? body.trim() : '';
  const bodyBlock = normalizedBody ? `\n\n${normalizedBody}\n` : '\n';
  return `---\n${lines.join('\n')}\n---${bodyBlock}`;
}

async function readCollection(type) {
  const dir = collectionDir(type);
  const files = await markdownFiles(dir);
  const entries = [];
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const markdown = await readFile(fullPath, 'utf8');
    const parsed = parseFrontmatter(markdown);
    entries.push({
      type,
      slug: file.replace(/\.md$/, ''),
      file,
      ...parsed
    });
  }
  return entries.sort((a, b) => String(b.data.date || '').localeCompare(String(a.data.date || '')));
}

async function readRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function saveEntry(type, payload) {
  const dir = collectionDir(type);
  await mkdir(dir, { recursive: true });
  const slug = entrySlug(type, payload.slug || payload.data?.title || 'entry');
  const originalSlug = payload.originalSlug ? entrySlug(type, payload.originalSlug) : '';
  const target = safeJoin(dir, `${slug}.md`);
  if (existsSync(target) && originalSlug !== slug) {
    const error = new Error(`页面路径已存在：${slug}。请调整标题或日期。`);
    error.statusCode = 409;
    throw error;
  }
  await mkdir(path.dirname(target), { recursive: true });
  if (originalSlug && originalSlug !== slug) {
    const originalTarget = safeJoin(dir, `${originalSlug}.md`);
    if (existsSync(originalTarget)) await rename(originalTarget, target);
  }
  const data = payload.data || {};
  const body = typeof payload.body === 'string' ? payload.body : '';
  await writeFile(target, toMarkdown(data, body), 'utf8');
  return { slug, file: `${slug}.md` };
}

async function deleteEntry(type, slug) {
  const dir = collectionDir(type);
  const target = safeJoin(dir, `${entrySlug(type, slug)}.md`);
  if (!existsSync(target)) return false;
  await mkdir(trashDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archived = path.join(trashDir, `${type}-${slugify(slug)}-${stamp}.md`);
  await rename(target, archived);
  return true;
}

async function importInterviews(payload) {
  const files = Array.isArray(payload.files) ? payload.files : [];
  const results = [];
  for (const file of files) {
    try {
      if (!/\.md$/i.test(file.path || '')) throw new Error('请选择 .md 文件。');
      const slug = entrySlug('interview', file.path.replace(/\.md$/i, ''));
      const { data, body } = parseFrontmatter(String(file.markdown || ''));
      const title = data.title || body.match(/^#\s+(.+)$/m)?.[1] || path.basename(slug);
      const date = data.date || new Date().toISOString().slice(0, 10);
      if (!Number.isFinite(new Date(date).valueOf())) throw new Error('日期无效。');
      if (
        data.tags !== undefined &&
        (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== 'string'))
      )
        throw new Error('标签应为字符串数组。');
      if (data.draft !== undefined && typeof data.draft !== 'boolean')
        throw new Error('draft 应为 true 或 false。');
      if (
        typeof title !== 'string' ||
        (data.description !== undefined && typeof data.description !== 'string')
      )
        throw new Error('标题和摘要应为文字。');
      const saved = await saveEntry('interview', {
        slug,
        data: {
          title,
          description: data.description || '',
          date,
          tags: data.tags || [],
          draft: data.draft || false
        },
        body
      });
      results.push({ path: file.path, ...saved, saved: true });
    } catch (error) {
      results.push({ path: file.path, saved: false, error: error.message });
    }
  }
  return results;
}

async function saveUploadedPhotos(payload) {
  await mkdir(assetPhotosDir, { recursive: true });
  const files = Array.isArray(payload.files) ? payload.files : [];
  const saved = [];
  for (const file of files) {
    const original = file.name || `photo-${randomUUID()}`;
    const parsed = path.parse(original);
    const ext = parsed.ext.toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp', '.avif', '.svg'].includes(ext)) {
      throw new Error(`Unsupported image extension: ${original}`);
    }
    const buffer = Buffer.from(file.data || '', 'base64');
    const name = `${slugify(file.slug || parsed.name)}-${randomUUID().slice(0, 6)}${ext}`;
    const target = safeJoin(assetPhotosDir, name);
    await writeFile(target, buffer);
    saved.push({
      src: `../../assets/photos/${name}`,
      caption: file.caption || ''
    });
  }
  return saved;
}

async function route(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      const html = await readFile(path.join(adminDir, 'index.html'), 'utf8');
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname.startsWith('/src/assets/photos/')) {
      const file = safeJoin(
        assetPhotosDir,
        decodeURIComponent(url.pathname.replace('/src/assets/photos/', ''))
      );
      const data = await readFile(file);
      return send(res, 200, data, contentType(file));
    }
    if (req.method === 'GET' && url.pathname === '/api/entries') {
      const type = url.searchParams.get('type');
      if (!['article', 'photography', 'interview'].includes(type))
        return json(res, 400, { error: 'Invalid type.' });
      return json(res, 200, await readCollection(type));
    }
    if (req.method === 'POST' && url.pathname === '/api/entry') {
      const payload = JSON.parse((await readRequest(req)).toString('utf8'));
      if (!['article', 'photography', 'interview'].includes(payload.type))
        return json(res, 400, { error: 'Invalid type.' });
      return json(res, 200, await saveEntry(payload.type, payload));
    }
    if (req.method === 'POST' && url.pathname === '/api/delete') {
      const payload = JSON.parse((await readRequest(req)).toString('utf8'));
      if (!['article', 'photography', 'interview'].includes(payload.type))
        return json(res, 400, { error: 'Invalid type.' });
      return json(res, 200, { deleted: await deleteEntry(payload.type, payload.slug) });
    }
    if (req.method === 'POST' && url.pathname === '/api/interviews/import') {
      const payload = JSON.parse((await readRequest(req)).toString('utf8'));
      return json(res, 200, { results: await importInterviews(payload) });
    }
    if (req.method === 'POST' && url.pathname === '/api/photos') {
      const payload = JSON.parse((await readRequest(req)).toString('utf8'));
      return json(res, 200, { gallery: await saveUploadedPhotos(payload) });
    }
    return json(res, 404, { error: 'Not found.' });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message });
  }
}

function listen(port, remainingAttempts = 20) {
  const server = http.createServer(route);
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && remainingAttempts > 0) {
      listen(port + 1, remainingAttempts - 1);
      return;
    }
    throw error;
  });
  server.listen(port, preferredHost, () => {
    const urlHost = preferredHost.includes(':') ? `[${preferredHost}]` : preferredHost;
    const urls = new Set([`http://${urlHost}:${port}/`]);
    if (preferredHost === '0.0.0.0' || preferredHost === '::') {
      urls.clear();
      urls.add(`http://127.0.0.1:${port}/`);
      for (const addresses of Object.values(os.networkInterfaces())) {
        for (const address of addresses || []) {
          if ((address.family === 'IPv4' || address.family === 4) && !address.internal) {
            urls.add(`http://${address.address}:${port}/`);
          }
        }
      }
    }
    console.log(`Local admin running at ${[...urls].join(' or ')}`);
  });
}

listen(preferredPort);
