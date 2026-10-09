/**
 * cdp-eval.js — evaluate an expression in a Chrome tab over the DevTools
 * Protocol and print the result.
 *
 * Used for testing because the browser-mcp session is attached to a different
 * Chrome instance than the one under test.
 *
 * Usage:
 *   node scripts/cdp-eval.js <port> "<js expression>"
 *   node scripts/cdp-eval.js <port> --file <path-to-js>
 */

const http = require('node:http');
const fs = require('node:fs');

const port = process.argv[2] || '9333';
const arg = process.argv[3];
const isFile = process.argv[4] === '--file' || arg === '--file';
const expr = isFile ? fs.readFileSync(process.argv[4] || process.argv[3], 'utf8') : arg;

if (!expr) {
  console.error('usage: node scripts/cdp-eval.js <port> "<expression>" | --file <path>');
  process.exit(2);
}

function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('CDP request timed out')));
  });
}

(async () => {
  const targets = await getJson('/json/list');
  // Prefer a loaded tl;dv meeting tab. During navigation the URL can briefly be
  // about:blank, so fall back to any tl;dv page target before giving up.
  const tldv = targets.filter((t) => t.type === 'page' && /tldv\.io/.test(t.url));
  const tab = tldv.find((t) => /app\/meetings/.test(t.url)) || tldv[0];
  if (!tab) {
    const seen = targets
      .filter((t) => t.type === 'page')
      .map((t) => '  ' + String(t.url).slice(0, 90))
      .join('\n');
    console.error('no tl;dv tab found. Open pages were:\n' + (seen || '  (none)'));
    process.exit(1);
  }

  const WebSocket = require('node:http') && globalThis.WebSocket;
  if (!WebSocket) {
    console.error('this Node build has no global WebSocket; use Node 22+');
    process.exit(1);
  }

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0;

  const send = (method, params) =>
    new Promise((resolve) => {
      const msgId = ++id;
      const onMsg = (ev) => {
        const data = JSON.parse(ev.data);
        if (data.id === msgId) {
          ws.removeEventListener('message', onMsg);
          resolve(data);
        }
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

  ws.addEventListener('open', async () => {
    // Await the promise the expression may return, and surface thrown errors.
    const res = await send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true
    });

    if (res.result && res.result.exceptionDetails) {
      console.error('EXCEPTION:', JSON.stringify(res.result.exceptionDetails, null, 2));
      ws.close();
      process.exit(1);
    }

    const value = res.result && res.result.result ? res.result.result.value : undefined;
    console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    ws.close();
    process.exit(0);
  });

  ws.addEventListener('error', (e) => {
    console.error('websocket error:', e.message || e);
    process.exit(1);
  });

  setTimeout(() => {
    console.error('timed out waiting for CDP');
    process.exit(1);
  }, 120000);
})();
