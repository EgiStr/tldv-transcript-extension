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

console.log('\n[1] JavaScript syntax');
const jsFiles = allFiles.filter((f) => f.endsWith('.js') && !f.includes('node_modules'));
for (const f of jsFiles) {
  const rel = path.relative(ROOT, f);
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
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
// to a syntax check. This actually imports the modules to prove it works.
console.log('\n[5] ESM bridge');
(async () => {
  try {
    const url = require('node:url').pathToFileURL(
      path.join(ROOT, 'src', 'lib', 'bridge.js')
    ).href;
    const mod = await import(url);

    if (mod.util && typeof mod.util.formatTime === 'function') ok('util exports functions');
    else fail('util did not export usable functions');

    if (mod.verify && typeof mod.verify.check === 'function') ok('verify exports functions');
    else fail('verify did not export usable functions');

    if (mod.markdown && typeof mod.markdown.toMarkdown === 'function') ok('markdown exports functions');
    else fail('markdown did not export usable functions');

    // Prove the whole output path works end to end with real data.
    const outputUrl = require('node:url').pathToFileURL(
      path.join(ROOT, 'src', 'lib', 'output.js')
    ).href;
    const out = await import(outputUrl);

    const rows = [
      { index: 0, ms: 0, time: '00:00', speaker: 'A', text: 'halo' },
      { index: 1, ms: 60000, time: '01:00', speaker: 'B', text: 'ya | tidak' }
    ];
    for (const fmt of ['md', 'txt', 'json']) {
      const built = out.buildOutput({ rows, format: fmt, meetingId: 'abc' });
      if (built.content && built.filename.endsWith('.' + fmt)) {
        ok('buildOutput produces ' + fmt + ' (' + built.content.length + ' chars)');
      } else {
        fail('buildOutput failed for ' + fmt);
      }
    }

    // A pipe in the text must survive as an escaped pipe, not split the row.
    const md = out.buildOutput({ rows, format: 'md', meetingId: 'abc' }).content;
    if (md.includes('ya \\| tidak')) ok('pipe escaping survives the ESM path');
    else fail('pipe escaping broken through the ESM path');
  } catch (e) {
    fail('importing the bridge threw: ' + (e && e.message ? e.message : e));
  }

  console.log('');
  if (failures === 0) {
    console.log('Static checks passed.');
    process.exit(0);
  } else {
    console.error(failures + ' static check(s) failed.');
    process.exit(1);
  }
})();
