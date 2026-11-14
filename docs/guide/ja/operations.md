# 運用と復旧

[한국어](../ko/operations.md) · [English](../en/operations.md) · [简体中文](../zh-CN/operations.md) · **日本語**

[README](../../../README.ja.md) · [インストール](installation.md) · [設定](configuration.md)

## unknown 復旧

`reserved` は実行中または中断済みの可能性があり、`unknown` は結果・使用量が不明な状態です。どちらも課金済みの可能性があり、自動再試行・失効・返金はしません。1 件で既定の枠を使い、新しいレビューを止める場合があります。

1. 同じバックエンド・principal・`REBUT_CONFIG_DIR` で `rebut status REQUEST_ID` を照会します。ID を失った場合、ローカル `rebut status --pending` は最大 100 件と `has_more` を返します。ローカル照会は OpenAI キー不要、Worker は既存の接続トークンを使用し、どちらも有料モデルを呼びません。
2. ホストを止め、閉じた SQLite と設定をバックアップします。Worker D1 は Cloudflare export/Time Travel を使います。
3. 元の ID・入力ハッシュ・プロファイルと利用可能なプロバイダー要求/使用量の証拠を照合します。`not_found` だけでは未実行と判断せず、他のバックエンドや新 ID で再実行しません。
4. 不明なら行・全額会計予約・枠を保持します。独立した証拠のある運用者だけが正確な `(principal, request_id)` を照合・精算します。強制解除・返金・削除ツールはありません。
5. **別の新しいレビュー**を意図する運用者は、ローカル `rebut set max-concurrent N` で必要分だけ容量を追加できます（最大 10）。元の予約は維持し、元リクエストの解除や再実行許可ではありません。金額上限とカスタム上限スナップショットは維持し、ホストを再起動します。

`budget_reserved_microusd`・`budget_accounted_microusd` はアプリの会計値であり確定請求額ではありません。10 枠すべて不明なら証拠による精算まで停止します。その後は一時容量を意図した値へ戻して再起動します。行削除は重複防止を失うため復旧手段にしません。

## 診断

`rebut doctor` はローカル設定・認証情報、`doctor --connect` は選択したバックエンド・ツール一覧を確認します。有料レビューやプロバイダーアカウント権限の検証はしません。SSH の Keychain 失敗と同じ端末のログインセッションでの成功を区別してください。

新規 unknown 記録には可能な場合のみ `unknown_reason`、`provider_elapsed_ms`、プロバイダー ID、`upstream_status` を含めます。本文・例外文字列は保存しません。HTTP エラー後に本文待ちで timeout になる場合があるため併せて解釈します。経過時間は実行・請求完了の証拠ではなく、過去の欠落情報も復元しません。

SIGINT/SIGTERM は unknown 記録と終了を試みます。SIGKILL・クラッシュ・切断は reserved を残す場合があります。自動再実行はありません。

## 更新とキー交換

**CLI → Codex 登録 → ホスト再起動 → Worker** の順で更新します。カスタムディレクトリを維持し、登録前に `config.toml` 全体をバックアップします。[インストールコマンド](installation.md#codex-登録と更新)を参照してください。

0.2.0 専用フィールドを使う前に `config.json` もバックアップします。0.1.0 は新フィールドを拒否するため、Worker 利用者も旧設定の復元が必要な場合があります。ローカル台帳利用後に 0.1.0 へ下げても台帳復旧にはなりません。設定互換性のために台帳を削除しないでください。

Worker は同じ D1 を維持し、未適用マイグレーションだけを適用します。bearer 交換では `AUTH_TOKENS` のダイジェストとクライアントストアを更新し、principal ID は維持します。`OPENAI_API_KEY` は別途交換します。管理者トークンを MCP 設定に入れないでください。`rebut remove` は登録だけを外します。

## 開発検証

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
npm run test:package
```

Worker テストはビルド結果を使います。自動テスト/package smoke はプロバイダーをモックし、有料 API 権限やモデル品質は証明しません。実際の API テスト既定は `luna-test`、運用既定は `astra-medium` です。Luna 成功から Astra の利用可否・品質を推定しません。過去の詳細は [0.2.0 ソース記録](https://github.com/abruption/rebut/tree/v0.2.0/docs/guide/ja)を参照してください。

ソース境界：`service.ts` はハッシュ・プロファイル・予約/会計、`review.ts` はプロバイダー/証拠検証、`local.ts` は stdio/SQLite、`worker.ts` は HTTP 認証/D1 を担当します。ローカルは 1 ディレクトリ、Worker はデプロイの共有台帳です。

## npm 公開

手動 `publish.yml` は main でタグ・ソース・版を検証し、`npm` Environment で所有者承認を受けます。ビルド/smoke に OIDC 書き込み権限はなく、検証済み tarball の公開ジョブだけが持ちます。PR マージ・GitHub Release イベントでは自動公開しません。

公開・検証の問題後は、元の実行とレジストリの版・完全性を調べてから再試行を判断します。公開済みの同じバージョンは再公開しません。[韓国語リリースチェックリスト](../../releases/release-checklist.ko.md#github-actions-trusted-publisher)に設定・承認・7 日の artifact 保持期間を記載しています。Worker デプロイや既存端末更新は含みません。
