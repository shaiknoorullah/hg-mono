// Static server for the journey prototypes. Correct MIME types matter:
// a module or a vendored library served as text/html fails strict MIME checking
// and the page falls back silently. Never test these over file://.
//
//   node serve.mjs <dir> [port]
import http from 'node:http';
import fs from 'node:fs';

const ROOT = process.argv[2];
const PORT = Number(process.argv[3] || 5400);
if (!ROOT) { console.error('usage: node serve.mjs <dir> [port]'); process.exit(1); }

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
};

http.createServer((q, r) => {
  const name = decodeURIComponent(q.url.split('?')[0]).replace(/^\//, '');
  if (name.includes('..')) { r.writeHead(400); return r.end('no'); }
  const ext = name.slice(name.lastIndexOf('.'));
  try {
    r.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream' });
    r.end(fs.readFileSync(ROOT + '/' + name));
  } catch { r.writeHead(404); r.end('not found'); }
}).listen(PORT, () => console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}`));
