<!--
Thanks for the pull request. A few things that make review faster.
-->

## What this changes

<!-- One or two sentences. What behaviour is different after this? -->

## Why

<!--
The reason, not the diff. If this fixes a bug caused by a wrong assumption,
name the assumption — that is how the documented DOM traps were found.
-->

## How it was verified

- [ ] `npm verify` passes
- [ ] `npm run release` builds a valid zip

<!--
If this touches the parser, the DOM reading, or the sweep, say how you checked
it against a REAL meeting page. A green test suite is necessary, not sufficient:
three of the traps in this codebase produced output with the correct row count
and completely wrong content, and none was caught by a row-count check.

If you compared output, say what you compared: row counts, per-row text lengths,
text character by character, speaker tally.
-->

## Checklist

- [ ] One logical change
- [ ] No new dependency (CI fails if one is added without updating that job)
- [ ] No new permission, or the reason is explained below
- [ ] Doc or comment updated where behaviour changed
- [ ] `CHANGELOG.md` updated if this is user-visible

## Permissions

<!-- Delete this section if no permission or host access changed. -->

<!--
The build fails on a permission with no call site, or host access broader than
https://tldv.io/*. If you need to widen it, explain why here.
-->
