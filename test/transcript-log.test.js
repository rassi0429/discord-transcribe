import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTranscriptLog } from '../src/transcript-log.js';

test('append final Japanese and delayed English once, preserving existing text', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'caption-log-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'transcript.txt'); await writeFile(path, 'existing\n');
  const store = new EventEmitter(); const log = createTranscriptLog(store, path);
  const row = { id: 'one', startedAt: Date.UTC(2026, 9, 18, 5, 0), speaker: { name: 'テスト' }, text: 'こんにちは', state: 'partial' };
  const send = patch => store.emit('change', { type: 'row', row: { ...row, ...patch } });
  send({}); send({ state: 'final' }); send({ state: 'final', translationState: 'pending' });
  send({ state: 'final', translationState: 'done', translation: 'Hello.\nHi.' });
  send({ state: 'final', translationState: 'done', translation: 'Hello.\nHi.' });
  send({ id: 'empty', state: 'final', text: '…' });
  await log.close();
  const text = await readFile(path, 'utf8');
  assert.ok(text.startsWith('existing\n'));
  assert.equal(text.split('\n').filter(Boolean).length, 3);
  assert.match(text, /2026-10-18 14:00:00 JST/);
  assert.match(text, /テスト \[JA\] こんにちは/);
  assert.match(text, /テスト \[EN\] Hello\. Hi\./);
});
