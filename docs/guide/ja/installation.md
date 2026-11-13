# インストールと入力の収集

[한국어](../ko/installation.md) · [English](../en/installation.md) · [简体中文](../zh-CN/installation.md) · **日本語**

[Rebut](../../../README.ja.md) · [ユーザーガイド](../ja.md)

## npm CLI のインストール

Node.js **24 以降**と npm を使用します。セルフホストした Worker のクライアントと stdio ブリッジをインストールします。

```sh
npm install -g rebut-mcp
```

## クライアントの設定

自分のエンドポイントを設定してから Bearer トークンを保存します。macOS の既定は Keychain で、`rebut set token` は入力を隠すプロンプトを使います。`rebut set token --stdin` は保護されたパイプ入力を明示的に受け付けます。トークン値を引数や追跡対象ファイルに入れないでください。

```sh
rebut set endpoint https://YOUR_HOST/mcp
rebut set token
```

既存の Vaultwarden を使う場合はバックエンドを明示的に選択します。`bw-get` と既定の項目 `Rebut — MCP Access Token` を使用し、必要に応じて項目名を変更できます。

```sh
rebut set secret-store vaultwarden
rebut set vaultwarden-item NAME
```

macOS 以外では `env` を明示的に選び、安全な実行環境で `REBUT_TOKEN` を渡します。追跡対象ファイルやコマンド引数に書かないでください。バックエンドは自動で代替されません。クライアントに OpenAI プロバイダーキーは不要です。

`env` バックエンドの場合、Codex 設定は値を保存せず、変数名だけを `env_vars = ['REBUT_TOKEN']` として保存します。トークンは実際に Codex を実行するホストの安全な実行環境で渡してください。設定コマンドにだけ渡した環境変数は、後の Codex セッションでは利用できません。

```sh
rebut set secret-store env
```

## Codex の接続と設定確認

```sh
rebut setup --client codex
rebut doctor
rebut doctor --connect
```

設定は `CODEX_HOME` または `~/.codex` を使い、`--codex-home PATH` で保存先を指定できます。`rebut mcp` を stdio サーバーとして登録し、他の MCP エントリを保持します。既存の非公開 `rebut` ブリッジの移行には `--replace` が必要です。

`rebut doctor` は機密値を除いたローカル設定と認証情報の利用可否を表示します。`rebut doctor --connect` は無料でリモートの `tools/list` を確認します。どちらも有料レビューを開始しません。

## ソースチェックアウトと開発者向け検証

npm パッケージはクライアントであり、ホストされたレビューサービスではありません。Worker/D1 は GitHub のソースチェックアウトから、Workers/D1 権限のある自分の Cloudflare アカウントと OpenAI Responses API キーでデプロイします。公開ソース/npm は個人の Worker やクレジットへのアクセスを付与しません。実際のエンドポイント、非公開設定、Bearer、プロバイダーキー、レビュー本文はパッケージに含まれません。この手順は CLI `0.1.0` を対象としています。

```sh
npm ci
npm run typecheck
npm run build
npm test
```

テストには合成入力、モックしたプロバイダーレスポンス、実際の SQLite 文、ローカルの Workers/D1 ランタイムを使います。`npm test` には `npm run build` で生成した Worker バンドルが必要です。有料のモデル呼び出しを行う自動テストはありません。別途実施した Luna スモークテストについては、[検証記録](validation.md)を参照してください。

## レビュー入力の確定

ソースファイルを明示的な許可リストで指定し、リポジトリ全体を自動収集しないでください。コレクターは確定済み JSON を標準出力に出力します。既定のプロファイルは `astra-medium` で、実際の API テストには `luna-test` を明示します。

```sh
umask 077
rebut collect --root /path/to/project --request-id request-001 --requirements 'Check that the supplied function preserves its input' --profile astra-medium -- src/example.ts > /protected/path/request-001.bundle.json
```

コレクターはシンボリックリンク、FIFO、シークレットを示すファイル名、バイナリファイル、サイズ上限を超える資料を拒否します。行番号を保持しながら、認識可能な一般的なシークレットのパターンを除去します。パターンによるマスキングは完全ではないため、送信前に生成されたバンドルを確認してください。ファイルを行番号付きの抜粋として提供したり、unified diff を直接提供したりすることもできます。正規化ハッシュと上限については[設定](configuration.md)で説明しています。

## 非公開デプロイ

