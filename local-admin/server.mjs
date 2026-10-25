import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { createHash, randomUUID } from 'node:crypto';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile, rename, unlink, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.ADMIN_PROJECT_ROOT
  ? path.resolve(process.env.ADMIN_PROJECT_ROOT)
  : path.resolve(__dirname, '..');
const adminDir = __dirname;
const articlesDir = path.join(root, 'src', 'content', 'articles');
const interviewsDir = path.join(root, 'src', 'content', 'interviews');
const photosDir = path.join(root, 'src', 'content', 'photos');
const assetPhotosDir = path.join(root, 'src', 'assets', 'photos');
const trashDir = path.join(root, '.local-admin-trash');
const preferredPort = Number(process.env.ADMIN_PORT || 9797);
const preferredHost = process.env.ADMIN_HOST || '127.0.0.1';
const markdownRenderer = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize)
  .use(rehypeStringify);
const revisionOf = (markdown) => createHash('sha256').update(markdown).digest('hex');
const thumbnails = new Map();
const execFileAsync = promisify(execFile);
const publishPaths = ['src/content', 'src/assets/photos'];
let publishing = false;
let mutations = Promise.resolve();
function mutate(action) {
  const result = mutations.then(action);
  mutations = result.catch(() => {});
  return result;
}

function sanitized(value) {
  return String(value || '').replaceAll(root, '[project]');
}

function tail(value, limit = 4000) {
  const text = sanitized(value).trim();
  return text.length > limit ? text.slice(-limit) : text;
}

function commandError(error, command) {
  const detail = [error.stderr, error.stdout, error.message].filter(Boolean).join('\n');
  const failure = new Error(detail.trim() || `${command} 执行失败。`);
  failure.statusCode = 500;
  return failure;
}

async function run(command, args, timeout = 120000) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  // The desktop harness can inject GIT_CONFIG_COUNT with empty keys, which
  // makes every git command fail before it starts. Drop only those transient
  // include-style overrides; the user's repository config is unaffected.
  for (const key of Object.keys(env)) {
    if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(key)) delete env[key];
  }
  try {
    const result = await execFileAsync(command, args, {
      cwd: root,
      env,
      timeout,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true
    });
    return result;
  } catch (error) {
    throw commandError(error, command);
  }
}

async function publishSite() {
  if (publishing) {
    const error = new Error('已有发布任务正在执行，请稍候。');
    error.statusCode = 409;
    throw error;
  }
  publishing = true;
  try {
    const branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 30000)).stdout.trim();
    if (branch !== 'main') throw new Error(`当前分支是 ${branch}，发布仅支持 main。`);
    const top = (await run('git', ['rev-parse', '--show-toplevel'], 30000)).stdout.trim();
    if (path.resolve(top) !== path.resolve(root)) {
      throw new Error('ADMIN_PROJECT_ROOT 不是 Git 仓库根目录。');
    }

    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const lint = await run(npm, ['run', 'lint'], 3 * 60 * 1000);
    const build = await run(npm, ['run', 'build'], 15 * 60 * 1000);
    const status = (
      await run(
        'git',
        ['status', '--porcelain', '--untracked-files=all', '--', ...publishPaths],
        30000
      )
    ).stdout.trim();

    let committed = false;
    let commit = '';
    if (status) {
      await run('git', ['add', '-A', '--', ...publishPaths], 30000);
      const stagedRaw = (
        await run('git', ['diff', '--cached', '--name-only', '-z', '--', ...publishPaths], 30000)
      ).stdout;
      const stagedFiles = stagedRaw.split('\0').filter(Boolean);
      if (stagedFiles.length) {
        const stamp = new Date()
          .toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
          .slice(0, 16)
          .replace('T', ' ');
        const message = `content: publish from local admin ${stamp}`;
        await run('git', ['commit', '--only', '-m', message, '--', ...stagedFiles], 60000);
        commit = (await run('git', ['rev-parse', '--short', 'HEAD'], 30000)).stdout.trim();
        committed = true;
      }
    }

    const ahead = Number(
      (await run('git', ['rev-list', '--count', 'origin/main..HEAD'], 30000)).stdout.trim() || '0'
    );
    let pushed = false;
    if (ahead > 0) {
      try {
        await run('git', ['push', 'origin', 'main'], 5 * 60 * 1000);
        pushed = true;
      } catch (error) {
        const prefix = committed && commit ? `已提交 ${commit}，但 push 失败：` : 'push 失败：';
        const failure = new Error(prefix + error.message);
        failure.statusCode = 500;
        throw failure;
      }
    }

    return {
      branch,
      committed,
      commit,
      pushed,
      ahead,
      build: tail(`${lint.stdout}\n${lint.stderr}\n${build.stdout}\n${build.stderr}`),
      message: pushed
        ? `已构建、${committed ? `提交 ${commit}、` : ''}推送 main${committed ? '' : '（包含已有本地提交）'}。GitHub Actions 将开始重建线上站点。`
        : '构建完成，内容没有变化，也没有待推送的本地提交。'
    };
  } finally {
    publishing = false;
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'content-type': type,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
    'content-security-policy': type.startsWith('image/svg+xml')
      ? "default-src 'none'; sandbox"
      : "frame-ancestors 'none'"
  });
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
    const error = new Error('Path escapes content directory.');
    error.statusCode = 400;
    throw error;
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

