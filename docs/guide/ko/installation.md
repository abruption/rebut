# 설치와 사용

**한국어** · [English](../en/installation.md) · [简体中文](../zh-CN/installation.md) · [日本語](../ja/installation.md)

[README](../../../README.md) · [설정](configuration.md) · [운영](operations.md)

Node.js 24 이상이 필요합니다. macOS와 Linux에서 동작을 확인했습니다. Windows의 로컬 실행 범위는 아래 절을 참고하세요.

<a id="windows-로컬-mcp-mvp"></a>

## Windows 로컬 MCP

Windows의 로컬 MCP는 `REBUT_OPENAI_API_KEY` 환경변수에서 OpenAI API 키를 읽습니다. 사용자 프로필 아래에 다른 사용자와 공유되지 않는 전용 데이터 디렉터리를 지정하세요. 그 디렉터리에 `config.json`이 없으면 Rebut이 기본 로컬 설정으로 시작합니다. 파일이 있으면 시작을 거부하며, `rebut.cmd set mode local`처럼 설정을 쓰는 명령도 오류를 반환합니다.

Windows 10 x64와 Node.js 24에서 `rebut-mcp@0.4.1`을 설치했습니다. Codex CLI의 App Server와 Claude Code CLI에서 각각 모의 응답으로 리뷰를 실행하고, 새 MCP 프로세스에서 원래 요청의 상태를 다시 조회했습니다. 0.4.1에서 실제 OpenAI 리뷰를 요청한 건은 전송 오류로 `unknown` 상태가 됐습니다. 데스크톱 앱 연결과 Worker 모드는 별도 검증이 필요합니다.

아래는 처음 설치할 때 쓸 수 있는 예제입니다. 이미 Windows에서 Rebut을 쓰고 있다면 요청·사용량 기록을 이어서 볼 수 있도록 기존 `REBUT_CONFIG_DIR` 값을 사용하세요. Claude Code에 등록하려면 마지막 줄에 `--client claude`를 사용하세요.

```powershell
npm.cmd install -g rebut-mcp
$env:REBUT_CONFIG_DIR = Join-Path $env:LOCALAPPDATA 'Rebut\local-mvp'
$rebutKey = Read-Host 'OpenAI API key' -AsSecureString
try {
    $env:REBUT_OPENAI_API_KEY = [System.Net.NetworkCredential]::new('', $rebutKey).Password
} finally {
    $rebutKey.Dispose()
    Remove-Variable rebutKey
}
rebut.cmd doctor --connect
rebut.cmd setup --client codex
```

전역 설치에 관리자 권한이 필요하면 `npm.cmd install -g --prefix "$env:APPDATA\npm" rebut-mcp`로 사용자 경로에 설치하세요. `rebut.cmd`를 찾을 수 없다면 `%APPDATA%\npm`을 Windows 환경 변수 설정의 사용자 `PATH`에 추가하고 PowerShell을 다시 여세요. 업데이트할 때도 같은 `--prefix`를 사용하세요.

