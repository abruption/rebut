# インストールと入力の収集

[한국어](../ko/installation.md) · [English](../en/installation.md) · [简体中文](../zh-CN/installation.md) · **日本語**

[Rebut](../../../README.ja.md) · [ユーザーガイド](../ja.md)

## 要件とローカル検証

Node.js **24 以降**、npm、Workers/D1 権限のある Cloudflare アカウント、Responses API にアクセスできる自分の OpenAI キーを使用します。ソースのチェックアウトからインストールします。この手順は npm パッケージのリリースや公開リポジトリを必要としません。

```sh
npm ci
npm run typecheck
npm run build
npm test
```

テストには合成入力、モックしたプロバイダーレスポンス、実際の SQLite 文、ローカルの Workers/D1 ランタイムを使います。`npm test` には `npm run build` で生成した Worker バンドルが必要です。有料のモデル呼び出しを行う自動テストはありません。別途実施した Luna スモークテストについては、[検証記録](validation.md)を参照してください。

## レビュー入力の確定

ソースファイルを明示的な許可リストで指定し、リポジトリ全体を自動収集しないでください。コマンドは Rebut のチェックアウトから実行します。

```sh
umask 077
npm run --silent collect -- /path/to/project request-001 'Check that the supplied function preserves its input' src/example.ts > /protected/path/request-001.bundle.json
```

コレクターはシンボリックリンク、FIFO、シークレットを示すファイル名、バイナリファイル、サイズ上限を超える資料を拒否します。行番号を保持しながら、認識可能な一般的なシークレットのパターンを除去します。パターンによるマスキングは完全ではないため、送信前に生成されたバンドルを確認してください。ファイルを行番号付きの抜粋として提供したり、unified diff を直接提供したりすることもできます。正規化ハッシュと上限については[設定](configuration.md)で説明しています。

## 非公開デプロイ

1. `wrangler.jsonc` を `wrangler.private.json` にコピーします（Git の追跡対象外）。自分のアカウント ID、利用可能な Worker 名、実際の D1 ID、および `workers_dev:true` または独自のルートを設定します。`npx wrangler d1 create rebut-ledger` で専用の D1 データベースを作成し、その ID を非公開設定に指定します。
2. `npx wrangler d1 migrations apply rebut-ledger --remote --config wrangler.private.json` を適用します。
3. `npx wrangler deploy --config wrangler.private.json` でデプロイします。未設定の Worker は 503 を返し、プロバイダーを呼び出せません。
4. 3 つの Workers Secrets、`OPENAI_API_KEY`、`REBUT_CONFIG`、`AUTH_TOKENS` を保存します。Wrangler の対話型シークレットプロンプトか、保護された標準入力経由の `secret bulk` を使い、シークレット値を引数や追跡対象ファイルに入れないでください。`REBUT_CONFIG` は [`config.example.json`](../../../config.example.json) の構造を使います。`hostname` をエンドポイントの正確なホスト名に変更してください。`AUTH_TOKENS` は、安定したプリンシパル ID を、それぞれ独立して生成したランダムな 256 ビット Bearer トークンの SHA-256 ダイジェストに対応付ける JSON オブジェクトです。元のトークンはパスワードマネージャーに保存します。同じトークンを使うクライアントはプリンシパルを共有し、異なるトークンはリクエストとステータスへのアクセスを分離します。
5. Bearer ヘッダーに対応した MCP クライアントを `https://YOUR_HOST/mcp` に接続し、`tools/list` を確認します。ツール実行前に Host とブラウザーの Origin が検証されます。この Bearer 設定は、OAuth ディスカバリーを必要とするクライアント向けの OAuth を実装していません。

## クライアントの実行

付属のクライアントは、`list`、`status REQUEST_ID`、または標準入力から JSON バンドルを受け取る `review` に対応しています。`REBUT_ENDPOINT` と `REBUT_TOKEN` は安全な環境変数として渡します。トークン値をコマンドや追跡対象ファイルに貼り付けないでください。

```sh
npm run client -- list
npm run client -- review < /protected/path/request-001.bundle.json
npm run client -- status request-001
```

任意で利用できる [Vaultwarden ラッパーとレビュアーのワークフロー](reviewer-integration.md)は、Bearer トークンをメモリ内で取得します。クライアントに OpenAI プロバイダーキーは不要です。最初のレスポンスはアクセス権限を制限してローカルに保存してください。サーバーはメタデータのみを保存し、レビュー本文を再取得できません。MCP クライアントの期限は 60 秒より長く設定してください。プロバイダー呼び出しのタイムアウトは 45 秒です。

## アップグレードと削除

デプロイのアップグレードや削除の前に、[運用ガイド](operations.md)に従って D1 台帳を保持し、保留中の実行を照合してください。ソースの公開と非公開の有料デプロイは、それぞれ別の操作です。
