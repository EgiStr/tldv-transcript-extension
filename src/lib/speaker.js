/**
 * Speaker-label parsing. Pure, shared by the content script and the tests, so
 * the parser under test is the parser that ships.
 *
 * BACKGROUND — why this is not just reading an attribute:
 *   In the tl;dv transcript DOM, a block is a `<p data-index data-time>` holding
 *   `<span data-word data-speaker data-clipped data-time>` children. It is
 *   tempting to read `data-speaker` as the speaker's name. It is NOT a name: it
 *   is a boolean marker, "true" on the span that opens a new speaker turn and
 *   "false" on the spans that continue it. Reading it as a name labels every
 *   block "true" and collapses the whole transcript to one speaker.
 *
 *   The real name is embedded in the text of the turn's opening span, in the
 *   form "01:12:28 sri_c_fauzi_x: " — timestamp, name, colon.
 */

/**
 * Matches a leading "<timestamp> <name>: " label.
 *
 * Accepts an unpadded minute ("33:10", not just "03:10") because that is what
 * tl;dv actually renders, and an hh:mm:ss form for meetings past an hour.
 * Anchored to the start, so a colon later in a sentence is never a label.
 */
const SPEAKER_TEXT_RE = /^(\d{1,2}:\d{2}(?::\d{2})?)\s+([^:\n]{1,60}):\s*/;

/** "mm:ss" or "hh:mm:ss" to milliseconds, or null if unparseable. */
function parseTimestamp(s) {
  const raw = String(s == null ? '' : s).trim();
  const parts = raw.split(':');
  if (parts.length !== 2 && parts.length !== 3) return null;
  const nums = parts.map((p) => Number(p));
  if (!nums.every((n) => Number.isFinite(n) && n >= 0)) return null;
  const secs = nums.length === 3
    ? nums[0] * 3600 + nums[1] * 60 + nums[2]
    : nums[0] * 60 + nums[1];
  return secs * 1000;
}

/**
 * Split a leading speaker label off the block text.
 *
 * @returns {{speaker:string, text:string, ms:number|null}}
 *   `speaker` is '' when no label is present, and the text is returned
 *   unchanged in that case. A colon in the middle of a sentence is not a label,
 *   because the match is anchored to the start and requires a leading timestamp.
 */
function parseSpeakerLabel(rawText) {
  const text = String(rawText == null ? '' : rawText);
  const out = { speaker: '', text: text, ms: null };

  const m = text.match(SPEAKER_TEXT_RE);
  if (!m) return out;

  const name = m[2].replace(/\s+/g, ' ').trim();
  // A name is a short run with no leading punctuation and at least one letter.
  if (!name || !/[A-Za-z\u00C0-\u024F]/.test(name)) return out;

  out.speaker = name;
  out.text = text.slice(m[0].length);
  out.ms = parseTimestamp(m[1]);
  return out;
}

const Speaker = { SPEAKER_TEXT_RE, parseSpeakerLabel, parseTimestamp };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Speaker;
}
if (typeof globalThis !== 'undefined') {
  globalThis.TLDV_SPEAKER = Speaker;
}