등록을 마치면 같은 PowerShell에서 Codex 또는 Claude Code를 시작하세요. 이미 등록한 경우 [등록 갱신 안내](#codex-등록과-업데이트)를 따르세요. 이 셸에서 시작한 프로그램은 키를 상속할 수 있습니다. 호스트를 종료한 뒤 `Remove-Item Env:REBUT_OPENAI_API_KEY`로 현재 셸의 키를 지울 수 있습니다.

`rebut.cmd doctor --provider`에서 `tls_certificate_error`가 표시되면 `tls_error_code`로 인증서 오류를 확인하세요. Windows가 신뢰하는 인증서를 Node.js가 거부한 경우, Node.js 24.6 이상을 사용 중이라면 PowerShell에서 `$env:NODE_USE_SYSTEM_CA = '1'`을 설정하면 Windows가 신뢰하는 인증서도 사용할 수 있습니다. 이 설정에는 조직이 설치한 인증서도 포함되므로, 해당 네트워크에서 API 키와 리뷰 자료를 전송할 때는 조직 정책을 따르세요. 같은 셸에서 진단을 다시 실행해 연결을 확인하세요. 이 진단은 모델 메타데이터만 조회합니다. [Node.js `NODE_USE_SYSTEM_CA`](https://nodejs.org/download/release/v24.22.2/docs/api/cli.html#node_use_system_ca1)

Claude Code CLI는 이 PowerShell에서 시작하면 설정을 상속합니다. Codex CLI에서 같은 인증서 저장소를 사용하려면 Codex 설정 파일(기본값 `%USERPROFILE%\.codex\config.toml`)의 `[mcp_servers.rebut.env]` 섹션에 `NODE_USE_SYSTEM_CA = "1"`을 추가하고 Codex를 다시 시작하세요. Rebut을 다시 등록하면서 이 항목이 지워지면 다시 추가하세요.

다음에 사용할 때도 같은 `REBUT_CONFIG_DIR`을 지정하세요. 요청과 사용량은 그 아래 `local\ledger.sqlite`에 기록됩니다. 결과가 불확실하면 같은 `REBUT_CONFIG_DIR`을 지정한 셸에서 원래 ID로 `rebut.cmd status REQUEST_ID`를 실행하세요. [복구 절차](operations.md#unknown-복구)를 참고하세요.

## 로컬 MCP

macOS Keychain을 사용하는 새 설치:

```sh
npm install -g rebut-mcp
rebut set api-key
rebut setup --client codex
rebut doctor --connect
```

호스트를 재시작하면 로컬 stdio 서버가 실행됩니다. Cloudflare나 별도 HTTP 서버는 필요 없습니다. 검토 자료는 자신의 키로 OpenAI API에 전송합니다. `doctor --connect`는 키 사용 가능 여부와 MCP 도구를 확인하며 모델을 호출하거나 API 계정 권한을 검증하지 않습니다.

기존 endpoint가 있으면 Worker 모드를 유지합니다. 로컬로 바꾸려면 `rebut set mode local` 후 키를 설정하고 등록을 갱신하세요. 백엔드를 바꿔도 기존 요청·사용량 기록과 예약은 새 백엔드로 옮겨지지 않습니다.

다른 자격증명 방식:

| 방식                  | 설정                                 | 로컬 OpenAI 키                                             |
| --------------------- | ------------------------------------ | ---------------------------------------------------------- |
| Keychain (macOS 기본) | `rebut set secret-store keychain`    | `rebut set api-key` 숨김 입력                              |
| 환경변수 (Linux 기본) | `rebut set secret-store env`         | 실제 MCP 호스트 환경의 `REBUT_OPENAI_API_KEY`              |
| Vaultwarden           | `rebut set secret-store vaultwarden` | `bw-get` 준비 후 `rebut set vaultwarden-api-key-item NAME` |

Vaultwarden은 항목명을 인자로 받아 비밀 값을 stdout으로 반환하는 `bw-get` 실행 파일과 기존 로그인이 필요합니다. 실행 경로는 MCP 호스트 환경의 `REBUT_BW_GET`로 지정할 수 있습니다.

키·토큰을 CLI 인자나 추적 파일에 넣지 마세요. env 등록에는 변수명만 기록합니다. `OPENAI_API_KEY`를 공유하려면 `rebut set api-key-env OPENAI_API_KEY`로 명시해야 하며 자동 대체하지 않습니다. 역할별 항목은 [설정](configuration.md)에 있습니다.

## Codex 등록과 업데이트

```sh
npm install -g rebut-mcp
rebut setup --client codex --replace
rebut doctor --connect
```

등록은 `CODEX_HOME` 또는 `~/.codex`를 사용합니다. 별도 경로는 `--codex-home PATH`를 지정하세요. `setup --replace` 전 `config.toml`을 백업하고, 사용자 지정 `REBUT_CONFIG_DIR`은 setup을 실행하는 셸에도 같은 값으로 제공하세요. 등록 갱신 뒤 호스트를 재시작해야 합니다. 실행 중인 프로세스는 설정을 다시 읽지 않습니다.

0.2.x → 0.3.0 Worker 업데이트는 **기존 OpenAI 설정을 유지해 Worker 코드 먼저 → CLI·등록·호스트 재시작 → Claude 키·프로필 추가** 순서입니다. 0.1.x 사용자는 먼저 CLI를 0.2.x로 올려 긴 대기 제한을 적용하세요. 공급자/HTTP 클라이언트/Codex 도구 제한은 각각 1,800/1,830/1,860초이며 네트워크·호스트의 연결 유지를 보장하지 않습니다. 다른 호스트도 긴 검토를 지원하는 제한을 설정해야 합니다.

등록 제거는 `rebut remove --client codex`입니다. 설정, 키, 요청·사용량 기록은 남습니다. 백업·다운그레이드는 [운영](operations.md)을 따르세요.

## 검토 실행

```sh
umask 077
rebut collect --root /path/to/project --request-id review-001 --requirements 'AC-1: 정렬 순서 유지. AC-2: 빈 결과 보존.' --profile astra-medium -- src/example.ts > /protected/path/review-001.bundle.json
```

이슈나 명세에서 사람이 승인한 수락 기준을 사용합니다. 가능하면 구현 전에 그 버전을 패치와 별도로 고정합니다. 패치를 판단하는 데 필요한 파일을 선택하고, 작성자 요약은 기본적으로 `requirements`에서 제외합니다.

제출하기 전에 고정한 버전이 이번 리뷰에 여전히 적용되는지 확인하고, 번들에서 마스킹된 실제 `requirements`를 승인본과 대조합니다. Rebut은 제출한 내용이 함께 제출한 해시와 일치하는지 확인합니다. 누가 기준을 승인했는지나 누락된 항목이 있는지는 알 수 없습니다. 기준 수정으로 범위가 달라지거나 마스킹으로 의미가 바뀌면 제출 전에 기준을 승인한 사람에게 확인합니다.

이 예시에서는 AC-1과 AC-2 모두를 판단할 근거가 필요합니다. AC-2나 이를 판단할 코드·테스트가 빠졌다면, 지적이 없어도 AC-2는 판단하지 못한 항목으로 봅니다. 승인된 기준이 없거나 서로 충돌하면 먼저 기준을 확정하거나 일반 결함 검토로 범위를 좁힙니다. 지적이 없다는 결과만으로 수락 기준을 충족했다거나 병합이 승인됐다고 판단하지 않습니다.

```sh
rebut review < /protected/path/review-001.bundle.json
rebut status review-001
```

번들에 식별할 수 있는 기준이 있으면, 지적이 없어도 리뷰어에게 어떤 기준을 판단했는지 근거와 함께 요약하도록 요청합니다. 예를 들어 `summary`에는 “AC-1: src/example.ts:12–16의 정렬 코드를 검토했고 근거가 있는 지적은 없음. AC-2: 미평가.”라고 적을 수 있습니다. `additional_evidence`에는 빈 결과를 처리하는 코드 경로나 관련 테스트를 요청합니다.

보고서를 승인된 기준 및 근거와 대조하세요. 번들이나 보고서에서 빠졌거나 인용한 근거로 판단하기 어려운 항목은 미평가로 남깁니다. 모델의 요약은 사람이 근거를 대조할 때 참고하세요. 수락과 병합은 기존 승인 절차를 따릅니다.

검토에 필요한 파일을 직접 지정하세요. 수집기는 위험 파일, 심볼릭 링크, FIFO, 바이너리를 거부하고 흔한 비밀 패턴을 마스킹합니다. 보내기 전에 번들을 확인하세요. `review`는 공급자 API를 호출하므로 비용이 발생할 수 있습니다. `status`는 메타데이터만 조회합니다. 나중에 리뷰 본문을 다시 받을 수 없으니 최초 응답을 저장하세요.

`review`는 사용자가 검토를 명시적으로 요청한 경우에만 실행하세요. 응답이 `completed`인지 확인한 뒤 모델과 입력 해시를 번들 및 프로필과 대조하고 각 지적을 원본에서 확인합니다. 독립 리뷰에는 같은 자료를 보내고 서로의 결과는 전달하지 마세요. 시간이 초과되거나 결과가 `unknown`이면 새 ID로 재시도하지 말고 같은 백엔드에서 기존 ID로 상태를 조회하세요. 자세한 내용은 [복구 절차](operations.md#unknown-복구)를 참고하세요.

### 두 프로필로 독립 리뷰하기

Codex나 Claude Code에서 사용자가 API 비용이 드는 두 프로필 검토를 명시적으로 요청하면 `review_pair`를 사용하세요. 공급자 API를 호출한 요청마다 요금이 적용됩니다. `first`에는 수집한 스키마 2 번들 전체를 넣고, `second`에는 별도의 `request_id`와 두 번째 `profile`, 해당 프로필의 `provider`를 넣습니다. 예를 들어 `first`를 `astra-medium` / `openai`로 수집했다면 `second`에 `{"request_id":"review-002","profile":"claude-medium","provider":"anthropic"}`을 전달할 수 있습니다. 두 프로필의 실제 설정은 `rebut profile list`에서 확인합니다.

두 요청은 같은 검토 자료를 사용하고 각 공급자에 맞춰 입력 해시를 고정합니다. 각 요청에 예산과 동시 실행 한도가 적용되므로 한쪽만 접수될 수 있습니다. 로컬에서 병렬 리뷰를 쓰려면 `rebut set max-concurrent 2`를 실행하고 MCP 호스트를 다시 시작합니다. 기본 한도는 1이며, 로컬 한도가 2보다 작으면 두 요청을 전송하기 전에 거부합니다. 두 결과에는 각 요청 ID와 `has_review`가 표시됩니다. 본문이 하나면 `partial`, 둘 다 없으면 `incomplete`입니다. 두 요청이 모두 이미 완료됐고 본문을 다시 받을 수 없으면 `completed_without_review`입니다. 응답이 끊기면 같은 백엔드에서 원래 두 ID로 `review_status`를 조회한 뒤에 API 호출을 더 할지 판단합니다. 상태 조회로 결과 본문을 다시 받을 수 없습니다.

이 도구는 로컬과 Worker 모드의 Rebut 클라이언트에서 제공됩니다. 기존 Codex 등록은 `rebut setup --client codex --replace`로 갱신하고 호스트를 다시 시작하세요. Claude Code는 호스트를 다시 시작해 도구 목록을 갱신하세요. 로컬에서 서로 다른 공급자를 쓰려면 Rebut 프로세스가 두 키에 모두 접근할 수 있어야 합니다. 환경변수 방식의 호스트 등록은 기본적으로 선호 공급자의 변수만 전달합니다.

## 선택적 Worker 배포

여러 기기에서 예산과 요청 기록을 공유할 때 사용합니다. 소스 체크아웃과 자신의 Cloudflare 계정·D1이 필요합니다.

1. 소스를 체크아웃해 `npm ci --ignore-scripts`를 실행합니다. `wrangler.jsonc`를 무시되는 `wrangler.private.json`으로 복사하고 계정·Worker 이름·호스트 설정을 자신의 값으로 바꿉니다.
2. `npx wrangler d1 create rebut-ledger --config wrangler.private.json`으로 D1을 생성하고 비공개 설정의 `DB` 바인딩에 ID를 넣습니다.
3. `npx wrangler d1 migrations apply rebut-ledger --remote --config wrangler.private.json`으로 기존 `0001`·`0002`를 적용합니다. 업그레이드는 같은 D1과 요청 행을 유지합니다.
4. `npx wrangler deploy --config wrangler.private.json`으로 배포합니다. 설정 전에는 503을 반환합니다.
5. `npx wrangler secret put NAME --config wrangler.private.json`의 대화형 입력으로 아래 시크릿을 저장합니다. 값을 인자에 넣지 마세요.

| Worker 시크릿        | 내용                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`     | 자신의 공급자 키                                                                      |
| `REBUT_CONFIG`       | [예시 설정](../../../config.example.json)의 JSON. `hostname`은 실제 엔드포인트 호스트 |
| `AUTH_TOKENS`        | 안정적인 인증 주체 ID → 별도 무작위 256비트 bearer의 SHA-256 다이제스트 매핑          |
| `ADMIN_TOKEN_SHA256` | 프로필 관리가 필요할 때 별도 관리자 bearer의 SHA-256 다이제스트                       |

원본 bearer는 자격증명 저장소에 보관합니다. 검토·관리자 토큰을 구분하고, 토큰 교체 때 인증 주체 ID는 유지하세요. 이 방식은 Bearer 인증이며 OAuth를 구현하지 않습니다.

클라이언트 설정(macOS):

```sh
rebut set endpoint https://YOUR_HOST/mcp
rebut set token
rebut setup --client codex --replace
rebut doctor --connect
```

endpoint 설정은 Worker 모드를 선택합니다. 로컬 OpenAI 키 대신 Worker 접속 토큰을 사용합니다. 환경변수·Vaultwarden 항목과 관리자 토큰은 [설정](configuration.md)을 참고하세요. Worker 배포는 npm 업데이트와 별도입니다.

## Claude API와 Claude Code — 0.3.0

0.3.0 이상에서 검토 공급자와 MCP 호스트를 별도로 선택합니다. 다음은 로컬·macOS Keychain 예시입니다.

```sh
rebut set mode local
rebut set provider anthropic
rebut set api-key
rebut setup --client claude
rebut doctor --connect
```

명령으로 공급자를 바꿀 때 기본 프로필을 선택하고 모델/추론 오버라이드를 지웁니다. 같은 공급자를 다시 선택하면 유지합니다. 기존 OpenAI 키와 프로필, 요청·사용량 기록은 남습니다.

Claude Code를 종료한 뒤 설정 파일을 백업하고 등록하세요. 사용자 범위의 `~/.claude.json`에서 Rebut 항목만 갱신합니다. 다른 파일은 `--claude-config PATH`로 명시하며 `CLAUDE_CONFIG_DIR`이 있으면 이 옵션이 필요합니다. 기존 다른 Rebut 등록은 `--replace`로만 교체합니다. 프로젝트/관리 설정이 같은 이름을 가리면 별도로 확인하세요. 등록 파일은 0600으로 원자적 교체하며 ACL/xattr는 보존하지 않습니다. 등록 후 Claude Code를 재시작해 `/mcp`에서 확인합니다.

환경변수는 `rebut set secret-store env`와 실제 호스트의 `REBUT_ANTHROPIC_API_KEY`를 사용합니다. Claude Code 자체 인증을 바꾸지 않도록 공유 `ANTHROPIC_API_KEY` 선택은 지원하지 않습니다. Keychain·Vaultwarden은 별도 env 키를 등록하지 않습니다. env setup도 프로필 조회 시 로컬 SQLite를 초기화할 수 있습니다. env 등록은 현재 기본 프로필의 공급자 변수를 전달합니다. 다른 공급자의 고정 번들에 필요한 env 키가 없으면 예약 전에 실패합니다. 프로필을 조회해 선택한 공급자는 `doctor`의 `provider`에 표시됩니다. 프로필을 확인하지 않았거나 확인할 수 없으면 공통 공급자 설정을 표시합니다. `--client`로 지정한 호스트에 기본값이 있으면 이 경우 `provider`를 생략합니다. `keyConfigurationProvider`는 `set api-key`가 사용하는 공급자입니다. 공급자·백엔드·env 변경 뒤에는 사용하는 각 호스트에 `setup --replace`를 다시 실행하고 재시작하세요.

선택 사항인 `rebut doctor --provider`는 로컬 키로 모델 메타데이터만 조회하며 생성·검토 예약·사용량 기록을 추가하지 않습니다. 프로필 조회 과정에서 로컬 SQLite를 초기화할 수 있습니다. `doctor --connect`는 계속 MCP 연결 확인용입니다. 메타데이터 조회 성공은 생성 권한·잔액·geo·구조화 출력·품질을 보장하지 않습니다.
