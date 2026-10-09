/**
 * Popup controller.
 *
 * The popup is only a view: it starts a run and shows progress, but the actual
 * export continues in the content script + background worker even if the popup
 * is closed. On open it re-syncs with whatever state the tab is in.
 *
 * Runs as a classic script; util.js and verify.js are loaded before it and read
 * from globalThis.
 */

(() => {
  'use strict';

  const U = globalThis.TLDV;
  const Verify = globalThis.TLDV_VERIFY;

  const el = {
    statusDot: document.getElementById('statusDot'),
    viewWrong: document.getElementById('viewWrong'),
    viewMain: document.getElementById('viewMain'),
    viewDone: document.getElementById('viewDone'),
    meetingLine: document.getElementById('meetingLine'),
    format: document.getElementById('format'),
    startBtn: document.getElementById('startBtn'),
    progressWrap: document.getElementById('progressWrap'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    errorBox: document.getElementById('errorBox'),
    doneLine: document.getElementById('doneLine'),
    doneFile: document.getElementById('doneFile'),
    againBtn: document.getElementById('againBtn'),
    redownloadBtn: document.getElementById('redownloadBtn'),
    hint: document.getElementById('hint')
  };

  let tabId = null;
  let meetingId = null;

  // ------------------------------------------------------------------ render

  function show(view) {
    for (const v of [el.viewWrong, el.viewMain, el.viewDone]) {
      v.hidden = v !== view;
    }
  }

  function setDot(kind) {
    el.statusDot.className = 'dot' + (kind ? ' ' + kind : '');
  }

  function showError(msg) {
    el.errorBox.textContent = msg;
    el.errorBox.hidden = false;
    setDot('err');
  }

  function clearError() {
    el.errorBox.hidden = true;
    el.errorBox.textContent = '';
  }

  function setProgress(have, total, label) {
    const pct = Verify.percent(have, total);
    el.progressBar.style.width = pct + '%';
    el.progressText.textContent =
      (label ? label + ' — ' : '') + have + ' / ' + total + ' blocks (' + pct + '%)';
  }

  // -------------------------------------------------------------------- init

  async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return show(el.viewWrong);

    tabId = tab.id;
    const parsed = U.parseMeetingUrl(tab.url);
    meetingId = parsed.meetingId;

    if (!meetingId) {
      setDot('');
      show(el.viewWrong);
      return;
    }

    el.meetingLine.textContent = 'Meeting ' + meetingId;
    show(el.viewMain);

    // Restore the saved format choice.
    const stored = await chrome.storage.local.get('format');
    if (stored.format) el.format.value = stored.format;

    // If a run already finished for this tab, show the result instead of the
    // start button, so reopening the popup does not lose the summary.
    const last = await sendToBackground({ type: 'TLDV_GET_LAST' });
    if (last && last.ok && last.summary && last.summary.meetingId === meetingId) {
      showDone(last.summary);
      return;
    }

    // Otherwise ask the page how far along it is, so a reopened popup reflects
    // an in-flight run.
    const ping = await sendToTab({ type: 'TLDV_PING' });
    if (ping && ping.ok && ping.running) {
      setDot('busy');
      el.progressWrap.hidden = false;
      el.startBtn.disabled = true;
      setProgress(ping.have, ping.total, 'Extracting');
    }

    el.startBtn.focus();
  }

  function showDone(summary) {
    setDot('ok');
    el.doneLine.textContent = summary.blocks + ' blocks exported';
    el.doneFile.textContent = summary.filename || '';
    show(el.viewDone);
    el.againBtn.focus();
  }

  // --------------------------------------------------------------- messaging

  function sendToBackground(msg) {
    return chrome.runtime.sendMessage(msg).catch(() => null);
  }

  function sendToTab(msg) {
    if (tabId == null) return Promise.resolve(null);
    return chrome.tabs.sendMessage(tabId, msg).catch(() => null);
  }

  // ------------------------------------------------------------- interactions

  el.format.addEventListener('change', () => {
    chrome.storage.local.set({ format: el.format.value });
  });

  el.startBtn.addEventListener('click', async () => {
    clearError();
    el.startBtn.disabled = true;
    el.progressWrap.hidden = false;
    setDot('busy');
    setProgress(0, 0, 'Starting');

    // Make sure the content script is present. A page loaded before the
    // extension was installed has no content script, so inject it on demand.
    const ping = await sendToTab({ type: 'TLDV_PING' });
    if (!ping) {
      const injected = await injectContentScript();
      if (!injected) {
        showError('Cannot reach the page. Reload the tl;dv tab and try again.');
        el.startBtn.disabled = false;
        return;
      }
    } else if (ping.total === 0) {
      showError('No transcript blocks found. Open the Transcript tab on the meeting page first.');
      el.startBtn.disabled = false;
      return;
    }

    const res = await sendToBackground({ type: 'TLDV_START_RUN', tabId: tabId });
    if (!res || !res.ok) {
      showError((res && res.error) || 'Could not start the export.');
      el.startBtn.disabled = false;
      setDot('err');
    }
  });

  el.againBtn.addEventListener('click', () => {
    clearError();
    show(el.viewMain);
    el.startBtn.disabled = false;
    el.progressWrap.hidden = true;
    el.progressBar.style.width = '0';
    setDot('');
    el.startBtn.focus();
  });

  el.redownloadBtn.addEventListener('click', async () => {
    const res = await sendToBackground({ type: 'TLDV_REDOWNLOAD' });
    if (!res || !res.ok) showError((res && res.error) || 'Nothing to download.');
  });

  /**
   * Inject the content script into the current tab on demand.
   * Only used when the page predates the extension install; the manifest
   * declares the same files, so this cannot drift from the declared list.
   */
  async function injectContentScript() {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: [
          'src/lib/util.js',
          'src/lib/verify.js',
          'src/lib/speaker.js',
          'src/lib/block.js',
          'src/lib/markdown.js',
          'src/content.js'
        ]
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------ live progress feed

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'TLDV_PROGRESS') {
      setDot('busy');
      el.progressWrap.hidden = false;
      setProgress(msg.have, msg.total, 'Extracting');
      return;
    }

    if (msg.type === 'TLDV_FINISHED') {
      showDone(msg.summary || { blocks: 0, filename: '' });
      return;
    }

    if (msg.type === 'TLDV_ERROR') {
      el.startBtn.disabled = false;
      el.progressWrap.hidden = true;
      showError(msg.error || 'Export failed. Open the Transcript tab and try again.');
      return;
    }
  });

  init();
})();
