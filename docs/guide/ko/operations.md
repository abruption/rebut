# 운영과 복구

**한국어** · [English](../en/operations.md) · [简体中文](../zh-CN/operations.md) · [日本語](../ja/operations.md)

[README](../../../README.md) · [설치](installation.md) · [설정](configuration.md)

<a id="로컬-복구와-제한된-용량-추가"></a>

## unknown 복구

`reserved`는 실행 중이거나 중단됐을 수 있는 예약, `unknown`은 결과·사용량이 불확실한 실행입니다. 둘 다 과금됐을 수 있으며 자동 재시도·만료·환불이 없습니다. 기본 한 슬롯을 점유하므로 신규 검토가 막힐 수 있습니다.

1. 같은 백엔드·인증 주체·`REBUT_CONFIG_DIR`에서 `rebut status REQUEST_ID`를 조회합니다. ID를 잃었다면 로컬에서 `rebut status --pending`을 사용합니다(최대 100건, `has_more` 표시). 로컬 조회에는 OpenAI 키가 필요 없고 Worker 조회는 기존 접속 토큰을 사용합니다. 유료 모델 호출은 없습니다.
2. 호스트를 중지하고 닫힌 로컬 SQLite와 설정을 백업합니다. Worker는 Cloudflare D1 내보내기·Time Travel 방식으로 백업합니다.
3. 원래 ID·입력 해시·프로필과 가능한 공급자 요청/사용량 근거를 대조합니다. `not_found`만으로 미실행을 단정하거나 다른 백엔드·새 ID로 재실행하지 마세요.
4. 불확실하면 행·전액 회계 예약·슬롯을 유지합니다. 정산은 독립 근거가 있는 운영자가 해당 `(principal, request_id)`를 확인해 처리하며, 앱은 강제 해제·환불·삭제 도구를 제공하지 않습니다.
5. 예약을 유지하면서 **다른 새 검토**를 의도한 운영자는 로컬 `rebut set max-concurrent N`으로 필요한 용량만 추가할 수 있습니다(최대 10). 기존 예약 해제나 원래 입력 재시도 허가가 아닙니다. 금액 한도는 계속 적용되며 사용자 한도 스냅샷을 유지합니다. 호스트를 재시작하세요.

`budget_reserved_microusd`·`budget_accounted_microusd`는 앱 회계값이며 실제 청구 확인값이 아닙니다. 슬롯 10개가 모두 불확실하면 근거 기반 정산까지 중지합니다. 정산 뒤 임시 용량을 원래 값으로 낮추고 재시작하세요. 요청 행 삭제는 중복 방지를 없애므로 복구 수단으로 사용하지 않습니다.

## 진단

`rebut doctor`는 로컬 설정·키 상태, `doctor --connect`는 선택한 백엔드와 도구 목록을 확인합니다. 유료 검토나 공급자 계정 접근 검증은 하지 않습니다. SSH Keychain 접근 실패와 같은 장비의 로그인 세션에서 접근 성공은 구분하세요.

새 unknown 기록의 `unknown_reason`, `provider_elapsed_ms`, 공급자 ID·`upstream_status`는 가능한 경우에만 있습니다. 원문·예외 문자열은 저장하지 않습니다. HTTP 오류를 받은 뒤 본문 대기에서 timeout이 날 수도 있어 필드를 함께 해석하세요. 경과 시간은 실행·청구 완료 증거가 아니며 과거 누락 필드를 복원하지 않습니다.

SIGINT/SIGTERM은 진행 중 요청을 unknown으로 기록하고 닫으려 시도합니다. SIGKILL·크래시·연결 단절은 reserved를 남길 수 있습니다. 어떤 경우에도 자동 재실행하지 않습니다.

## 업그레이드·키 교체

CLI → Codex 등록 갱신 → 호스트 재시작 → Worker 순서로 업데이트합니다. 사용자 지정 디렉터리를 유지하고 등록 전 `config.toml` 전체를 백업하세요. [설치 명령](installation.md#codex-등록과-업데이트)을 따릅니다.

0.2.0 전용 설정을 쓰기 전 `config.json`도 백업하세요. 0.1.0은 새 필드를 거부하므로 Worker 사용자도 롤백 시 이전 설정 복원이 필요할 수 있습니다. 로컬 장부를 사용한 상태에서 0.1.0으로 내리는 것은 장부 복구가 아닙니다. 설정 복원을 위해 장부를 지우지 마세요.

Worker는 같은 D1을 유지하고 대기 중인 마이그레이션만 적용합니다. bearer 교체는 `AUTH_TOKENS`의 다이제스트와 클라이언트 저장소를 갱신하되 인증 주체 ID는 유지합니다. 공급자 키는 별도로 `OPENAI_API_KEY`를 갱신합니다. 관리자 토큰을 MCP 설정에 넣지 마세요. `rebut remove`는 등록만 제거하며 키·설정·장부는 남깁니다.

## 개발 검증

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
npm run test:package
```

Worker 테스트는 빌드 결과를 사용합니다. 자동 테스트·패키지 smoke는 공급자를 모의 처리하므로 유료 API·모델 품질 검증이 아닙니다. 실제 API 테스트 기본 모델은 `luna-test`, 운영 기본은 `astra-medium`이며 Luna 성공으로 Astra 가용성·품질을 추론하지 않습니다. 과거 검증 상세는 [0.2.0 소스 기록](https://github.com/abruption/rebut/tree/v0.2.0/docs/guide/ko)을 참고하세요.

소스 경계: `service.ts`는 해시·프로필·예약/정산, `review.ts`는 공급자·근거 검증, `local.ts`는 stdio·SQLite, `worker.ts`는 HTTP 인증·D1을 담당합니다. 로컬은 한 디렉터리의 장부, Worker는 배포 공유 장부를 사용합니다.

## npm 발행

`publish.yml`은 main에서 수동 실행하며 태그·소스·버전을 검증하고 `npm` Environment에서 소유자 승인을 받습니다. 빌드·smoke에는 OIDC 쓰기 권한이 없고 검증한 tarball의 게시 작업만 권한을 갖습니다. PR 병합·GitHub Release 이벤트로 자동 발행하지 않습니다.

게시 뒤 처리·검증 문제가 생기면 원래 실행과 레지스트리 버전·무결성을 먼저 확인한 뒤 재시도 여부를 판단하세요. 이미 게시된 버전은 재발행하지 않습니다. [한국어 릴리즈 체크리스트](../../releases/release-checklist.ko.md#github-actions-trusted-publisher)에 설정·승인·7일 artifact 기한을 정리했습니다. 이 워크플로는 Worker 배포·기존 설치 업데이트를 수행하지 않습니다.
