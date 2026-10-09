/**
 * Reading one transcript block out of the DOM. Pure.
 *
 * Lives in lib/ (rather than inside content.js) so it can be unit-tested
 * against a fake DOM node. Shared with the content script via globalThis.
 *
 * TWO FIELDS THAT LOOK LIKE DATA BUT ARE NOT — this is the whole reason the
 * function is isolated and tested:
 *
 *   data-word     a SEQUENTIAL WORD INDEX ("3329", "3330", ...), NOT the word.
 *                 Reading it as text yields a transcript of the digits
 *                 0,1,2,3... — valid-looking Markdown with entirely wrong
 *                 content and no error raised. The text is textContent.
 *
 *   data-speaker  a BOOLEAN marker ("true"/"false"), NOT a name. The name is
 *                 the opening span's innerText.
 *
 * The opening span of a turn carries the label as one run:
 *   textContent = "33:10 m_fh_n_x: "    innerText = "m_fh_n_x"
 */

const Block = (() => {
  'use strict';

  const Speaker = typeof module !== 'undefined' && module.exports
    ? require('./speaker.js')
    : globalThis.TLDV_SPEAKER;

  const U = typeof module !== 'undefined' && module.exports
    ? require('./util.js')
    : globalThis.TLDV;

  /** A name candidate must be short, non-numeric, and contain a letter. */
  function looksLikeName(s) {
    const v = U.collapseWhitespace(s);
    if (!v || v.length > 60) return false;
    if (/^\d+$/.test(v)) return false;
    return /[A-Za-z\u00C0-\u024F]/.test(v);
  }

  /**
   * @param {Element} p a `<p data-index data-time>` element
   * @returns {{index:number, time:number, speaker:string, text:string}|null}
   */
  function readBlockFromNode(p) {
    if (!p || typeof p.getAttribute !== 'function') return null;

    const idx = parseInt(p.getAttribute('data-index'), 10);
    if (!Number.isFinite(idx)) return null;

    const spans = p.querySelectorAll('span[data-word]');
    if (!spans || spans.length === 0) return null;

    let ms = parseInt(p.getAttribute('data-time'), 10);
    if (!Number.isFinite(ms)) ms = 0;

    let speaker = '';

    // ---------------------------------------------------------------- text
    //
    // Prefer the element's innerText. The spans split a hyphenated word into
    // separate spans ("·web" + "-bob"), each carrying a LEADING space, so
    // joining textContent with a space yields "web -bob" and joining it with
    // nothing yields "webbob" when the pieces are actually " web" and " bob".
    // Only the rendered innerText resolves that correctly, because the browser
    // has already collapsed the inline layout into real text.
    //
    // textContent is the fallback for a detached or unrendered node, where
    // innerText is empty.
    // Keep the line structure here: collapseWhitespace turns "\n" into a space,
    // which would merge the speaker line into the text. Normalise line endings
    // only, split the name off, and collapse each piece afterwards.
    let text = String(p.innerText || '').replace(/\r\n?/g, '\n');

    let speakerSource = '';
    const nl = text.indexOf('\n');
    if (nl !== -1) {
      const firstLine = U.collapseWhitespace(text.slice(0, nl));
      const rest = U.collapseWhitespace(text.slice(nl + 1));
      if (looksLikeName(firstLine) && rest) {
        speaker = firstLine;
        text = rest;
      } else {
        text = U.collapseWhitespace(text);
      }
    } else {
      text = U.collapseWhitespace(text);
    }

    // Strip a leading "<time> <name>: " label, whether or not the name was
    // already recovered from the first line.
    const label = Speaker.parseSpeakerLabel(text);
    if (label.speaker || label.ms != null) {
      if (!speaker && label.speaker) speaker = label.speaker;
      if (label.ms != null && (label.ms > 0 || ms === 0)) ms = label.ms;
      text = label.text;
    }
    speakerSource = speaker;

    if (!text) {
      // Fall back to the raw spans when innerText is unavailable.
      const parts = [];
      for (let i = 0; i < spans.length; i++) {
        const s = spans[i];
        const raw = s.textContent || '';
        if (!raw) continue;

        if (i === 0 && !speaker) {
          const label = Speaker.parseSpeakerLabel(U.collapseWhitespace(raw));
          if (label.speaker) {
            speaker = label.speaker;
            if (label.ms != null && (label.ms > 0 || ms === 0)) ms = label.ms;
            if (label.text) parts.push(label.text);
            continue;
          }
          const inner = U.collapseWhitespace(s.innerText || '');
          if (looksLikeName(inner)) speaker = inner;
        }
        parts.push(raw);
      }
      // Join without a separator, then normalise: the spans already carry
      // their own leading spaces, and inserting more would break hyphenation.
      text = U.collapseWhitespace(parts.join(''));
    }

    // Recover the speaker from the spans if innerText gave us nothing.
    if (!speaker) {
      const first = spans[0];
      const inner = U.collapseWhitespace(first.innerText || '');
      const tc = U.collapseWhitespace(first.textContent || '');
      const label = Speaker.parseSpeakerLabel(tc);
      if (label.speaker) {
        speaker = label.speaker;
        if (label.ms != null && (label.ms > 0 || ms === 0)) ms = label.ms;
      } else if (looksLikeName(inner)) {
        speaker = inner;
      }
    }

    text = U.collapseWhitespace(text);
    if (!text) return null;

    return { index: idx, time: ms, speaker: speaker, text: text };
  }

  return { readBlockFromNode, looksLikeName };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Block;
}
if (typeof globalThis !== 'undefined') {
  globalThis.TLDV_BLOCK = Block;
}
