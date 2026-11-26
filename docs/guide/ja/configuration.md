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

設定ファイルは現在のアカウントの所有とし、パーミッションを `0600` にします。設定ディレクトリも同じアカウントが所有し、上位のパスも含めて他のユーザーが書き込めない場所に置きます。設定パスが安全でないと表示された場合は、所有者と権限を確認してください。

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

1 つの設定と台帳を共有しながら、Codex と Claude Code に別々の既定レビュープロファイルを設定できます。

```sh
rebut set profile claude-medium --client codex
rebut set profile astra-medium --client claude
rebut set profile --client codex --clear
```

`--clear` はそのクライアントを共有の既定値に戻します。シェルやエージェントから `collect --client codex` または `collect --client claude` を指定するとクライアント別の既定値が適用されます。明示した `collect --profile` が優先されます。既定のプロファイルが使用できない場合は既定値での収集が失敗し、既存のバンドルのプロファイルとプロバイダーは保持されます。`rebut doctor --client codex` または `--client claude` で設定を確認できます。

既存の登録を `rebut setup --client codex --replace` または `rebut setup --client claude --replace` で更新し、ホストを再起動してください。ローカルの環境変数方式で必要なキー変数が変わった場合は再登録します。モデルは `rebut profile set --model` でプロファイルに定義します。既定値に選んだプロファイルのモデル・推論・料金が適用されます。 クライアント別の既定値をサポートしない版へ戻す場合は、両方の設定を先に解除し、旧版の CLI で両方の MCP ホストを再登録してください。

