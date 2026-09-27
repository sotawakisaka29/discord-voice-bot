# Discord Voice Clone Bot

自分または明確な許可を得た人の声を使い、Discord のボイスチャンネルでテキストを読み上げるローカル運用のボットです。外部の音声生成 API に依存せず、コストと音声データの外部送信を抑える方針で開発しています。

## 現在の状態

以下の機能を実装済みです。

- Discord へのログインとテストサーバーへのスラッシュコマンド登録
- ボイスチャンネルへの接続・切断と固定テスト音の再生
- `/say` と通常チャットメッセージの自動読み上げ
- サーバー単位の音声生成・再生キュー
- 声プロフィールの一覧表示、切り替え、サーバーごとの選択保存
- macOS 音声合成、GPT-SoVITS、Style-Bert-VITS2 の3種類の音声エンジン
- Style-Bert-VITS2 用データセットの分割・整形用スクリプト

GPT-SoVITS と Style-Bert-VITS2 の連携コードは実装済みですが、利用時にはそれぞれの本体、Python 環境、必要なモデルをローカルに準備する必要があります。

## アーキテクチャ

Discord ボットと重い音声生成モデルは別プロセスで動かします。GPT-SoVITS と Style-Bert-VITS2 の HTTP サーバーは `127.0.0.1` だけに公開し、ネットワーク外部からはアクセスできない構成にします。

```text
Discordの /say または通常メッセージ
  → Node.js / discord.js ボット
  → 選択中のローカル音声エンジン
     ├─ macOS NSSpeechSynthesizer + ffmpeg
     ├─ GPT-SoVITS HTTP API
     └─ Style-Bert-VITS2 FastAPI ブリッジ
  → 一時音声ファイル
  → サーバーごとの再生キュー
  → Discordのボイスチャンネル
```

音声生成はサーバーごとに直列化し、受信順を保って再生します。生成した一時ファイルは再生後に削除します。

## 必要環境

- macOS
- Node.js 22.12.0 以上と npm
- Swift 実行環境（macOS 音声合成に使用）
- ffmpeg
- Discord Bot とテスト用サーバー
- 選択する音声エンジンに応じた Python 環境とモデル

## セットアップ

### 1. Node.js 依存関係

```bash
npm install
```

### 2. Discord 設定

Discord Developer Portal で Bot を作成し、テストサーバーへ追加します。ボイス機能には `Connect` と `Speak` 権限が必要です。通常チャットの自動読み上げを使う場合は、Bot 設定の **Message Content Intent** も有効にします。

プロジェクト直下の `.env` に次の2項目を設定します。実際の値はチャット、ログ、リポジトリに記録しないでください。

```dotenv
DISCORD_BOT_TOKEN=<Botのトークン>
DISCORD_GUILD_ID=<テストサーバーのID>
```

### 3. 動作確認

macOS の標準音声と ffmpeg だけで音声ファイルを生成できるか確認します。

```bash
npm run tts:test
```

成功すると `tmp/tts-test.mp3` が生成されます。`tmp/` の生成物は Git で管理しません。

## 起動方法

macOS 音声合成だけを使う場合、別の音声サーバーは不要です。

```bash
npm start
```

GPT-SoVITS または Style-Bert-VITS2 を使う場合は、先に対応するローカルサーバーを別ターミナルで起動し、その後に Bot を起動します。

```bash
# ターミナル1：どちらか一方
npm run gpt-sovits:start
npm run style-bert-vits2:start

# ターミナル2
npm start
```

2つの音声サーバーを同時に利用したい場合は、それぞれを個別のターミナルで起動します。

## Discord コマンド

| コマンド | 機能 | 条件 |
| --- | --- | --- |
| `/ping` | Bot の応答確認 | なし |
| `/join` | 実行者が参加中のボイスチャンネルへ接続 | 先に実行者がボイスチャンネルへ参加 |
| `/leave` | 再生キューを破棄して切断 | Bot が接続中 |
| `/play` | `assets/test.mp3` を再生 | Bot が接続中 |
| `/say text:<文章>` | 選択中の声で文章を読み上げ | Bot が接続中 |
| `/voices` | 利用できる声と現在の選択を表示 | なし |
| `/setvoice voice:<ID>` | サーバー全体の声を切り替え | サーバー管理権限 |

Bot が接続中は、同じ Discord サーバーの通常メッセージも受信順に読み上げます。Bot 自身のメッセージ、空文字、500文字を超えるメッセージは対象外です。`/leave` で自動読み上げも停止します。

## 声プロフィール

利用可能な声は `voices.json` で手動管理します。`/setvoice` は登録済みの声を選択するだけで、Discord からの音声アップロード、学習、自動登録は行いません。キュー待機中の読み上げには、メッセージを受け付けた時点の声が使われます。

| `engine` | 必要な主要項目 | ローカル接続先 |
| --- | --- | --- |
| `macos` | `id`, `label`, `macosVoice` | なし |
| `gpt-sovits` | `id`, `label`, `apiUrl`, `referenceAudioPath`, `promptText`, `promptLanguage`（`textLanguage` は省略時 `ja`） | 既定 `127.0.0.1:9881` |
| `style-bert-vits2` | `id`, `label`, `apiUrl` | 既定 `127.0.0.1:5000` |

GPT-SoVITS と Style-Bert-VITS2 の `apiUrl` は、安全上 `127.0.0.1`、`localhost`、`::1` のいずれかに限定しています。サーバーごとの選択は `data/guild-voices.json` に保存され、この実行時ファイルは Git で管理しません。

