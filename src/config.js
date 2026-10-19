export function config(env = process.env) {
  const integer = (key, fallback, min, max) => {
    const n = Number(env[key] || fallback);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${key}: ${min}〜${max} の整数を指定してください`);
    return n;
  };
  const delay = env.TRANSCRIBE_DELAY || 'medium';
  if (!['minimal', 'low', 'medium', 'high', 'xhigh'].includes(delay)) throw new Error('TRANSCRIBE_DELAY が不正です');
  const keywords = (env.TRANSCRIBE_KEYWORDS || 'Discord').split(',').map(s => s.trim()).filter(Boolean);
  if (keywords.some(s => /[<>\r\n]/.test(s))) throw new Error('固有名詞に改行や < > は使えません');
  return {
    token: env.DISCORD_TOKEN, clientId: env.DISCORD_CLIENT_ID, guildId: env.DISCORD_GUILD_ID,
    apiKey: env.OPENAI_API_KEY, port: integer('PORT', 3210, 1, 65535),
    transcribeModel: env.TRANSCRIBE_MODEL || 'gpt-live-transcribe', delay, keywords,
    translationModel: env.TRANSLATION_MODEL || 'gpt-4.1-mini',
    translationEnabled: env.TRANSLATION_ENABLED !== 'false',
    maxTurnMs: integer('MAX_TURN_MS', 8000, 1000, 30000),
    silenceMs: integer('SILENCE_MS', 700, 200, 3000),
    maxSpeakers: integer('MAX_SPEAKERS', 10, 1, 50),
    realtimeUrl: env.OPENAI_REALTIME_URL || 'wss://api.openai.com/v1/realtime?intent=transcription',
    apiBase: env.OPENAI_API_BASE || 'https://api.openai.com/v1',
  };
}
