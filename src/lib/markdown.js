/**
 * Markdown / TXT / JSON rendering. Pure — takes normalised blocks and returns
 * a string. No DOM, no chrome APIs, so the whole output format is testable
 * without a browser.
 */

const Markdown = (() => {
  'use strict';

  const U = typeof module !== 'undefined' && module.exports ? require('./util.js') : globalThis.TLDV;

  /**
   * Normalise the raw accumulator into an ordered array of rows.
   * This is the single place index ordering, speaker fallback and text
   * cleaning are applied, so every output format agrees.
   */
  function toRows(acc) {
    const source = acc && typeof acc === 'object' ? acc : {};
    const keys = Object.keys(source)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

    return keys.map((k) => {
      const b = source[k] || {};
      const speaker = U.collapseWhitespace(b.speaker) || 'Unknown';
      return {
        index: k,
        ms: Number(b.time) || 0,
        time: U.formatTime(b.time),
        speaker: speaker,
        text: U.cleanText(b.text)
      };
    });
  }

  /** Speaker -> block count, sorted by count desc then name asc for stable output. */
  function tallySpeakers(rows) {
    const counts = {};
    for (const r of rows) {
      counts[r.speaker] = (counts[r.speaker] || 0) + 1;
    }
    return Object.keys(counts)
      .map((name) => ({ name: name, count: counts[name] }))
      .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
  }

  /** Total characters of transcript text (excludes headers and markup). */
  function totalChars(rows) {
    return rows.reduce((n, r) => n + r.text.length, 0);
  }

  /**
   * @param {object} opts
   * @param {Array} opts.rows
   * @param {string} opts.meetingId
   * @param {string} opts.url
   * @param {string} [opts.title]
   * @param {Date}   [opts.now]
   */
  function toMarkdown(opts) {
    const rows = opts.rows || [];
    const speakers = tallySpeakers(rows);
    const last = rows.length ? rows[rows.length - 1] : null;
    const out = [];

    out.push('# Transcript — ' + (U.collapseWhitespace(opts.title) || 'tl;dv meeting'));
    out.push('');
    out.push('- **Meeting ID:** `' + (opts.meetingId || 'unknown') + '`');
    if (opts.url) out.push('- **Source:** ' + opts.url);
    if (last) out.push('- **Duration:** ' + last.time);
    out.push('- **Blocks:** ' + rows.length);
    out.push('- **Characters:** ' + totalChars(rows));
    out.push('- **Speakers:** ' + speakers.length);
    out.push('- **Exported:** ' + (opts.now instanceof Date ? opts.now : new Date()).toISOString());
    // If the page reported more blocks than were captured, say so in the file.
    // A silently short transcript is worse than a labelled one.
    if (opts.missing && opts.missing.length) {
      out.push('- **Warning:** ' + opts.missing.length +
        ' block(s) could not be rendered and are absent (indices: ' +
        opts.missing.slice(0, 30).join(', ') + (opts.missing.length > 30 ? ', …' : '') + ')');
    }
    out.push('');
    out.push('## Speakers');
    out.push('');
    out.push('| Speaker | Blocks |');
    out.push('| --- | ---: |');
    for (const s of speakers) {
      out.push('| ' + U.escapeTableCell(s.name) + ' | ' + s.count + ' |');
    }
    out.push('');
    out.push('---');
    out.push('');
    out.push('## Full Transcript');
    out.push('');
    out.push('| # | Time | Speaker | Text |');
    out.push('| ---: | --- | --- | --- |');
    rows.forEach((r, i) => {
      out.push(
        '| ' + (i + 1) +
        ' | ' + r.time +
        ' | ' + U.escapeTableCell(r.speaker) +
        ' | ' + U.escapeTableCell(r.text) + ' |'
      );
    });
    out.push('');
    out.push('---');
    out.push('');
    out.push('## Plain Text');
    out.push('');
    for (const r of rows) {
      out.push('**[' + r.time + '] ' + U.escapePlain(r.speaker) + ':** ' + U.escapePlain(r.text));
      out.push('');
    }

    return out.join('\n');
  }

  /** Plain-text export: one block per paragraph, no Markdown table. */
  function toText(opts) {
    const rows = opts.rows || [];
    const out = [];
    out.push('Transcript — ' + (U.collapseWhitespace(opts.title) || 'tl;dv meeting'));
    out.push('Meeting ID: ' + (opts.meetingId || 'unknown'));
    out.push('Blocks: ' + rows.length);
    out.push('');
    for (const r of rows) {
      out.push('[' + r.time + '] ' + U.escapePlain(r.speaker) + ': ' + U.escapePlain(r.text));
    }
    return out.join('\n');
  }

  /** JSON export: structured, with the speaker tally included. */
  function toJson(opts) {
    const rows = opts.rows || [];
    return JSON.stringify(
      {
        meetingId: opts.meetingId || null,
        url: opts.url || null,
        title: U.collapseWhitespace(opts.title) || null,
        exportedAt: (opts.now instanceof Date ? opts.now : new Date()).toISOString(),
        blockCount: rows.length,
        duration: rows.length ? rows[rows.length - 1].time : null,
        speakers: tallySpeakers(rows).map((s) => ({ name: s.name, blocks: s.count })),
        blocks: rows.map((r) => ({
          index: r.index,
          time: r.time,
          ms: r.ms,
          speaker: r.speaker,
          text: r.text
        }))
      },
      null,
      2
    );
  }

  return { toRows, tallySpeakers, totalChars, toMarkdown, toText, toJson };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Markdown;
}
if (typeof globalThis !== 'undefined') {
  globalThis.TLDV_MARKDOWN = Markdown;
}
