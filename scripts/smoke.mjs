import { spawn } from 'node:child_process';

const port = 4327;
const routes = [
  '/',
  '/article/',
  '/article/design-notes/',
  '/photography/',
  '/photography/2026-07-11-stone-garden/',
  '/archive/',
  '/tags/',
  '/tags/cat/',
  '/about/',
  '/404'
];

const server = spawn(
  'node_modules/.bin/astro',
  ['preview', '--host', '127.0.0.1', '--port', String(port)],
  {
    stdio: ['ignore', 'pipe', 'pipe']
  }
);
let output = '';
server.stdout.on('data', (chunk) => {
  output += chunk.toString();
});
server.stderr.on('data', (chunk) => {
  output += chunk.toString();
});

const stop = () => server.kill('SIGTERM');
process.on('exit', stop);

try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error(`preview server did not start\n${output}`);

  for (const route of routes) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`);
    const html = await response.text();
    if (response.status !== 200) throw new Error(`${route}: expected 200, got ${response.status}`);
    for (const marker of ['<main', '<nav', '<title>']) {
      if (!html.includes(marker)) throw new Error(`${route}: missing ${marker}`);
    }
    if (route.startsWith('/article/') && route !== '/article/' && !html.includes('文章'))
      throw new Error(`${route}: missing article body`);
    if (
      route.startsWith('/photography/') &&
      route !== '/photography/' &&
      (!html.includes('<img') || !html.includes('photo-zoom-trigger'))
    )
      throw new Error(`${route}: missing photo lightbox trigger`);
  }
  console.log(`smoke: ${routes.length} routes passed`);
} finally {
  stop();
}