## GPT-SoVITS

起動スクリプトは既定でこのリポジトリの隣にある `../GPT-SoVITS` を使い、MPS、`is_half: false`、v3 の基本モデルで API v2 を起動します。一時設定ファイルは終了時に削除されます。

```bash
npm run gpt-sovits:start
```

環境に合わせて次の値を上書きできます。

- `GPT_SOVITS_DIR`: GPT-SoVITS 本体のパス
- `GPT_SOVITS_PYTHON`: GPT-SoVITS 用 Python のパス

`voices.json` の `referenceAudioPath` にはローカルの参照音声を指定します。参照音声、学習データ、モデル本体は Git に追加しません。

## Style-Bert-VITS2

既定で次の3ファイルを `Style-Bert-VITS2/model_assets/discord_voice/` に置きます。

- `config.json`
- `style_vectors.npy`
- `discord_voice_e50_s1326.safetensors`

モデルを1回だけ読み込む FastAPI ブリッジを起動します。推論の競合を防ぐため、リクエストはプロセス内で直列化されます。

```bash
npm run style-bert-vits2:start
```

Apple Silicon でも、現在の学習済みモデルには MPS 未対応の演算があるため、既定は安定性を優先した CPU 常駐モードです。起動後は `http://127.0.0.1:5000/health` で状態を確認できます。

主な上書き用環境変数は次のとおりです。

- `STYLE_BERT_VITS2_DIR`
- `STYLE_BERT_VITS2_PYTHON`
- `STYLE_BERT_VITS2_MODEL_DIR`
- `STYLE_BERT_VITS2_MODEL_FILE`
- `STYLE_BERT_VITS2_DEVICE`（`cpu`、`mps`、`cuda`）

## 音声データの準備

音声の収集、文字起こし、分割、学習、声プロフィールへの登録は、本人の明確な許可を確認したうえで手動で行います。

Audacity などから書き出したタブ区切りラベルを使い、WAV を個別ファイルへ分割できます。

```bash
bash scripts/split-labeled-wav.sh <入力.wav> <ラベル.txt> <出力フォルダ>
```

`filename,text` 形式の CSV と分割済み音声から、Style-Bert-VITS2 用の `raw/` と `esd.list` を作成できます。誤った上書きを防ぐため、出力先がすでに存在する場合は停止します。

```bash
node scripts/prepare-sbv2-dataset.js <対応表.csv> <音声フォルダ> <データセット出力先> <話者名>
```

## 開発方針

1. 変更を小さく検証可能な単位に分け、完了条件と実行結果を確認してから次へ進みます。
2. ローカル実行、少ない依存関係、コンポーネント間の明確な境界を優先します。
3. 仕様、費用、セキュリティ、不可逆な変更に影響する判断は、実施前に確認します。
4. 外部公開は前提とせず、音声生成サーバーはループバック限定で運用します。
5. 開発変更が完了するたびに、`development-logs/` へ JST の時刻付き Markdown ログを新規作成します。ログはローカル専用で、Git の追跡対象外です。
6. Git の `add`、`commit`、`push` は、対象とコミット内容を確認し、明示的な依頼を受けてから実行します。

## 安全とプライバシー

- 使用するのは自分の声、または学習と利用の明確な許可を得た声だけとします。
- Bot であることと合成音声を使っていることを、利用者に分かるようにします。
- Discord トークン、`.env`、参照音声、収録データ、学習済みモデル、生成音声、実行時データは Git に追加しません。
- 秘密情報や個人音声の内容をチャットや開発ログに転記しません。
- 公開サーバーでの運用前に、アクセス制限、コマンド権限、停止方法、Discord と関連ソフトウェアの利用規約を確認します。

## 主なファイル

| パス | 役割 |
| --- | --- |
| `bot.js` | 現在の主要な Discord Bot 実装 |
| `voices.json` | 利用できる声プロフィール |
| `data/guild-voices.json` | サーバーごとの声選択（Git 管理外） |
| `tts-test.js` | macOS 音声合成の単体確認 |
| `scripts/macos-tts.swift` | NSSpeechSynthesizer を呼び出す Swift ヘルパー |
| `scripts/start-gpt-sovits.sh` | GPT-SoVITS API v2 のローカル起動 |
| `scripts/style_bert_vits2_server.py` | Style-Bert-VITS2 用 FastAPI ブリッジ |
| `scripts/start-style-bert-vits2.sh` | Style-Bert-VITS2 ブリッジの起動 |
| `scripts/split-labeled-wav.sh` | ラベルに基づく音声分割 |
| `scripts/prepare-sbv2-dataset.js` | Style-Bert-VITS2 用データセット整形 |
| `development-logs/` | 時系列のローカル開発ログ（Git 管理外） |

`bot.py` は初期の最小 Python 実装であり、現在の主要実装は `bot.js` です。

## 今後の主な課題

- 音声エンジン別の起動・疎通確認とエラー表示の改善
- 公開範囲に応じた読み上げ対象チャンネルと実行者の制限
- 自動テストと長時間運用時の回復・停止処理
- 少人数のテストサーバーでの品質、遅延、安定性の検証
- 必要に応じた運用手順とデプロイ方法の整備

## 参考

- [Discord Voice Clone Bot メモ](https://app.notion.com/p/Discord-Voice-Clone-Bot-3d61ff2d1a8b81f3a337d8b868b0e673?source=copy_link)
