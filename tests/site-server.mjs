import { dev } from 'astro';
import { constants } from 'node:fs';
import { cp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.env.TEST_SITE_ROOT;
if (!root) throw new Error('TEST_SITE_ROOT is required. Run through Playwright.');

// Fixtures retain the sample content regardless of the author's current draft choices.
// Neither the browser tests nor the integration admin writes to the real library.
for (const name of ['src', 'public', 'astro.config.mjs', 'package.json', 'tsconfig.json']) {
  await cp(name, path.join(root, name), { recursive: true, mode: constants.COPYFILE_FICLONE });
}
await symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), 'dir');
for (const name of [
  'articles/design-notes.md',
  'photos/2026-07-02-concrete-quiet.md',
  'photos/2026-07-08-yard-cats.md',
  'photos/2026-07-11-stone-garden.md'
]) {
  const file = path.join(root, 'src/content', name);
  const markdown = await readFile(file, 'utf8');
  await writeFile(file, markdown.replace(/^draft: true$/m, 'draft: false'));
}
await rm(path.join(root, 'src/content/photos/2026-10-09-北京.md'), { force: true });

const server = await dev({
  root,
  cacheDir: path.join(root, '.astro/cache'),
  vite: { cacheDir: path.join(root, '.astro/vite') },
  server: { host: '127.0.0.1', port: 4330 }
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await server.stop();
    await rm(root, { recursive: true, force: true });
    process.exit(0);
  });
}
