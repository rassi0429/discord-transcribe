import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

export function createDashboard(store, { port = 3210 } = {}) {
  const clients = new Set();
  const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
  const server = createServer(async (req, res) => {
    // Loopback binding plus Host/Origin checks prevent exposing transcripts to other sites.
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host) || (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin))) { res.writeHead(403).end(); return; }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https://cdn.discordapp.com https://media.discordapp.net; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'snapshot', ...store.snapshot() })}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (path === '/api/state') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(store.snapshot())); return; }
    if (!files[path]) { res.writeHead(404).end(); return; }
    try {
      const [file, type] = files[path];
      const body = await readFile(new URL(`../public/${file}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }).end(body);
    } catch { res.writeHead(500).end(); }
  });
  const broadcast = event => {
    for (const res of clients) {
      if (res.writableLength > 1024 * 1024) { res.destroy(); clients.delete(res); }
      else res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };
  store.on('change', broadcast);
  const pulse = setInterval(() => { for (const res of clients) res.write(': heartbeat\n\n'); }, 15000);
  server.on('close', () => { clearInterval(pulse); store.off('change', broadcast); });
  return { server, close: () => { for (const res of clients) res.end(); server.close(); } };
}
