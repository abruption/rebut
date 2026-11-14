# インストールと使い方

[한국어](../ko/installation.md) · [English](../en/installation.md) · [简体中文](../zh-CN/installation.md) · **日本語**

[README](../../../README.ja.md) · [設定](configuration.md) · [運用](operations.md)

Node.js 24 以上が必要です。macOS/Linux を検証対象とし、Windows の動作・ACL は未検証です。

## ローカル MCP

macOS Keychain を使う新規インストール例：

```sh
npm install -g rebut-mcp
rebut set api-key
rebut setup --client codex
rebut doctor --connect
```

ホストを再起動するとローカル stdio サーバーが動きます。Cloudflare や HTTP サーバーは不要です。レビュー資料は自分のキーで OpenAI に送信します。`doctor --connect` は認証情報の利用可否と MCP ツールを確認し、有料レビューや API アカウント権限の検証は行いません。

既存の endpoint 設定は Worker モードを維持します。ローカルへの切り替えは `rebut set mode local`、キー設定、登録更新の順です。台帳は移行されません。

ほかの認証方式：

| 方式                   | 選択                                 | ローカル OpenAI キー                                         |
| ---------------------- | ------------------------------------ | ------------------------------------------------------------ |
| Keychain（macOS 既定） | `rebut set secret-store keychain`    | `rebut set api-key` の非表示入力                             |
| 環境変数（Linux 既定） | `rebut set secret-store env`         | 実際の MCP ホスト環境の `REBUT_OPENAI_API_KEY`               |
| Vaultwarden            | `rebut set secret-store vaultwarden` | `bw-get` を準備し、`rebut set vaultwarden-api-key-item NAME` |

Vaultwarden には、項目名を引数として受け取り秘密値を stdout に返す認証済み `bw-get` 実行ファイルが必要です。パスは MCP ホスト環境の `REBUT_BW_GET` で指定できます。

認証情報を CLI 引数や追跡ファイルに入れないでください。env 登録は変数名だけを保存します。`OPENAI_API_KEY` の共有は `rebut set api-key-env OPENAI_API_KEY` で明示し、自動フォールバックはしません。役割別項目は[設定](configuration.md)を参照してください。

## Codex 登録と更新

```sh
npm install -g rebut-mcp
rebut setup --client codex --replace
rebut doctor --connect
```

登録先は `CODEX_HOME` または `~/.codex`、別の場所は `--codex-home PATH` で指定します。`setup --replace` 前に `config.toml` 全体をバックアップし、カスタム `REBUT_CONFIG_DIR` は setup を実行するシェルにも同じ値を渡してください。登録後はホストを再起動します。起動中プロセスは設定を再読み込みしません。

0.2.x → 0.3.0 は **OpenAI 設定を維持して Worker コード → CLI/登録/ホスト再起動 → Claude キーとプロファイル有効化** の順です。0.1.x は先に CLI を 0.2.x に更新して長い期限に対応してください。プロバイダー/HTTP クライアント/Codex ツールの期限は 1,800/1,830/1,860 秒で、接続の維持を保証しません。他のホストも長いレビューに対応する期限が必要です。

`rebut remove --client codex` は登録だけを外し、設定・キー・台帳は削除しません。バックアップとダウングレードは[運用](operations.md)を参照してください。

## レビュー実行

```sh
umask 077
rebut collect --root /path/to/project --request-id review-001 --requirements 'Check the supplied code' --profile astra-medium -- src/example.ts > /protected/path/review-001.bundle.json
rebut review < /protected/path/review-001.bundle.json
rebut status review-001
```

ファイルを明示選択します。収集器は危険なファイル、シンボリックリンク、FIFO、バイナリを拒否し、一般的な秘密のパターンをマスクしますが、送信前にバンドルを確認してください。`review` は有料呼び出し、`status` はメタデータ照会です。本文は再取得できないため初回応答を保存します。

