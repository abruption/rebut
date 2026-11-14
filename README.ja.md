<div align="center">

# Rebut

**ローカル実行を標準とする独立コードレビューMCP。Cloudflare Workerは任意です。**

[한국어](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · **日本語**

</div>

Rebutは自分のOpenAIまたはClaude APIキーでコードをレビューします。新規インストールはローカルstdioサーバーとして動作し、Cloudflareアカウントや別のHTTPデーモンは不要です。

レビュー資料は選択したプロバイダーAPIへ送信し、ローカル台帳には要求・使用量メタデータのみ保存します。

0.3.0 以降の Claude 対応は `rebut set provider anthropic` → `rebut set api-key` → `rebut setup --client claude` の順です。ホストとレビュープロバイダーは別々に選択します。

検証対象はmacOS/Linuxで、Windows動作・ACLは未検証です。

## クイックスタート

Node.js 24以降が必要です。以下はmacOS Keychainを使う例です。

```sh
npm install -g rebut-mcp
rebut set api-key
rebut setup --client codex
rebut doctor --connect
```

`rebut set api-key` はOpenAI APIキーを非表示入力で受け取りKeychainに保存します。Linux等では `rebut set secret-store env` を選び、実際のMCPホストの安全な環境で `REBUT_OPENAI_API_KEY` を提供してください。登録には変数名だけを記録し、キーを引数や追跡対象ファイルに書きません。

## 任意のWorker

複数端末で予算と要求台帳を共有する場合はセルフホストのWorkerを選べます。`rebut set endpoint URL` はWorkerモードを選択します。macOSでは `rebut set token` で別のWorker接続トークンを保存します。OpenAI APIキー・Worker接続トークン・管理者トークンは別の資格情報です。

```sh
rebut set endpoint https://YOUR_HOST/mcp
rebut setup --client codex --replace
```

既存endpoint設定はWorkerモードを維持します。`rebut set mode local` で明示的に切り替え、障害時の自動切り替えはしません。切り替えても既存の要求や予約は移行されません。

## 主な機能

- 明示されたファイル・diff・要件だけを収集・秘匿処理・固定し、プロバイダーを1回呼び出します。
- ローカルSQLiteまたはWorker D1で原子的な予算予約と重複排除を行い、原文・レビュー本文・キーは台帳に保存しません。
- 指定ファイル・行の根拠、モデル識別、使用量、推定費用を含む構造化された指摘を返します。
- reviewとメタデータ専用review_statusを提供します。不確かな結果後は同じIDを維持し、unknownを別backendで再実行しません。

既定例はUTCで日額$6.66・月額$200、pending/unknown同時1件、日100件の新規要求です。**ローカル制限はその端末のデータディレクトリのみが対象**で、別のMac・Worker・外部API・OpenAIアカウント残高は合算しません。Worker利用者はそのデプロイの台帳を共有します。推定は請求書ではなく、不確かな実行の予約と枠は保持します。

プロバイダー待機上限は30分で、HTTP/MCP・Codexの期限も合わせます。ローカルプロファイルはOS所有者、Workerは別の管理者認証で管理します。資格情報・モデル・予算・任意のWorkerデプロイは[インストール](docs/guide/ja/installation.md)と[設定](docs/guide/ja/configuration.md)を参照してください。

## 開発者向け検証

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
npm run test:package
```

自動テストとパッケージsmokeはプロバイダーを模擬します。既定の実APIテストはgpt-6-luna、運用はgpt-6-astra / mediumです。Lunaの成功はAstraのレビュー品質を証明しません。

## ドキュメント

- [ユーザーガイド](docs/guide/ja.md)
- [インストールと入力の収集](docs/guide/ja/installation.md)
- [設定、予算、MCP 仕様](docs/guide/ja/configuration.md)
- [運用と復旧](docs/guide/ja/operations.md)
- [明示的に選択するレビュアーの統合](docs/guide/ja/reviewer-integration.md)
- [アーキテクチャ](docs/guide/ja/architecture.md)
- [検証と結果の限界](docs/guide/ja/validation.md)
- [MIT ライセンス](LICENSE)
