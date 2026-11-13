# 設定と MCP 仕様

[한국어](../ko/configuration.md) · [English](../en/configuration.md) · [简体中文](../zh-CN/configuration.md) · **日本語**

[Rebut](../../../README.ja.md) · [ユーザーガイド](../ja.md)

## ローカル CLI 設定

`npm install -g rebut` でインストールし、`rebut set endpoint https://YOUR_HOST/mcp` で Worker を設定します。macOS の既定は Keychain です。`rebut set token` は入力を隠す対話型プロンプトを使い、`rebut set token --stdin` は保護されたパイプ入力を明示的に受け付けます。Bearer 値を引数や追跡対象ファイルに入れないでください。既存の Vaultwarden ワークフローは `rebut set secret-store vaultwarden` で明示的に選びます。既定の項目は `Rebut — MCP Access Token` で、`rebut set vaultwarden-item NAME` で変更できます。macOS 以外では `rebut set secret-store env` を明示し、安全な実行環境から `REBUT_TOKEN` を渡します。バックエンドは自動で代替されません。

`env` バックエンドの場合、Codex 設定は値を保存せず、変数名だけを `env_vars = ['REBUT_TOKEN']` として保存します。トークンは実際に Codex を実行するホストの安全な実行環境で渡してください。設定コマンドにだけ渡した環境変数は、後の Codex セッションでは利用できません。

`rebut setup --client codex` は `CODEX_HOME` または `~/.codex` を使用し、`--codex-home PATH` で別の保存先を指定します。`rebut mcp` を登録し、他の MCP エントリを保持します。既存の非公開 `rebut` ブリッジの移行には `--replace` が必要です。`rebut doctor` は機密値を除いたローカル設定と認証情報の利用可否を表示し、`rebut doctor --connect` は無料でリモートの `tools/list` を確認します。いずれも有料レビューは実行しません。[インストール](installation.md)を参照してください。

## モデルと推論の設定

新しく収集するバンドルのローカル設定を指定するか、サーバーのプロファイルを直接選択します。

```sh
rebut set model MODEL_ID
rebut set reasoning EFFORT
rebut set profile PROFILE_ID
```

`MODEL_ID`、`EFFORT`、`PROFILE_ID` はプレースホルダーです。モデルと推論の設定はサーバーの許可リスト内のプロファイルに解決され、任意のモデルへのアクセスは付与しません。コレクターの明示的な `--profile` がローカル設定より優先されます。設定がなければ既定は `astra-medium` のままです。`rebut review` は確定済みバンドルに含まれるプロファイルを使い、現在の設定で書き換えません。

## 所有者によるサーバープロファイル管理

`rebut profile list` は認証付きの読み取り専用 GET で、サーバーのプロファイル、モデル、推論設定、出力上限、料金、リビジョンを一覧表示します。プロバイダーの呼び出しや有料レビューは行いません。

```sh
rebut profile list
rebut set admin-token
```

プロファイルの変更には、別の所有者用管理 Bearer が必要です。`rebut set admin-token` は入力を隠す対話型プロンプトを使い、`rebut set admin-token --stdin` は保護されたパイプを明示的に受け付けます。トークンを引数や追跡対象ファイルに入れないでください。macOS Keychain のサービスは `com.abruption.rebut`、レビュー用アカウントは `codex-mcp-bearer`、管理用は `codex-mcp-admin` です。選択済みの Vaultwarden バックエンドでは、ユーザーが別の項目を選択できます。既定は `Rebut — MCP Admin Token` で、`rebut set vaultwarden-admin-item NAME` で変更します。env バックエンドは安全な実行環境から `REBUT_ADMIN_TOKEN` を読み取ります。管理トークンは Codex に転送されません。バックエンドは自動で代替されません。

