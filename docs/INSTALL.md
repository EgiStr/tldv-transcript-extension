# Install & Usage Guide — tl;dv Transcript Exporter

A step-by-step guide for a manual install. No technical background needed.

---

## At a glance

| | |
| --- | --- |
| What it does | Extracts the **complete** transcript from a tl;dv meeting page |
| Output | A `.md`, `.txt`, or `.json` file |
| Install | Once, via `chrome://extensions` (~2 minutes) |
| Browser | Chrome, Edge, Brave, Opera (anything Chromium-based) |

---

## Part 1 — Installing

### Step 1. Download and extract

1. Download `tldv-transcript-exporter-v1.0.0.zip`
2. Extract it to a **permanent** folder, e.g. `C:\extensions\tldv-exporter`

> **Important:** do not extract to Downloads and then delete it. Chrome loads the
> extension directly from that folder, so the folder must stay where it is. Move
> or delete it and the extension stops working.

After extracting, the folder must look like this — `manifest.json` must sit
**directly inside** it, not one level deeper:

```
tldv-exporter\
  manifest.json      <- must be here
  README.md
  LICENSE
  icons\
  src\
```

If you end up with `tldv-exporter\tldv-transcript-exporter\manifest.json`, move
the contents up one level.

### Step 2. Open the Chrome extensions page

Type this in the address bar and press Enter:

```
chrome://extensions
```

### Step 3. Turn on Developer mode

The **Developer mode** toggle is in the **top-right corner**. Turn it on.

Three buttons appear: **Load unpacked**, **Pack extension**, **Update**.

### Step 4. Load the extension

1. Click **Load unpacked**
2. Select the folder you extracted (`tldv-exporter`)
3. Click **Select Folder**

The extension appears in the list as **tl;dv Transcript Exporter**.

> An error here almost always means `manifest.json` is not in the folder you
> picked. Re-check Step 1.

### Step 5. Pin it to the toolbar (optional, recommended)

1. Click the **puzzle-piece** icon to the right of the address bar
2. Find **tl;dv Transcript Exporter**
3. Click the **pin** icon

The icon now stays on your toolbar.

---

## Part 2 — Using it

### Step 1. Open a meeting on tl;dv

```
https://tldv.io/app/meetings/<MEETING_ID>/
```

### Step 2. Make sure the Transcript tab is showing

The extension reads the transcript list as displayed. If another tab is open
(Notes, Summary), switch to **Transcript** first.

### Step 3. Click the extension icon

The popup shows:

- **Format** — pick `.md`, `.txt`, or `.json`
- **Export transcript** — the start button
- A progress bar

### Step 4. Click Export transcript

The sweep runs. The progress bar tracks it, e.g. `218 / 390`.

**Timing:** roughly 3–5 minutes for a 1 h 40 m meeting. This is expected — the
speed is limited by how fast the tl;dv page re-renders its transcript.

**The page will scroll on its own.** Do not touch the scroll, do not switch
tabs, and do not close the tl;dv tab while it runs.

### Step 5. The file is saved

The file downloads automatically when the sweep finishes:

```
tldv-transcript-6ac740deabce3900133486c2-20261009-2045.md
```

The name carries the meeting ID and the export date.

---

## Part 3 — Troubleshooting

### "Open a tl;dv meeting first"

The popup did not find the right page. Open the tl;dv meeting in the active tab,
then click the icon again.

### "No transcript blocks found"

The **Transcript** tab is not open in tl;dv. Open it and try again.

### The sweep stops partway

The page lost focus, or you scrolled manually during the run. Click **Export
transcript** again — previous progress is reused, so it does not start over.

### The file contains a missing-blocks warning

This is **expected and deliberate**. Example:

```markdown
- **Warning:** 6 block(s) could not be rendered and are absent (indices: 270, 271, …)
```

Sometimes the tl;dv page will not render certain blocks no matter how hard it is
pushed. Rather than fail the whole export, the extension keeps what it captured
and **tells you what is missing**. A transcript honest about its gaps is more
useful than one that looks complete and is not.

If the loss is large (>15% of blocks) the extension **refuses** instead and
shows an error — so you never mistake a partial capture for a complete one.

### The output is empty, or contains only numbers

That is a sign tl;dv changed its DOM structure. Report it on
[GitHub Issues](https://github.com/EgiStr/tldv-transcript-extension/issues) — the
extension is designed to fail loudly rather than quietly produce wrong output.

### After I change the code

Click the **reload** button (circular arrow) on the extension's card in
`chrome://extensions`.

If behaviour still looks stale, Chrome may be serving a cached module:

1. Close all Chrome windows
2. Open `%LOCALAPPDATA%\Google\Chrome\User Data\Default`
3. Delete the folders named `Service Worker` and `Code Cache`
4. Start Chrome again

---

## Part 4 — About the content

**This transcript is tl;dv's raw auto-caption text.**

- Names and technical terms are frequently **misheard** by tl;dv's system. Real
  examples from the output: `teklokannya`, `capan`, `meng, KPI`.
- Speaker labels are **inconsistent** — one person may appear under different
  spellings across blocks.
- Punctuation and capitalisation are not reliable.

In other words, this is **not a publish-ready transcript**. Treat it as raw
material that still needs editing. For anything quoted, verify against the video
recording.

**The extension changes nothing.** It copies exactly what tl;dv displays. If the
text is wrong on screen, it is wrong in the file.

---

## Part 5 — Privacy and permissions

This extension **sends no data anywhere.**

- No server, no third-party API, no telemetry.
- No analytics, no tracking.
- Everything runs locally in your browser.
- Output files are created on your machine and never uploaded.

### Permissions and why they are needed

| Permission | Why |
| --- | --- |
| `downloads` | Saves the transcript file to your Downloads folder |
| `storage` | Remembers your format choice and the last export |
| `scripting` | Injects the reader if automatic loading is not ready yet |
| `https://tldv.io/*` | Reads the tl;dv meeting page — **this origin only** |

Only `tldv.io` is accessed. The extension cannot read any other site.

---

## Part 6 — Uninstalling

1. Open `chrome://extensions`
2. Find **tl;dv Transcript Exporter**
3. Click **Remove**

You can then delete the extracted folder. Transcripts you already downloaded stay
in your Downloads folder — they are yours, not the extension's.
