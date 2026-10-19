import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import prism from 'prism-media';
import OpusScript from 'opusscript';
import { config } from '../src/config.js';
import { Store } from '../src/store.js';
import { SpeakerSession } from '../src/transcribe.js';
import { Translator } from '../src/translate.js';
import { createDashboard } from '../src/server.js';

async function until(check) {
  const end = Date.now() + 3000;
  while (!check()) { if (Date.now() > end) throw new Error('Timed out'); await new Promise(r => setTimeout(r, 10)); }
}

test('separate speaker sockets, queued audio, matching items and out-of-order final events', async t => {
  const provider = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(provider, 'listening');
  const received = [];
  provider.on('connection', socket => {
    const commands = []; received.push({ socket, commands });
    socket.on('message', data => {
      const e = JSON.parse(data); commands.push(e);
      if (e.type === 'session.update') setTimeout(() => socket.send(JSON.stringify({ type: 'session.updated' })), 20);
    });
  });
  const store = new Store(); const translated = [];
  const options = { ...config({}), apiKey: 'test', realtimeUrl: `ws://127.0.0.1:${provider.address().port}` };
  const sessions = ['alice', 'bob'].map(id => new SpeakerSession(options, { id, name: id }, store, { enqueue: row => translated.push(row) }));
  t.after(() => { sessions.forEach(s => s.close()); provider.close(); });
  sessions[0].push(Buffer.alloc(960, 1)); sessions[0].commit();
  sessions[1].push(Buffer.alloc(960, 2)); sessions[1].commit();
  await until(() => received.length === 2 && received.every(r => r.commands.some(c => c.type === 'input_audio_buffer.commit')));
  received.forEach((r, i) => {
    assert.deepEqual(r.commands[0].session.audio.input.transcription.languages, ['ja']);
    assert.equal(r.commands[0].session.audio.input.format.rate, 24000);
    assert.equal(r.commands[0].session.audio.input.turn_detection, null);
    assert.equal(Buffer.from(r.commands[1].audio, 'base64')[0], i + 1);
    const appended = r.commands.filter(c => c.type === 'input_audio_buffer.append');
    assert.equal(appended.reduce((n, c) => n + Buffer.from(c.audio, 'base64').length, 0), 4800);
    r.socket.send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id: 'same-provider-id' }));
    r.socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'same-provider-id', delta: i ? 'おは' : 'こん' }));
  });
  await until(() => store.rows.size === 2);
  for (const i of [1, 0]) received[i].socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'same-provider-id', transcript: i ? 'おはよう' : 'こんにちは' }));
  await until(() => translated.length === 2);
  const rows = store.snapshot().rows;
  assert.equal(rows.find(r => r.speaker.id === 'alice').text, 'こんにちは');
  assert.equal(rows.find(r => r.speaker.id === 'bob').text, 'おはよう');
  assert.equal(new Set(rows.map(r => r.id)).size, 2);
  received[0].socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'same-provider-id', transcript: 'duplicate' }));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(translated.length, 2);
});

test('provider disconnect marks partial text incomplete and releases speaker session', async t => {
  const provider = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(provider, 'listening');
  provider.on('connection', socket => { socket.send(JSON.stringify({ type: 'session.updated' })); socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'x', delta: '途中' })); setTimeout(() => socket.close(), 25); });
  const store = new Store(); let closed = false;
  const session = new SpeakerSession({ ...config({}), apiKey: 'test', realtimeUrl: `ws://127.0.0.1:${provider.address().port}` }, { id: 'a', name: 'A' }, store, { enqueue() {} }, () => { closed = true; });
  t.after(() => { session.close(); provider.close(); });
  await until(() => closed);
  assert.equal(store.snapshot().rows[0].state, 'error'); assert.match(store.status.message, /切れました/);
});

test('stereo Discord Opus decodes directly to 24kHz mono PCM', async () => {
  const encoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
  const pcm = Buffer.alloc(960 * 2 * 2);
  for (let i = 0; i < 960; i++) { const value = Math.round(Math.sin(2 * Math.PI * 440 * i / 48000) * 16000); pcm.writeInt16LE(value, i * 4); pcm.writeInt16LE(value, i * 4 + 2); }
  const packet = encoder.encode(pcm, 960); encoder.delete();
  const decoder = new prism.opus.Decoder({ rate: 24000, channels: 1, frameSize: 480 });
  const output = once(decoder, 'data'); decoder.write(packet);
  const [decoded] = await output; decoder.destroy();
  assert.equal(decoded.length, 480 * 2);
  assert.ok(decoded.some(value => value !== 0));
});

test('translation client sends Japanese text over HTTP and preserves transcript on failures', async t => {
  const requests = [];
  const provider = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push({ path: req.url, body });
    if (body.messages[1].content === '失敗') { res.writeHead(429).end('limit'); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'Hello.' }, finish_reason: 'stop' }] }));
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening'); t.after(() => provider.close());
  const store = new Store(); const translator = new Translator({ ...config({}), apiBase: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'test' }, store);
  for (const [id, text] of [['one', 'こんにちは'], ['two', '失敗']]) { const row = { id, text, state: 'final' }; store.upsert(row); translator.enqueue(row); }
  await until(() => translator.active === 0);
  assert.equal(store.rows.get('one').translation, 'Hello.'); assert.equal(store.rows.get('two').text, '失敗');
  assert.equal(store.rows.get('two').translationState, 'error');
  assert.equal(requests[0].path, '/v1/chat/completions'); assert.equal(requests[0].body.messages[1].content, 'こんにちは');
});

test('dashboard serves snapshots, rejects foreign origins, and never exposes configuration', async t => {
  const store = new Store(); store.upsert({ id: 'a', text: '<script>bad</script>', startedAt: 1 });
  // Use a real, available port then create a server with the exact allowed Host.
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(r => probe.close(r));
  const dashboard = createDashboard(store, { port }); dashboard.server.listen(port, '127.0.0.1'); await once(dashboard.server, 'listening'); t.after(() => dashboard.close());
  const url = `http://127.0.0.1:${port}`;
  const response = await fetch(`${url}/api/state`); assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.rows[0].text, '<script>bad</script>'); assert.equal(body.apiKey, undefined);
  assert.equal((await fetch(`${url}/api/state`, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(`${url}/.env`)).status, 404);
  const events = await fetch(`${url}/events`); const reader = events.body.getReader(); const data = new TextDecoder().decode((await reader.read()).value); assert.match(data, /snapshot/); await reader.cancel();
});
