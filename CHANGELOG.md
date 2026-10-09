# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

Releases are tag-driven: pushing a tag whose version matches `manifest.json` runs
the release workflow and publishes the zip with a build provenance attestation.

## [Unreleased]

## [1.1.1] — 2026-10-09

### Fixed

- The release notes printed a literal `$GITHUB_REPOSITORY` in the attestation
  verification command instead of the repository name.

### Changed

- GitHub Actions bumped to the versions dependabot proposed, after confirming
  each bump against the workflows that use it: `checkout` v4 → v7, `github-script`
  v7 → v9, `attest-build-provenance` v3 → v4. The `checkout` v7 breaking change
  concerns `pull_request_target` and `workflow_run`, neither of which these
  workflows use; the `github-script` v9 breaking change concerns
  `require('@actions/github')`, which the release notes script does not call.
  Verified by publishing a release with the new versions and confirming the
  attestation still verifies.

## [1.1.0] — 2026-10-09

### Added

- **CI** across Linux, Windows, and macOS on Node 18, 20, and 22, running the
  static checks, the unit tests, and the release build on every push and pull
  request.
- **Tag-driven releases.** Pushing a tag whose version matches `manifest.json`
  runs the checks, builds the zip, signs a
  [build provenance attestation](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations),
  and publishes the release with generated notes.
- **SHA256 checksum** published alongside every release zip.
- `CONTRIBUTING.md`, `SECURITY.md`, issue and pull request templates, and a
  dependabot configuration scoped to the GitHub Actions actually used.

### Changed

- The release zip is now written by Node instead of PowerShell's
  `Compress-Archive`, so the build produces the same archive on every platform.
  It previously would have failed outright on the Linux CI runner.

### Fixed

Three Node version incompatibilities, all found by CI and all invisible when
developing on a single version:

- `scripts/check.js` syntax-checked ES modules with `node --check`, which parses
  them as CommonJS. Node 22 tolerates this; Node 18 rejects them outright. ESM
  sources are now piped in with `--input-type=module`.
- The ESM bridge check imported `bridge.js` directly. Under Node 18 that file is
  CommonJS, so a named import failed with `Named export 'util' not found`. The
  probe now runs against a copy of the tree whose `package.json` declares module
  scope — which is what Chrome does with an MV3 service worker regardless of
  `package.json`.
- `npm test` used a glob that `node --test` does not expand, and a bare
  directory target that Node 22 rejects. An explicit file list is the only form
  all three versions accept.

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

[Unreleased]: https://github.com/EgiStr/tldv-transcript-extension/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/EgiStr/tldv-transcript-extension/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/EgiStr/tldv-transcript-extension/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/EgiStr/tldv-transcript-extension/releases/tag/v1.0.0
