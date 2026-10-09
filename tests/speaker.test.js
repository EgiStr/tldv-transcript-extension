/**
 * Tests for the speaker-label parsing and block reading.
 *
 * These exist because the first implementation read `data-speaker` as if it were
 * a name. It is actually a boolean marker, so every block was labelled "true"
 * and the transcript came out with one speaker. The parser is pure and lives
 * here so the failure mode is covered by a test rather than found in production.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { SPEAKER_TEXT_RE, parseSpeakerLabel, parseTimestamp } = require('../src/lib/speaker.js');

test('extracts a name and time from a speaker label', () => {
  const r = parseSpeakerLabel('01:12:28 sri_c_fauzi_x: halo semua');
  assert.equal(r.speaker, 'sri_c_fauzi_x');
  assert.equal(r.text, 'halo semua');
  assert.equal(r.ms, (1 * 3600 + 12 * 60 + 28) * 1000);
});

test('handles an mm:ss label', () => {
  const r = parseSpeakerLabel('00:17 Seruni Dewanti: coba lagi');
  assert.equal(r.speaker, 'Seruni Dewanti');
  assert.equal(r.text, 'coba lagi');
  assert.equal(r.ms, 17 * 1000);
});

test('handles a name containing a hyphen or underscore', () => {
  assert.equal(parseSpeakerLabel('01:02:03 m_fh_n_x: ya').speaker, 'm_fh_n_x');
  assert.equal(parseSpeakerLabel('01:02:03 Yavta_M_Klini: ya').speaker, 'Yavta_M_Klini');
});

test('leaves text untouched when there is no label', () => {
  const r = parseSpeakerLabel('ini kalimat biasa tanpa label');
  assert.equal(r.speaker, '');
  assert.equal(r.text, 'ini kalimat biasa tanpa label');
  assert.equal(r.ms, null);
});

test('does not treat a mid-sentence colon as a speaker label', () => {
  // No leading timestamp, so this must not be parsed as a label.
  const r = parseSpeakerLabel('jadi begini: kita mulai');
  assert.equal(r.speaker, '');
  assert.equal(r.text, 'jadi begini: kita mulai');
});

test('a very long leading run is not accepted as a name', () => {
  const long = '00:10 ' + 'x'.repeat(80) + ': isi';
  const r = parseSpeakerLabel(long);
  assert.equal(r.speaker, '');
});

test('parseTimestamp reads both mm:ss and hh:mm:ss', () => {
  assert.equal(parseTimestamp('05:30'), 330 * 1000);
  assert.equal(parseTimestamp('01:02:03'), (3600 + 120 + 3) * 1000);
  assert.equal(parseTimestamp('bogus'), null);
});

test('the label regex is anchored to the start', () => {
  assert.equal(SPEAKER_TEXT_RE.test('01:00 A: x'), true);
  assert.equal(SPEAKER_TEXT_RE.test('kata 01:00 A: x'), false);
});
