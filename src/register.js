import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { command } from './commands.js';
const c = config();
for (const key of ['token', 'clientId', 'guildId']) if (!c[key]) throw new Error(`.env の ${key} を設定してください`);
const rest = new REST({ version: '10' }).setToken(c.token);
// POST upserts this named command without deleting unrelated commands.
try {
  await rest.post(Routes.applicationGuildCommands(c.clientId, c.guildId), { body: command.toJSON() });
  console.log('/caption を登録しました');
} catch (error) {
  console.error(`コマンド登録に失敗しました (HTTP ${error.status ?? 'unknown'}, code ${error.code ?? 'unknown'})。Botの招待・トークン・Application ID・サーバーIDを確認してください。`);
  process.exitCode = 1;
}