同梱の `astra-medium` プロファイルは GPT-6.2 Astra（`gpt-6.2-astra`）と medium の推論を使用します。例の[短いコンテキストの Standard 料金](https://developers.openai.com/api/docs/models/gpt-6.2-astra)は100万トークン当たり入力 $8、出力 $40 です。既存の Worker とローカルのプロファイル上書きは保存済み設定を維持します。移行するには `rebut profile list` を確認し、モデル `gpt-6.2-astra`、推論 `medium`、両方の料金と料金バージョン `openai-standard-2026-11-18` を、現在の `--if-revision` で一度に更新してください。旧モデル ID を明示しているクライアントでは、その設定を更新するか、プロファイル ID で `astra-medium` を選択してください。

ローカルは OS 所有者が管理します。Worker の変更には `0002`、`ADMIN_TOKEN_SHA256`、別の管理者トークンが必要です。一覧取得は有料モデルを呼びません。

```sh
rebut profile set PROFILE_ID --model MODEL_ID --reasoning medium --max-output-tokens 8192 --input-usd-per-million INPUT_USD --output-usd-per-million OUTPUT_USD --price-version PRICE_VERSION
rebut profile remove PROFILE_ID --if-revision N
```

`PROFILE_ID` や `MODEL_ID` などのプレースホルダーは実際の値に置き換えてください。モデルが対応する推論レベルと料金を確認し、入力料金・出力料金・料金バージョンを指定します。`set` でも `--if-revision N` を使えます。リビジョンが競合した場合は一覧を確認し直してください。自動で上書きしないでください。

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

Worker の任意バインディング `REBUT_BUDGET_LIMITS` に、変更する `dailyMicrousd` または `monthlyMicrousd` を JSON で指定できます。単位は 100 万分の 1 ドルです。日額に `0` を指定すると、日ごとの支出上限を解除します。月額、リクエスト単位の支出上限、日ごとのリクエスト数、同時実行数の上限は引き続き適用されます。管理者は `rebut budget` の JSON で日額と月額の上限を確認できます。`daily_limit_microusd` が `0` の場合は日ごとの支出上限が解除されています。バインディングが無効な場合、Worker は 503 を返します。GPT-6.2 Astra と Claude Fable 5.2 のプロファイルは `maxOutputTokens` を最大 50,000 に設定できます。有効なプロファイルを 16,384 より上げる前に、その Worker を使う CLI を更新してください。

呼び出し前に入力と最大出力を保守的に予約し、確認した使用量で計上します。見積もりは請求書ではありません。unknown は全額予約と同時実行枠を保持し、日付変更でも枠は解放しません。期間計上は最初の UTC 提出日・月に属します。

`rebut budget` で月間の計上額、次の UTC 切り替え時刻、未解決のリクエストが占有する枠を確認できます。台帳上の数値はプロバイダーのクレジット残高とは別です。Worker モードでは Worker の管理者トークンを使います。月間計上額と月間上限、占有枠と同時実行上限を比べて確認できます。日別・リクエスト別の上限も適用されます。

月間の UTC 開始日を変更するには `rebut budget set-start-day DAY`（1〜28）を実行します。空の台帳にはすぐ適用されます。リクエスト履歴がある台帳では、現在の暦月予算を翌月の指定日まで延長します。たとえば11月に15日を指定すると、12月15日 00:00 UTC まで11月の予算を使用します。既定は1日で、台帳ごとに別の開始日へ一度だけ移行できます。同じ指定の繰り返しは安全で、別の日への再変更は拒否されます。

Worker では新しいコードをデプロイし、D1 マイグレーション `0003_budget_cycle.sql` を適用してから設定してください。暦月モードにはこのマイグレーションは不要です。ローカルでは切り替えに成功すると台帳が自動でアップグレードされ、旧版の CLI では開けなくなります。旧版の Worker は切り替え後に新規予約を作成できません。既存のリクエスト ID、計上期間、未解決の枠は保持されます。

## 入力と結果の契約

| 項目              | 上限                  |
| ----------------- | --------------------- |
| 正規化 UTF-8 入力 | 128,000 bytes         |
| ファイル          | 40                    |
| diff / 要件       | 100,000 / 16,000 文字 |
| 転送エンベロープ  | 160,000 bytes         |

SHA-256 はマスク後の `{schema_version,provider,task_kind,requirements,files,diff}` を JavaScript で空白なしの JSON にした UTF-8 バイト列から計算します。ファイルのキー順は `{path,start_line,content}` です。入力スキーマ 1 では `provider` を省きます。拡張出力を選んだ場合は最後に `result_format` を追加し、キー順は `{version,criterion_ids}`、基準 ID の配列順は入力どおりです。リクエスト ID とプロファイルはハッシュの対象外です。入力の `schema_version` と出力の `result_format.version` は別々の値です。 [完全なスキーマ](../../../src/contracts.ts)を参照してください。

入力スキーマ 2 で従来の出力を使う例です。

```json
{"schema_version":2,"provider":"openai","task_kind":"code","requirements":"AC-1: Preserve 순서.","files":[{"path":"sample.ts","start_line":1,"content":"export const value = 1;"}],"diff":""}
```

同じ資料の SHA-256 は、`provider` を省いた入力スキーマ 1 が `412b5f538cfa6fac93c83813b6f4b723156f40ae06d50848072c58a5dabc8ca0`、上の例が `f8add8f03abd7292de2918d02a70b435953019074a35d6a45d3a182f177417c5`、末尾に `result_format: {"version":2,"criterion_ids":["AC-1"]}` を追加した入力スキーマ 2 が `fd39d1847c3a55e9a318020874a96b55fcaad132c5c7c2df6325d4e8d1cf032a` です。

| CLI とバックエンド | 対応する出力 |
| --- | --- |
| v0.5.0 CLI と対応するローカルランタイムまたは Worker | 従来の出力 |
| 更新した CLI と v0.5.0 Worker | 既定値または `--output-schema 1` |
| 更新した CLI と拡張出力に対応したローカルランタイムまたは Worker | 従来の出力、または `--criterion-id ID` で選ぶ拡張出力 |

収集時にプロファイル ID とプロバイダーを固定します。バックエンドは最初の予約直前に現在のプロファイルからモデル、推論レベル、料金を取得します。記録済みのリクエストには元の ID のメタデータを返します。

シェルで自動化する場合、`rebut review --strict-exit` は指定形式の完了本文があるときだけ終了コード 0 を返します。再送で本文のない `completed` メタデータが返った場合は、0 以外で終了します。標準出力の JSON 形式は変わりません。不明な結果は JSON の状態を確認し、元のリクエスト ID で照会してください。

- `review` は固定資料を検討します。新しい `completed` の本文にはファイル/diff 行の根拠、モデル、入力ハッシュ、使用量、推定費用を返します。空の findings は正しさの証明ではありません。
- `review_status` は元の認証主体にのみメタデータを返します。同じバックエンドと認証主体の台帳に ID が記録されていれば、同じ入力ハッシュとプロファイルで `review` を再送してもプロバイダーは再度呼び出されません。入力ハッシュやプロファイルが違う場合は `conflict` を返します。状態照会ではレビュー本文を再取得できません。

台帳にはリクエスト/使用量メタデータだけを残し、コード・レビュー本文・キーは保存しません。資料はプロファイルで指定したプロバイダーに送信します。OpenAI の `store:false` はデータが一切保持されないことを保証するものではありません。プロンプトは資料内の指示をレビューデータとして扱うようモデルに指示します。モデルにリポジトリ/URL 取得、シェル、テスト、編集、PR ツールは与えません。

## Claude プロバイダー — 0.3.0

`rebut set provider anthropic` 後、既存の `rebut set api-key` でキー 1 つを設定します。Keychain サービス/アカウントは `com.abruption.rebut` / `anthropic-api-key`。Vaultwarden は `rebut set vaultwarden-api-key-item NAME` で選択中の項目を指定し、既定は `Rebut — Anthropic API Key`。アカウント別名・キー循環・プロバイダーフォールバックは追加しません。

`claude-medium` は Claude Opus 5.5 / medium です。Anthropic プロファイル新規作成時は `--provider anthropic` を明示します。省略すると、有効な既存プロファイルのプロバイダーを維持します。新規または無効なプロファイルには OpenAI が適用されます。キー選択設定は継承しません。provider のない旧プロファイルは OpenAI です。固定バンドルのプロファイルが実際のプロバイダーとキーを決めるため、設定変更後も元のバンドル/ID を保持します。

各ローカル/Worker 台帳で両プロバイダーの予算・同時実行を合算します。新規リクエストの `requested_provider` は予約・完了・エラーでも維持し、旧行は変更しません。thinking 詳細がなければ `reasoning_tokens` を省略します。キャッシュ読み込みは基本入力料金全額で保守的に計上し、要求していないキャッシュ書き込みや非標準使用量は unknown として保持します。

Claude は standard tier/global geo の Messages API を使い、ツールやプロンプトキャッシュはありません。workspace の地域制約で拒否される場合も他キーで再試行しません。既存 OpenAI 設定のまま Worker コードを更新し、クライアント更新後に `ANTHROPIC_API_KEY` シークレットと Anthropic プロファイルを追加します。管理者トークンをホストへ渡しません。

API 費用・クレジット適用は [Claude Console 請求案内](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage)で確認し、Rebut API 呼び出しと Claude Code サブスクリプション使用量を区別してください。

新規 schema 2 バンドルはプロバイダーを固定してハッシュに含めます。収集時に選択したバックエンドのプロファイルを参照するため、Worker では接続トークンが必要です。提出時に供給先が変わっていればキー読み込み・予約前に `provider_mismatch` で拒否します。旧 schema 1 の新規要求は OpenAI のみとし、提出済み ID は元のバンドルでメタデータを照会できます。変更を確認してから新バンドルを収集してください。

ローカル収集はプロファイルストアを初期化する場合があります。schema 1 のハッシュは provider を含めず旧順序を維持します。
