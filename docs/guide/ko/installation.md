# 설치 및 입력 수집

**한국어** · [English](../en/installation.md) · [简体中文](../zh-CN/installation.md) · [日本語](../ja/installation.md)

[Rebut](../../../README.md) · [사용자 가이드](../ko.md)

## npm CLI 설치

Node.js **24 이상**과 npm을 사용합니다. 직접 호스팅한 Worker의 클라이언트·stdio 브리지를 설치합니다.

```sh
npm install -g rebut-mcp
```

## 클라이언트 설정

자신의 엔드포인트를 설정한 뒤 bearer 토큰을 저장합니다. macOS 기본값은 Keychain이며 `rebut set token`은 입력을 숨기는 프롬프트를 사용합니다. `rebut set token --stdin`은 보호된 파이프 입력을 명시적으로 받습니다. 토큰 값을 인자나 추적되는 파일에 넣지 마세요.

```sh
rebut set endpoint https://YOUR_HOST/mcp
rebut set token
```

기존 Vaultwarden 설치를 사용하려면 백엔드를 명시적으로 선택합니다. `bw-get`과 기본 항목 `Rebut — MCP Access Token`을 사용하며 필요하면 항목명을 변경합니다.

```sh
rebut set secret-store vaultwarden
rebut set vaultwarden-item NAME
```

macOS 외 환경에서는 `env`를 명시적으로 선택하고 안전한 실행 환경으로 `REBUT_TOKEN`을 제공합니다. 추적되는 파일이나 명령 인자에 쓰지 마세요. 백엔드는 자동으로 대체되지 않습니다. 클라이언트에는 OpenAI 공급자 키가 필요하지 않습니다.

`env` 백엔드에서 Codex 설정은 값 없이 변수명만 `env_vars = ['REBUT_TOKEN']`로 저장합니다. 토큰은 실제 Codex 호스트의 안전한 실행 환경에 제공해야 합니다. 설정 명령에만 제공한 환경 변수는 이후 Codex 세션에 전달되지 않습니다.

```sh
rebut set secret-store env
```

## Codex 연결 및 설정 확인

```sh
rebut setup --client codex
rebut doctor
rebut doctor --connect
```

설정은 `CODEX_HOME` 또는 `~/.codex`를 사용하며 `--codex-home PATH`로 경로를 명시할 수 있습니다. `rebut mcp`를 stdio 서버로 등록하고 다른 MCP 항목을 보존합니다. 기존 비공개 `rebut` 브리지를 이전하려면 `--replace`가 필요합니다.

`rebut doctor`는 민감한 값을 제거한 로컬 설정과 자격증명 사용 가능 여부를 표시합니다. `rebut doctor --connect`는 무료 원격 `tools/list` 확인을 수행합니다. 두 명령 모두 유료 검토를 시작하지 않습니다.

## 소스 체크아웃 및 개발자 검증

npm 패키지는 호스팅된 검토 서비스가 아닌 클라이언트입니다. Worker/D1은 GitHub 소스 체크아웃에서 Workers/D1 권한이 있는 자신의 Cloudflare 계정과 OpenAI Responses API 키로 배포합니다. 공개 소스/npm은 개인 Worker나 크레딧 접근 권한을 주지 않습니다. 패키지에는 실제 엔드포인트, 비공개 설정, bearer, 공급자 키, 검토 본문이 포함되지 않습니다. 이 안내는 CLI `0.1.0`을 대상으로 합니다.

```sh
npm ci
npm run typecheck
npm run build
npm test
```

테스트는 합성 입력, 모의 공급자 응답, 실제 SQLite 문, 로컬 Workers/D1 런타임을 사용합니다. `npm test`에는 `npm run build`로 만든 Worker 번들이 필요합니다. 자동화 테스트는 유료 모델을 호출하지 않습니다. 별도로 수행한 Luna 스모크 테스트는 [검증 기록](validation.md)을 참고하세요.

## 검토 입력 고정

소스 파일을 명시적인 허용 목록으로 지정하고 전체 저장소를 자동 수집하지 마세요. 수집기는 고정 JSON을 표준 출력으로 내보냅니다. 기본 프로필은 `astra-medium`이며 실제 API 테스트에는 `luna-test`를 명시해야 합니다.

```sh
umask 077
rebut collect --root /path/to/project --request-id request-001 --requirements 'Check that the supplied function preserves its input' --profile astra-medium -- src/example.ts > /protected/path/request-001.bundle.json
```

수집기는 심볼릭 링크, FIFO, 비밀정보 파일명, 바이너리 파일, 크기 한도를 넘는 자료를 거부합니다. 흔히 식별할 수 있는 비밀정보 패턴을 제거하면서 행 번호를 보존합니다. 패턴 기반 마스킹은 불완전하므로 전송 전에 생성된 번들을 확인하세요. 파일을 행 번호가 있는 코드 조각으로 제공하거나 unified diff를 직접 제공할 수도 있습니다. 정규화 해시와 한도는 [설정](configuration.md)에서 설명합니다.

## 비공개 배포

