/**
 * build-release.js — package the extension for distribution.
 *
 * Produces dist/tldv-transcript-exporter-v<version>.zip containing exactly the
 * files the browser loads at runtime, and then VERIFIES the package rather than
 * assuming the file list is right:
 *
 *   - every path the manifest references is present in the zip
 *   - every relative `import` in a shipped file resolves to a shipped file
 *
 * That second check exists because a hand-built package once dropped
 * src/lib/bridge.js, which output.js imports. The zip looked complete and the
 * extension would have loaded and then failed on first export.
 *
 * Usage: node scripts/build-release.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

/** Files and directories that ship. Everything else is dev-only. */
const SHIP_FILES = ['manifest.json', 'README.md', 'LICENSE'];
const SHIP_DIRS = ['src', 'icons'];

function walk(dir, base) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(rel);
  }
  return out;
}

function fail(msg) {
  console.error('  FAIL  ' + msg);
  process.exitCode = 1;
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const version = manifest.version;

  // ------------------------------------------------ collect the shipped set
  const wanted = new Set(SHIP_FILES);
  for (const d of SHIP_DIRS) {
    for (const rel of walk(path.join(ROOT, d), ROOT)) wanted.add(rel);
  }

  // ------------------------------------------------ manifest references exist
  console.log('[1] manifest references');
  const refs = [];
  if (manifest.background && manifest.background.service_worker) {
    refs.push(manifest.background.service_worker);
  }
  if (manifest.action && manifest.action.default_popup) refs.push(manifest.action.default_popup);
  if (manifest.action && manifest.action.default_icon) {
    refs.push(...Object.values(manifest.action.default_icon));
  }
  if (manifest.icons) refs.push(...Object.values(manifest.icons));
  for (const cs of manifest.content_scripts || []) {
    refs.push(...(cs.js || []), ...(cs.css || []));
  }

  for (const r of new Set(refs)) {
    if (!wanted.has(r)) fail('manifest references ' + r + ' but it is not in the shipped set');
    else console.log('  ok    ' + r);
  }

  // ------------------------------------------------ every import resolves
  //
  // A shipped file whose relative import points at a file that was not shipped
  // produces an extension that loads and then dies at the first call.
  console.log('\n[2] relative imports resolve inside the package');
  for (const rel of wanted) {
    if (!rel.endsWith('.js')) continue;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;

    const src = fs.readFileSync(abs, 'utf8');
    const re = /(?:^|\n)\s*(?:import|export)[^'"\n]*from\s*['"](\.{1,2}\/[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const target = path
        .relative(ROOT, path.resolve(path.dirname(abs), m[1]))
        .split(path.sep)
        .join('/');
      if (!wanted.has(target)) {
        fail(rel + ' imports ' + m[1] + ' -> ' + target + ', which is NOT shipped');
      } else {
        console.log('  ok    ' + rel + ' -> ' + target);
      }
    }
  }

  if (process.exitCode) {
    console.error('\nRelease build aborted: the package would be broken.');
    return;
  }

  // ------------------------------------------------ build
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const zipName = 'tldv-transcript-exporter-v' + version + '.zip';
  const zipPath = path.join(DIST, zipName);

  // Use a staging copy so the archive has no extra directory level.
  const staging = path.join(require('node:os').tmpdir(), 'tldv-release-' + version);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  for (const rel of wanted) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) {
      fail('missing on disk: ' + rel);
      continue;
    }
    const dst = path.join(staging, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }

  if (process.exitCode) {
    fs.rmSync(staging, { recursive: true, force: true });
    console.error('\nRelease build aborted: a file is missing from disk.');
    return;
  }

  console.log('\n[3] archive');
  // PowerShell is the reliable zip tool on Windows; `zip` is not always present.
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      'Compress-Archive -Path "' + staging + '\\*" -DestinationPath "' + zipPath + '" -Force'
    ],
    { stdio: 'inherit' }
  );
  fs.rmSync(staging, { recursive: true, force: true });

  const kb = (fs.statSync(zipPath).size / 1024).toFixed(1);
  console.log('  ok    dist/' + zipName + ' (' + kb + ' KB, ' + wanted.size + ' files)');

  console.log('\nRelease package built and verified.');
  console.log('Install: unzip, then chrome://extensions -> Developer mode -> Load unpacked.');
}

main();
