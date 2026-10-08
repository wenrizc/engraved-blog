#!/usr/bin/env node
// Rebuild the active collection from the individually reviewed manifest.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(
  await readFile(path.join(root, 'src/data/plate-curation.json'), 'utf8')
);
const plates = [];
for (const entry of manifest.entries.filter((entry) => entry.decision === 'keep')) {
  const record = { ...entry.record };
  const file = path.join(root, 'src/assets/prints', record.file);
  const metadata = await sharp(file).metadata();
  record.width = metadata.width;
  record.height = metadata.height;
  record.orientation = record.width >= record.height ? 'landscape' : 'portrait';
  record.caption = `图版 ${String(plates.length + 1).padStart(2, '0')}`;
  plates.push(record);
}
if (plates.length >= 400)
  throw new Error('The reviewed collection must contain fewer than 400 plates.');
const payload = {
  source: 'The Met Open Access (CC0) and Project Gutenberg (public-domain artworks)',
  sourceUrl: 'https://www.metmuseum.org/hubs/open-access',
  generatedAt: new Date().toISOString(),
  count: plates.length,
  plates
};
await writeFile(
  path.join(root, 'src/data/generated/plates.json'),
  `${JSON.stringify(payload, null, 2)}\n`
);
const escape = (text) => String(text).replaceAll('|', '\\|');
const credits = [
  '# Plate credits',
  '',
  'The Met images are from its [Open Access collection](https://www.metmuseum.org/hubs/open-access), released under CC0.',
  'Doré illustrations come from the linked Project Gutenberg editions. The original artworks are in the public domain; these scans are not described as CC0.',
  'Doré is credited for the designs; the wood engravers are not identified by these image records. These are wood engravings, not copperplate etchings.',
  'Images retain their downloaded resolution (maximum edge 1800 px for website assets, without enlargement).',
  '',
  '| 图版 | Work | Artist | Date | Credit | Source |',
  '| --- | --- | --- | --- | --- | --- |',
  ...plates.map(
    (p) =>
      `| ${p.caption} | ${escape(p.title)} | ${escape(p.artist)} | ${escape(p.date)} | ${p.credit} | [${p.id}](${p.sourceUrl}) |`
  ),
  ''
].join('\n');
await writeFile(path.join(root, 'src/assets/prints/CREDITS.md'), credits);
const report = [
  '# 版画逐张审核与多雷资源扩充',
  '',
  `审核日期：${manifest.reviewedAt}。当前启用 ${plates.length} 张。`,
  '',
  '筛选依据：细密排线、强烈明暗、完整叙事和宏大空间；鲜明浮世绘兼容保留。多雷代表插图属于木口木刻，本次按视觉风格纳入，技法不改称蚀刻。',
  '',
  '原有资源：逐张查看 162 张，保留 120 张，移除 42 张，其中浮世绘保留 29 张。移除的原有文件可从本地 `.local-admin-trash/print-review-2026-10-07/` 恢复。',
  `多雷资源：下载并查看 286 张，第二轮删减 50 张，目前启用 ${plates.filter((p) => p.id.startsWith('pg-')).length} 张。原始下载图片及 URL 清单保存于本地 data/print-originals/dore/（不随网站发布）；下载源原图通常约 700–1200 px，并非出版级高清扫描。`,
  `新增知名版画家：约翰·马丁 1 张、皮拉内西 19 张、丢勒 9 张、卡洛 5 张，共 34 张。原图与馆藏元数据保存在本地 data/print-originals/masters/。`,
  '首页在浏览器加载时从全部启用图版中等概率随机选图；不指定多雷默认首图。静态 HTML 的首张仅作无脚本后备图。同步脚本限制启用图库少于 400 张。',
  '国芳 36709 裁去画面外的摄影色卡；原始图片备份保存在同一回收目录。',
  '',
  '来源书籍：',
  '',
  '- [《地狱篇》](https://www.gutenberg.org/ebooks/8789)',
  '- [《炼狱篇》](https://www.gutenberg.org/ebooks/8795)',
  '- [《天堂篇》](https://www.gutenberg.org/ebooks/8799)',
  '- [《圣经画廊》](https://www.gutenberg.org/ebooks/8710)',
  '- [《失乐园》西班牙文插图版](https://www.gutenberg.org/ebooks/67092)',
  '',
  '多雷题名采用书名与原图标识；没有根据画面猜测馆藏标题。日期表示插图系列年代，不代表下载版本的印刷日期。',
  '',
  '重新同步：`node scripts/sync_curated_plates.mjs`。重新下载：`npm run fetch:plates`，优先遵循逐张审核清单。',
  '',
  '## 原有资源逐张审核',
  '',
  '| 原编号 | 作品 | 决定 | 理由 |',
  '| --- | --- | --- | --- |',
  ...manifest.entries
    .filter((e) => e.origin === 'existing')
    .map(
      (e) =>
        `| ${e.originalNumber} | [${escape(e.record.title)}](${e.record.sourceUrl}) | ${e.decision === 'keep' ? '保留' : '移除'} | ${e.reason} |`
    ),
  '',
  '## 新下载资源逐张审核',
  '',
  '| 作品 | 决定 | 理由 | 原图 |',
  '| --- | --- | --- | --- |',
  ...manifest.entries
    .filter((e) => e.origin === 'downloaded' || e.origin === 'museum-download')
    .map(
      (e) =>
        `| ${escape(e.record.title)} | ${e.decision === 'keep' ? '启用' : '仅本地研究'} | ${e.reason} | [下载](${e.imageUrl}) |`
    ),
  ''
].join('\n');
await writeFile(path.join(root, 'docs/print-resource-review.md'), report);
const html = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const gallery = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>精选版画资源</title><style>
body{margin:0;padding:32px;background:#f4f0e7;color:#302e2a;font-family:serif}header{max-width:900px;margin-bottom:28px}h1{font-size:30px}input{padding:12px;width:min(90%,500px);font:inherit}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:24px}figure{margin:0;padding:16px;background:#fffdfa}img{width:100%;height:310px;object-fit:contain}figcaption{line-height:1.6;margin-top:12px}small{display:block}a{color:inherit}figure[hidden]{display:none}
</style><header><h1>精选版画资源 · ${plates.length} 张</h1><p>多雷的史诗插图、细密欧洲版画与浮世绘。点击图片查看大图；每张保留来源。</p><p><a href="print-resource-review.md">逐张审核记录</a></p><input type="search" placeholder="搜索书名、作者或图版编号" aria-label="搜索版画"></header><main>
${plates.map((p) => `<figure><a href="../src/assets/prints/${html(p.file)}"><img loading="lazy" src="../src/assets/prints/${html(p.file)}" alt="${html(p.alt)}"></a><figcaption>${html(p.caption)} · ${html(p.title)}<small>${html(p.artist)} · ${html(p.date)}</small><small>${html(p.medium)}</small><a href="${html(p.sourceUrl)}">来源 · ${html(p.id)}</a></figcaption></figure>`).join('\n')}
</main><script>document.querySelector('input').addEventListener('input',event=>{const q=event.target.value.toLowerCase();document.querySelectorAll('figure').forEach(f=>{f.hidden=!f.textContent.toLowerCase().includes(q)})})</script></html>`;
await writeFile(path.join(root, 'docs/print-collection.html'), gallery);
console.log(`Synced ${plates.length} reviewed plates.`);