function storedSlug(type, input) {
  const slug = String(input);
  const parts = slug.split('/');
  if (
    (type !== 'interview' && parts.length !== 1) ||
    parts.some((part) => !part || part === '.' || part === '..') ||
    slug.includes('\\')
  )
    throw new Error('目录路径无效。');
  safeJoin(collectionDir(type), `${slug}.md`);
  return slug;
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

function toMarkdown(data, body = '') {
  const metadata = Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  );
  const normalizedBody = typeof body === 'string' ? body.trim() : '';
  const bodyBlock = normalizedBody ? `\n\n${normalizedBody}\n` : '\n';
  return `---\n${stringifyYaml(metadata, { lineWidth: 0 })}---${bodyBlock}`;
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
      revision: revisionOf(markdown),
      ...parsed
    });
  }
  return entries.sort((a, b) => String(b.data.date || '').localeCompare(String(a.data.date || '')));
}

async function readRequest(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 45 * 1024 * 1024) {
      const error = new Error('文件过大，请每次上传小于 30 MB 的图片。');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function saveEntry(type, payload) {
  const dir = collectionDir(type);
  const data = payload.data || {};
  if (typeof data.title !== 'string' || !data.title.trim()) throw new Error('请填写标题。');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(data.date) ||
    !Number.isFinite(Date.parse(data.date)) ||
    new Date(data.date).toISOString().slice(0, 10) !== data.date
  )
    throw new Error('请填写有效日期。');
  if (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== 'string'))
    throw new Error('标签应为字符串数组。');
  if (typeof data.draft !== 'boolean') throw new Error('草稿状态无效。');
  if (type === 'photography') {
    const gallery = data.gallery || [];
    if (!Array.isArray(gallery) || (!data.cover && !gallery.length))
      throw new Error('摄影作品至少需要一张图片。');
    if (
      gallery.some(
        (item) =>
          !item ||
          typeof item.src !== 'string' ||
          !item.src ||
          (item.caption !== undefined && typeof item.caption !== 'string')
      )
    )
      throw new Error('图片或说明格式无效。');
    for (const src of [data.cover, ...gallery.map((item) => item?.src)].filter(Boolean)) {
      if (
        typeof src !== 'string' ||
        !src.startsWith('../../assets/photos/') ||
        !existsSync(safeJoin(assetPhotosDir, src.slice('../../assets/photos/'.length)))
      )
        throw new Error('图片不存在，请重新添加图片。');
    }
  }
  await mkdir(dir, { recursive: true });
  const originalSlug = payload.originalSlug ? storedSlug(type, payload.originalSlug) : '';
  let slug =
    originalSlug && payload.slug === originalSlug
      ? originalSlug
      : entrySlug(type, payload.slug || data.title);
  if (originalSlug && type === 'interview' && payload.slug !== originalSlug) {
    const directory = String(payload.slug).replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    slug = [directory ? entrySlug(type, directory) : '', originalSlug.split('/').pop()]
      .filter(Boolean)
      .join('/');
  }
  const target = safeJoin(dir, `${slug}.md`);
  if (originalSlug && payload.revision) {
    const originalTarget = safeJoin(dir, `${originalSlug}.md`);
    if (
      !existsSync(originalTarget) ||
      revisionOf(await readFile(originalTarget, 'utf8')) !== payload.revision
    ) {
      const error = new Error('文件已被其他窗口或编辑器修改。请保留本机草稿，重新加载后再保存。');
      error.statusCode = 409;
      throw error;
    }
  }
  if (existsSync(target) && originalSlug !== slug) {
    const error = new Error(`页面路径已存在：${slug}。请调整标题或日期。`);
    error.statusCode = 409;
    throw error;
  }
  await mkdir(path.dirname(target), { recursive: true });
  const body = typeof payload.body === 'string' ? payload.body : '';
  const markdown = toMarkdown(data, body);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, markdown, 'utf8');
    await rename(temporary, target);
    if (originalSlug && originalSlug !== slug) await unlink(safeJoin(dir, `${originalSlug}.md`));
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return { slug, file: `${slug}.md`, revision: revisionOf(markdown) };
}

