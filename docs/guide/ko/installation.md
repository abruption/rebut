# 설치 및 입력 수집

**한국어** · [English](../en/installation.md) · [简体中文](../zh-CN/installation.md) · [日本語](../ja/installation.md)

[Rebut](../../../README.md) · [사용자 가이드](../ko.md)

## 요구 사항 및 로컬 검증

Node.js **24 이상**, npm, Workers/D1 권한이 있는 Cloudflare 계정, Responses API 접근 권한이 있는 자신의 OpenAI 키를 사용합니다. 소스 체크아웃에서 설치하며, 이 안내는 npm 패키지 배포나 공개 저장소를 요구하지 않습니다.

```sh
npm ci
npm run typecheck
npm run build
npm test
```

테스트는 합성 입력, 모의 공급자 응답, 실제 SQLite 문, 로컬 Workers/D1 런타임을 사용합니다. `npm test`에는 `npm run build`로 만든 Worker 번들이 필요합니다. 자동화 테스트는 유료 모델을 호출하지 않습니다. 별도로 수행한 Luna 스모크 테스트는 [검증 기록](validation.md)을 참고하세요.

## 검토 입력 고정

소스 파일을 명시적인 허용 목록으로 지정하세요. 전체 저장소를 자동 수집하지 마세요. Rebut 체크아웃에서 명령을 실행합니다.

```sh
umask 077
npm run --silent collect -- /path/to/project request-001 'Check that the supplied function preserves its input' src/example.ts > /protected/path/request-001.bundle.json
```

수집기는 심볼릭 링크, FIFO, 비밀정보 파일명, 바이너리 파일, 크기 한도를 넘는 자료를 거부합니다. 흔히 식별할 수 있는 비밀정보 패턴을 제거하면서 행 번호를 보존합니다. 패턴 기반 마스킹은 불완전하므로 전송 전에 생성된 번들을 확인하세요. 파일을 행 번호가 있는 코드 조각으로 제공하거나 unified diff를 직접 제공할 수도 있습니다. 정규화 해시와 한도는 [설정](configuration.md)에서 설명합니다.

## 비공개 배포

1. `wrangler.jsonc`를 Git에서 무시하는 `wrangler.private.json`으로 복사합니다. 자신의 계정 ID, 사용 가능한 Worker 이름, 실제 D1 ID, `workers_dev:true` 또는 자신의 경로를 설정합니다. `npx wrangler d1 create rebut-ledger`로 전용 D1 데이터베이스를 만들고 비공개 설정에 해당 ID를 지정합니다.
2. `npx wrangler d1 migrations apply rebut-ledger --remote --config wrangler.private.json`을 적용합니다.
3. `npx wrangler deploy --config wrangler.private.json`으로 배포합니다. 설정되지 않은 Worker는 503을 반환하며 공급자를 호출할 수 없습니다.
4. Workers Secrets에 `OPENAI_API_KEY`, `REBUT_CONFIG`, `AUTH_TOKENS` 세 가지를 저장합니다. Wrangler의 대화형 시크릿 프롬프트 또는 보호된 표준 입력을 통한 `secret bulk`를 사용하세요. 시크릿 값을 인자나 추적되는 파일에 넣지 마세요. `REBUT_CONFIG`는 [`config.example.json`](../../../config.example.json)의 구조를 사용하며, `hostname`을 정확한 엔드포인트 호스트명으로 변경합니다. `AUTH_TOKENS`는 안정적인 인증 주체 ID를 서로 독립적으로 생성한 무작위 256비트 bearer 토큰의 SHA-256 다이제스트에 매핑하는 JSON 객체입니다. 원본 토큰은 비밀번호 관리자에 저장하세요. 같은 토큰을 쓰는 클라이언트는 인증 주체을 공유하며, 서로 다른 토큰은 요청·상태 접근을 격리합니다.
5. Bearer 헤더를 지원하는 MCP 클라이언트를 `https://YOUR_HOST/mcp`에 연결하고 `tools/list`를 확인합니다. 도구 실행 전에 Host 및 브라우저 Origin 검증이 적용됩니다. 이 bearer 설정은 OAuth 검색이 필요한 클라이언트를 위한 OAuth를 구현하지 않습니다.

## 클라이언트 실행

포함된 클라이언트는 `list`, `status REQUEST_ID`, 또는 표준 입력으로 JSON 번들을 받는 `review`를 지원합니다. `REBUT_ENDPOINT`와 `REBUT_TOKEN`은 안전한 환경을 통해 제공합니다. 토큰 값을 명령이나 추적되는 파일에 붙여 넣지 마세요.

```sh
npm run client -- list
npm run client -- review < /protected/path/request-001.bundle.json
npm run client -- status request-001
```

선택 사항인 [Vaultwarden 래퍼 및 검토자 작업 흐름](reviewer-integration.md)은 bearer 토큰을 메모리에서 가져옵니다. 클라이언트에는 OpenAI 공급자 키가 필요하지 않습니다. 최초 응답을 제한적인 권한으로 로컬에 저장하세요. 서버는 메타데이터만 저장하므로 검토 본문을 다시 제공할 수 없습니다. MCP 클라이언트 제한 시간은 60초보다 길게 설정하세요. 공급자 호출의 제한 시간은 45초입니다.

## 업그레이드 또는 제거

배포를 업그레이드하거나 제거하기 전에 [운영 가이드](operations.md)에 따라 D1 원장을 보존하고 대기 중인 실행을 대조하여 정리하세요. 소스 공개와 개인 유료 배포는 별개의 작업입니다.
