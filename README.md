<div align="center">

# Rebut

**로컬에서 바로 실행하는 독립 코드 검토 MCP. Cloudflare Worker는 선택 사항입니다.**

**한국어** · [English](README.en.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

</div>

Rebut은 자신의 OpenAI API 키로 실행하는 코드 검토 도구입니다. 새 설치는 로컬 stdio 서버를 사용하며 Cloudflare 계정이나 별도 HTTP 서버가 필요하지 않습니다.

검토 자료는 OpenAI API로 전송하며, 로컬 원장에는 요청·사용량 메타데이터만 저장합니다.

검증 대상은 macOS/Linux이며 Windows 동작·ACL은 확인하지 않았습니다.

## 빠른 시작

Node.js 24 이상이 필요합니다. 다음은 macOS Keychain을 사용하는 예입니다.

```sh
npm install -g rebut-mcp
rebut set api-key
rebut setup --client codex
rebut doctor --connect
```

`rebut set api-key`는 OpenAI API 키를 숨김 입력으로 받아 Keychain에 저장합니다. Linux 등에서는 `rebut set secret-store env`를 선택하고 실제 MCP 호스트의 안전한 환경에 `REBUT_OPENAI_API_KEY`를 제공하세요. 설정에는 변수명만 기록하며 키를 인자나 추적 파일에 넣지 않습니다.

## Worker 선택

여러 기기가 하나의 예산과 요청 장부를 공유하려면 직접 호스팅한 Worker를 선택할 수 있습니다. `rebut set endpoint URL`은 Worker 모드를 선택합니다. macOS에서는 `rebut set token`으로 별도의 Worker 접속 토큰을 저장합니다. OpenAI API 키와 접속·관리자 토큰은 서로 다른 자격증명입니다.

```sh
rebut set endpoint https://YOUR_HOST/mcp
rebut setup --client codex --replace
```

기존 endpoint 설정은 Worker 모드로 유지됩니다. `rebut set mode local`로 명시적으로 전환할 수 있으며 장애 시 다른 backend로 자동 대체하지 않습니다. backend 전환은 기존 기록이나 예약을 이전하지 않습니다.

## 주요 기능

- 명시한 파일·diff·요구사항만 수집·마스킹·해시 고정하고 공급자를 한 번 호출합니다.
- 로컬 SQLite 또는 Worker D1에서 원자적 예산 예약과 요청 중복 방지를 적용합니다. 원문·리뷰·키는 장부에 저장하지 않습니다.
- 파일·행 근거, 모델 식별, 사용량, 예상 비용을 포함한 구조화된 검토 결과를 반환합니다.
- `review`와 메타데이터 전용 `review_status`를 제공합니다. unknown 이후 같은 ID를 유지하며 다른 backend로 우회 재실행하지 않습니다.

기본 예시는 UTC 하루 $6.66·월 $200, 동시 pending/unknown 한 건, 하루 신규 요청 100건입니다. **로컬 한도는 해당 기기의 데이터 디렉터리에만 적용**됩니다. 다른 Mac·Worker·외부 API 사용량이나 OpenAI 계정 잔액을 합산하지 않습니다. Worker는 해당 배포의 장부를 공유합니다. 예상 비용은 청구서가 아니며 불확실한 실행의 예약과 슬롯은 유지합니다.

공급자 대기 상한은 30분이며 HTTP/MCP·Codex의 외부 제한도 함께 조정합니다. 로컬 프로필은 OS 소유자가, Worker 프로필은 별도 관리자 인증으로 관리합니다. 자세한 키 설정·모델·예산·Worker 배포는 [설치](docs/guide/ko/installation.md)와 [설정](docs/guide/ko/configuration.md)을 참고하세요.

## 개발 검증

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
npm run test:package
```

자동화 테스트와 패키지 smoke는 공급자를 모의 처리합니다. 기본 실제 API 테스트는 gpt-6-luna, 운영 프로필은 gpt-6-astra / medium이며 Luna 성공으로 Astra 품질을 추론하지 않습니다.

## 문서

- [사용자 가이드](docs/guide/ko.md)
- [설치 및 입력 수집](docs/guide/ko/installation.md)
- [설정, 예산 및 MCP 계약](docs/guide/ko/configuration.md)
- [운영 및 복구](docs/guide/ko/operations.md)
- [선택적 검토자 연동](docs/guide/ko/reviewer-integration.md)
- [아키텍처](docs/guide/ko/architecture.md)
- [검증 및 결과의 한계](docs/guide/ko/validation.md)
- [최초 릴리즈 기록](docs/releases/0.1.0.ko.md) · [0.2.0 릴리즈 후보](docs/releases/0.2.0.ko.md)
- [MIT 라이선스](LICENSE)