[インストール](installation.md)に記載した一度限りの Worker 更新、D1 マイグレーション `0002`、`ADMIN_TOKEN_SHA256` シークレット設定後、所有者はプロファイルを追加・更新できます。以下の例は既存の Astra/medium 設定と 2026-11-12 時点の Standard 料金を使っています。値を選ぶ前に公式の[モデル](https://developers.openai.com/api/docs/models/gpt-6-astra)と[料金](https://developers.openai.com/api/docs/pricing)を確認してください。新しいモデルにはプレースホルダー `MODEL_ID` を確認済みの Responses 互換モデル ID に置き換え、対応する推論設定、出力上限、公式料金をすべて明示します。

```sh
rebut profile set astra-medium --model gpt-6-astra --reasoning medium --max-output-tokens 8192 --input-usd-per-million 10 --output-usd-per-million 50 --price-version official-2026-11-12
```

両方の料金と `--price-version` は必須で、サーバーは予算予約と費用見積もりに使用します。Rebut は料金を自動取得せず、プロバイダーのモデルエンドポイントも呼び出しません。`--if-revision N` は set/remove に明示的な比較交換のリビジョン条件を加えます。`409` の競合時は `rebut profile list` を読み直して変更内容を判断し、自動で上書きしないでください。

```sh
rebut profile remove PROFILE_ID --if-revision N
```

削除はレビュー履歴を消さず、無効化する tombstone を残します。Worker/D1 の対応を一度導入すれば、プロファイル変更は D1 への書き込みだけです。Responses 互換の新しいモデル ID や推論値には Worker の再ビルド・再デプロイや npm 更新は不要です。プロファイルの更新・削除後も、既存のリクエストは元のモデルとリビジョンを保持します。変更による再実行や予約の自動解放・返金はありません。通常のレビュー Bearer ではプロファイルを変更できません。この所有者 API は MCP ツールとして公開されず、予算、認証、プロバイダー URL も変更できません。

## サーバー設定

[`config.example.json`](../../../config.example.json) は `REBUT_CONFIG` シークレットの構造を定義しています。`hostname` をエンドポイントの正確なホスト名に設定し、サーバー側のプロファイル ID とデプロイ全体の上限を設定します。クライアントはプロファイル ID を選択しますが、モデル名やプロバイダー URL を上書きすることはできません。この例は設定を示すものであり、アカウントでのモデルアクセスを保証するものではありません。

`REBUT_CONFIG` は初期プロファイルを提供します。D1 の上書きと無効化 tombstone が優先され、削除しても同じ ID の初期プロファイルは復活しません。サーバーは予約した各リクエストの解決済みプロファイルとリビジョンを固定します。

| プロファイル   | モデル        | 推論     | 最大出力トークン数 | 100 万トークンあたりの Standard 入力/出力料金 |
| -------------- | ------------- | -------- | ------------------ | --------------------------------------------- |
| `astra-medium` | `gpt-6-astra` | `medium` | 8,192              | $10 / $50                                     |
| `luna-test`    | `gpt-6-luna`  | `medium` | 2,048              | $0.10 / $0.50                                 |

出力上限には推論トークンを含みます。日付付き料金表は `openai-standard-2026-11-12` であり、見積もりにキャッシュ入力の割引は適用しません。**実際の API テストには Luna** を使い、自動テストにはモックを使ってください。本番プロファイルは引き続き Astra/medium です。Luna の結果は、Astra の実行時の利用可否や同等のレビュー品質を実証するものではありません。デプロイ前に公式の [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)、[Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)、[料金](https://developers.openai.com/api/docs/pricing)ドキュメントを確認してください。

リクエストは `service_tier:default` と、ブレークポイントを設けない `prompt_cache_options.mode:explicit` に固定され、これらのプロファイルではプロンプトキャッシュが無効になります。実行ツールは提供しません。見積もりは請求書ではなく、同じキーやプロジェクトを共有する他のサービスは考慮しません。

## 予算と同時実行

| 設定                                        | 設定例                             |
| ------------------------------------------- | ---------------------------------- |
| UTC の暦日                                  | $6.66 (`dailyMicrousd:6660000`)    |
| UTC の暦月                                  | $200 (`monthlyMicrousd:200000000`) |
| リクエストあたり                            | $6.66 (`requestMicrousd:6660000`)  |
| 保留中または結果不明の同時リクエスト数      | 1 (`maxConcurrent:1`)              |
| UTC の 1 日あたりの新規レビューリクエスト数 | 100 (`dailyRequests:100`)          |

これらの上限は、デプロイ内のすべてのプリンシパルを合算したものです。呼び出し前に予約します。シリアライズしたリクエストのバイト数にフレーミング用の余裕を加えた値を入力トークン数として数え、最大出力予算を予約します。検証済みの使用量は、キャッシュなしの Standard 料金で保守的に精算します。実行結果が不明な場合や使用量が欠落している場合は、予約全額を保持します。UTC の日付や月が変わると、その期間の支出枠はリセットされますが、未解決の実行は同時実行枠を占有し続けます。予算期間はサブスクリプションのクレジット付与日や有効期限ではなく、最初の送信日に従います。この台帳は、他の利用元を含む OpenAI アカウント全体の上限を強制できません。アカウントや組織のクレジット適用資格は別途確認してください。

## 入力上限とハッシュ

| 資料                                       | 上限           |
| ------------------------------------------ | -------------- |
| 正規化してシリアライズした UTF-8 JSON 入力 | 128,000 バイト |
| ファイル数                                 | 40             |
| 差分                                       | 100,000 文字   |
| 要件                                       | 16,000 文字    |
| 転送エンベロープ                           | 160,000 バイト |

SHA-256 は、マスキング後の正規化された `{schema_version,task_kind,requirements,files,diff}` を対象とし、ファイルのキー順序は `{path,start_line,content}` です。リクエスト ID とプロファイル名は、この確定済み証拠のハッシュとは別です。完全な仕様は [`ReviewInputSchema`](../../../src/contracts.ts) を参照してください。独立した初回レビュアーには同じ証拠を渡し、それぞれの出力を分けて保持してください。

## MCP ツール

- `review`: 許可リスト内のプロファイル ID を選び、確定済みの資料を渡します。ステータス、検証済みの指摘、プロバイダーのモデルと ID、ハッシュ、使用量、推定 microUSD を返します。レビュー成功を表すのは `completed` だけです。拒否、不完全な生成、無効な出力、結果不明の実行は、それぞれ異なる状態として扱います。すべての指摘は、提供されたファイルの行、または提供された差分の変更後側の行を参照する必要があります。要約が空でなければ、指摘の配列が空でも有効です。空のレスポンスや形式の不正なレスポンスは無効です。
- `review_status`: `{request_id}` により、呼び出し元のプリンシパルに属するメタデータだけを返します。レビュー本文は再取得できません。

タイムアウト後は、**同じリクエスト ID** を照会してください。同じ ID を再送しても、別のプロバイダー実行は作成されません。入力ハッシュやプロファイルを変更して ID を再利用すると `conflict` を返します。完了済みの重複リクエストはレビュー本文ではなくメタデータを返すため、クライアントは最初のレスポンスをローカルに保存する必要があります。照合については[運用](operations.md)を参照してください。転送障害後の `not_found` だけでは、新しい ID を使う根拠にはなりません。

## 保存とプライバシー

メタデータのみを保存する D1 台帳には、リクエスト ID、ハッシュ、プロファイル、ステータス、予約額、安全な形式に処理したプロバイダー ID、使用量を保持します。ソースやレビュー本文は一切保存しません。設定例では Worker のオブザーバビリティを無効にしています。`AUTH_TOKENS` には Bearer 値ではなくトークンのダイジェストを保存します。元の Bearer トークンはパスワードマネージャーに保管してください。セットアップは[インストール](installation.md)を参照してください。

OpenAI リクエストは `store:false` を使用します。これはプロバイダーによる保持がゼロであることを保証せず、組織のデータポリシーに代わるものでも**ありません**。[OpenAI のデータ管理](https://developers.openai.com/api/docs/guides/your-data)を参照してください。認証情報と非公開のデプロイ識別子は、公開ソースやログに含めないでください。

結果が `invalid_output` の場合、`invalid_output_reason` により、ソースやレビュー本文を保持せずに失敗した検証段階を識別できます。途中の `commentary` メッセージは除外し、`final_answer` または phase のない従来形式のメッセージだけを構造化レビューとして解析します。複数の最終出力、不正な JSON やスキーマ、提供された証拠の範囲外を指す指摘は、引き続きエラーになります。
