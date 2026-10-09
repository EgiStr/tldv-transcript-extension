/**
 * Content script: runs in the tl;dv page, drives the virtualized transcript
 * list, and hands the collected blocks back to the popup/background.
 *
 * WHY THIS DRIVES SCROLL INSTEAD OF THE VIDEO:
 *   The transcript is a virtualized list — at rest only ~5 of 390 blocks carry
 *   text. The transcript data is not in any API reachable from here (CORS), not
 *   in textTracks, and not in storage. Text only exists in the DOM once the
 *   block has been rendered.
 *
 *   Driving the video does not work: video.play() is rejected by the browser's
 *   background power-saving policy, and setting currentTime while paused does
 *   not trigger a re-render.
 *
 *   Moving scrollTop and dispatching a scroll event DOES re-render. That is the
 *   only reliable trigger found, so it is what this script does.
 *
 * Runs as a classic script (manifest declares no "type": "module"), so the
 * lib files are loaded via manifest order and read from globalThis.
 */

(() => {
  'use strict';

  const U = globalThis.TLDV;
  const Verify = globalThis.TLDV_VERIFY;
  const Markdown = globalThis.TLDV_MARKDOWN;
  // Speaker parsing now lives in lib/block.js, so this script does not need it
  // directly; block.js declares it as its own dependency.
  const Block = globalThis.TLDV_BLOCK;

  if (!U || !Verify || !Markdown || !Block) {
    // A missing lib means the manifest content_scripts js order is wrong.
    console.error('[tldv-exporter] libs missing; check content_scripts order');
    return;
  }

  const CONTAINER_ID = 'transcript-container';
  const STEP_PX = 320;      // px per scroll stop; smaller = slower = fewer gaps
  const DWELL_MS = 340;     // time for the virtualizer to render at each stop
  const HARD_CAP_MS = 15 * 60 * 1000; // give up rather than loop forever

  /** @type {{running:boolean, acc:Object, expected:number, startedAt:number, error:string|null}} */
  let state = {
    running: false,
    acc: {},
    expected: 0,
    startedAt: 0,
    error: null,
    trace: []
  };

  // ------------------------------------------------------------- utilities

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Append a line to a small in-page trace log.
   *
   * The content script runs in an isolated world that a normal page evaluator
   * cannot inspect, so without this a failure in the reporting path is
   * completely silent. The log is also exposed through TLDV_PING.
   */
  function trace(line) {
    state.trace.push(new Date().toISOString().slice(11, 19) + ' ' + line);
    if (state.trace.length > 40) state.trace.shift();
  }

  function container() {
    return document.getElementById(CONTAINER_ID);
  }

  function blockNodes() {
    const c = container();
    return c ? c.querySelectorAll('p[data-index]') : [];
  }

  /**
   * Read one block from the DOM.
   *
   * The parsing lives in lib/block.js so it can be unit-tested against a fake
   * DOM node. See that file for why `data-word` and `data-speaker` are traps:
   * data-word is a word INDEX (not the word) and data-speaker is a boolean
   * (not a name). Getting either wrong produces a plausible-looking but wrong
   * transcript with no error raised.
   */
  function readBlock(p) {
    return Block.readBlockFromNode(p);
  }

  /**
   * Sweep every rendered block into the accumulator.
   * A later render can only add or extend a block, never shorten it, so we keep
   * whichever text is longer. Without this, a partially-rendered block caught
   * mid-fade would overwrite a complete one.
   */
  function collectAll() {
    let added = 0;
    const nodes = blockNodes();
    for (const p of nodes) {
      const b = readBlock(p);
      if (!b) continue;
      const prev = state.acc[b.index];
      if (!prev || b.text.length > (prev.text || '').length) {
        state.acc[b.index] = { time: b.time, speaker: b.speaker, text: b.text };
        added++;
      }
    }
    return added;
  }

  function expectedTotal() {
    return blockNodes().length;
  }

  function haveCount() {
    return Object.keys(state.acc).length;
  }

  /**
   * Persist progress so a reload or a closed popup cannot destroy a run that is
   * already minutes deep. Keyed by meeting id so two meetings never collide.
   */
  function save() {
    try {
      const id = U.parseMeetingUrl(location.href).meetingId || 'unknown';
      sessionStorage.setItem(
        '__tldv_export_' + id,
        JSON.stringify({ acc: state.acc, expected: state.expected, savedAt: Date.now() })
      );
      return true;
    } catch (e) {
      return false;
    }
  }

  function load() {
    try {
      const id = U.parseMeetingUrl(location.href).meetingId || 'unknown';
      const raw = sessionStorage.getItem('__tldv_export_' + id);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.acc && typeof parsed.acc === 'object') {
        state.acc = parsed.acc;
        if (parsed.expected) state.expected = parsed.expected;
        return true;
      }
    } catch (e) {
      // corrupt entry — start fresh rather than crash
    }
    return false;
  }

  function clearSaved() {
    try {
      const id = U.parseMeetingUrl(location.href).meetingId || 'unknown';
      sessionStorage.removeItem('__tldv_export_' + id);
    } catch (e) {
      // ignore
    }
  }

  // ----------------------------------------------------------------- sweep

  /**
   * The core loop: walk the scroll container from top to bottom, collecting at
   * every stop. This is async and long-running by design — it has no 30s script
   * timeout to respect here, unlike the browser-automation approach.
   */
  async function sweep() {
    const c = container();
    if (!c) throw new Error('transcript container not found — open the Transcript tab');

    // Start from the top so every block passes through the render window.
    c.scrollTop = 0;
    c.dispatchEvent(new Event('scroll', { bubbles: true }));
    await sleep(200);

    // The container GROWS as blocks render in, so the bottom must be
    // re-measured every iteration. Caching it once made the sweep stop early
    // (observed: 327/390) because the initial scrollHeight was too small.
    let pos = 0;
    let staleRounds = 0;

    while (true) {
      if (Date.now() - state.startedAt > HARD_CAP_MS) {
        throw new Error('timed out after 15 minutes');
      }

      const liveMax = Math.max(0, c.scrollHeight - c.clientHeight);
      if (pos > liveMax) break;

      c.scrollTop = pos;
      c.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(DWELL_MS);

      const before = haveCount();
      collectAll();
      const gained = haveCount() - before;

      // If the bottom stops moving and nothing new arrives for several rounds,
      // the list is fully rendered and we can stop.
      if (pos >= liveMax - STEP_PX && gained === 0) {
        staleRounds++;
        if (staleRounds >= 3) break;
      } else {
        staleRounds = 0;
      }

      report();
      pos += STEP_PX;
    }

    // Final pass at the exact bottom: a virtualizer can drop a block that
    // scrolled past between two samples.
    c.scrollTop = c.scrollHeight;
    c.dispatchEvent(new Event('scroll', { bubbles: true }));
    await sleep(DWELL_MS + 200);
    collectAll();
    report();

    save();
  }

  /** Fill any index the first pass missed by seeking near it. */
  async function fillGaps(missing, limit) {
    const c = container();
    if (!c || !missing.length) return;

    const nodes = blockNodes();
    if (!nodes.length) return;
    const avg = c.scrollHeight / nodes.length;

    for (const idx of missing.slice(0, limit)) {
      if (Date.now() - state.startedAt > HARD_CAP_MS) return;
      const target = Math.max(0, Math.min(c.scrollHeight, Math.round(idx * avg - c.clientHeight / 2)));
      c.scrollTop = target;
      c.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(DWELL_MS);
      collectAll();
      report();
    }
    save();
  }

  function report() {
    const total = state.expected || expectedTotal();
    chrome.runtime
      .sendMessage({
        type: 'TLDV_PROGRESS',
        have: haveCount(),
        total: total,
        percent: Verify.percent(haveCount(), total)
      })
      .catch(() => {
        // Popup closed; nothing to report to. Harmless.
      });
  }

  /**
   * Hand the finished (or failed) result to the background worker.
   *
   * Retried, because an MV3 service worker can be asleep when the message
   * arrives and the first send can fail with no receiver attached. Losing this
   * message loses the whole run's output, so a few attempts are warranted.
   *
   * The result is also cached in sessionStorage first, so a total delivery
   * failure is still recoverable.
   */
  async function deliver(result, attempt) {
    const tries = attempt || 0;
    const kind = result && result.ok ? 'TLDV_DONE' : 'TLDV_FAILED';

    // Record the attempt before sending, so a silent delivery failure is still
    // visible after the fact.
    trace('deliver:' + kind + ':try' + tries);

    try {
      const res = await chrome.runtime.sendMessage({ type: kind, result: result });
      if (res && res.ok) {
        trace('deliver:ok');
        return true;
      }
      throw new Error('receiver replied: ' + JSON.stringify(res));
    } catch (e) {
      trace('deliver:fail:' + String(e && e.message ? e.message : e));
      if (tries < 3) {
        await sleep(600 * (tries + 1));
        return deliver(result, tries + 1);
      }
      try {
        sessionStorage.setItem('__tldv_last_delivery_failed', JSON.stringify({
          error: String(e && e.message ? e.message : e),
          blocks: result && result.rows ? result.rows.length : 0,
          at: Date.now()
        }));
      } catch (err) {
        // nothing more we can do
      }
      return false;
    }
  }

  // ------------------------------------------------------------- entrypoint

  async function run() {
    if (state.running) return { ok: false, error: 'already running' };

    state.running = true;
    state.error = null;
    state.startedAt = Date.now();

    try {
      // Reuse a previous partial run rather than redoing minutes of work.
      const resumed = load();
      state.expected = expectedTotal();
      if (state.expected === 0) {
        throw new Error('no transcript blocks found — is the Transcript tab open?');
      }

      report();

      // Pass 1: full sweep.
      await sweep();

      // Pass 2: chase anything the sweep missed.
      let check = Verify.check(state.acc, state.expected);
      if (!check.ok && check.missing.length) {
        trace('sweep done, missing ' + check.missing.length + ': ' + check.missing.slice(0, 20).join(','));
        await fillGaps(check.missing, 120);
        check = Verify.check(state.acc, state.expected);
      }

      // Give up on the last stragglers only after a second gap pass, which is
      // usually enough: a block that never renders cannot be forced, and
      // looping forever is worse than exporting what exists.
      if (!check.ok && check.missing.length) {
        trace('retry gaps, still missing ' + check.missing.length);
        await fillGaps(check.missing, 120);
        check = Verify.check(state.acc, state.expected);
      }

      // A transcript missing a few blocks is still useful; a failed export is
      // not. Only refuse when the loss is too large to be a rendering quirk —
      // and always say so in the output rather than failing silently.
      const missingRatio = check.total > 0 ? check.missing.length / check.total : 1;
      const TOO_INCOMPLETE = 0.15;

      if (check.have === 0) {
        state.running = false;
        state.error = 'nothing collected: ' + check.reasons.join('; ');
        trace('fatal: nothing collected');
        return { ok: false, error: state.error, check: check };
      }

      if (missingRatio > TOO_INCOMPLETE || check.empty.length > 0 || check.nonMonotonic.length > 0) {
        state.running = false;
        state.error =
          'incomplete (' + check.have + '/' + check.total + '): ' + check.reasons.join('; ');
        trace('fatal: ' + state.error);
        return { ok: false, error: state.error, check: check };
      }

      const rows = Markdown.toRows(state.acc);
      const id = U.parseMeetingUrl(location.href).meetingId;
      const payload = {
        ok: true,
        meetingId: id,
        url: location.href.split('?')[0],
        title: document.title.replace(/\s*[|·-]\s*tl;dv.*$/i, '').trim() || 'tl;dv meeting',
        rows: rows,
        check: check,
        resumed: resumed,
        // Surfaced in the output so a partial capture is never mistaken for a
        // complete one.
        missing: check.missing
      };

      state.running = false;
      trace('done ok: ' + rows.length + ' rows, missing ' + check.missing.length);
      clearSaved();
      return payload;
    } catch (e) {
      state.running = false;
      state.error = String(e && e.message ? e.message : e);
      save(); // keep whatever we have for a retry
      return { ok: false, error: state.error };
    }
  }

  // ------------------------------------------------------------ message API

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return false;

    if (msg.type === 'TLDV_PING') {
      sendResponse({
        ok: true,
        container: !!container(),
        total: expectedTotal(),
        have: haveCount(),
        running: state.running,
        // Last failure reason, if any. Exposed here so a stall can be diagnosed
        // without attaching a debugger to the page.
        error: state.error,
        startedAt: state.startedAt || null,
        trace: state.trace.slice(-20)
      });
      return false;
    }

    if (msg.type === 'TLDV_START') {
      // Respond immediately; the run reports progress via TLDV_PROGRESS and
      // delivers the final result as TLDV_DONE. A long sweep cannot be held in
      // a single sendResponse.
      sendResponse({ ok: true, started: true });
      run()
        .then((result) => deliver(result))
        .catch((e) => {
          // run() already catches its own errors, so reaching here means a bug
          // in the reporting path itself. Report it rather than swallow it.
          deliver({ ok: false, error: 'internal error: ' + String(e && e.message ? e.message : e) });
        });
      return false;
    }

    if (msg.type === 'TLDV_RESET') {
      state.acc = {};
      clearSaved();
      sendResponse({ ok: true, have: 0 });
      return false;
    }

    return false;
  });

  // Announce readiness so the popup can tell whether the script is injected.
  chrome.runtime.sendMessage({ type: 'TLDV_READY', url: location.href }).catch(() => {});
})();
