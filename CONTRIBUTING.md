# Contributing

Thanks for taking the time to contribute.

## The one rule that matters

**Verify against the real page, not against your reading of the code.**

This extension scrapes a page that is actively misleading. Three DOM fields look
like data and are not:

| Looks like | Actually is |
| --- | --- |
| `data-word` | a sequential word index (`"3329"`), not the word |
| `data-speaker` | a boolean (`"true"`), not a name |
| block text from joined `textContent` | wrong: hyphens split a word across spans, so joining inserts a stray space |

Each of those produced a transcript with the **correct number of rows** and valid
Markdown, and each was wrong. They were found by diffing real output, never by
reading the markup.

So: if you change the parser, run it against a real meeting and compare the
result row by row. A passing test suite is necessary, not sufficient.

## Setup

No dependencies, no build step.

```bash
git clone https://github.com/EgiStr/tldv-transcript-extension
cd tldv-transcript-extension
npm verify    # static checks + unit tests
```

Requires Node 18 or newer.

## Before opening a pull request

```bash
npm verify              # must pass
npm run release         # must build a valid zip
```

`npm run release` verifies its own output: it resolves every manifest reference
and every relative import against the files it is about to ship. That check
exists because a package once shipped without `src/lib/bridge.js`, which
`output.js` imports — it would have installed cleanly and then failed on the
first export.

## What the checks enforce

`npm run check` fails the build on:

- a syntax error in any shipped file
- a manifest that is not valid MV3, or references a file that does not exist
- a permission that is requested but never used (an unused permission widens the
  install prompt for no reason)
- host access broader than `https://tldv.io/*`, or a subdomain wildcard
- a content-script match that is not the meetings page
- a lib loaded *after* the script that consumes it
- a global read into a variable that is then never used, or used without being
  bound — a `ReferenceError` at the first call, invisible behind a fallback path
- a broken ESM bridge (the check imports the real modules and renders all three
  formats)

If a check is wrong, fix the check in the same pull request as the code — but say
so in the description, because a weakened check is easy to miss in review.

## Testing without a browser

The `src/lib/*` files are pure and dual-published (CommonJS for Node,
`globalThis` for the content script), so they run directly under `node --test`.
Add unit tests there.

Anything touching the DOM, the virtualised list, or the service worker needs the
end-to-end harness, which drives the **installed** extension over CDP rather than
reimplementing the scrape:

```bash
# launch Chromium with the extension loaded on a debug port, then:
node scripts/run-extension-test.js <port> <timeoutSeconds> [outputDir]
```

Two things that will waste your afternoon otherwise:

- **The service worker sleeps.** Open the popup once
  (`chrome-extension://<ID>/src/popup.html`) to wake it before the harness runs.
- **Chrome caches the service-worker modules.** After changing lib code, delete
  `Service Worker` and `Code Cache` from the profile's `Default` folder, or you
  will debug a failure that no longer exists in the source.

## Commits

- One logical change per commit.
- Explain **why** in the body when the reason is not obvious from the diff. A
  commit that says "fix parser" helps nobody in six months.
- If you fix a bug caused by a wrong assumption, name the assumption. That is how
  the traps above got documented.

## Releases

Maintainers only. Releases are tag-driven:

1. Update `version` in **both** `manifest.json` and `package.json` (they must
   match; CI enforces it).
2. Commit, then tag: `git tag -a v1.2.0 -m "v1.2.0"`.
3. Push the tag: `git push origin v1.2.0`.

The Release workflow verifies the tag against the manifest, runs the full check
suite, builds the zip, signs a build provenance attestation, and publishes the
release with generated notes. A tag whose version disagrees with the manifest
fails before anything is published.

A tag with a suffix (`v1.1.0-beta.1`) is published as a prerelease.

## Reporting bugs

Include:

- what you expected and what happened
- the browser and version
- whether the meeting page had the **Transcript** tab open
- any `Warning:` line from the output file, verbatim
- for a scraping bug: the meeting's block count, and whether the output looked
  structurally valid but wrong

That last point matters most. A transcript of `0 1 2 3 …` is a specific, known
failure (see the table at the top), not a vague "it's broken".

**Do not paste real transcripts into an issue.** They contain other people's
speech. Describe the problem, or reproduce it on your own test meeting.

## Code of conduct

Be decent. Disagree about the code, not the person.
