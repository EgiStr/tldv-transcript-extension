/**
 * Background service worker.
 *
 * Responsibilities:
 *   - own the long-lived export run so it survives the popup closing
 *   - render the final output (markdown / txt / json) and trigger the download
 *   - keep the last result so a reopened popup can still download it
 *
 * The content script does the scraping; this file never touches the page.
 * MV3 service workers are killed when idle, so nothing important is held only
 * in memory — the last result is persisted to chrome.storage.session.
 */

import { buildOutput } from './lib/output.js';

const STORAGE_KEY = 'lastResult';

/** Track which tab is mid-export so a second popup cannot start a second run. */
const runningTabs = new Set();

// --------------------------------------------------------------- messaging

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  // From content script: a run finished or failed. Render and download here so
  // the work is not lost if the popup is closed.
  if (msg.type === 'TLDV_DONE') {
    handleDone(msg.result, sender.tab)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true; // async response
  }

  if (msg.type === 'TLDV_FAILED') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId != null) runningTabs.delete(tabId);
    if (tabId != null) {
      chrome.action.setBadgeText({ tabId: tabId, text: '!' });
      chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: '#c0392b' });
      // Record the failure so a reopened popup can explain what went wrong
      // instead of silently showing the start button again.
      chrome.storage.session
        .set({
          lastError: {
            error: (msg.result && msg.result.error) || 'export failed',
            have: msg.result && msg.result.check ? msg.result.check.have : null,
            total: msg.result && msg.result.check ? msg.result.check.total : null,
            at: Date.now()
          }
        })
        .catch(() => {});
    }
    // Surface the reason to any open popup.
    chrome.runtime
      .sendMessage({ type: 'TLDV_ERROR', error: (msg.result && msg.result.error) || 'export failed' })
      .catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'TLDV_READY') {
    // Content script injected; nothing to do but acknowledge.
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

// ------------------------------------------------------------ run lifecycle

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'TLDV_START_RUN') return false;

  const tabId = msg.tabId;
  if (tabId == null) {
    sendResponse({ ok: false, error: 'no tab id' });
    return false;
  }
  if (runningTabs.has(tabId)) {
    sendResponse({ ok: false, error: 'an export is already running in this tab' });
    return false;
  }

  runningTabs.add(tabId);
  chrome.action.setBadgeText({ tabId: tabId, text: '...' });
  chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: '#2c7be5' });

  // Kick the content script. It answers immediately and reports progress
  // separately, because a multi-minute sweep cannot fit in one sendResponse.
  chrome.tabs
    .sendMessage(tabId, { type: 'TLDV_START' })
    .then(() => sendResponse({ ok: true, started: true }))
    .catch((e) => {
      runningTabs.delete(tabId);
      chrome.action.setBadgeText({ tabId: tabId, text: '!' });
      sendResponse({ ok: false, error: 'cannot reach the page: ' + String(e && e.message ? e.message : e) });
    });

  return true;
});

/** Render the result, store it, and download the chosen format. */
async function handleDone(result, tab) {
  const tabId = tab && tab.id;

  if (tabId != null) {
    runningTabs.delete(tabId);
    chrome.action.setBadgeText({ tabId: tabId, text: '' });
  }

  if (!result || !result.ok) {
    return { ok: false, error: (result && result.error) || 'export failed' };
  }

  const format = await getFormat();
  const output = buildOutput({
    rows: result.rows,
    format: format,
    meetingId: result.meetingId,
    url: result.url,
    title: result.title,
    missing: result.missing || []
  });

  await chrome.storage.session.set({
    [STORAGE_KEY]: {
      meetingId: result.meetingId,
      url: result.url,
      title: result.title,
      blocks: result.rows.length,
      savedAt: Date.now(),
      filename: output.filename,
      content: output.content,
      mime: output.mime
    }
  });

  await download(output);

  // Tell any open popup to refresh with the finished state.
  chrome.runtime.sendMessage({ type: 'TLDV_FINISHED', summary: output.summary }).catch(() => {});

  return { ok: true, summary: output.summary, filename: output.filename };
}

function getFormat() {
  return chrome.storage.local
    .get('format')
    .then((r) => r.format || 'md')
    .catch(() => 'md');
}

/**
 * Trigger a save-as-free download.
 * The file is handed over as a data URL built from UTF-8 bytes so non-ASCII
 * transcript text (accents, CJK) survives instead of being mangled.
 */
async function download(output) {
  const bytes = new TextEncoder().encode(output.content);
  let binary = '';
  const CHUNK = 0x8000; // avoid "too many arguments" on large files
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  const dataUrl = 'data:' + output.mime + ';base64,' + btoa(binary);

  return chrome.downloads.download({
    url: dataUrl,
    filename: output.filename,
    saveAs: false,
    conflictAction: 'uniquify'
  });
}

// ------------------------------------------------------- re-download support

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'TLDV_REDOWNLOAD') return false;

  chrome.storage.session
    .get(STORAGE_KEY)
    .then((r) => {
      const last = r[STORAGE_KEY];
      if (!last) return sendResponse({ ok: false, error: 'nothing saved yet' });
      return download({
        filename: last.filename,
        mime: last.mime,
        content: last.content
      }).then((id) => sendResponse({ ok: true, downloadId: id }));
    })
    .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));

  return true;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'TLDV_GET_LAST') return false;

  chrome.storage.session
    .get(STORAGE_KEY)
    .then((r) => {
      const last = r[STORAGE_KEY];
      if (!last) return sendResponse({ ok: false });
      // Do not ship the full content to the popup; it only needs the summary.
      return sendResponse({
        ok: true,
        summary: {
          meetingId: last.meetingId,
          blocks: last.blocks,
          filename: last.filename,
          savedAt: last.savedAt
        }
      });
    })
    .catch(() => sendResponse({ ok: false }));

  return true;
});

// Clear the badge when the user navigates away or closes the tab.
chrome.tabs.onRemoved.addListener((tabId) => {
  runningTabs.delete(tabId);
});
