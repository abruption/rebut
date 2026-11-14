<div align="center">

# Rebut

**ローカル実行を標準とする独立コードレビューMCP。Cloudflare Workerは任意です。**

[한국어](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · **日本語**

</div>

提供したコードと diff を OpenAI API でレビューする MCP です。レビュー資料は OpenAI に送信します。

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

`review` は有料呼び出しです。`doctor --connect` は有料レビューなしで接続確認を行います。結果が不明なら同じリクエスト ID を維持してください。

## ガイド

- [インストール](docs/guide/ja/installation.md)
- [設定](docs/guide/ja/configuration.md)
- [運用](docs/guide/ja/operations.md)

[リリース](https://github.com/abruption/rebut/releases) · [MIT](LICENSE)
