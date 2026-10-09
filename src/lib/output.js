/**
 * Output assembly for the background worker.
 *
 * Pure and Node-testable: takes already-extracted rows and returns
 * { filename, content, mime, summary }, so the file format can be verified
 * without loading the extension into Chrome.
 *
 * Imports the libs through bridge.js because they are classic scripts, not ES
 * modules — see the note in bridge.js.
 */

import { util as U, markdown as Markdown } from './bridge.js';

export const FORMATS = {
  md: { ext: 'md', mime: 'text/markdown;charset=utf-8' },
  txt: { ext: 'txt', mime: 'text/plain;charset=utf-8' },
  json: { ext: 'json', mime: 'application/json;charset=utf-8' }
};

/**
 * @param {object} opts
 * @param {Array}  opts.rows
 * @param {string} opts.format - 'md' | 'txt' | 'json'
 * @param {string} opts.meetingId
 * @param {string} [opts.url]
 * @param {string} [opts.title]
 * @param {Date}   [opts.now]
 */
export function buildOutput(opts) {
  const format = FORMATS[opts.format] ? opts.format : 'md';
  const spec = FORMATS[format];
  const rows = opts.rows || [];

  const common = {
    rows: rows,
    meetingId: opts.meetingId,
    url: opts.url,
    title: opts.title,
    now: opts.now,
    missing: opts.missing || []
  };

  let content;
  if (format === 'json') content = Markdown.toJson(common);
  else if (format === 'txt') content = Markdown.toText(common);
  else content = Markdown.toMarkdown(common);

  const filename = U.buildFilename(opts.meetingId, spec.ext, opts.now);

  return {
    filename: filename,
    content: content,
    mime: spec.mime,
    summary: {
      meetingId: opts.meetingId || null,
      blocks: rows.length,
      format: format,
      filename: filename,
      bytes: content.length,
      duration: rows.length ? rows[rows.length - 1].time : null
    }
  };
}
