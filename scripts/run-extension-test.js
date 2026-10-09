/**
 * run-extension-test.js — drive the real extension end-to-end over CDP.
 *
 * This does NOT reimplement the extraction: it tells the extension's own
 * content script to start, then polls its progress exactly as the popup would.
 * The point is to test the shipped code, not a copy of it.
 *
 * Usage: node scripts/run-extension-test.js <port> [timeoutSeconds]
 */

const http = require('node:http');

const PORT = process.argv[2] || '9336';
const TIMEOUT_MS = (Number(process.argv[3]) || 300) * 1000;
const EXT_ID_RE = /chrome-extension:\/\/([a-z]+)\/src\/background\.js/;

function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
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
  });
}

/** Minimal CDP client over one target's websocket. */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];

  ws.addEventListener('message', (ev) => {
    const data = JSON.parse(ev.data);
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    } else if (data.method) {
      events.push(data);
    }
  });

  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });

  const send = (method, params) =>
    new Promise((resolve) => {
      const msgId = ++id;
      pending.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error('page exception: ' + (d.exception && d.exception.description ? d.exception.description : d.text));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  return { ready, send, evaluate, events, close: () => ws.close() };
}

/**
 * Read the rendered content back out of the extension's session storage.
 *
 * This script runs outside the extension, so it reaches the content through
 * CDP. The service worker has just been polled, so it is awake in practice.
 */
async function fetchContent(port) {
  const list = await getJson('/json/list');
  const sw = list.find((t) => t.type === 'service_worker' && EXT_ID_RE.test(t.url || ''));
  if (!sw) return null;

  return new Promise((resolve) => {
    const ws = new WebSocket(sw.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const timer = setTimeout(() => {
      try { ws.close(); } catch (e) {}
      resolve(null);
    }, 20000);

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    });

    const send = (method, params) =>
      new Promise((res) => {
        const i = ++id;
        pending.set(i, res);
        ws.send(JSON.stringify({ id: i, method, params }));
      });

    ws.addEventListener('open', async () => {
      await send('Runtime.enable', {});
      const r = await send('Runtime.evaluate', {
        expression:
          "(async()=>{const r=await chrome.storage.session.get('lastResult');" +
          "return r.lastResult && r.lastResult.content ? r.lastResult.content : null;})()",
        awaitPromise: true,
        returnByValue: true
      });
      clearTimeout(timer);
      const value = r && r.result && r.result.result ? r.result.result.value : null;
      try { ws.close(); } catch (e) {}
      resolve(value || null);
    });
  });
}

(async () => {
  const list = await getJson('/json/list');
  const sw = list.find((t) => t.type === 'service_worker' && EXT_ID_RE.test(t.url || ''));
  if (!sw) {
    console.error('extension service worker not running; open the popup once, then retry');
    process.exit(1);
  }
  const extId = sw.url.match(EXT_ID_RE)[1];
  console.log('extension id : ' + extId);

  const cdp = connect(sw.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable', {});

  const tabId = await cdp.evaluate(`
    const t = await chrome.tabs.query({ url: 'https://tldv.io/app/meetings/*' });
    return t.length ? t[0].id : null;
  `);
  if (tabId == null) {
    console.error('no tl;dv meeting tab open');
    process.exit(1);
  }
  console.log('target tab   : ' + tabId);

  // Ensure the content script is present. Automatic manifest injection does not
  // always happen under automation, so inject explicitly when the ping fails.
  const ping = await cdp.evaluate(`
    try {
      const r = await chrome.tabs.sendMessage(${tabId}, { type: 'TLDV_PING' });
      return JSON.stringify(r);
    } catch (e) {
      return JSON.stringify({ error: String(e && e.message ? e.message : e) });
    }
  `);
  console.log('ping         : ' + ping);

  if (ping.includes('error')) {
    console.log('injecting content script explicitly...');
    const inj = await cdp.evaluate(`
      try {
        await chrome.scripting.executeScript({
          target: { tabId: ${tabId} },
          files: ['src/lib/util.js','src/lib/verify.js','src/lib/speaker.js','src/lib/block.js','src/lib/markdown.js','src/content.js']
        });
        return 'ok';
      } catch (e) { return 'failed: ' + e.message; }
    `);
    console.log('inject       : ' + inj);
    if (inj !== 'ok') process.exit(1);
  }

  // Start the real run through the extension's own background worker path.
  console.log('\nstarting export via the extension...');
  const start = await cdp.evaluate(`
    try {
      const r = await chrome.tabs.sendMessage(${tabId}, { type: 'TLDV_START' });
      return JSON.stringify(r);
    } catch (e) { return 'error: ' + e.message; }
  `);
  console.log('start        : ' + start);

  const startedAt = Date.now();
  let lastHave = -1;
  let done = null;

  // Poll progress the way the popup does.
  while (Date.now() - startedAt < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 4000));

    const p = await cdp.evaluate(`
      try {
        const r = await chrome.tabs.sendMessage(${tabId}, { type: 'TLDV_PING' });
        return JSON.stringify(r);
      } catch (e) { return JSON.stringify({ error: String(e.message) }); }
    `);
    let parsed = {};
    try {
      parsed = JSON.parse(p);
    } catch (e) {
      /* ignore */
    }

    const have = parsed.have;
    const total = parsed.total;
    if (typeof have === 'number' && have !== lastHave) {
      const pct = total ? Math.round((have / total) * 100) : 0;
      console.log('  progress     : ' + have + ' / ' + total + ' (' + pct + '%)');
      lastHave = have;
    }

    // The run reports completion through the background worker, so ask it.
    const finished = await cdp.evaluate(`
      const r = await chrome.storage.session.get('lastResult');
      return JSON.stringify(r.lastResult ? {
        meetingId: r.lastResult.meetingId,
        blocks: r.lastResult.blocks,
        filename: r.lastResult.filename,
        contentLength: r.lastResult.content ? r.lastResult.content.length : 0
      } : null);
    `);
    if (finished && finished !== 'null') {
      done = JSON.parse(finished);
      break;
    }
  }

  cdp.close();

  console.log('');
  if (!done) {
    console.error('TIMEOUT: export did not finish within ' + TIMEOUT_MS / 1000 + 's');
    process.exit(1);
  }

  console.log('FINISHED');
  console.log('  meetingId    : ' + done.meetingId);
  console.log('  blocks       : ' + done.blocks);
  console.log('  filename     : ' + done.filename);
  console.log('  contentChars : ' + done.contentLength);

  // Pull the rendered content out of the extension and write it to disk, so the
  // result can be inspected and diffed rather than only counted.
  try {
    const full = await fetchContent(PORT, done.filename);
    if (full) {
      const outDir = process.argv[4] || '.';
      const outPath = require('node:path').resolve(outDir, 'e2e-' + done.filename);
      require('node:fs').mkdirSync(require('node:path').dirname(outPath), { recursive: true });
      require('node:fs').writeFileSync(outPath, full, 'utf8');
      console.log('  savedTo      : ' + outPath);
    }
  } catch (e) {
    console.error('  (could not save the content: ' + (e && e.message ? e.message : e) + ')');
  }

  process.exit(0);
})().catch((e) => {
  console.error('test harness error: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
