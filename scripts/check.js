/**
 * Static QA: syntax-check every JS file and validate manifest.json.
 * Run with: npm run check
 *
 * Catches the errors that would otherwise only surface as a silent failure to
 * load in Chrome: a syntax error anywhere in the bundle, a manifest that is not
 * valid JSON, or a permission/field that is not allowed in MV3.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
let failures = 0;

function fail(msg) {
  failures++;
  console.error('  FAIL  ' + msg);
}

function ok(msg) {
  console.log('  ok    ' + msg);
}

// ---------------------------------------------------------------- collect

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const allFiles = walk(ROOT);

// ------------------------------------------------------------- syntax check

// ------------------------------------------------------------- syntax check

console.log('\n[1] JavaScript syntax');
const jsFiles = allFiles.filter((f) => f.endsWith('.js') && !f.includes('node_modules'));

/**
 * Syntax-check one file the way that file will actually be loaded.
 *
 * `node --check` parses its input as CommonJS unless the file is `.mjs` or the
 * nearest package.json says `"type": "module"`. This extension's service worker
 * and its lib/ modules are real ES modules but cannot carry that flag: the same
 * lib files are ALSO loaded as classic scripts by the content script, and
 * package.json governs the whole tree. So `--check` rejects them outright.
 *
 * Node 22 tolerates this; Node 18 does not, which is how this was found — the
 * check passed locally and failed on the Node 18 CI leg. Piping the source with
 * `--input-type=module` checks the real grammar on every Node version without
 * renaming files or flagging the whole package.
 */
function syntaxCheckArgs(absPath, relPath) {
  // Service worker, popup, and lib/ are ESM. util.js is dual-published
  // (module.exports for Node, globalThis in the browser) so it parses either
  // way. Everything else (scripts/, tests/) is CommonJS.
  const isEsm = relPath.startsWith('src/') && relPath !== 'src/lib/util.js';
  return isEsm
    ? { args: ['--input-type=module', '--check'], input: fs.readFileSync(absPath, 'utf8') }
    : { args: ['--check'], input: undefined };
}

for (const f of jsFiles) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  const { args, input } = syntaxCheckArgs(f, rel);
  try {
    execFileSync(process.execPath, args, {
      stdio: 'pipe',
      ...(input === undefined ? {} : { input })
    });
    ok(rel);
  } catch (e) {
    fail(rel + ' -> ' + String(e.stderr || e.message).split('\n')[0]);
  }
}

// -------------------------------------------------------- manifest validity

console.log('\n[2] manifest.json');
const manifestPath = path.join(ROOT, 'manifest.json');
let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  ok('valid JSON');
} catch (e) {
  fail('invalid JSON: ' + e.message);
}

