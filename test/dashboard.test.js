import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';

function dashboard() {
  const { document, HTMLElement } = parseHTML(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'));
  HTMLElement.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 100 });
  let source; let nextId = 0; const callbacks = new Map();
  runInNewContext(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), {
    document, Intl,
    EventSource: class { constructor() { source = this; } },
    requestAnimationFrame: fn => { callbacks.set(++nextId, fn); return nextId; },
    cancelAnimationFrame: id => callbacks.delete(id),
  });
  return {
    document,
    send: data => source.onmessage({ data: JSON.stringify(data) }),
    flush: () => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(fn => fn()); },
  };
}
const row = (id, text, startedAt = 1) => ({ id, text, startedAt, speaker: { id: 'speaker', name: 'Test' }, state: 'partial' });
const status = { connected: true, channel: 'Test', message: 'Test', speakers: [] };

test('empty and punctuation-only recognitions never create placeholder rows', () => {
  const d = dashboard();
  for (const [id, text] of ['', '   ', '…', '...', '。。。', '\n'].entries()) d.send({ type: 'row', row: row(String(id), text) });
  d.flush();
  assert.equal(d.document.querySelectorAll('.message').length, 0);
  d.send({ type: 'row', row: row('yes', 'うん') }); d.flush();
  assert.equal(d.document.querySelector('.transcript').textContent, 'うん');
  d.send({ type: 'row', row: { ...row('yes', ''), state: 'final' } }); d.flush();
  assert.equal(d.document.querySelectorAll('.message').length, 0);
});

test('partial/translation updates and reconnect snapshots preserve existing DOM nodes without moves', () => {
  const d = dashboard(); const feed = d.document.getElementById('feed');
  d.send({ type: 'row', row: row('a', 'こん') }); d.send({ type: 'row', row: row('b', 'はい', 2) }); d.flush();
  const original = [...d.document.querySelectorAll('.message')];
  const avatar = original[0].querySelector('.avatar');
  let moves = 0;
  const insert = feed.insertBefore.bind(feed); feed.insertBefore = (...args) => { moves++; return insert(...args); };
  d.send({ type: 'row', row: row('a', 'こんにち') });
  d.send({ type: 'row', row: { ...row('a', 'こんにちは'), translation: 'Hello', state: 'final' } }); d.flush();
  assert.equal(original[0].querySelector('.transcript').textContent, 'こんにちは');
  assert.equal(original[0].querySelector('.avatar'), avatar);
  assert.equal(moves, 0);
  d.send({ type: 'snapshot', status, rows: [row('a', 'こんにちは'), row('b', 'はい', 2)] }); d.flush();
  assert.deepEqual([...d.document.querySelectorAll('.message')], original);
  assert.equal(moves, 0);
});

test('late-arriving rows are inserted in order and errors remain visible', () => {
  const d = dashboard();
  d.send({ type: 'row', row: row('b', 'second', 2) }); d.flush();
  d.send({ type: 'row', row: row('a', 'first', 1) }); d.flush();
  assert.deepEqual([...d.document.querySelectorAll('.transcript')].map(e => e.textContent), ['first', 'second']);
  d.send({ type: 'row', row: { ...row('error', '', 3), state: 'error', error: '認識エラー' } }); d.flush();
  assert.equal(d.document.querySelectorAll('.message').length, 3);
  d.send({ type: 'row', row: row('pending', 'discard', 4) });
  d.send({ type: 'reset' }); d.flush();
  assert.equal(d.document.querySelectorAll('.message').length, 0);
});
