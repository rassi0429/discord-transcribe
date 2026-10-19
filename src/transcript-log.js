import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const transcriptPath = fileURLToPath(new URL('../logs/transcript.txt', import.meta.url));
const timestamp = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const singleLine = value => String(value || '').replace(/[\r\n\t]+/g, ' ').trim();

// Append Japanese immediately; append English separately when it arrives.
// Translation delays/failures must never prevent the original from being saved.
export function createTranscriptLog(store, path = transcriptPath) {
  const written = new Map();
  let pending = mkdir(dirname(path), { recursive: true });
  let lastError;
  const listener = event => {
    if (event.type !== 'row') return;
    const row = event.row;
    if (row.state !== 'final' || !/[\p{L}\p{N}\p{S}]/u.test(row.text || '')) return;
    const seen = written.get(row.id) || { ja: false, en: false };
    const id = createHash('sha256').update(row.id).digest('hex').slice(0, 8);
    const prefix = `[${timestamp.format(new Date(row.startedAt))} JST] [${id}] ${singleLine(row.speaker?.name)}`;
    let content = '';
    if (!seen.ja) { content += `${prefix} [JA] ${singleLine(row.text)}\n`; seen.ja = true; }
    if (!seen.en && row.translationState === 'done' && row.translation?.trim()) {
      content += `${prefix} [EN] ${singleLine(row.translation)}\n`; seen.en = true;
    }
    written.set(row.id, seen);
    while (written.size > 1000) written.delete(written.keys().next().value);
    if (content) pending = pending.then(() => appendFile(path, content, 'utf8')).catch(error => {
      lastError = error;
      console.error(`字幕ログを書き込めません (${error.code || 'unknown'}): ${path}`);
    });
  };
  store.on('change', listener);
  return {
    async flush() { await pending; if (lastError) throw lastError; },
    async close() { store.off('change', listener); await this.flush(); },
  };
}
