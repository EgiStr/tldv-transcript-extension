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
const zlib = require('node:zlib');
const { createHash } = require('node:crypto');

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

/**
 * Write a ZIP archive with no external tools and no dependencies.
 *
 * The obvious implementation shells out to `Compress-Archive` on Windows or
 * `zip` on Unix, which means the build produces different bytes on different
 * machines and breaks outright on a runner that has neither. GitHub's CI runs
 * on Linux, so this builds the archive in-process instead: identical output
 * everywhere, and the same ZIP a user downloads is the one CI tested.
 *
 * @param {string} outPath   where to write the archive
 * @param {Array<{rel: string, abs: string}>} files
 */
function writeZip(outPath, files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  // A fixed timestamp keeps builds reproducible: same input, same bytes.
  const dosTime = 0;
  const dosDate = (1 << 5) | 1; // 1980-01-01

  for (const f of files) {
    const data = fs.readFileSync(f.abs);
    const crc = crc32(data);
    const deflated = zlib.deflateRawSync(data, { level: 9 });

    // Only use the compressed form when it actually helps.
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const nameBuf = Buffer.from(f.rel, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    chunks.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42);

    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  fs.writeFileSync(outPath, Buffer.concat([...chunks, centralBuf, end]));
}

let CRC_TABLE = null;

function crc32(buf) {
  if (CRC_TABLE === null) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
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

  // The archive entries are built straight from disk, in a stable order, so the
  // same source tree always produces the same zip. A staging directory would
  // only add a copy step and a chance for the two trees to diverge.
  const files = [...wanted]
    .sort()
    .map((rel) => ({ rel, abs: path.join(ROOT, rel) }))
    .filter((f) => {
      if (fs.existsSync(f.abs)) return true;
      fail('missing on disk: ' + f.rel);
      return false;
    });

  if (process.exitCode) {
    console.error('\nRelease build aborted: a file is missing from disk.');
    return;
  }

  console.log('\n[3] archive');
  writeZip(zipPath, files);

  const kb = (fs.statSync(zipPath).size / 1024).toFixed(1);
  console.log('  ok    dist/' + zipName + ' (' + kb + ' KB, ' + files.length + ' files)');

  // A checksum file, so a downloader can verify what they got without trusting
  // the release page. GitHub CI attaches both this and the zip.
  const digest = createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
  const sumName = zipName + '.sha256';
  fs.writeFileSync(path.join(DIST, sumName), digest + '  ' + zipName + '\n');
  console.log('  ok    dist/' + sumName);
  console.log('  sha256 ' + digest);

  console.log('\nRelease package built and verified.');
  console.log('Install: unzip, then chrome://extensions -> Developer mode -> Load unpacked.');
}

main();
