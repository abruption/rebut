# インストールと入力の収集

[한국어](../ko/installation.md) · [English](../en/installation.md) · [简体中文](../zh-CN/installation.md) · **日本語**

[Rebut](../../../README.ja.md) · [ユーザーガイド](../ja.md)


**Node.js 24以降**が必要です。新規インストールはローカルstdio MCPが既定で、Cloudflareアカウント・Worker endpoint・別のHTTPデーモンは不要です。

```sh
npm install -g rebut-mcp
```

## ローカル設定

macOSの rebut set api-key はOpenAI APIキーを非表示入力でlogin Keychainへ保存します。com.abruption.rebutのopenai-api-keyを使い、Worker接続／管理者トークンと分離します。--stdinは保護されたパイプ用で、資格情報を引数に入れません。

```sh
rebut set api-key
```

環境変数は rebut set secret-store env を選び、実際のMCPホストの安全な環境でREBUT_OPENAI_API_KEYを提供します。登録には変数名だけを保存します。Vaultwardenは rebut set secret-store vaultwarden と rebut set vaultwarden-api-key-item NAME を使い、既定ローカル項目はRebut — OpenAI API Keyです。既存bw-getログインが必要で、資格情報やbackendの自動切り替えはありません。

## 接続と確認

```sh
rebut setup --client codex
rebut doctor --connect
```

rebut setup --client codex はCODEX_HOMEまたは~/.codexにrebut mcpを登録し、--codex-home PATHで宛先を指定できます。ホストがサーバーを自動起動します。doctor --connect はローカル資格情報・SQLite・実際のMCPツール登録を確認し、プロバイダー呼び出しやAPIアカウント権限確認はしません。ローカルenvはREBUT_OPENAI_API_KEY名だけを転送します。置換時はカスタムREBUT_CONFIG_DIRを維持してください。

## 任意のWorkerモード

endpoint設定はWorkerモードを明示的に選び、既存のendpointのみの設定も更新時にWorkerを維持します。ローカルOpenAIキーではなく別のMCP接続トークンを使い、macOSはrebut set token、envはREBUT_TOKEN、Vaultwardenはvaultwarden-itemです。管理操作は別の管理者資格情報を使います。Workerの作成は下記の非公開デプロイを参照してください。

```sh
rebut set endpoint https://YOUR_HOST/mcp
rebut setup --client codex --replace
```

rebut set mode localで明示的に切り替え、障害時の自動代替はしません。backend間で要求・予約・予算は共有／移行されないためunknownを別backendで再実行しません。SQLiteは~/.local/share/rebut/local/ledger.sqlite、カスタムREBUT_CONFIG_DIRではlocal/に保存します。既定のUTC日額$6.66・月額$200はこのディレクトリのみの制限です。ローカル予算のset daily-budget／monthly-budget／request-budgetはUSD小数を受け取り、Worker制限はデプロイ設定で管理します。

## ソースチェックアウトと開発者向け検証

CLI 0.2.0向けです。npmはローカルサーバーと任意Workerブリッジを実行し、ホスト型サービスやAPIクレジットは提供しません。Cloudflareアカウントとソースチェックアウトは任意のWorkerデプロイだけに必要です。実endpoint・非公開設定・資格情報・レビュー本文はパッケージに含めません。

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

モード・資格情報backend・ローカル予算変更後は、必要に応じ `rebut setup --client codex --replace` で登録を更新しMCPホストを再起動してください。既存プロセスは起動時設定を維持しdoctorでは再読込しません。setup再実行時も同じREBUT_CONFIG_DIR環境変数を指定します。secret-storeは全役割に共通ですが、役割ごとのアカウント／項目は別です。

ローカルenvはREBUT_OPENAI_API_KEYが既定で、Codexや他アプリのキーを黙って再利用しません。OPENAI_API_KEYを明示共有する場合はrebut set api-key-env OPENAI_API_KEY後に登録更新・再起動します。変数間fallbackはありません。日・月・要求上限は独立し、1つの変更で他は自動拡大しません。カスタム制限は更新後も保持します。ツール説明は起動時ヒントで、実行時には明示要求のプロファイルを動的に確認します。

検証対象はmacOS/Linuxで、Windows動作・ACLは未検証です。
