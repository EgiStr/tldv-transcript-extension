/**
 * Pure helpers shared by the extension. No DOM globals, no chrome.* APIs —
 * everything here is a plain function so it can be unit-tested under Node.
 *
 * Loaded as a classic script in the content script (registers on
 * globalThis.TLDV) and imported directly by tests.
 */

const TLDV = (() => {
  'use strict';

  /** Zero-pad to two digits. */
  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /**
   * Milliseconds to a display timestamp.
   * Under an hour renders as mm:ss to match tl;dv's own UI; an hour or more
   * renders hh:mm:ss. A meeting crossing the hour boundary therefore changes
   * format partway through, which is intended.
   *
   * TRUNCATES (floor), matching tl;dv. Verified against the page: a block
   * stamped 16896 ms is labelled "00:16" by tl;dv itself, as are 46336 -> 00:46
   * and 89344 -> 01:29. Rounding to nearest or up would put every timestamp one
   * second ahead of the UI the user is comparing against.
   */
  function formatTime(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
    return pad2(m) + ':' + pad2(s);
  }

  /** Collapse all whitespace runs to single spaces and trim. */
  function collapseWhitespace(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  /**
   * Strip a leading "Speaker:" label from block text.
   *
   * The transcript DOM sometimes repeats the speaker inside the text node.
   * Only a short leading label is removed so a genuine first sentence
   * containing a colon is left alone.
   */
  function stripSpeakerPrefix(s) {
    return String(s == null ? '' : s).replace(/^[^:\n]{1,40}:\s*/, '');
  }

  /** Normalise raw block text into the form written to output. */
  function cleanText(s) {
    return collapseWhitespace(stripSpeakerPrefix(s));
  }

  /**
   * Escape a value for a Markdown table cell.
   *
   * A literal pipe would otherwise be read as a column separator and silently
   * corrupt the row's structure, so it is escaped, and newlines are flattened
   * because a table cell cannot span lines.
   */
  function escapeTableCell(s) {
    return collapseWhitespace(s).replace(/\|/g, '\\|');
  }

  /**
   * Escape a value for a Markdown heading/plain-text context.
   * Only newlines need collapsing here.
   */
  function escapePlain(s) {
    return collapseWhitespace(s);
  }

  /**
   * Derive { meetingId } from a tl;dv meeting URL.
   * Returns meetingId: null when the URL is not a meeting page, so callers can
   * report a clear error instead of exporting a file with an empty id.
   */
  function parseMeetingUrl(url) {
    const out = { meetingId: null, path: null };
    if (!url) return out;
    try {
      const u = new URL(url);
      const m = u.pathname.match(/^\/app\/meetings\/([A-Za-z0-9]+)/);
      if (m) {
        out.meetingId = m[1];
        out.path = u.pathname;
      }
    } catch (e) {
      // not a URL — leave nulls
    }
    return out;
  }

  /**
   * Build the canonical output filename.
   * Kept deterministic so re-running an export overwrites rather than piling
   * up near-duplicate files, and date-stamped so separate days stay apart.
   */
  function buildFilename(meetingId, ext, date) {
    const d = date instanceof Date ? date : new Date();
    const stamp =
      d.getFullYear() +
      pad2(d.getMonth() + 1) +
      pad2(d.getDate()) +
      '-' +
      pad2(d.getHours()) +
      pad2(d.getMinutes());
    const id = meetingId || 'unknown';
    return 'tldv-transcript-' + id + '-' + stamp + '.' + ext;
  }

  /**
   * Sanitise a string for use inside a filename.
   * Windows forbids \ / : * ? " < > | and a leading/trailing dot.
   */
  function sanitizeFilenamePart(s) {
    return String(s == null ? '' : s)
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^\.+|\.+$/g, '')
      .trim();
  }

  return {
    pad2,
    formatTime,
    collapseWhitespace,
    stripSpeakerPrefix,
    cleanText,
    escapeTableCell,
    escapePlain,
    parseMeetingUrl,
    buildFilename,
    sanitizeFilenamePart
  };
})();

// Export for Node tests without breaking classic-script loading in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TLDV;
}
if (typeof globalThis !== 'undefined') {
  globalThis.TLDV = TLDV;
}
