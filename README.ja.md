<div align="center">

# Rebut

[![npm version](https://img.shields.io/npm/v/rebut-mcp)](https://www.npmjs.com/package/rebut-mcp)
[![npm downloads](https://img.shields.io/npm/dm/rebut-mcp)](https://www.npmjs.com/package/rebut-mcp)
[![MIT license](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/abruption/rebut/blob/main/LICENSE)

**ローカル実行を標準とする独立コードレビューMCP。Cloudflare Workerは任意です。**

[한국어](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · **日本語**

</div>

Rebut は、指定したコードや diff を OpenAI または Claude API でレビューする MCP サーバーです。レビュー資料は選択したプロバイダーに送信します。

0.3.0 以降の Claude 対応は `rebut set provider anthropic` → `rebut set api-key` → `rebut setup --client claude` の順です。ホストとプロバイダーは別々に選びます。

## クイックスタート

Node.js 24 以上が必要です。以下は macOS Keychain の例です。

```sh
npm install -g rebut-mcp
rebut set api-key
rebut setup --client codex
rebut doctor --connect
```

登録後に Codex を再起動してください。Linux/env・Vaultwarden 設定は[インストール](docs/guide/ja/installation.md)を参照してください。

新規インストールはローカル stdio を使います。端末間で予算・台帳を共有する場合は [Worker モード](docs/guide/ja/installation.md#任意の-worker-デプロイ)を選択します。既存 Worker 設定は維持します。

`review` は有料レビューを実行します。`doctor --connect` はモデルを呼び出さずに接続を確認します。結果が不明な場合は、新しい ID で再試行せず、同じバックエンドで元のリクエスト ID の状態を確認してください。

## ガイド

- [インストール](docs/guide/ja/installation.md)
- [設定](docs/guide/ja/configuration.md)
- [運用](docs/guide/ja/operations.md)

[リリース](https://github.com/abruption/rebut/releases) · [MIT](LICENSE)
