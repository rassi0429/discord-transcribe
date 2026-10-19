# Discord Transcribe

Discordの会話を**ユーザーごとの独立した音声ストリーム**で文字起こしし、名前・アイコン・日本語字幕・英訳をチャット形式で表示するローカルBotです。

字幕画面のブラウザウィンドウを、通常のDiscordクライアントでGo Live共有します。Bot自身は映像を配信しません。

## 起動

Node.js 22.12以上が必要です。Node.js 26.4.0 / Windowsで動作確認しています。

```powershell
git clone https://github.com/rassi0429/discord-transcribe.git
cd discord-transcribe
npm ci
npm start
```

[字幕画面を開く](http://127.0.0.1:3210)。APIキー未設定の場合は空の字幕画面を表示し、外部APIへは接続しません。終了はターミナルでCtrl+C。

実際の文字起こしにはDiscord Bot TokenとOpenAI APIキーが必要です。APIの使用料金は利用者のアカウントに課金されます。認証情報や会話ログはリポジトリに含まれていません。

## 実際の会話に接続する

1. [Discord Developer Portal](https://discord.com/developers/applications)でアプリとBotを作成します。
2. OAuth2 URL Generatorで `bot` と `applications.commands` を選び、対象サーバーへ招待します。対象チャンネルの **View Channel / Connect / Send Messages** 権限を付与します。管理者権限やMessage Content Intentは不要です。
3. Discordの開発者モードでサーバーIDをコピーします。Application IDはDeveloper Portalから取得します。
4. `.env.example` を `.env` にコピーし、次を記入します。キーをチャットやリポジトリへ貼らないでください。

```dotenv
DISCORD_TOKEN=Botのトークン
DISCORD_CLIENT_ID=Application_ID
DISCORD_GUILD_ID=サーバーID
OPENAI_API_KEY=OpenAIのAPIキー
```

5. 起動中のプロセスを停止し、次を実行します。

```powershell
npm run register
npm start
```

6. Discordの通常のボイスチャンネルに参加し、`/caption start` を実行します。音声がOpenAIへ送信されることを参加者に案内してから使ってください。コマンド実行時にも案内が表示されます。
7. [字幕画面](http://127.0.0.1:3210)のブラウザをDiscordから画面共有します。字幕と右上の「英訳」チェックだけを表示します。
8. `/caption stop` で終了します。`/caption status` で状態を確認できます。

一度に扱うのは、設定された1サーバーの1ボイスチャンネルです。ステージチャンネルは対象外です。

## 音声と翻訳の流れ

```text
Discord user A → Opusデコード → A専用Realtime接続 → Aの日本語字幕 → 英訳
Discord user B → Opusデコード → B専用Realtime接続 → Bの日本語字幕 → 英訳
                                              ↓
                                   ローカル字幕画面へSSE配信
```

- 音声を混ぜず、DiscordユーザーIDで話者を確定します。同時に話しても別々の行です。マイクが拾った他人の声までは分離できません。
- Opusを24 kHz・モノラル・16-bit PCMへデコードします。`opusscript` を使うためローカルのC++ビルド環境やFFmpegは不要です。
- 音声認識は `gpt-live-transcribe`。日本語指定、固有名詞ヒント、認識遅延の調整に対応します。部分テキストを逐次表示し、確定テキストで置き換えます。
- 英訳は `gpt-4.1-mini` に確定テキストを送ります。日本語の確定後に表示されるため同時表示ではありません。英訳の処理中も日本語字幕は進みます。
- 無音700 ms、または音声8秒分ごとに発言を確定します。8秒は翻訳待ちを長くしすぎないための初期値で、文の途中で区切れることがあります。
- 発言IDと接続IDで日本語・英訳を対応づけ、返答順が入れ替わっても別の発言へ上書きしません。
- 90秒間発言がなければそのユーザーのAPI接続を閉じ、次の発言で作り直します。音声認識エラーも画面に表示し、次の発言で再接続します。
- 停止・退出で未確定の応答が残った場合は「未確定」と表示します。確実に最後まで字幕を得たい場合は、表示の確定を待ってから停止してください。

## 調整

`.env` を変更したらBotを再起動します。

| 設定 | 初期値 | 意味 |
| --- | --- | --- |
| `TRANSCRIBE_DELAY` | `medium` | `minimal / low / medium / high / xhigh`。低いほど表示優先、高いほど文脈を待つ設定 |
| `TRANSCRIBE_KEYWORDS` | `Discord` | カンマ区切りの人名・ゲーム名・専門用語。認識ヒントであり強制置換ではありません |
| `MAX_TURN_MS` | `8000` | 長い発言を確定させる音声長。1000〜30000 ms |
| `SILENCE_MS` | `700` | 発言の区切りに使う無音時間。200〜3000 ms |
| `MAX_SPEAKERS` | `10` | アクティブな音声認識接続数の上限。1〜50 |
| `TRANSLATION_ENABLED` | `true` | `false` なら英訳APIを呼びません |
| `TRANSLATION_MODEL` | `gpt-4.1-mini` | Chat Completions対応の翻訳モデル |
| `PORT` | `3210` | ローカル字幕画面のポート |

「英訳」チェックは**表示のみ**の切り替えです。翻訳APIの利用を止めたいときは `TRANSLATION_ENABLED=false` を使います。翻訳先はこの版では英語固定です。

APIキーには利用可能な残高と対象モデルへのアクセスが必要です。日本語精度や遅延の最上位を保証するものではなく、普段のマイク、固有名詞、ノイズ、同時発話を含む音声で確認してください。

## データと接続

音声はOpenAIへ、確定した日本語テキストは翻訳APIへ送信します。Botは音声ファイルを保存しません。画面用の字幕は最大200件をメモリに保持し、再起動または次の開始時に消去します。確定した字幕は `logs/transcript.txt` にUTF-8で追記し、再起動しても残ります。OpenAI側のデータ取扱いは利用するAPIアカウントの設定・ポリシーに従います。

ログは日本時間の日時、発言ID、話者名、`[JA]` / `[EN]`、本文の順です。日本語は確定後すぐ、英訳は返ってきた時点で別行に追記します。認識途中や空の結果は保存しません。`logs/` はGit管理対象外です。自動削除やローテーションは行いません。

画面サーバーは `127.0.0.1` のみにバインドし、外部Origin・Hostからのアクセスを拒否します。APIキーはフロントエンドへ送りません。サーバーを公開するための認証機能は含めていないため、リバースプロキシ等でインターネットに公開しないでください。

## 検証

```powershell
npm test
node scripts/doctor.js
```

テストは、2ユーザーの独立WebSocket、接続待ちの音声保持、短い音声のパディング、応答順の逆転、切断時の表示、Opus→PCM変換、翻訳のHTTP通信と429エラー、画面のSSE・Origin制限を検証します。実際のOpenAI認識品質やDiscordでの受信を証明するものではありません。

翻訳のPostmanシミュレーション（CLI 1.70以上）は別ターミナルで実行します。

```powershell
postman simulation run postman/simulations/captions.sim.yaml --port 4900 --output ndjson
npm run test:simulation
```

翻訳モックは公式ドキュメントとOrbitのAPI情報に基づくローカルのテスト用実装です。音声WebSocketはNodeテスト内のプロトコル模擬サーバーで検証します。

## 制約・参照

Discordの音声受信は公式に文書化された安定APIではありません。`@discordjs/voice` 0.19.2とDAVE対応依存ライブラリを利用していますが、Discordの変更により更新が必要になる可能性があります。

- [OpenAI Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [discord.js voice](https://github.com/discordjs/discord.js/tree/main/packages/voice)
- [Discord Go Live](https://support.discord.com/hc/en-us/articles/360040816151-Go-Live-and-Screen-Share)

## ライセンス

[MIT](LICENSE)
