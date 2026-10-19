import { config } from './config.js';
import { Store } from './store.js';
import { Translator } from './translate.js';
import { createDashboard } from './server.js';
import { createTranscriptLog } from './transcript-log.js';

const options = config();
const configured = options.token && options.guildId && options.apiKey;
const store = new Store();
const transcriptLog = createTranscriptLog(store);
const dashboard = createDashboard(store, options);
let bot;
dashboard.server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `ポート${options.port}は使用中です。.envのPORTを変更してください` : '画面サーバーを起動できませんでした'); process.exit(1); });
dashboard.server.listen(options.port, '127.0.0.1', async () => {
  console.log(`字幕画面: http://127.0.0.1:${options.port}`);
  if (!configured) {
    store.updateStatus({ message: '.env にDiscord Bot Token・サーバーID・OpenAI APIキーを設定し、Botを再起動してください' });
    console.log('APIキー未設定。画面は待機中です。');
  }
  else {
    try {
      const { CaptionBot } = await import('./bot.js');
      bot = new CaptionBot(options, store, new Translator(options, store));
      await bot.login();
    } catch { store.updateStatus({ message: 'Botを起動できませんでした。トークン・Node.js・音声ライブラリを確認してください' }); console.error(store.status.message); }
  }
});
async function shutdown() {
  bot?.destroy(); dashboard.close();
  try { await transcriptLog.close(); process.exit(0); }
  catch { process.exit(1); }
}
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
