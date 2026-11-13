# 明示的に選択する独立レビュー

[한국어](../ko/reviewer-integration.md) · [English](../en/reviewer-integration.md) · [简体中文](../zh-CN/reviewer-integration.md) · **日本語**

[Rebut](../../../README.ja.md) · [ユーザーガイド](../ja.md)

ホストの既存レビュー方針を維持し、OpenAIレビューの明示要求時だけRebutを選びます。自動代替や3者同時呼び出しはしません。

1. 必要な根拠のみを収集・秘匿処理・確認・固定しcanonical SHA-256を記録します。独立レビュアーには同一資料を渡し、相互の結果は渡しません。
2. ローカルまたはWorkerと有効なプロファイルを選択します。意図した新規レビューのみ新ID、不確かな要求は元IDとbackendを維持します。
3. ローカルはOpenAI APIキー（set api-key、REBUT_OPENAI_API_KEY、vaultwarden-api-key-item）、Workerは別のendpointと接続トークン（set token、REBUT_TOKEN、vaultwarden-item）を使い、プロバイダーキーはWorkerに置きます。
4. 明示的な有料選択後に `rebut review < /protected/path/request-001.bundle.json` を実行し、初回応答を制限した権限で保存します。資格情報は引数や追跡ファイルに入れません。
5. completed・期待モデル／プロファイル／ハッシュ・使用量を確認し指摘を根拠と照合します。空の指摘や有効JSONは正しさの証明ではありません。実モデル・使用量推定・根拠・限界を報告します。
6. タイムアウト・取消・不確かな結果後はrebut status REQUEST_IDを照会します。reserved/unknownは課金済みの場合があり予約を維持し、重複はメタデータだけを返します。別backendで再実行して回避しません。

モデルに実行・公開権限は与えません。doctor --connectはプロバイダーを呼ばず選択backendを確認し、API権限の証明ではありません。ローカル予算は1ディレクトリで端末間共有はなく、追加MCPホストは互換性と期限を個別確認します。
