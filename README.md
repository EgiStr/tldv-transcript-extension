# tl;dv Transcript Exporter

[![CI](https://github.com/EgiStr/tldv-transcript-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/EgiStr/tldv-transcript-extension/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/EgiStr/tldv-transcript-extension)](https://github.com/EgiStr/tldv-transcript-extension/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A Chrome extension that extracts the **full** transcript from a tl;dv meeting
page and saves it as Markdown, plain text, or JSON.

tl;dv's own copy button stops at the first minute on a free plan, and its
transcript only renders as the video plays — so a simple copy never gets the
whole thing. This extension drives the page's virtualised transcript list
directly and collects every block.

**Status:** verified against a real 390-block, 1 h 40 m meeting — 390/390 blocks,
byte-identical text, matching timestamps and speaker labels.

---

## Install

**[Download the latest release](https://github.com/EgiStr/tldv-transcript-extension/releases/latest)**
and unzip it to a permanent folder. Then:

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the unzipped folder — the one containing `manifest.json`
5. It appears as **tl;dv Transcript Exporter**

Then:

1. Open a meeting: `https://tldv.io/app/meetings/<MEETING_ID>/`
2. Make sure the **Transcript** tab is showing
3. Click the extension icon → **Export transcript**
4. The file downloads when the sweep finishes

Use the popup's **format** selector to switch between `.md`, `.txt`, and `.json`.

New here? **[docs/INSTALL.md](docs/INSTALL.md)** (English) and
**[docs/PANDUAN.md](docs/PANDUAN.md)** (Indonesian) walk through it with
troubleshooting.

---

## Verifying a download

Every release ships a SHA256 checksum and a signed build provenance attestation,
so you do not have to trust the release page:

```bash
sha256sum -c tldv-transcript-exporter-v1.0.0.zip.sha256

gh attestation verify tldv-transcript-exporter-v1.0.0.zip \
  --repo EgiStr/tldv-transcript-extension
```


## What it does

The transcript is a virtualised list: the container holds one `<p>` per block,
but only the handful near the current scroll position actually contain text. The
rest are empty placeholders. So the extension scrolls the container in small
steps, reading each block as it materialises, and then makes a second pass to
chase anything the first pass missed.

Three details in the DOM are actively misleading, and all three were found by
diffing real output rather than by reading the markup:

| Looks like | Actually is |
| --- | --- |
| `data-word` | a **sequential word index** (`"3329"`), not the word. Reading it as text yields a transcript of `0 1 2 3 …` — valid-looking and completely wrong. |
| `data-speaker` | a **boolean** (`"true"`/`"false"`), not a name. Reading it labels every block `true`. |
| block text from joined `textContent` | hyphenated words are **split across spans**, so joining inserts a stray space: `web-bob` becomes `web -bob`. The rendered `innerText` is correct. |

Timestamps are **truncated**, matching how tl;dv labels its own blocks. Verified
against the page: a block stamped `16896 ms` is shown by tl;dv as `00:16`.

---

## Partial captures are labelled, never silent

The virtualiser cannot always be forced to render every block. If a few are
missing the export still completes, and the missing indices are written into the
file:

```markdown
- **Warning:** 6 block(s) could not be rendered and are absent (indices: 270, 271, …)
```

A short transcript that admits it is short is far more useful than one that looks
complete. The export only refuses — with a visible error — when the loss is too
large to be a rendering quirk (>15%), when nothing was collected, or when the
captured text is empty or out of order.

---

## Development

```bash
npm test        # 45 unit tests
npm run check   # static checks: syntax, manifest, permissions, lib binding order
npm run verify  # both
npm run release # build dist/*.zip and verify the package
```

Requires Node 18 or newer. There are no dependencies, so there is nothing to
install.

The tests run in plain Node — no browser, no bundler. The lib files are pure and
dual-published (CommonJS for Node, `globalThis` for the content script), so the
code under test is the code that ships.

### Releases

Tag-driven. Pushing a tag that matches `manifest.json` runs
[`release.yml`](.github/workflows/release.yml), which:

1. refuses the release if the tag and `manifest.json` versions disagree
2. runs the full check suite
3. builds the zip and verifies it (manifest at the root, checksum matches)
4. signs a [build provenance attestation](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations)
5. publishes the release with generated notes, the zip, and the checksum

```bash
# bump version in manifest.json AND package.json (they must match)
git commit -am "Release v1.1.0"
git tag -a v1.1.0 -m "v1.1.0"
git push origin main v1.1.0
```

A tag with a suffix (`v1.1.0-beta.1`) publishes as a prerelease.

[`ci.yml`](.github/workflows/ci.yml) runs on every push and pull request across
Linux, Windows, and macOS on Node 18 and 22 — Node 18 because that is the floor
`package.json` declares.

### Layout

```
manifest.json
src/
  background.js      service worker: renders the output, triggers the download
  content.js         the scraper; drives the virtualised list
  popup.html/.css/.js
  lib/
    util.js          timestamps, filename building, text cleanup
    verify.js        completeness check over the captured blocks
    speaker.js       "01:12:28 name: " label parsing
    block.js         reading one block out of the DOM
    markdown.js      .md / .txt / .json rendering
    output.js        assembles { filename, content, mime, summary }
    bridge.js        exposes the classic-script libs to the ESM worker
scripts/
  check.js              static checks
  build-release.js      packages dist/ and verifies its own output
  run-extension-test.js drives the real extension end-to-end over CDP
tests/
```

### End-to-end testing

`scripts/run-extension-test.js` drives the actual installed extension over the
Chrome DevTools Protocol — it does not reimplement the scrape. It starts a run,
polls progress exactly as the popup does, then writes the rendered result to disk
for inspection.

```bash
# launch Chromium with the extension loaded on a debug port, then:
node scripts/run-extension-test.js <port> <timeoutSeconds> <outputDir>
```

Two things to know when running it:

- **The service worker sleeps.** MV3 workers are killed when idle, so open the
  popup once (`chrome-extension://<ID>/src/popup.html`) to wake it first.
- **Clear the extension cache after changing lib code**, or Chrome may serve the
  previous module and produce a failure that no longer exists in the source:
  delete `Service Worker` and `Code Cache` from the profile's `Default` folder.

`npx skills add`-style automation is out of scope; this is a manual unpacked
extension by design, so the source is auditable in place.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: changes to the parser
must be checked against a **real** meeting page, because this DOM produces output
with the correct row count and wrong content, and a green test suite will not
catch that.

Security issues: [SECURITY.md](SECURITY.md) — report privately, not in an issue.

Changes by release: [CHANGELOG.md](CHANGELOG.md).

---

## Limitations

- tl;dv's transcript is **auto-caption text**. Names and technical terms are
  misheard, and speaker labels are inconsistent. This is a faithful extraction
  of what tl;dv shows, not a cleaned-up transcript.
- Meeting pages change. If tl;dv renames its DOM attributes the extraction will
  break loudly (`nothing collected`), not quietly.
- The scrape takes roughly 3–5 minutes for a 1 h 40 m meeting, because it is
  bounded by how fast the virtualiser re-renders.

## License

MIT