async function deleteEntry(type, slug) {
  const dir = collectionDir(type);
  const target = safeJoin(dir, `${storedSlug(type, slug)}.md`);
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
          date: new Date(date).toISOString().slice(0, 10),
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
  const sanitized = [];
  if (files.length > 100) throw new Error('单次最多添加 100 张图片。');
  // Validate the whole batch before writing any assets.
  for (const file of files) {
    const buffer = Buffer.from(file.data || '', 'base64');
    if (!buffer.length || buffer.length > 30 * 1024 * 1024)
      throw new Error('图片大小应在 0 到 30 MB 之间。');
    if (
      !['.jpg', '.jpeg', '.png', '.webp', '.avif', '.svg'].includes(
        path.extname(file.name || '').toLowerCase()
      )
    )
      throw new Error(`不支持的图片格式：${file.name}`);
    try {
      const image = sharp(buffer).rotate();
      const metadata = await image.metadata();
      // Rasterize SVG so uploaded XML/scripts can never run on the admin origin.
      // Sharp also removes EXIF/XMP metadata, including location and device details.
      const output = await (metadata.format === 'svg' ? image.png() : image).toBuffer({
        resolveWithObject: true
      });
      const extension = { jpeg: '.jpg', png: '.png', webp: '.webp', heif: '.avif' }[
        output.info.format
      ];
      if (!extension) throw new Error('Unsupported image format.');
      sanitized.push({ file, buffer: output.data, extension });
    } catch {
      throw new Error(`无法读取图片：${file.name || '未命名图片'}`);
    }
  }
  for (const { file, buffer, extension } of sanitized) {
    const original = file.name || `photo-${randomUUID()}`;
    const parsed = path.parse(original);
    const name = `${slugify(file.slug || parsed.name)}-${randomUUID().slice(0, 6)}${extension}`;
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
  try {
    const origin = `http://${req.headers.host}`;
    const url = new URL(req.url || '/', origin);
    const localAddresses = Object.values(os.networkInterfaces())
      .flat()
      .filter(Boolean)
      .map(({ address }) => (address.includes(':') ? `[${address}]` : address));
    const hosts = new Set(['localhost', '127.0.0.1', '[::1]', ...localAddresses]);
    if (!['0.0.0.0', '::'].includes(preferredHost)) {
      hosts.add(preferredHost.includes(':') ? `[${preferredHost}]` : preferredHost);
    }
    // Host validation prevents DNS rebinding; Origin and JSON checks prevent CSRF.
    if (
      !hosts.has(url.hostname) ||
      url.origin !== origin ||
      Number(url.port || 80) !== req.socket.localPort ||
      (req.headers.origin && req.headers.origin !== url.origin) ||
      (url.pathname.startsWith('/api/') && req.headers['sec-fetch-site'] === 'cross-site')
    ) {
      return json(res, 403, { error: '仅允许从管理页同一地址访问。' });
    }
    if (
      req.method === 'POST' &&
      req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json'
    ) {
      return json(res, 415, { error: '请求必须使用 application/json。' });
    }
    if (req.method === 'GET' && url.pathname === '/') {
      const html = await readFile(path.join(adminDir, 'index.html'), 'utf8');
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && ['/admin.css', '/admin.js'].includes(url.pathname)) {
      const file = path.join(adminDir, url.pathname.slice(1));
      return send(
        res,
        200,
        await readFile(file, 'utf8'),
        url.pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8'
      );
    }
    if (req.method === 'POST' && url.pathname === '/api/preview') {
      const payload = JSON.parse((await readRequest(req)).toString('utf8'));
      const rendered = await markdownRenderer.process(String(payload.body || ''));
      return json(res, 200, { html: String(rendered) });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/src/assets/photos/')) {
      const file = safeJoin(
        assetPhotosDir,
        decodeURIComponent(url.pathname.replace('/src/assets/photos/', ''))
      );
      const width = Number(url.searchParams.get('width'));
      if ([96, 480, 1440].includes(width)) {
        const info = await stat(file);
        const key = `${file}:${info.mtimeMs}:${info.size}:${width}`;
        let thumbnail = thumbnails.get(key);
        if (!thumbnail) {
          thumbnail = await sharp(file)
            .rotate()
            .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 82 })
            .toBuffer();
          if (thumbnails.size >= 80) thumbnails.delete(thumbnails.keys().next().value);
          thumbnails.set(key, thumbnail);
        }
        return send(res, 200, thumbnail, 'image/webp');
      }
      return send(res, 200, await readFile(file), contentType(file));
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
      return json(res, 200, await mutate(() => saveEntry(payload.type, payload)));
    }
    if (req.method === 'POST' && url.pathname === '/api/delete') {
      const payload = JSON.parse((await readRequest(req)).toString('utf8'));
      if (!['article', 'photography', 'interview'].includes(payload.type))
        return json(res, 400, { error: 'Invalid type.' });
      return json(res, 200, {
        deleted: await mutate(() => deleteEntry(payload.type, payload.slug))
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/publish') {
      await readRequest(req);
      return json(res, 200, await mutate(() => publishSite()));
    }
    if (req.method === 'POST' && url.pathname === '/api/interviews/import') {
      const payload = JSON.parse((await readRequest(req)).toString('utf8'));
      return json(res, 200, { results: await mutate(() => importInterviews(payload)) });
    }
    if (req.method === 'POST' && url.pathname === '/api/photos') {
      const payload = JSON.parse((await readRequest(req)).toString('utf8'));
      return json(res, 200, { gallery: await saveUploadedPhotos(payload) });
    }
    if (req.method === 'GET' && /\.(png|jpe?g|webp|avif|svg)$/i.test(url.pathname)) {
      const file = safeJoin(path.join(root, 'public'), decodeURIComponent(url.pathname.slice(1)));
      if (existsSync(file)) return send(res, 200, await readFile(file), contentType(file));
    }
    return json(res, 404, { error: 'Not found.' });
  } catch (error) {
    const status = error.statusCode || (error instanceof SyntaxError ? 400 : 500);
    return json(res, status, {
      error: error.code === 'ENOENT' ? '文件不存在。' : error.message.replaceAll(root, '[project]')
    });
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
