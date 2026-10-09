/**
 * Verification gate. Pure — takes the collected blocks and the expected total
 * and decides whether the export is safe to write.
 *
 * This mirrors the check that caught real gaps during the reference run
 * (233/390 collected while the sweep looked finished), so it is not decorative:
 * a non-empty `missing` list means the caller must keep sweeping.
 */

const Verify = (() => {
  'use strict';

  /**
   * @param {Object<string|number, {time:number, speaker:string, text:string}>} acc
   * @param {number} expectedTotal - authoritative block count from the page
   * @returns {{ok:boolean, total:number, have:number, missing:number[],
   *            empty:number[], nonMonotonic:Array<{prev:number,cur:number}>,
   *            duplicates:number[], reasons:string[]}}
   */
  function check(acc, expectedTotal) {
    const source = acc && typeof acc === 'object' ? acc : {};
    const total = Number(expectedTotal) || 0;

    // Sort numerically: Object.keys returns strings, so "10" < "9" without this.
    const keys = Object.keys(source)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n) && Number.isInteger(n) && n >= 0)
      .sort((a, b) => a - b);

    // Detect impossible state: more distinct indices than the page has blocks.
    // That can only come from a stale accumulator mixed with a new page.
    const duplicates = [];
    const seen = new Set();
    for (const k of keys) {
      if (seen.has(k)) duplicates.push(k);
      seen.add(k);
    }

    const missing = [];
    for (let i = 0; i < total; i++) {
      if (!Object.prototype.hasOwnProperty.call(source, i)) missing.push(i);
    }

    const empty = keys.filter((k) => !String((source[k] || {}).text || '').trim());

    const nonMonotonic = [];
    for (let i = 1; i < keys.length; i++) {
      const prev = source[keys[i - 1]];
      const cur = source[keys[i]];
      const a = Number(prev && prev.time);
      const b = Number(cur && cur.time);
      // Timestamps must not go backwards. If they do, blocks were written
      // against the wrong index and the transcript order cannot be trusted.
      if (Number.isFinite(a) && Number.isFinite(b) && b < a) {
        nonMonotonic.push({ prev: keys[i - 1], cur: keys[i] });
      }
    }

    const reasons = [];
    if (total <= 0) reasons.push('expected total is not known (page may not be ready)');
    if (missing.length) reasons.push(missing.length + ' block(s) never collected');
    if (empty.length) reasons.push(empty.length + ' block(s) have empty text');
    if (nonMonotonic.length) reasons.push(nonMonotonic.length + ' out-of-order timestamp(s)');
    if (keys.length > total) reasons.push('more blocks collected than the page reports');

    const ok =
      total > 0 &&
      keys.length === total &&
      missing.length === 0 &&
      empty.length === 0 &&
      nonMonotonic.length === 0;

    return {
      ok: ok,
      total: total,
      have: keys.length,
      missing: missing,
      empty: empty,
      nonMonotonic: nonMonotonic,
      duplicates: duplicates,
      reasons: reasons
    };
  }

  /** Percentage complete, clamped to 0..100 for a progress bar. */
  function percent(have, total) {
    const t = Number(total) || 0;
    if (t <= 0) return 0;
    const p = Math.round((Number(have) / t) * 100);
    return Math.max(0, Math.min(100, p));
  }

  return { check, percent };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Verify;
}
if (typeof globalThis !== 'undefined') {
  globalThis.TLDV_VERIFY = Verify;
}
