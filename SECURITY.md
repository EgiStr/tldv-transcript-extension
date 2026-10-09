# Security Policy

## Reporting a vulnerability

Open a **[private security advisory](https://github.com/EgiStr/tldv-transcript-extension/security/advisories/new)**
rather than a public issue.

Please include what the issue is, how to reproduce it, and what an attacker could
do with it. You will get a response within a few days.

## What this extension can and cannot do

Stated plainly, because it is the useful part of a security review for a browser
extension:

**It has no network access.** There is no server, no analytics, no telemetry, and
no third-party API. `fetch` and `XMLHttpRequest` are never called anywhere in the
codebase. If you find a request being made, that is a serious bug — report it.

**It runs on one site.** Host access is limited to `https://tldv.io/*`. It cannot
read or modify any other website. It does not request `<all_urls>`.

**It has no install-time surface.** There is no `postinstall`, no build step, no
bundler, and no runtime dependencies. What you see in `src/` is what Chrome
executes.

**It cannot exfiltrate data.** There is nowhere for data to go. This is a
consequence of having no network access, not a promise.

## Permissions, and why each exists

| Permission | Reason | Verified by |
| --- | --- | --- |
| `downloads` | save the transcript file | `scripts/check.js` fails if `chrome.downloads.` is never called |
| `storage` | remember the format choice and last export | same, for `chrome.storage.` |
| `scripting` | inject the reader when automatic loading is not ready | same, for `chrome.scripting.` |
| `https://tldv.io/*` | read the meeting page | the check rejects any broader pattern or subdomain wildcard |

A permission with no corresponding call site fails the build. This is deliberate:
an unused permission widens the install prompt and the review surface for nothing.
`activeTab` was removed this way after an audit found zero call sites.

## What the extension does with your data

It reads the transcript text that tl;dv has already rendered in your browser, and
writes it to a file in your Downloads folder. That is the entire data flow.

- Nothing is uploaded.
- Nothing is sent to the author.
- The transcript stays on your machine.
- Uninstalling removes the extension; the files it produced are yours and stay
  where they are.

## Supply chain

- **No dependencies.** `package.json` lists zero runtime and zero dev
  dependencies, so there is no transitive supply chain to compromise. CI fails if
  a dependency is ever added without updating that assumption.
- **Releases are built in CI from a tag**, not on a maintainer's machine.
- **Releases carry a build provenance attestation**, so the published zip can be
  traced to this repository and commit:

  ```bash
  gh attestation verify tldv-transcript-exporter-v1.0.0.zip --repo EgiStr/tldv-transcript-extension
  ```

- **A SHA256 checksum is published** alongside each zip.

## Out of scope

- The accuracy of tl;dv's auto-caption text. It mishears names and terms; that is
  the source, not a vulnerability.
- Anything that requires an attacker to already control your browser profile or
  your machine.
- Vulnerabilities in Chrome itself, or in tl;dv.
