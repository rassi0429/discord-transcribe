import { SlashCommandBuilder } from 'discord.js';

export const command = new SlashCommandBuilder().setName('caption').setDescription('話者別のリアルタイム字幕')
  .addSubcommand(s => s.setName('start').setDescription('参加中の音声チャンネルの文字起こしを開始'))
  .addSubcommand(s => s.setName('stop').setDescription('文字起こしを停止'))
  .addSubcommand(s => s.setName('status').setDescription('接続状態を表示'));
