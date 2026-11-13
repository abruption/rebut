<div align="center">

# Rebut

**OpenAI Responses API による、証拠に基づく独立したレビュー。**

[한국어](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · **日本語**

**明示的に提供された確定済みの資料をレビューする、認証付き Cloudflare Worker MCP。**

</div>

Rebut は**明示的に選択して利用するレビュアー**です。既存の Claude/Gemini ワークフローを置き換えたり、3 つのレビュアーを自動で呼び出したりしません。MIT ライセンスで提供され、自分の Cloudflare アカウントと OpenAI キーでデプロイします。ソースの公開と個人用の有料デプロイは、それぞれ別の操作です。

## クイックスタート

**Node.js 24 以降**が必要です。npm CLI をインストールし、自分でデプロイした Worker を設定します。

```sh
npm install -g rebut
rebut set endpoint https://YOUR_HOST/mcp
rebut set token
rebut setup --client codex
rebut doctor
rebut doctor --connect
```

macOS の `rebut set token` は入力を隠す対話型プロンプトを使い、既定では Bearer トークンを Keychain に保存します。トークンを引数で渡さないでください。Vaultwarden/env バックエンドの明示的な選択と Codex 移行オプションは[インストール手順](docs/guide/ja/installation.md)を参照してください。

`rebut`（初期 CLI バージョン `0.1.0`、実行コマンド `rebut`）は**セルフホストした Worker**のクライアントと stdio ブリッジです。Worker/D1 は引き続き GitHub のソースチェックアウトから、自分の Cloudflare アカウントと OpenAI キーでデプロイします。公開ソースや npm パッケージは、個人の Worker やクレジットへのアクセスを付与しません。パッケージに実際のエンドポイント、非公開設定、Bearer、プロバイダーキー、レビュー本文は含まれません。この手順は CLI `0.1.0` を対象としています。

開発者向けの検証はソースチェックアウトで実行します。

```sh
npm ci
npm run typecheck
npm run build
npm test
```

自動テストはプロバイダーをモックし、有料モデルを呼び出しません。実際の API テストには **gpt-6-luna**、本番には **gpt-6-astra / medium** を使います。Luna の結果は Astra の利用可否や同等のレビュー品質を実証しません。Worker には D1 と `OPENAI_API_KEY`、`REBUT_CONFIG`、`AUTH_TOKENS` のシークレットが必要です。[インストールと非公開デプロイ](docs/guide/ja/installation.md)に従ってください。

`rebut set model MODEL_ID`、`rebut set reasoning EFFORT`、`rebut set profile PROFILE_ID` でローカルの既定値を選びます。新しい収集ではサーバーの許可リスト内のプロファイルに解決され、明示的な `collect --profile` が優先し、`review` は確定済みバンドルのプロファイルを保持します。設定がなければ `astra-medium` です。`rebut profile list` はプロバイダーを呼ばず、認証付きでサーバーのモデルと料金のメタデータを読み取ります。所有者は一度限りの Worker 更新、マイグレーション `0002`、別の管理認証情報の設定後に D1 でプロファイルを管理できます。[設定](docs/guide/ja/configuration.md)を参照してください。

## 主な機能

- 明示的に許可したテキストソースを収集し、一般的なシークレットのパターンを除去して、確定済みの証拠のハッシュを計算します。送信前にマスキング結果を確認してください。
- 認証、許可リスト内のプロファイル、リクエスト ID の重複、デプロイ全体のアトミックな予算予約を確認してから、制限付きの Responses 呼び出しを 1 回実行します。
- 提供されたファイルと行に基づく証拠、モデル情報、トークン使用量、推定費用を含む構造化された指摘を返します。
- `review` と、メタデータのみを返す `review_status` を公開します。タイムアウトや結果不明の後も同じリクエスト ID を使ってください。サーバーは代わりの有料呼び出しを自動で作成しません。

設定例の上限は **UTC の 1 日あたり $6.66**、**UTC の 1 か月あたり $200**、保留中または結果不明のリクエストは同時に 1 件、新規レビューリクエストは 1 日あたり 100 件です。台帳は Rebut の利用を追跡し、アカウント全体のクレジット残高は追跡しません。実行結果が不明な場合は予約を保持します。レビュー本文は再取得できないため、最初のレスポンスをローカルに保存してください。

レビュアーは、リポジトリのクローン、任意の URL の取得、コマンドやテストの実行、ファイルの編集、プルリクエストの作成を行えません。ソース、レビュー本文、キーは D1 や Worker のログに保存されません。`store:false` は、プロバイダーによるデータ保持がゼロであることを保証しません。

## ドキュメント

- [ユーザーガイド](docs/guide/ja.md)
- [インストールと入力の収集](docs/guide/ja/installation.md)
- [設定、予算、MCP 仕様](docs/guide/ja/configuration.md)
- [運用と復旧](docs/guide/ja/operations.md)
- [明示的に選択するレビュアーの統合](docs/guide/ja/reviewer-integration.md)
- [アーキテクチャ](docs/guide/ja/architecture.md)
- [検証と結果の限界](docs/guide/ja/validation.md)
- [MIT ライセンス](LICENSE)
