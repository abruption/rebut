# アーキテクチャ

[한국어](../ko/architecture.md) · [English](../en/architecture.md) · [简体中文](../zh-CN/architecture.md) · **日本語**

[Rebut](../../../README.ja.md) · [ユーザーガイド](../ja.md)

## ローカルとWorkerの実行

新規インストールはローカルstdio MCP → 共通レビューサービス → private SQLite予約 → OpenAI Responsesの単一呼び出し → 検証とメタデータ精算です。Cloudflareアカウント・ローカルHTTPポート・デーモンは不要です。明示したWorkerモードは認証HTTP MCP → D1 → 同じプロバイダーアダプターを維持します。

src/service.tsはハッシュ・プロファイル・要求所有権・精算、src/review.tsはプロバイダー／根拠検証、src/local.tsはNode SQLite／stdio、src/worker.tsはHTTP認証とD1を担当します。ローカルプロバイダーキーとWorker接続／管理者トークンは別です。台帳は原文・レビュー本文・キーを保存しません。ローカル予算とIDは1ディレクトリ、Workerはそのデプロイの共有台帳が対象です。backend変更で履歴移行や不確かな要求の再実行は許可されません。

以下はWorker専用の流れと参照です。


クライアントの明示的な許可リスト → マスキング・確定・ハッシュ計算 → 認証付き Streamable HTTP MCP → プロファイルとハッシュの検証 → アトミックな D1 予約 → 制限付き Responses 呼び出しを 1 回実行 → スキーマ・証拠・使用量の検証 → メタデータの精算 → クライアントにレビューを返却。

ホストに依存しない仕様とプロバイダーアダプターは `src/contracts.ts` と `src/review.ts` にあります。`src/worker.ts` が MCP と認証を、`src/ledger.ts` が D1 アダプターを提供します。Cloudflare のリクエスト単位の `createMcpHandler` は MCP SDK v2 を使用し、従来のステートレスクライアントにも対応します。状態を持つセッション、バックグラウンドタスク、OAuth、モデルが駆動するツール、リポジトリアクセス、保存済みレビューの再取得は、この MVP の対象外です。

単一の `INSERT ... SELECT` が、リクエスト行を書き込むと同時に、全体の UTC 予算、有効な予約、日次リクエスト数を評価します。一意の `(principal,request_id)` キーにより、予測不能な取得権を持つ所有者を 1 つだけ選びます。その所有者だけがプロバイダー呼び出しを送信し、行を精算します。クラッシュが発生し得る区間でも予約は保持され、実行は `waitUntil` や自動で期限切れになるリースに依存しません。提供された資料内の指示はデータとして扱い、指摘は提供された行を引用しなければならず、モデルには実行ツールがありません。

2026-11-12 に確認した参考資料：

- [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [構造化出力](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Cloudflare MCP ハンドラー](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/)
- [D1 Worker API](https://developers.cloudflare.com/d1/worker-api/d1-database/)

合成した上流レスポンスを使い、実際のローカル Workers/D1 ランタイムで互換性を確認しました。これは、任意のクライアントへの対応や他モデルとのレビュー品質の同等性を実証するものではありません。