1. `wrangler.jsonc`를 Git에서 무시하는 `wrangler.private.json`으로 복사합니다. 자신의 계정 ID, 사용 가능한 Worker 이름, 실제 D1 ID, `workers_dev:true` 또는 자신의 경로를 설정합니다. `npx wrangler d1 create rebut-ledger`로 전용 D1 데이터베이스를 만들고 비공개 설정에 해당 ID를 지정합니다.
2. `npx wrangler d1 migrations apply rebut-ledger --remote --config wrangler.private.json`을 적용합니다.
3. `npx wrangler deploy --config wrangler.private.json`으로 배포합니다. 설정되지 않은 Worker는 503을 반환하며 공급자를 호출할 수 없습니다.
4. Workers Secrets에 `OPENAI_API_KEY`, `REBUT_CONFIG`, `AUTH_TOKENS` 세 가지를 저장합니다. Wrangler의 대화형 시크릿 프롬프트 또는 보호된 표준 입력을 통한 `secret bulk`를 사용하세요. 시크릿 값을 인자나 추적되는 파일에 넣지 마세요. `REBUT_CONFIG`는 [`config.example.json`](../../../config.example.json)의 구조를 사용하며, `hostname`을 정확한 엔드포인트 호스트명으로 변경합니다. `AUTH_TOKENS`는 안정적인 인증 주체 ID를 서로 독립적으로 생성한 무작위 256비트 bearer 토큰의 SHA-256 다이제스트에 매핑하는 JSON 객체입니다. 원본 토큰은 비밀번호 관리자에 저장하세요. 같은 토큰을 쓰는 클라이언트는 인증 주체을 공유하며, 서로 다른 토큰은 요청·상태 접근을 격리합니다.
5. Bearer 헤더를 지원하는 MCP 클라이언트를 `https://YOUR_HOST/mcp`에 연결하고 `tools/list`를 확인합니다. 도구 실행 전에 Host 및 브라우저 Origin 검증이 적용됩니다. 이 bearer 설정은 OAuth 검색이 필요한 클라이언트를 위한 OAuth를 구현하지 않습니다.

## 소유자 프로필 관리를 위한 일회성 업그레이드

동적 프로필에는 소스 체크아웃의 Worker를 한 번 업그레이드하고 D1 마이그레이션 `0002`와 Worker 시크릿 `ADMIN_TOKEN_SHA256`을 적용해야 합니다. 원장을 보존하며 기존 D1에 대기 중인 마이그레이션을 적용한 뒤 비공개 설정으로 업그레이드한 Worker를 배포합니다. 별도의 무작위 256비트 관리자 bearer를 생성하고 보호된 대화형 시크릿 프롬프트로 SHA-256 해시를 `ADMIN_TOKEN_SHA256`에 저장합니다. 원본 bearer는 자격증명 저장소에 보관하세요. 검토 bearer를 재사용하거나 기존 인증 주체 ID를 바꾸지 마세요. 이 일회성 설정 후 CLI 프로필 변경은 Worker 재빌드·재배포나 npm 업그레이드 없이 D1에 기록합니다.

`rebut set admin-token`의 숨김 입력으로 소유자 bearer를 저장하거나 보호된 파이프에서 `rebut set admin-token --stdin`을 명시적으로 사용합니다. 선택한 Vaultwarden 백엔드의 기본 관리자 항목은 `Rebut — MCP Admin Token`이며 `rebut set vaultwarden-admin-item NAME`으로 변경합니다. env 백엔드는 안전한 실행 환경의 `REBUT_ADMIN_TOKEN`을 사용하며 Codex에 전달하지 않습니다. Keychain 서비스 `com.abruption.rebut`는 검토 계정 `codex-mcp-bearer`와 관리자 계정 `codex-mcp-admin`을 분리합니다. 백엔드는 자동으로 대체되지 않습니다. 모델 환경설정, 조회, 명시적 가격, 리비전을 확인하는 수정·제거는 [설정](configuration.md)을 참고하세요.

## 클라이언트 실행

`rebut review`는 표준 입력으로 JSON 번들을 받아 사용자가 명시적으로 선택한 경우에만 유료 검토를 시작합니다. `rebut status REQUEST_ID`는 무료 메타데이터 조회입니다.

```sh
rebut review < /protected/path/request-001.bundle.json
rebut status request-001
```

서버는 메타데이터만 저장하므로 최초 응답을 제한적인 권한으로 로컬에 보존하세요. 시간 초과나 불확실한 결과 뒤에는 같은 요청 ID를 유지합니다. 공급자 대기 제한은 1,800초(30분)입니다. MCP HTTP 클라이언트는 1,830초, Codex의 `tool_timeout_sec`는 1,860초로 설정해 결과 기록과 전송 시간을 확보합니다. 시작·연결 확인 제한은 별도로 짧게 유지합니다. 변경된 Worker와 CLI를 함께 업데이트하고 `rebut setup --client codex --replace`로 기존 등록을 갱신한 뒤 Codex를 재시작하세요. 기존 0.1.0 CLI의 제한은 설정 파일만 수정해도 바뀌지 않습니다. [선택적 검토 작업 흐름](reviewer-integration.md)을 참고하세요.

## 업그레이드 또는 제거

배포를 업그레이드하거나 제거하기 전에 [운영 가이드](operations.md)에 따라 D1 원장을 보존하고 대기 중인 실행을 대조하여 정리하세요. 소스 공개와 개인 유료 배포는 별개의 작업입니다.

업데이트 순서는 **CLI 설치 → 기존 옵션을 보존해 Codex 등록 갱신 → Codex/MCP 재시작 → Worker 배포**입니다. Worker를 먼저 늘리면 구 CLI가 65초에 연결을 끊을 수 있습니다. 사용자 지정 `REBUT_CONFIG_DIR` 등 기존 등록 옵션을 유지하세요. Node HTTP 전송 계층의 헤더·본문 제한도 MCP 도구 제한에 맞춥니다. 30분은 애플리케이션 상한이며 모든 네트워크·호스트가 30분 연결을 보장한다는 뜻은 아닙니다. 절전·종료·연결 단절로 실행이 중단되면 `reserved` 또는 `unknown` 예약이 남을 수 있습니다. 같은 요청 ID로 확인하며 자동 재실행하거나 예약을 해제하지 않습니다.
