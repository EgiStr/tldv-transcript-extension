# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

Releases are tag-driven: pushing a tag whose version matches `manifest.json` runs
the release workflow and publishes the zip with a build provenance attestation.

## [Unreleased]

## [1.0.0] — 2026-10-09

First release.

### Added

- **Transcript extraction** from a tl;dv meeting page, driving the virtualised
  transcript list directly. tl;dv's copy button stops at the first minute on a
  free plan, and the transcript only renders as the video plays, so the text is
  never all present at once.
- **Three output formats**: Markdown (table plus readable blocks), plain text, and
  JSON.
- **Completeness reporting.** If some blocks cannot be forced to render, the
  export still completes and the missing indices are written into the file as a
  `Warning:` line. Only a loss above 15% is treated as a failure.
- **Auto-scroll sweep** with a second pass to chase blocks the first pass missed.
- **Documentation** in English (`docs/INSTALL.md`) and Indonesian
  (`docs/PANDUAN.md`).

### Fixed

Bugs found by diffing real output against a verified baseline — each produced a
structurally valid transcript with the correct row count, so none was caught by a
row-count check:

- `data-word` was read as the word itself. It is a **sequential word index**, so
  the transcript came out as the digits `0 1 2 3 …`.
- `data-speaker` was read as a speaker name. It is a **boolean**, so every block
  was labelled `true` and the transcript collapsed to a single speaker.
- Hyphenated words were joined from `textContent`. Because a hyphen splits a word
  across spans that each carry a leading space, `web-bob` became `web -bob`.
  Reading the rendered `innerText` resolves this correctly.
- Timestamps were rounded. tl;dv **truncates**, so rounding put every timestamp
  one second ahead of the UI the user was comparing against. Verified against the
  live page: `16896 ms` is displayed as `00:16`.
- The ESM bridge into the service worker yielded an empty namespace, so the
  result failed to render and the failure was swallowed by a `catch`. Fixed with
  an explicit `bridge.js`, and the static check now imports the real modules and
  renders all three formats to prove the path works.
- The content script used `Block.` without ever defining it — a `ReferenceError`
  behind a fallback path. The static check now requires every global to be bound,
  used, and guarded.
- The sweep stopped early at 327/390 because the scroll bound was measured once
  while the container was still growing.

### Security

- Permissions limited to what the code calls: `downloads`, `storage`,
  `scripting`, and `https://tldv.io/*`. Unused `activeTab` removed.
- Host access narrowed from `https://*.tldv.io/*` to a single origin.
- No dependencies, so there is no transitive supply chain.
- Releases built in CI from a tag, with a build provenance attestation and a
  published SHA256 checksum.

[Unreleased]: https://github.com/EgiStr/tldv-transcript-extension/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/EgiStr/tldv-transcript-extension/releases/tag/v1.0.0
