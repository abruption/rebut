<div align="center">

# Rebut

**OpenAI Responses API를 통한 독립적이고 근거에 기반한 검토.**

**한국어** · [English](README.en.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

**명시적으로 제공한 고정 자료를 검토하는 인증 기반 Cloudflare Worker MCP.**

</div>

Rebut은 **명시적으로 선택하여 사용하는 검토 도구**입니다. 기존 Claude/Gemini 작업 흐름을 대체하거나 검토자 세 명을 자동으로 호출하지 않습니다. MIT 라이선스로 제공되며, 자신의 Cloudflare 계정과 OpenAI 키로 배포합니다. 소스 공개와 개인 유료 배포는 별개의 작업입니다.

## 빠른 시작

**Node.js 24 이상**이 필요합니다. npm CLI를 설치하고 직접 배포한 Worker를 설정합니다.

```sh
npm install -g rebut
rebut set endpoint https://YOUR_HOST/mcp
rebut set token
rebut setup --client codex
rebut doctor
rebut doctor --connect
```

macOS에서 `rebut set token`은 입력을 숨기는 대화형 프롬프트로 bearer를 받아 기본 Keychain에 저장합니다. 토큰을 인자로 전달하지 마세요. 명시적인 Vaultwarden/env 백엔드와 Codex 마이그레이션 옵션은 [설치 안내](docs/guide/ko/installation.md)를 참고하세요.

`rebut`(초기 CLI 버전 `0.1.0`, 실행 명령 `rebut`)는 **직접 호스팅한 Worker**의 클라이언트이자 stdio 브리지입니다. Worker/D1은 GitHub 소스 체크아웃에서 자신의 Cloudflare 계정과 OpenAI 키로 배포합니다. 공개 소스나 npm 패키지는 개인 Worker 또는 크레딧 접근 권한을 주지 않습니다. 패키지에는 실제 엔드포인트, 비공개 설정, bearer, 공급자 키, 검토 본문이 포함되지 않습니다. 이 안내는 CLI `0.1.0`을 대상으로 합니다.

개발자 검증은 소스 체크아웃에서 수행합니다.

```sh
npm ci
npm run typecheck
npm run build
npm test
```

자동화 테스트는 공급자를 모의 처리하며 유료 모델을 호출하지 않습니다. 실제 API 테스트에는 **gpt-6-luna**, 운영에는 **gpt-6-astra / medium**을 사용합니다. Luna 결과로 Astra의 사용 가능 여부나 동등한 검토 품질을 입증할 수는 없습니다. Worker 배포에는 D1과 `OPENAI_API_KEY`, `REBUT_CONFIG`, `AUTH_TOKENS` 시크릿이 필요합니다. [설치 및 비공개 배포](docs/guide/ko/installation.md)를 따르세요.

`rebut set model MODEL_ID`, `rebut set reasoning EFFORT`, `rebut set profile PROFILE_ID`로 로컬 기본값을 선택합니다. 새 수집에서 서버 허용 목록의 프로필을 찾으며 명시적인 `collect --profile`이 우선하고 `review`는 고정 번들의 프로필을 유지합니다. 환경설정이 없으면 `astra-medium`입니다. `rebut profile list`는 공급자 호출 없이 인증된 서버 모델·요금 메타데이터를 조회합니다. 소유자는 일회성 Worker 업그레이드, 마이그레이션 `0002`, 별도 관리자 자격증명 설정 뒤 D1에서 프로필을 관리할 수 있습니다. [설정](docs/guide/ko/configuration.md)을 참고하세요.

## 주요 기능

- 명시적으로 허용한 텍스트 소스를 수집하고, 흔한 비밀정보 패턴을 제거한 뒤 고정한 증거 자료의 해시를 계산합니다. 전송 전에 마스킹 결과를 확인하세요.
- 인증, 허용 목록의 프로필, 중복 요청 ID, 배포 전체의 원자적 예산 예약을 확인한 뒤 한도가 설정된 Responses 호출을 한 번 수행합니다.
- 제공한 파일·행 근거, 모델 식별 정보, 토큰 사용량, 예상 비용을 포함한 구조화된 지적 사항을 반환합니다.
- `review`와 메타데이터만 제공하는 `review_status`를 노출합니다. 시간 초과 또는 unknown 이후에도 같은 요청 ID를 유지하세요. 서버는 대체 유료 호출을 자동으로 만들지 않습니다.

예시 한도는 **UTC 기준 하루 $6.66**, **UTC 기준 한 달 $200**, 동시 pending/unknown 요청 한 개, 하루 신규 검토 요청 100개입니다. 원장은 Rebut 사용량을 추적하며 계정 전체의 크레딧 잔액을 추적하지 않습니다. 실행 결과를 알 수 없으면 예약을 유지합니다. 검토 본문은 다시 조회할 수 없으므로 최초 응답을 로컬에 저장하세요.

검토자는 저장소 복제, 임의 URL 가져오기, 명령·테스트 실행, 파일 수정, 풀 리퀘스트 생성을 할 수 없습니다. 소스, 검토 본문, 키는 D1이나 Worker 로그에 저장하지 않습니다. `store:false`는 공급자의 보관 기간이 0임을 보장하지 않습니다.

## 문서

- [사용자 가이드](docs/guide/ko.md)
- [설치 및 입력 수집](docs/guide/ko/installation.md)
- [설정, 예산 및 MCP 계약](docs/guide/ko/configuration.md)
- [운영 및 복구](docs/guide/ko/operations.md)
- [선택적 검토자 연동](docs/guide/ko/reviewer-integration.md)
- [아키텍처](docs/guide/ko/architecture.md)
- [검증 및 결과의 한계](docs/guide/ko/validation.md)
- [MIT 라이선스](LICENSE)
