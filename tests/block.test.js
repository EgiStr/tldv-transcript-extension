/**
 * Tests for reading a transcript block out of the DOM.
 *
 * These use a minimal fake DOM rather than a real browser, because the bug
 * being guarded against is about WHICH property is read, not about rendering.
 *
 * The failure this file exists for: the first implementation read `data-word`
 * as the word text. `data-word` is a sequential word INDEX ("3329", "3330"),
 * so the export came out as the digits 0,1,2,3... — structurally valid
 * Markdown, entirely wrong content, and no error anywhere.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { readBlockFromNode } = require('../src/lib/block.js');

/** Build a fake <p> with the shape tl;dv actually produces. */
function fakeBlock(attrs, spans, innerText) {
  return {
    getAttribute: (name) => (name in attrs ? String(attrs[name]) : null),
    // The rendered text. Omitted means "not rendered", which makes the reader
    // fall back to the spans.
    innerText: innerText,
    querySelectorAll: (sel) =>
      sel === 'span[data-word]'
        ? spans.map((s) => ({
            textContent: s.textContent,
            innerText: s.innerText != null ? s.innerText : s.textContent,
            getAttribute: (n) => (n in s ? String(s[n]) : null)
          }))
        : []
  };
}

test('reads the word text, not the data-word index', () => {
  const p = fakeBlock(
    { 'data-index': 118, 'data-time': 1990000 },
    [
      { 'data-word': '3329', textContent: '33:10 m_fh_n_x: ', innerText: 'm_fh_n_x' },
      { 'data-word': '3330', textContent: ' Oke,' },
      { 'data-word': '3331', textContent: ' jadi' }
    ]
  );

  const b = readBlockFromNode(p);

  // The body must be words, never the numeric indices.
  assert.equal(b.text, 'Oke, jadi');
  assert.doesNotMatch(b.text, /3330|3331/);
  assert.equal(b.speaker, 'm_fh_n_x');
  assert.equal(b.time, (33 * 60 + 10) * 1000);
  assert.equal(b.index, 118);
});

test('a hyphenated word is not split by a stray space', () => {
  // The real DOM splits "web-bob" into a span ending " web" and a span
  // "-bob". Joining those with a separator produces "web -bob".
  const p = fakeBlock(
    { 'data-index': 386, 'data-time': 5972000 },
    [
      { 'data-word': '0', textContent: '01:39:32 m_fh_n_x: ', innerText: 'm_fh_n_x' },
      { 'data-word': '1', textContent: ' pas' },
      { 'data-word': '2', textContent: ' maka' },
      { 'data-word': '3', textContent: ' web' },
      { 'data-word': '4', textContent: '-bob' },
      { 'data-word': '5', textContent: ' benar' },
      { 'data-word': '6', textContent: '-benar' }
    ],
    'm_fh_n_x\npas maka web-bob benar-benar'
  );

  const b = readBlockFromNode(p);
  assert.equal(b.text, 'pas maka web-bob benar-benar');
  assert.doesNotMatch(b.text, /web -bob/);
  assert.doesNotMatch(b.text, /benar -benar/);
  assert.equal(b.speaker, 'm_fh_n_x');
});

test('uses the rendered innerText when it is available', () => {
  const p = fakeBlock(
    { 'data-index': 1, 'data-time': 0 },
    [{ 'data-word': '0', textContent: '00:01 A: halo' }],
    'A\nhalo dunia'
  );
  const b = readBlockFromNode(p);
  assert.equal(b.speaker, 'A');
  assert.equal(b.text, 'halo dunia');
});

test('never emits a transcript that is only numbers', () => {
  const spans = [];
  for (let i = 0; i < 10; i++) {
    spans.push({ 'data-word': String(i), textContent: ' kata' + i });
  }
  spans.unshift({ 'data-word': '0', textContent: '00:00 A: ', innerText: 'A' });

  const b = readBlockFromNode(fakeBlock({ 'data-index': 0, 'data-time': 0 }, spans));
  assert.equal(b.text, 'kata0 kata1 kata2 kata3 kata4 kata5 kata6 kata7 kata8 kata9');
  // A bare run of digits is the signature of the old bug.
  assert.doesNotMatch(b.text, /^\d+( \d+)*$/);
});

test('falls back to innerText for the name when the text has no label', () => {
  const p = fakeBlock(
    { 'data-index': 5, 'data-time': 5000 },
    [
      { 'data-word': '10', textContent: 'sri_c_fauzi_x', innerText: 'sri_c_fauzi_x' },
      { 'data-word': '11', textContent: ' halo' }
    ],
    'sri_c_fauzi_x\nhalo'
  );
  const b = readBlockFromNode(p);
  assert.equal(b.speaker, 'sri_c_fauzi_x');
  assert.equal(b.text, 'halo');
});

test('returns null for a block with no rendered spans', () => {
  assert.equal(readBlockFromNode(fakeBlock({ 'data-index': 3 }, [])), null);
});

test('returns null when the block has spans but no text', () => {
  const p = fakeBlock({ 'data-index': 4 }, [{ 'data-word': '1', textContent: '   ' }]);
  assert.equal(readBlockFromNode(p), null);
});