if (manifest) {
  if (manifest.manifest_version === 3) ok('manifest_version is 3');
  else fail('manifest_version must be 3, got ' + manifest.manifest_version);

  for (const key of ['name', 'version', 'description']) {
    if (manifest[key]) ok('has ' + key);
    else fail('missing required field: ' + key);
  }

  // Version must be 1-4 dot-separated integers.
  if (/^\d+(\.\d+){0,3}$/.test(String(manifest.version))) ok('version format valid');
  else fail('version must be 1-4 integers separated by dots, got ' + manifest.version);

  // Permissions must be a known-safe subset, and every one requested must
  // actually be used. An unused permission widens the install prompt and the
  // review surface for nothing — `activeTab` sat here unused until an audit
  // checked the code against the manifest field by field.
  const ALLOWED = new Set(['downloads', 'storage', 'scripting']);
  const perms = manifest.permissions || [];

  // Map a permission to the chrome.* namespace that requires it.
  const USES = {
    downloads: 'chrome.downloads.',
    storage: 'chrome.storage.',
    scripting: 'chrome.scripting.',
    activeTab: 'chrome.tabs.' // only if the file lacks host permission to match
  };

  const allSrc = fs
    .readdirSync(path.join(ROOT, 'src'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'))
    .concat(
      fs
        .readdirSync(path.join(ROOT, 'src', 'lib'))
        .filter((f) => f.endsWith('.js'))
        .map((f) => fs.readFileSync(path.join(ROOT, 'src', 'lib', f), 'utf8'))
    )
    .join('\n');

  for (const p of perms) {
    if (!ALLOWED.has(p)) {
      fail('unexpected permission (review before shipping): ' + p);
      continue;
    }
    const marker = USES[p];
    if (marker && !allSrc.includes(marker)) {
      fail('permission "' + p + '" is requested but ' + marker + ' is never called');
    } else {
      ok('permission: ' + p + ' (used)');
    }
  }

  // Host access must be scoped to the one origin the code touches, with no
  // subdomain wildcard: the content script and every call target `tldv.io`
  // itself. A `*.tldv.io` pattern asks for more than is used.
  const hosts = manifest.host_permissions || [];
  if (hosts.length === 0) {
    fail('no host_permissions, but the content script needs tldv.io');
  }
  for (const h of hosts) {
    if (h === '<all_urls>' || h === '*://*/*' || /\/\/\*\./.test(h)) {
      fail('host_permission is broader than needed: ' + h);
    } else if (!/^https:\/\/tldv\.io\//.test(h)) {
      fail('host_permission is not scoped to https://tldv.io: ' + h);
    } else {
      ok('host_permission scoped to: ' + h);
    }
  }

  // The script match patterns must stay on the meetings page.
  for (const cs of manifest.content_scripts || []) {
    for (const m of cs.matches || []) {
      if (!/^https:\/\/tldv\.io\/app\/meetings\//.test(m)) {
        fail('content script matches more than the meetings page: ' + m);
      } else {
        ok('content script scoped to: ' + m);
      }
    }
  }

  // Every file the manifest references must exist, or Chrome fails to load.
  const referenced = [];
  const push = (p) => p && referenced.push(p);
  if (manifest.background && manifest.background.service_worker) push(manifest.background.service_worker);
  if (manifest.action && manifest.action.default_popup) push(manifest.action.default_popup);
  for (const cs of manifest.content_scripts || []) {
    for (const j of cs.js || []) push(j);
    for (const c of cs.css || []) push(c);
  }
  const icons = Object.assign({}, manifest.icons, (manifest.action || {}).default_icon);
  for (const k of Object.keys(icons)) push(icons[k]);

  for (const rel of referenced) {
    const full = path.join(ROOT, rel);
    if (fs.existsSync(full)) ok('referenced file exists: ' + rel);
    else fail('manifest references a missing file: ' + rel);
  }
}

// ------------------------------------------------------ popup HTML wiring

console.log('\n[3] popup wiring');
const popupPath = path.join(ROOT, 'src', 'popup.html');
if (!fs.existsSync(popupPath)) {
  fail('src/popup.html missing');
} else {
  const html = fs.readFileSync(popupPath, 'utf8');
  ok('popup.html exists');

  // MV3 forbids inline scripts in extension pages (CSP), so any inline <script>
  // with content is a load-time failure waiting to happen.
  const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi) || [];
  const withBody = inline.filter((s) => s.replace(/<[^>]+>/g, '').trim().length > 0);
  if (withBody.length === 0) ok('no inline script bodies (CSP-safe)');
  else fail(withBody.length + ' inline <script> body found; move it to a .js file');

  // Every id referenced by the popup script should exist in the HTML, and vice
  // versa for ids the script reaches for.
  const scriptPath = path.join(ROOT, 'src', 'popup.js');
  if (!fs.existsSync(scriptPath)) {
    fail('src/popup.js missing');
  } else {
    const js = fs.readFileSync(scriptPath, 'utf8');
    const htmlIds = new Set((html.match(/id="([^"]+)"/g) || []).map((s) => s.slice(4, -1)));
    const wanted = new Set(
      (js.match(/getElementById\(['"]([^'"]+)['"]\)/g) || []).map((s) => s.replace(/.*\(['"]|['"]\)/g, ''))
    );
    const missing = [...wanted].filter((id) => !htmlIds.has(id));
    if (missing.length === 0) ok('all ' + wanted.size + ' referenced ids present in HTML');
    else fail('popup.js references ids not in HTML: ' + missing.join(', '));
  }
}

// ------------------------------------------------- content script lib order

// content.js reads TLDV / TLDV_VERIFY / TLDV_MARKDOWN off globalThis, so those
// lib files must be listed (and therefore executed) BEFORE it. A wrong order
// makes the extension load cleanly and then silently do nothing, which is the
// worst failure mode to debug — so it is asserted here.
console.log('\n[4] content script global dependencies');
for (const cs of (manifest && manifest.content_scripts) || []) {
  const js = cs.js || [];
  const last = js[js.length - 1];

  // Expected providers per global, keyed by the file that defines them. Every
  // lib in this map must be loaded; DIRECT marks the ones the content script
  // reads itself. TLDV_SPEAKER is deliberately not direct: it is a dependency
  // of lib/block.js, not of the content script.
  const PROVIDERS = {
    'src/lib/util.js': { global: 'TLDV', alias: 'U', direct: true },
    'src/lib/verify.js': { global: 'TLDV_VERIFY', alias: 'Verify', direct: true },
    'src/lib/speaker.js': { global: 'TLDV_SPEAKER', alias: null, direct: false },
    'src/lib/block.js': { global: 'TLDV_BLOCK', alias: 'Block', direct: true },
    'src/lib/markdown.js': { global: 'TLDV_MARKDOWN', alias: 'Markdown', direct: true }
  };

  for (const [file, spec] of Object.entries(PROVIDERS)) {
    const providerIdx = js.indexOf(file);
    if (providerIdx === -1) {
      fail('content_scripts does not load ' + file + ' (needed for ' + spec.global + ')');
      continue;
    }
    if (providerIdx > js.indexOf(last)) {
      fail(file + ' must be listed before ' + last);
    } else {
      ok(spec.global + ' provided by ' + file + ' before ' + last);
    }
  }

  // The consumer must not merely mention each global it uses: it must BIND it
  // to a local alias and actually USE that alias. A global read into a variable
  // and then never used, or used without being bound, throws a ReferenceError
  // at the first call — and when that call sits behind a fallback path the
  // failure is invisible. This caught exactly that for TLDV_BLOCK, which was
  // used as `Block.` while never having been defined.
  const consumerPath = path.join(ROOT, last);
  if (!fs.existsSync(consumerPath)) {
    fail('content script missing on disk: ' + last);
    return;
  }

  const src = fs.readFileSync(consumerPath, 'utf8');
  const guardMatch = src.match(/if\s*\(([^)]*)\)\s*\{[\s\S]{0,200}?check content_scripts order/);

  for (const spec of Object.values(PROVIDERS)) {
    if (!spec.direct) continue;
    const { global: globalName, alias } = spec;
    const bound = new RegExp('const\\s+' + alias + '\\s*=\\s*globalThis\\.' + globalName + '\\b');
    const used = new RegExp('\\b' + alias + '\\.[A-Za-z_]');

    if (!src.includes('globalThis.' + globalName)) {
      fail(last + ' never reads ' + globalName + ' — check for a rename');
    } else if (!bound.test(src)) {
      fail(globalName + ' is read but never bound to a usable local alias (' + alias + ')');
    } else if (!used.test(src)) {
      fail(globalName + ' is bound to ' + alias + ' but never used');
    } else if (guardMatch && !guardMatch[1].includes('!' + alias)) {
      fail(globalName + ' (' + alias + ') is not guarded at startup');
    } else {
      ok(last + ' binds and uses ' + globalName + ' (as ' + alias + ')');
    }
  }
}

// ------------------------------------------------------------------ result

// -------------------------------------------------- ESM bridge correctness

// The service worker is an ES module, but the lib files are classic scripts
// that publish on globalThis. Importing those directly as ESM yields an empty
// namespace, which fails at RUNTIME with "X is not a function" and is invisible
// to a syntax check. This actually exercises the modules to prove it works.
//
// Why this does not simply `import('./src/lib/bridge.js')`:
//
// `bridge.js` is an ES module to Chrome — an MV3 service worker treats every
// .js file it loads as a module, regardless of package.json. Node has to be
// told, and under Node 18 a .js file with no `"type": "module"` in the nearest
// package.json is treated as CommonJS, so a named import from it fails with
// "Named export 'util' not found".
//
// Adding `"type": "module"` to package.json would fix Node and break nothing in
// Chrome — but it would also switch the meaning of the CommonJS `src/lib/*`
// files for Node, which the unit tests load with `require`. So the check builds
// a temporary package.json declaring module scope NEXT TO A COPY of the tree,
// and runs the real import there. Chrome's behaviour is what matters; this
// reproduces it on the Node version that is hardest to please.
console.log('\n[5] ESM bridge');

const bridgeProbe = (() => {
  const fsTmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tldv-esm-'));

  // Copy only what the import graph needs, plus a package.json that puts the
  // whole copy in ES-module scope.
  const copyOf = path.join(fsTmp, 'src');
  fs.mkdirSync(copyOf, { recursive: true });
  fs.cpSync(path.join(ROOT, 'src'), copyOf, { recursive: true });
  fs.writeFileSync(
    path.join(fsTmp, 'package.json'),
    JSON.stringify({ type: 'module' })
  );

  const probePath = path.join(fsTmp, 'probe.mjs');
  fs.writeFileSync(
    probePath,
    `
import { util as U, verify as Verify, markdown as Markdown } from './src/lib/bridge.js';
import { buildOutput } from './src/lib/output.js';

const out = [];
const ok = (m) => out.push('ok ' + m);
const fail = (m) => out.push('fail ' + m);

for (const [name, mod, fn] of [
  ['util', U, 'formatTime'],
  ['verify', Verify, 'check'],
  ['markdown', Markdown, 'toMarkdown']
]) {
  if (mod && typeof mod[fn] === 'function') ok(name + ' exports functions');
  else fail(name + ' did not export usable functions');
}

const rows = [
  { index: 0, ms: 0, time: '00:00', speaker: 'A', text: 'halo' },
  { index: 1, ms: 60000, time: '01:00', speaker: 'B', text: 'ya | tidak' }
];

for (const fmt of ['md', 'txt', 'json']) {
  const built = buildOutput({ rows, format: fmt, meetingId: 'abc' });
  if (built.content && built.filename.endsWith('.' + fmt)) {
    ok('buildOutput produces ' + fmt + ' (' + built.content.length + ' chars)');
  } else {
    fail('buildOutput failed for ' + fmt);
  }
}

const md = buildOutput({ rows, format: 'md', meetingId: 'abc' }).content;
if (md.includes('ya \\\\| tidak')) ok('pipe escaping survives the ESM path');
else fail('pipe escaping broken through the ESM path');

console.log(out.join('\\n'));
`
  );

  return { dir: fsTmp, probePath };
})();

{
  let probeOut = '';
  let probeErr = '';
  try {
    probeOut = execFileSync(process.execPath, [bridgeProbe.probePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
  } catch (e) {
    probeErr = String(e.stderr || e.message || e);
  }

  if (probeErr) {
    fail('the ESM bridge is broken: ' + probeErr.split('\n').find((l) => l.trim() && !l.startsWith('file:'))?.trim());
  }

  for (const line of probeOut.split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('ok ')) ok(line.slice(3));
    else if (line.startsWith('fail ')) fail(line.slice(5));
  }

  if (!probeOut.includes('buildOutput produces md')) {
    fail('the ESM bridge probe produced no results');
  }

  fs.rmSync(bridgeProbe.dir, { recursive: true, force: true });
}

console.log('');
if (failures === 0) {
  console.log('Static checks passed.');
  process.exit(0);
} else {
  console.error(failures + ' static check(s) failed.');
  process.exit(1);
}