1. `wrangler.jsonc` を `wrangler.private.json` にコピーします（Git の追跡対象外）。自分のアカウント ID、利用可能な Worker 名、実際の D1 ID、および `workers_dev:true` または独自のルートを設定します。`npx wrangler d1 create rebut-ledger` で専用の D1 データベースを作成し、その ID を非公開設定に指定します。
2. `npx wrangler d1 migrations apply rebut-ledger --remote --config wrangler.private.json` を適用します。
3. `npx wrangler deploy --config wrangler.private.json` でデプロイします。未設定の Worker は 503 を返し、プロバイダーを呼び出せません。
4. 3 つの Workers Secrets、`OPENAI_API_KEY`、`REBUT_CONFIG`、`AUTH_TOKENS` を保存します。Wrangler の対話型シークレットプロンプトか、保護された標準入力経由の `secret bulk` を使い、シークレット値を引数や追跡対象ファイルに入れないでください。`REBUT_CONFIG` は [`config.example.json`](../../../config.example.json) の構造を使います。`hostname` をエンドポイントの正確なホスト名に変更してください。`AUTH_TOKENS` は、安定したプリンシパル ID を、それぞれ独立して生成したランダムな 256 ビット Bearer トークンの SHA-256 ダイジェストに対応付ける JSON オブジェクトです。元のトークンはパスワードマネージャーに保存します。同じトークンを使うクライアントはプリンシパルを共有し、異なるトークンはリクエストとステータスへのアクセスを分離します。
5. Bearer ヘッダーに対応した MCP クライアントを `https://YOUR_HOST/mcp` に接続し、`tools/list` を確認します。ツール実行前に Host とブラウザーの Origin が検証されます。この Bearer 設定は、OAuth ディスカバリーを必要とするクライアント向けの OAuth を実装していません。

## 所有者によるプロファイル管理の初回更新

動的プロファイルには、ソースチェックアウトからの一度限りの Worker 更新、D1 マイグレーション `0002`、Worker Secret `ADMIN_TOKEN_SHA256` が必要です。台帳を保持したまま既存の D1 に未適用のマイグレーションを適用し、非公開設定で更新済み Worker をデプロイします。別のランダムな 256 ビット管理 Bearer を生成し、保護された対話型シークレットプロンプトでその SHA-256 ハッシュを `ADMIN_TOKEN_SHA256` に保存します。元の Bearer は認証情報ストアに保管してください。レビュー Bearer の再利用や既存プリンシパル ID の変更はしないでください。初回設定後の CLI プロファイル変更は D1 にだけ書き込み、Worker の再ビルド・再デプロイや npm 更新は不要です。

`rebut set admin-token` の隠された入力で所有者 Bearer を保存するか、保護されたパイプで `rebut set admin-token --stdin` を明示的に使います。選択済み Vaultwarden バックエンドの既定の管理項目は `Rebut — MCP Admin Token` で、`rebut set vaultwarden-admin-item NAME` で変更します。env バックエンドは安全な実行環境の `REBUT_ADMIN_TOKEN` を使い、Codex には転送しません。Keychain サービス `com.abruption.rebut` はレビュー用 `codex-mcp-bearer` と管理用 `codex-mcp-admin` を分離します。自動的なバックエンドの代替はありません。モデル設定、一覧、明示的な料金、リビジョン条件付きの更新・削除は[設定](configuration.md)を参照してください。

## クライアントの実行

`rebut review` は標準入力から JSON バンドルを読み取り、ユーザーが明示的に選んだ場合のみ有料レビューを開始します。`rebut status REQUEST_ID` は無料のメタデータ照会です。

```sh
rebut review < /protected/path/request-001.bundle.json
rebut status request-001
```

サーバーはメタデータのみを保持し、レビュー本文は再取得できません。最初のレスポンスを権限を制限してローカルに保存してください。タイムアウトや不確かな結果の後も同じ ID を使います。プロバイダーの待機期限は1,800秒（30分）、MCP HTTPクライアントは1,830秒、Codexの `tool_timeout_sec` は1,860秒とし、結果の記録・転送時間を確保します。起動・ハンドシェイクは別の短い期限を維持します。WorkerとCLIの両方を更新し、`rebut setup --client codex --replace` で既存登録を更新してCodexを再起動してください。ホスト設定だけでは0.1.0 CLI内部の旧期限は変わりません。[明示的なレビューワークフロー](reviewer-integration.md)を参照してください。

## アップグレードと削除

デプロイのアップグレードや削除の前に、[運用ガイド](operations.md)に従って D1 台帳を保持し、保留中の実行を照合してください。ソースの公開と非公開の有料デプロイは、それぞれ別の操作です。

更新順は **CLIのインストール → 既存オプションを維持したCodex登録更新 → Codex/MCP再起動 → Workerデプロイ**です。Workerを先に更新すると、旧CLIが65秒で切断する場合があります。`REBUT_CONFIG_DIR` など既存のカスタム登録オプションを維持してください。Node HTTPのヘッダー・本文期限もMCPツール期限に合わせます。30分はアプリの上限であり、すべてのネットワークやホストの接続保証ではありません。スリープ・終了・切断でreservedまたはunknownの予約が残る場合は、元の要求IDで確認し、自動再実行・予約解除は行いません。
