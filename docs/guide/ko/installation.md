# 설치와 사용

**한국어** · [English](../en/installation.md) · [简体中文](../zh-CN/installation.md) · [日本語](../ja/installation.md)

[README](../../../README.md) · [설정](configuration.md) · [운영](operations.md)

Node.js 24 이상이 필요합니다. macOS/Linux를 검증하며 Windows 동작·ACL은 미검증입니다.

## 로컬 MCP

macOS Keychain을 사용하는 새 설치:

```sh
npm install -g rebut-mcp
rebut set api-key
rebut setup --client codex
rebut doctor --connect
```

호스트를 재시작하면 로컬 stdio 서버가 실행됩니다. Cloudflare나 별도 HTTP 서버는 필요 없습니다. 검토 자료는 자신의 키로 OpenAI API에 전송합니다. `doctor --connect`는 키 사용 가능 여부와 MCP 도구를 확인하며 유료 검토나 API 계정 권한 검증은 하지 않습니다.

기존 endpoint가 있으면 Worker 모드를 유지합니다. 로컬로 바꾸려면 `rebut set mode local` 후 키를 설정하고 등록을 갱신하세요. 백엔드 전환은 장부를 이전하지 않습니다.

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

Worker 사용자의 업데이트 순서는 **CLI → 등록 → 호스트 재시작 → Worker**입니다. 공급자/HTTP 클라이언트/Codex 도구 제한은 각각 1,800/1,830/1,860초이며 네트워크·호스트의 연결 유지를 보장하지 않습니다. 다른 호스트도 긴 검토를 지원하는 제한을 설정해야 합니다.

등록 제거는 `rebut remove --client codex`입니다. 설정·키·장부는 삭제하지 않습니다. 백업·다운그레이드는 [운영](operations.md)을 따르세요.

## 검토 실행

```sh
umask 077
rebut collect --root /path/to/project --request-id review-001 --requirements 'Check the supplied code' --profile astra-medium -- src/example.ts > /protected/path/review-001.bundle.json
rebut review < /protected/path/review-001.bundle.json
rebut status review-001
```

파일은 명시적으로 선택합니다. 수집기는 위험 파일·심볼릭 링크·FIFO·바이너리를 거부하고 흔한 비밀 패턴을 마스킹하지만, 전송 전 번들을 직접 확인해야 합니다. `review`는 유료 호출이며 `status`는 메타데이터 조회입니다. 최초 응답을 보관하세요. 본문은 재조회할 수 없습니다.

유료 검토는 명시적으로 선택합니다. 응답이 `completed`인지 확인하고 모델·입력 해시를 고정 번들·프로필과 대조한 뒤 각 지적을 원본에서 확인하세요. 독립 리뷰에는 같은 고정 자료를 제공하고 서로의 결과를 섞지 마세요. timeout/unknown 뒤에는 같은 ID·백엔드를 유지하며 새 ID로 다시 호출하지 않습니다. [복구 절차](operations.md#unknown-복구)를 따르세요.

## 선택적 Worker 배포

여러 기기가 예산·요청 장부를 공유할 때 사용합니다. 소스 체크아웃과 자신의 Cloudflare 계정·D1이 필요합니다.

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