有料レビューを明示選択します。`completed` を確認し、返されたモデル・入力ハッシュを固定バンドルとプロファイルに照合して、各指摘を原資料で確認します。独立レビューには同じ固定資料を渡し、各レビュアーの結果を混ぜません。timeout/unknown 後は同じ ID・バックエンドを保ち、新しい ID で再実行せず[復旧](operations.md#unknown-復旧)に従ってください。

## 任意の Worker デプロイ

複数端末で予算・リクエスト台帳を共有する場合に使います。ソース、自分の Cloudflare アカウント、D1 が必要です。

1. ソースをチェックアウトして `npm ci --ignore-scripts` を実行します。`wrangler.jsonc` を無視対象の `wrangler.private.json` にコピーし、アカウント・Worker 名・ホストを設定します。
2. `npx wrangler d1 create rebut-ledger --config wrangler.private.json` で D1 を作り、ID を非公開の `DB` バインディングに設定します。
3. `npx wrangler d1 migrations apply rebut-ledger --remote --config wrangler.private.json` で既存の `0001`・`0002` を適用します。更新でも同じ D1 とリクエスト行を保持します。
4. `npx wrangler deploy --config wrangler.private.json` でデプロイします。設定前は 503 を返します。
5. `npx wrangler secret put NAME --config wrangler.private.json` の対話入力で以下を保存します。値を引数に入れないでください。

| Worker シークレット  | 内容                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `OPENAI_API_KEY`     | 自分のプロバイダーキー                                                                     |
| `REBUT_CONFIG`       | [設定例](../../../config.example.json)に合わせた JSON。`hostname` は実際の endpoint ホスト |
| `AUTH_TOKENS`        | 安定した principal ID → 独立したランダムな 256-bit bearer の SHA-256 ダイジェスト          |
| `ADMIN_TOKEN_SHA256` | プロファイル管理が必要な場合、別の管理者 bearer の SHA-256 ダイジェスト                    |

元の bearer は認証ストアに保存します。レビューと管理者のトークンを分け、交換時も principal ID は保持します。Bearer 認証であり OAuth は実装していません。

macOS クライアント設定：

```sh
rebut set endpoint https://YOUR_HOST/mcp
rebut set token
rebut setup --client codex --replace
rebut doctor --connect
```

endpoint 設定は Worker モードを選び、ローカル OpenAI キーではなく接続トークンを使います。env/Vaultwarden 項目と管理者認証は[設定](configuration.md)を参照してください。Worker デプロイと npm 更新は別の操作です。

## Claude API と Claude Code — 0.3.0

0.3.0 以降はレビューのプロバイダーと MCP ホストを別々に選択します。ローカル macOS Keychain の例：

```sh
rebut set mode local
rebut set provider anthropic
rebut set api-key
rebut setup --client claude
rebut doctor --connect
```

プロバイダーを切り替えると既定プロファイルを選び、モデル/推論オーバーライドを解除します。同じ選択の繰り返しでは維持します。既存の OpenAI キー・プロファイル・台帳は削除しません。

登録前に Claude Code を止め、設定をバックアップします。`~/.claude.json` の Rebut ユーザー項目だけを更新します。別ファイルは `--claude-config PATH`、`CLAUDE_CONFIG_DIR` 使用時は必須です。異なる Rebut 登録は `--replace` が必要です。プロジェクト/管理設定の同名上書きは別途確認し、登録ファイルは 0600 で原子的に置換し、ACL/xattr は維持しません。再起動後 `/mcp` を確認してください。

env は `rebut set secret-store env` と実際のホスト環境の `REBUT_ANTHROPIC_API_KEY` を使います。Claude Code 認証を変えないため共有 `ANTHROPIC_API_KEY` の選択は非対応です。Keychain/Vaultwarden 登録はキー用 env プレースホルダーを追加しません。env setup もプロファイル取得時にローカル SQLite を初期化する場合があります。 env 登録は現在の既定プロファイルの変数を渡します。他プロバイダーの固定バンドルでキーがなければ予約前に失敗します。doctor の `provider` は既定プロファイル、`keyConfigurationProvider` は `set api-key` の対象です。変更後は各ホストで `setup --replace` と再起動を行います。

任意のローカル専用 `rebut doctor --provider` はモデルメタデータだけを取得し、生成・レビュー予約・使用量記録は追加しません。プロファイル取得時にローカル SQLite を初期化する場合があります。`doctor --connect` は引き続き MCP 確認です。メタデータ到達は生成権限・残高・geo・構造化出力・品質の証明ではありません。
