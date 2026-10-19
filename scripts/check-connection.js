import { config } from '../src/config.js';
import WebSocket from 'ws';
const c = config();
for (const key of ['token', 'clientId', 'guildId', 'apiKey']) {
  console.log(`${key}: ${c[key] ? 'configured' : 'MISSING'}`);
}
if (!c.apiKey) process.exit(1);
for (const model of [c.transcribeModel, c.translationModel]) {
  try {
    const r = await fetch(`${c.apiBase}/models/${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${c.apiKey}` }, signal: AbortSignal.timeout(15000),
    });
    console.log(`Model ${model}: HTTP ${r.status}`);
  } catch { console.log(`Model ${model}: connection failed`); }
}
await new Promise(resolve => {
  const ws = new WebSocket(c.realtimeUrl, { headers: { Authorization: `Bearer ${c.apiKey}` }, handshakeTimeout: 15000 });
  let finished = false;
  const done = message => { if (finished) return; finished = true; console.log(message); clearTimeout(timeout); ws.terminate(); resolve(); };
  const timeout = setTimeout(() => done('Realtime: timeout'), 20000);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'session.update', session: {
    type: 'transcription', audio: { input: { format: { type: 'audio/pcm', rate: 24000 }, transcription: {
      model: c.transcribeModel, languages: ['ja'], delay: c.delay, keywords: c.keywords,
    }, turn_detection: null } },
  } })));
  ws.on('message', raw => {
    const event = JSON.parse(raw.toString());
    if (event.type === 'session.updated') done('Realtime: session configuration accepted (no audio sent)');
    if (event.type === 'error') done(`Realtime: rejected (code ${event.error?.code ?? 'unknown'}, param ${event.error?.param ?? 'unknown'})`);
  });
  ws.on('error', () => done('Realtime: connection/authentication failed'));
  ws.on('close', () => done('Realtime: closed before configuration accepted'));
});
