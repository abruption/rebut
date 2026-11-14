# 設定

[한국어](../ko/configuration.md) · [English](../en/configuration.md) · [简体中文](../zh-CN/configuration.md) · **日本語**

[README](../../../README.ja.md) · [インストール](installation.md) · [運用](operations.md)

## モードと保存先

| モード               | 選択                                                                            | 台帳の範囲                                  |
| -------------------- | ------------------------------------------------------------------------------- | ------------------------------------------- |
| ローカル（新規既定） | `rebut set mode local`                                                          | 1 つのデータディレクトリ内の private SQLite |
| Worker               | `rebut set endpoint URL` または `rebut set mode worker`（既存 endpoint が必要） | デプロイの D1 を複数クライアントで共有      |

既存 endpoint は Worker のままです。障害時に自動で切り替えず、切り替えても記録・予約を移行または解除しません。

macOS/Linux の設定は `~/.config/rebut/config.json`、ローカル台帳は `~/.local/share/rebut/local/ledger.sqlite` です。`REBUT_CONFIG_DIR` 指定時はその中の `config.json` と `local/` を使います。登録と状態照会も同じディレクトリを使ってください。

## 認証情報

`rebut set secret-store keychain|vaultwarden|env` は全役割のバックエンドを選び、自動フォールバックはありません。Keychain サービスは `com.abruption.rebut` です。

| 役割                 | Keychain アカウント / 非表示入力コマンド | env                    | Vaultwarden 既定項目 / 設定キー                       |
| -------------------- | ---------------------------------------- | ---------------------- | ----------------------------------------------------- |
| ローカルプロバイダー | `openai-api-key` / `set api-key`         | `REBUT_OPENAI_API_KEY` | `Rebut — OpenAI API Key` / `vaultwarden-api-key-item` |
| Worker 接続          | `codex-mcp-bearer` / `set token`         | `REBUT_TOKEN`          | `Rebut — MCP Access Token` / `vaultwarden-item`       |
| Worker 管理者        | `codex-mcp-admin` / `set admin-token`    | `REBUT_ADMIN_TOKEN`    | `Rebut — MCP Admin Token` / `vaultwarden-admin-item`  |

コマンドの先頭は `rebut` です。Vaultwarden 項目変更は `rebut set SETTING_KEY NAME`。明示した保護されたパイプ入力に限り `--stdin` を使います。`rebut set api-key-env OPENAI_API_KEY` はローカル変数名の明示変更で、変数間のフォールバックはありません。管理者トークンは MCP ホストに渡しません。

## モデルプロファイル

```sh
rebut profile list
rebut set model MODEL_ID
rebut set reasoning EFFORT
rebut set profile PROFILE_ID
```

設定は新規収集に適用します。明示した `collect --profile` が優先され、`review` は固定バンドルのプロファイルを維持します。既定は `astra-medium` です。許可リストはプロバイダーのモデル権限を与えません。

ローカルは OS 所有者が管理します。Worker の変更には `0002`、`ADMIN_TOKEN_SHA256`、別の管理者トークンが必要です。一覧取得は有料モデルを呼びません。

```sh
rebut profile set PROFILE_ID --model MODEL_ID --reasoning medium --max-output-tokens 8192 --input-usd-per-million INPUT_USD --output-usd-per-million OUTPUT_USD --price-version PRICE_VERSION
rebut profile remove PROFILE_ID --if-revision N
```

大文字は確認した値に置き換えます。モデル・推論対応と料金を確認し、入力/出力料金と価格バージョンを指定してください。`set` も `--if-revision N` を使えます。競合時は一覧を再取得して判断し、自動上書きしません。

変更は後続リクエストに適用します。削除は無効化 tombstone を残し、履歴を消したり初期プロファイルを復活させたりしません。既存 ID のモデル・リビジョン・予約は維持します。動的変更に Worker 再デプロイは不要です。

## 予算

| 項目                 | 既定  | ローカルコマンド                     |
| -------------------- | ----- | ------------------------------------ |
| UTC 日               | $6.66 | `rebut set daily-budget USD`         |
| UTC 月               | $200  | `rebut set monthly-budget USD`       |
| リクエスト単位       | $6.66 | `rebut set request-budget USD`       |
| 同時未解決リクエスト | 1     | `rebut set max-concurrent N`（1–10） |
| 1 日の新規リクエスト | 100   | デプロイ/初期設定                    |

ローカルはディレクトリ単位、Worker はデプロイ全体の制限です。他端末・Worker・API 使用や OpenAI 残高は合算しません。Worker は `REBUT_CONFIG` で管理します。日・月・単位上限は独立し、1 つの変更で他が増えることはありません。変更後はホストを再起動します。

呼び出し前に入力と最大出力を保守的に予約し、確認した使用量で計上します。見積もりは請求書ではありません。unknown は全額予約と同時実行枠を保持し、日付変更でも枠は解放しません。期間計上は最初の UTC 提出日・月に属します。

## 入力と結果の契約

| 項目              | 上限                  |
| ----------------- | --------------------- |
| 正規化 UTF-8 入力 | 128,000 bytes         |
| ファイル          | 40                    |
| diff / 要件       | 100,000 / 16,000 文字 |
| 転送エンベロープ  | 160,000 bytes         |

SHA-256 はマスク後の `{schema_version,task_kind,requirements,files,diff}`、ファイルキー順は `{path,start_line,content}` です。ID とプロファイルは証拠ハッシュとは別です。[完全なスキーマ](../../../src/contracts.ts)を参照してください。

- `review` は固定資料を検討します。成功は `completed` のみで、ファイル/diff 行の根拠、モデル、入力ハッシュ、使用量、推定費用を返します。空の findings は正しさの証明ではありません。
- `review_status` は元の principal のメタデータを照会します。同じ ID は追加呼び出しを作らず、ハッシュ/プロファイル変更は競合になります。本文は再取得しません。

台帳にはリクエスト/使用量メタデータだけを残し、コード・レビュー本文・キーは保存しません。資料は OpenAI に送信し、`store:false` はプロバイダーのゼロ保持を保証しません。プロンプトは資料内の指示をレビューデータとして扱うようモデルに指示します。モデルにリポジトリ/URL 取得、シェル、テスト、編集、PR ツールは与えません。
