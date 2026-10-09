/**
 * Unit tests for the pure helpers. Run with: node --test tests/
 *
 * These cover the logic that actually broke (or could silently break) during
 * development: index ordering, pipe escaping, the completeness gate, and the
 * mm:ss -> hh:mm:ss boundary.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const U = require('../src/lib/util.js');
const Verify = require('../src/lib/verify.js');
const Markdown = require('../src/lib/markdown.js');

// ---------------------------------------------------------------- util.js

test('formatTime pads and switches to hh:mm:ss only at one hour', () => {
  assert.equal(U.formatTime(0), '00:00');
  assert.equal(U.formatTime(1000), '00:01');
  assert.equal(U.formatTime(59000), '00:59');
  assert.equal(U.formatTime(60000), '01:00');
  // 59:59 stays mm:ss; 60:00 must become hh:mm:ss
  assert.equal(U.formatTime(59 * 60000 + 59000), '59:59');
  assert.equal(U.formatTime(60 * 60000), '01:00:00');
});

test('formatTime truncates, matching how tl;dv labels its own blocks', () => {
  // These millisecond values and the expected labels were read off the live
  // tl;dv transcript. Each block carries a sub-second offset and tl;dv shows
  // the TRUNCATED second; rounding instead would put every timestamp one
  // second ahead of the UI the user is comparing against.
  assert.equal(U.formatTime(16896), '00:16');
  assert.equal(U.formatTime(46336), '00:46');
  assert.equal(U.formatTime(51712), '00:51');
  assert.equal(U.formatTime(89344), '01:29');
  // The meeting's own duration, 6016.777778 s, truncates to 01:40:16.
  assert.equal(U.formatTime(6016778), '01:40:16');
});

test('formatTime treats negatives and junk as zero rather than emitting NaN', () => {
  assert.equal(U.formatTime(-5000), '00:00');
  assert.equal(U.formatTime(null), '00:00');
  assert.equal(U.formatTime(undefined), '00:00');
  assert.equal(U.formatTime('abc'), '00:00');
});

test('collapseWhitespace flattens newlines and tabs', () => {
  assert.equal(U.collapseWhitespace('  a \n\t b  '), 'a b');
  assert.equal(U.collapseWhitespace(null), '');
  assert.equal(U.collapseWhitespace(undefined), '');
});

test('stripSpeakerPrefix removes a short leading label only', () => {
  assert.equal(U.stripSpeakerPrefix('Seruni Dewanti: halo'), 'halo');
  assert.equal(U.stripSpeakerPrefix('halo'), 'halo');
  // A long leading run is not a label; it must survive intact.
  const long = 'ini adalah kalimat panjang sekali yang melebihi batas label: isi';
  assert.equal(U.stripSpeakerPrefix(long), long);
});

test('escapeTableCell escapes pipes so a row cannot be split', () => {
  assert.equal(U.escapeTableCell('a | b'), 'a \\| b');
  assert.equal(U.escapeTableCell('paket | promo | faq'), 'paket \\| promo \\| faq');
});

test('parseMeetingUrl extracts the id and rejects non-meeting URLs', () => {
  assert.equal(
    U.parseMeetingUrl('https://tldv.io/app/meetings/6ac740deabce3900133486c2/?transcript=true').meetingId,
    '6ac740deabce3900133486c2'
  );
  assert.equal(U.parseMeetingUrl('https://tldv.io/app/').meetingId, null);
  assert.equal(U.parseMeetingUrl('https://example.com/x').meetingId, null);
  assert.equal(U.parseMeetingUrl('not a url').meetingId, null);
  assert.equal(U.parseMeetingUrl('').meetingId, null);
});

test('buildFilename is deterministic for a given date', () => {
  const d = new Date(2026, 9, 9, 10, 53); // month is 0-based -> October
  assert.equal(
    U.buildFilename('abc123', 'md', d),
    'tldv-transcript-abc123-20261009-1053.md'
  );
});

test('sanitizeFilenamePart strips characters Windows forbids', () => {
  assert.equal(U.sanitizeFilenamePart('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j');
});

// -------------------------------------------------------------- verify.js

test('verify passes on a complete, ordered set', () => {
  const acc = { 0: { time: 0, text: 'a' }, 1: { time: 1000, text: 'b' }, 2: { time: 2000, text: 'c' } };
  const r = Verify.check(acc, 3);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.empty, []);
  assert.equal(r.have, 3);
});

test('verify fails and lists indices when blocks are missing', () => {
  const acc = { 0: { time: 0, text: 'a' }, 2: { time: 2000, text: 'c' } };
  const r = Verify.check(acc, 3);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, [1]);
  assert.match(r.reasons.join(' '), /never collected/);
});

test('verify detects empty text blocks', () => {
  const acc = { 0: { time: 0, text: 'a' }, 1: { time: 1, text: '   ' } };
  const r = Verify.check(acc, 2);
  assert.equal(r.ok, false);
  assert.deepEqual(r.empty, [1]);
});

test('verify detects non-monotonic timestamps', () => {
  const acc = { 0: { time: 5000, text: 'a' }, 1: { time: 1000, text: 'b' } };
  const r = Verify.check(acc, 2);
  assert.equal(r.ok, false);
  assert.equal(r.nonMonotonic.length, 1);
});

test('verify sorts numerically, not lexicographically', () => {
  // With string sorting, index 10 would compare before index 9.
  const acc = {};
  for (let i = 0; i < 12; i++) acc[i] = { time: i * 1000, text: 'x' + i };
  const r = Verify.check(acc, 12);
  assert.equal(r.ok, true);
  assert.equal(r.have, 12);
});

test('verify refuses an unknown total instead of claiming success', () => {
  const r = Verify.check({ 0: { time: 0, text: 'a' } }, 0);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(' '), /not known/);
});

test('verify flags more collected blocks than the page reports', () => {
  const acc = { 0: { time: 0, text: 'a' }, 1: { time: 1, text: 'b' } };
  const r = Verify.check(acc, 1);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(' '), /more blocks collected/);
});

test('percent clamps to 0..100 and survives a zero total', () => {
  assert.equal(Verify.percent(0, 0), 0);
  assert.equal(Verify.percent(0, 10), 0);
  assert.equal(Verify.percent(5, 10), 50);
  assert.equal(Verify.percent(10, 10), 100);
  assert.equal(Verify.percent(20, 10), 100);
});

// ------------------------------------------------------------ markdown.js

function sampleAcc() {
  return {
    0: { time: 0, speaker: 'Seruni Dewanti', text: 'Coba lagi dong, Mas.' },
    1: { time: 16000, speaker: 'm_fh_n_x', text: 'Bentar-bentar, saya ada ini.' },
    2: { time: 60000, speaker: 'Seruni Dewanti', text: 'Masuk | keluar | lagi.' }
  };
}

test('toRows orders by index and formats time', () => {
  const rows = Markdown.toRows(sampleAcc());
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.time), ['00:00', '00:16', '01:00']);
  assert.equal(rows[0].speaker, 'Seruni Dewanti');
});

test('toRows falls back to Unknown when the speaker is absent', () => {
  const rows = Markdown.toRows({ 0: { time: 0, text: 'hi' } });
  assert.equal(rows[0].speaker, 'Unknown');
});

test('tallySpeakers sorts by count desc then name', () => {
  const rows = Markdown.toRows(sampleAcc());
  const t = Markdown.tallySpeakers(rows);
  assert.equal(t[0].name, 'Seruni Dewanti');
  assert.equal(t[0].count, 2);
  assert.equal(t[1].name, 'm_fh_n_x');
  assert.equal(t[1].count, 1);
});

test('markdown output escapes pipes so table structure survives', () => {
  const md = Markdown.toMarkdown({
    rows: Markdown.toRows(sampleAcc()),
    meetingId: 'abc',
    url: 'https://tldv.io/app/meetings/abc/'
  });
  assert.match(md, /Masuk \\\| keluar \\\| lagi\./);
  // The raw unescaped form must not appear in a table row.
  assert.doesNotMatch(md, /\| Masuk \| keluar \|/);
});

test('markdown output has both a table and a plain-text section with equal rows', () => {
  const md = Markdown.toMarkdown({
    rows: Markdown.toRows(sampleAcc()),
    meetingId: 'abc'
  });
  const tableRows = (md.match(/^\|\s*\d+\s*\|/gm) || []).length;
  const plainRows = (md.match(/^\*\*\[\d{2}:\d{2}(?::\d{2})?\]/gm) || []).length;
  assert.equal(tableRows, 3);
  assert.equal(plainRows, 3);
});

test('markdown includes metadata and a speaker table', () => {
  const md = Markdown.toMarkdown({ rows: Markdown.toRows(sampleAcc()), meetingId: 'abc' });
  assert.match(md, /# Transcript/);
  assert.match(md, /- \*\*Meeting ID:\*\* `abc`/);
  assert.match(md, /## Speakers/);
  assert.match(md, /## Full Transcript/);
  assert.match(md, /## Plain Text/);
});

test('plain text export has one line per block', () => {
  const txt = Markdown.toText({ rows: Markdown.toRows(sampleAcc()), meetingId: 'abc' });
  const lines = txt.split('\n').filter((l) => /^\[\d{2}:\d{2}/.test(l));
  assert.equal(lines.length, 3);
});

test('json export round-trips and reports the block count', () => {
  const json = Markdown.toJson({ rows: Markdown.toRows(sampleAcc()), meetingId: 'abc' });
  const parsed = JSON.parse(json);
  assert.equal(parsed.blockCount, 3);
  assert.equal(parsed.blocks.length, 3);
  assert.equal(parsed.blocks[0].speaker, 'Seruni Dewanti');
  assert.equal(parsed.speakers[0].name, 'Seruni Dewanti');
});

test('an empty accumulator produces valid but empty output, not a crash', () => {
  const md = Markdown.toMarkdown({ rows: [], meetingId: 'abc' });
  assert.match(md, /- \*\*Blocks:\*\* 0/);
  const json = JSON.parse(Markdown.toJson({ rows: [], meetingId: 'abc' }));
  assert.equal(json.blockCount, 0);
  assert.deepEqual(json.blocks, []);
});

test('a 390-block transcript produces 390 table rows and 390 plain rows', () => {
  const acc = {};
  for (let i = 0; i < 390; i++) {
    acc[i] = { time: i * 1000, speaker: 'Speaker ' + (i % 3), text: 'Block ' + i };
  }
  const md = Markdown.toMarkdown({ rows: Markdown.toRows(acc), meetingId: 'big' });
  assert.equal((md.match(/^\|\s*\d+\s*\|/gm) || []).length, 390);
  assert.equal((md.match(/^\*\*\[\d{2}:\d{2}(?::\d{2})?\]/gm) || []).length, 390);
});

test('a partial capture is labelled with a warning, not silently short', () => {
  const acc = { 0: { time: 0, speaker: 'A', text: 'a' }, 1: { time: 1000, speaker: 'B', text: 'b' } };
  const md = Markdown.toMarkdown({
    rows: Markdown.toRows(acc),
    meetingId: 'partial',
    missing: [2, 5, 9]
  });
  assert.match(md, /\*\*Warning:\*\* 3 block\(s\) could not be rendered/);
  assert.match(md, /2, 5, 9/);
});

test('a complete capture carries no warning line', () => {
  const acc = { 0: { time: 0, speaker: 'A', text: 'a' } };
  const md = Markdown.toMarkdown({ rows: Markdown.toRows(acc), meetingId: 'full', missing: [] });
  assert.doesNotMatch(md, /Warning:/);
});

test('a very long missing list is truncated in the warning', () => {
  const acc = { 0: { time: 0, speaker: 'A', text: 'a' } };
  const many = Array.from({ length: 50 }, (_, i) => i + 1);
  const md = Markdown.toMarkdown({ rows: Markdown.toRows(acc), meetingId: 'x', missing: many });
  assert.match(md, /Warning:/);
  assert.match(md, /…/);
});
