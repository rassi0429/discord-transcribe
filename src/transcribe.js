import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

// One instance and one provider socket per Discord user. PCM: 24 kHz, mono, s16le.
export class SpeakerSession {
  constructor(options, speaker, store, translator, onClose = () => {}) {
    Object.assign(this, { options, speaker, store, translator, onClose });
    this.prefix = `${speaker.id}:${randomUUID()}`;
    this.ready = false; this.closed = false; this.queue = []; this.queuedBytes = 0;
    this.turnBytes = 0; this.turnStart = null; this.commits = []; this.items = new Map();
    this.lastAudio = Date.now();
    this.ws = new WebSocket(options.realtimeUrl, { headers: { Authorization: `Bearer ${options.apiKey}` }, handshakeTimeout: 10000 });
    this.startTimer = setTimeout(() => this.fail('音声認識への接続がタイムアウトしました'), 15000);
    this.idleTimer = setInterval(() => { if (Date.now() - this.lastAudio > 90000) this.close(); }, 15000);
    this.ws.on('open', () => this.ws.send(JSON.stringify({ type: 'session.update', session: {
      type: 'transcription', audio: { input: {
        format: { type: 'audio/pcm', rate: 24000 },
        transcription: { model: options.transcribeModel, languages: ['ja'], delay: options.delay, keywords: options.keywords },
        turn_detection: null,
      } },
    } })));
    this.ws.on('message', raw => {
      try { this.handle(JSON.parse(raw.toString())); } catch { this.fail('音声認識の応答を処理できませんでした'); }
    });
    this.ws.on('error', () => this.fail('音声認識に接続できません。APIキー・接続状況を確認してください'));
    this.ws.on('close', () => { if (!this.closed) this.fail('音声認識の接続が切れました。次の発言で再接続します'); });
  }
  send(event, bytes = 0) {
    if (this.closed) return;
    if (this.ready) {
      if (this.ws.bufferedAmount > 1024 * 1024) return this.fail('音声送信が追いついていません');
      this.ws.send(JSON.stringify(event));
    } else {
      this.queuedBytes += bytes;
      if (this.queuedBytes > 48000 * 12) return this.fail('音声認識の接続待ちが長すぎます');
      this.queue.push(event);
    }
  }
  push(pcm) {
    if (this.closed) return;
    this.lastAudio = Date.now();
    if (!this.turnBytes) this.turnStart = this.lastAudio;
    this.turnBytes += pcm.length;
    this.send({ type: 'input_audio_buffer.append', audio: pcm.toString('base64') }, pcm.length);
    if (this.turnBytes >= this.options.maxTurnMs * 48) this.commit();
  }
  commit() {
    if (this.closed || !this.turnBytes) return;
    // The service requires at least 100 ms per commit. Pad very short utterances.
    if (this.turnBytes < 4800) this.send({ type: 'input_audio_buffer.append', audio: Buffer.alloc(4800 - this.turnBytes).toString('base64') }, 4800 - this.turnBytes);
    this.commits.push(this.turnStart);
    this.send({ type: 'input_audio_buffer.commit' });
    this.turnBytes = 0; this.turnStart = null;
  }
  handle(event) {
    if (this.closed) return;
    if (event.type === 'session.updated') {
      clearTimeout(this.startTimer); this.ready = true;
      for (const command of this.queue) this.send(command);
      this.queue = []; this.queuedBytes = 0;
      return;
    }
    if (event.type === 'error') return this.fail(`音声認識エラー (${event.error?.code || 'unknown'})。モデル・利用上限・設定を確認してください`);
    if (event.type === 'input_audio_buffer.committed') {
      const startedAt = this.commits.shift() ?? Date.now();
      const entry = this.entry(event.item_id);
      entry.startedAt = startedAt;
      this.store.patch(entry.id, { startedAt });
      return;
    }
    if (!event.type.startsWith('conversation.item.input_audio_transcription.')) return;
    const entry = this.entry(event.item_id);
    if (entry.final) return;
    if (event.type.endsWith('.delta')) {
      entry.text += event.delta || '';
      this.store.upsert({ ...entry, speaker: this.speaker, state: 'partial' });
    } else if (event.type.endsWith('.completed')) {
      entry.text = event.transcript || ''; entry.final = true;
      this.store.upsert({ ...entry, speaker: this.speaker, state: 'final' });
      this.translator.enqueue({ ...entry });
      if (this.items.size > 250) this.items.delete(this.items.keys().next().value);
    } else if (event.type.endsWith('.failed')) {
      entry.final = true;
      this.store.upsert({ ...entry, speaker: this.speaker, state: 'error', error: 'この発言を認識できませんでした' });
    }
  }
  entry(itemId) {
    if (!this.items.has(itemId)) this.items.set(itemId, { id: `${this.prefix}:${itemId}`, text: '', startedAt: this.commits[0] ?? this.turnStart ?? Date.now() });
    return this.items.get(itemId);
  }
  fail(message) { if (!this.closed) { this.store.updateStatus({ message: `${this.speaker.name}: ${message}` }); this.close(); } }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.startTimer); clearInterval(this.idleTimer);
    for (const item of this.items.values()) if (!item.final) this.store.patch(item.id, { state: 'error', error: '接続が終了したため未確定です' });
    this.queue = []; this.ws.terminate(); this.onClose();
  }
}
