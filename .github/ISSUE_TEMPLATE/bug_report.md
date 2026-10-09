---
name: Bug report
about: Something is broken or produced wrong output
title: ''
labels: bug
assignees: ''
---

## What happened

<!-- What you expected, and what actually happened. -->

## Where in the output

<!--
If the transcript itself is wrong, this is the most useful section. Choose one:

- Output is only digits (0 1 2 3 ...)  -> data-word was read as text
- Every block has the same speaker    -> data-speaker was read as a name
- Words like "web-bob" appear as "web -bob" -> hyphen splitting
- Timestamps are all 1 second off     -> rounding instead of truncating
- Output is empty or says "No transcript blocks found"
- Something else (describe it)
-->

## Environment

- Extension version:
- Browser and version:
- OS:
- Was the **Transcript** tab open in tl;dv? yes / no

## Block count

<!--
The progress bar shows this, e.g. "390 / 390". If the run ended early, the
number it stopped at is useful.
-->

## Anything from the output file

<!--
If the file starts with a Warning line about missing blocks, paste that line.
It is expected behaviour and tells us how far the capture got.

Do NOT paste the transcript itself: it contains other people's speech. Describe
the problem instead.
-->

## Checks you have tried

- [ ] Reloaded the extension in `chrome://extensions`
- [ ] If the code was changed: deleted `Service Worker` and `Code Cache` from the Chrome profile
- [ ] Re-ran the export