import { Client, GatewayIntentBits, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { joinVoiceChannel, entersState, VoiceConnectionStatus, EndBehaviorType } from '@discordjs/voice';
import prism from 'prism-media';
import { SpeakerSession } from './transcribe.js';

export class CaptionBot {
  constructor(options, store, translator) {
    Object.assign(this, { options, store, translator });
    this.sessions = new Map(); this.captures = new Map(); this.connection = null; this.channel = null; this.starting = false;
    this.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    this.client.on('error', () => store.updateStatus({ message: 'Discord接続エラー。接続状況を確認してください' }));
    this.client.on('interactionCreate', i => this.interact(i).catch(() => {
      store.updateStatus({ message: 'コマンドを実行できませんでした。Botの権限と接続状況を確認してください' });
      if (i.isRepliable()) (i.deferred || i.replied ? i.editReply('処理に失敗しました。Botの権限と接続状況を確認してください') : i.reply({ content: '処理に失敗しました', flags: MessageFlags.Ephemeral })).catch(() => {});
    }));
    this.client.on('voiceStateUpdate', (oldState, newState) => {
      if (!this.channel) return;
      if (newState.id === this.client.user.id && newState.channelId !== this.channel.id) { this.stop('Botが音声チャンネルから退出しました'); return; }
      if (oldState.channelId === this.channel.id && newState.channelId !== this.channel.id) this.removeSpeaker(newState.id);
      this.updateSpeakers();
    });
    this.client.once('clientReady', () => store.updateStatus({ message: '準備完了。Discordで /caption start を実行してください' }));
  }
  async login() { await this.client.login(this.options.token); }
  async interact(i) {
    if (!i.isChatInputCommand() || i.commandName !== 'caption') return;
    if (i.guildId !== this.options.guildId) return i.reply({ content: '設定されたサーバーで実行してください', flags: MessageFlags.Ephemeral });
    const sub = i.options.getSubcommand();
    if (sub === 'status') return i.reply({ content: this.channel ? `文字起こし中: ${this.channel.name}` : '文字起こしは停止中です', flags: MessageFlags.Ephemeral });
    const member = await i.guild.members.fetch(i.user.id);
    if (sub === 'stop') {
      if (this.starting) return i.reply({ content: '接続処理中です。少し待ってから停止してください', flags: MessageFlags.Ephemeral });
      if (this.channel && member.voice.channelId !== this.channel.id && !member.permissions.has(PermissionFlagsBits.ManageGuild)) return i.reply({ content: '文字起こし中の音声チャンネルに参加してから停止してください', flags: MessageFlags.Ephemeral });
      this.stop();
      return i.reply('文字起こしを停止しました');
    }
    if (!member.voice.channel || member.voice.channel.type !== 2) return i.reply({ content: '通常のボイスチャンネルに参加してから実行してください', flags: MessageFlags.Ephemeral });
    if (this.channel || this.starting) return i.reply({ content: 'すでに接続中です。先に /caption stop で停止してください', flags: MessageFlags.Ephemeral });
    this.starting = true;
    try {
      await i.deferReply();
      await i.editReply('このチャンネルの発言を話者別に文字起こしし、英訳します。音声はOpenAIへ送信されます。停止: /caption stop');
      await this.start(member.voice.channel);
      await i.editReply('話者別の文字起こしを開始しました。音声はOpenAIへ送信されます。停止: /caption stop');
    } finally { this.starting = false; }
  }
  async start(channel) {
    this.channel = channel;
    this.store.clear();
    const connection = joinVoiceChannel({ channelId: channel.id, guildId: channel.guild.id, adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: false, selfMute: true });
    this.connection = connection;
    connection.on('error', () => this.stop('Discordの音声接続でエラーが発生しました。/caption start で再接続してください'));
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([entersState(connection, VoiceConnectionStatus.Signalling, 5000), entersState(connection, VoiceConnectionStatus.Connecting, 5000)]);
        await entersState(connection, VoiceConnectionStatus.Ready, 15000);
      } catch { if (this.connection === connection) this.stop('Discordとの音声接続が切れました。/caption start で再接続してください'); }
    });
    try { await entersState(connection, VoiceConnectionStatus.Ready, 20000); }
    catch (error) { if (this.connection === connection) this.stop('音声チャンネルに接続できませんでした'); throw error; }
    if (this.connection !== connection) return;
    connection.receiver.speaking.on('start', id => this.capture(id));
    this.store.updateStatus({ connected: true, channel: channel.name, message: '音声を待っています' });
    this.updateSpeakers();
  }
  capture(id) {
    if (!this.connection || !this.channel || this.captures.has(id)) return;
    const member = this.channel.members.get(id);
    if (!member || member.user.bot) return;
    let session = this.sessions.get(id);
    if (!session) {
      if (this.sessions.size >= this.options.maxSpeakers) { this.store.updateStatus({ message: '同時接続人数の上限です。MAX_SPEAKERSを確認してください' }); return; }
      const speaker = { id, name: member.displayName, avatar: member.displayAvatarURL({ extension: 'png', size: 64 }) };
      session = new SpeakerSession(this.options, speaker, this.store, this.translator, () => {
        if (this.sessions.get(id) === session) this.sessions.delete(id);
      });
      this.sessions.set(id, session);
    }
    const input = this.connection.receiver.subscribe(id, { end: { behavior: EndBehaviorType.AfterSilence, duration: this.options.silenceMs } });
    // libopus decodes directly at the target rate; no naive downsampling.
    const decoder = new prism.opus.Decoder({ rate: 24000, channels: 1, frameSize: 480 });
    let ended = false;
    const finish = (error = false) => {
      if (ended) return; ended = true;
      session.commit();
      input.unpipe(decoder); input.destroy(); decoder.destroy(); this.captures.delete(id);
      if (error) this.store.updateStatus({ message: `${member.displayName}: 音声を復号できませんでした` });
      this.updateSpeakers();
    };
    this.captures.set(id, { finish });
    decoder.on('data', pcm => session.push(pcm));
    decoder.once('end', () => finish());
    decoder.once('error', () => finish(true)); input.once('error', () => finish(true));
    input.pipe(decoder);
    this.updateSpeakers();
  }
  updateSpeakers() {
    this.store.updateStatus({ speakers: this.channel ? [...this.channel.members.values()].filter(m => !m.user.bot).map(m => ({ id: m.id, name: m.displayName, speaking: this.captures.has(m.id) })) : [] });
  }
  removeSpeaker(id) { this.captures.get(id)?.finish(); this.sessions.get(id)?.close(); this.sessions.delete(id); }
  stop(message = '停止しました。Discordで /caption start を実行すると再開します') {
    for (const id of [...this.captures.keys()]) this.captures.get(id)?.finish();
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
    const connection = this.connection; this.connection = null; this.channel = null;
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
    this.store.updateStatus({ connected: false, channel: null, speakers: [], message });
  }
  destroy() { this.stop(); this.client.destroy(); }
}
