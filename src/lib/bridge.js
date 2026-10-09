/**
 * ESM bridge for the background service worker.
 *
 * WHY THIS FILE EXISTS:
 *   src/lib/util.js and src/lib/markdown.js are classic scripts that publish
 *   themselves on globalThis (so the content script can load them via the
 *   manifest, in order). A service worker is an ES module, and
 *   `import * as Markdown from './markdown.js'` against a classic script yields
 *   an EMPTY namespace — the functions are not ESM exports, so every call fails
 *   with "Markdown.toMarkdown is not a function".
 *
 *   This module imports the classic scripts for their side effect (they set
 *   globalThis), then re-exports the real objects. One place to get the bridge
 *   right instead of scattering workarounds.
 */

import './util.js';
import './verify.js';
import './speaker.js';
import './block.js';
import './markdown.js';

const U = globalThis.TLDV;
const Verify = globalThis.TLDV_VERIFY;
const Markdown = globalThis.TLDV_MARKDOWN;
const Speaker = globalThis.TLDV_SPEAKER;
const Block = globalThis.TLDV_BLOCK;

if (!U || !Verify || !Markdown || !Speaker || !Block) {
  // Fail loudly at import time rather than at the first export attempt.
  throw new Error(
    'lib bridge failed: TLDV=' + typeof U + ' TLDV_VERIFY=' + typeof Verify +
    ' TLDV_MARKDOWN=' + typeof Markdown + ' TLDV_SPEAKER=' + typeof Speaker + ' TLDV_BLOCK=' + typeof Block
  );
}

export { U as util, Verify as verify, Markdown as markdown, Speaker as speaker, Block as block };
