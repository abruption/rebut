# 설정

**한국어** · [English](../en/configuration.md) · [简体中文](../zh-CN/configuration.md) · [日本語](../ja/configuration.md)

[README](../../../README.md) · [설치](installation.md) · [운영](operations.md)

## 모드와 저장 위치

| 모드                | 선택                                                                       | 요청·사용량 기록 범위                              |
| ------------------- | -------------------------------------------------------------------------- | -------------------------------------- |
| 로컬 (새 설치 기본) | `rebut set mode local`                                                     | 해당 데이터 디렉터리의 private SQLite  |
| Worker              | `rebut set endpoint URL` 또는 `rebut set mode worker` (기존 endpoint 필요) | 해당 배포의 D1, 여러 클라이언트가 공유 |

기존 endpoint 설정은 Worker로 유지하며 장애 시 다른 모드로 대체하지 않습니다. 전환은 기록·예약을 이전하거나 해제하지 않습니다.

설정은 `~/.config/rebut/config.json`, 로컬 요청·사용량 기록은 `~/.local/share/rebut/local/ledger.sqlite`입니다(macOS/Linux). `REBUT_CONFIG_DIR`을 지정하면 그 안의 `config.json`과 `local/`을 사용합니다. 등록과 상태 조회도 같은 디렉터리를 사용해야 합니다.

설정 파일은 현재 계정이 소유하고 권한을 `0600`으로 유지합니다. 설정 디렉터리도 현재 계정이 소유해야 합니다. 설정 디렉터리와 상위 경로는 다른 사용자가 쓸 수 없는 위치를 사용합니다. 안전하지 않은 설정 경로 오류가 나면 소유권과 권한을 확인합니다.

## 자격증명

`rebut set secret-store keychain|vaultwarden|env`는 모든 역할에 적용하며 자동 대체하지 않습니다. Keychain 서비스는 `com.abruption.rebut`입니다.

| 역할          | Keychain 계정 / 숨김 입력 명령        | env                    | Vaultwarden 기본 항목 / 변경 키                       |
| ------------- | ------------------------------------- | ---------------------- | ----------------------------------------------------- |
| 로컬 공급자   | `openai-api-key` / `set api-key`      | `REBUT_OPENAI_API_KEY` | `Rebut — OpenAI API Key` / `vaultwarden-api-key-item` |
| Worker 접속   | `codex-mcp-bearer` / `set token`      | `REBUT_TOKEN`          | `Rebut — MCP Access Token` / `vaultwarden-item`       |
| Worker 관리자 | `codex-mcp-admin` / `set admin-token` | `REBUT_ADMIN_TOKEN`    | `Rebut — MCP Admin Token` / `vaultwarden-admin-item`  |

명령은 `rebut` 접두사를 사용합니다. Vaultwarden 변경은 `rebut set SETTING_KEY NAME`입니다. 숨김 입력 대신 보호된 파이프를 사용할 때만 `--stdin`을 지정하세요. 로컬 env 기본값을 바꾸는 `rebut set api-key-env OPENAI_API_KEY`는 명시 선택이며 두 변수 간 fallback은 없습니다. 관리자 토큰은 MCP 호스트에 전달하지 않습니다.

## 모델 프로필

```sh
rebut profile list
rebut set model MODEL_ID
rebut set reasoning EFFORT
rebut set profile PROFILE_ID
```

환경설정은 새 수집에 적용합니다. 명시적 `collect --profile`이 우선하며 `review`는 번들에 고정한 프로필을 유지합니다. 기본은 `astra-medium`입니다. 프로필 허용 목록은 공급자의 모델 사용 권한을 보장하지 않습니다.

같은 설정과 요청·사용량 기록을 공유하면서 Codex와 Claude Code의 기본 리뷰 프로필을 각각 지정할 수 있습니다.

```sh
rebut set profile claude-medium --client codex
rebut set profile astra-medium --client claude
rebut set profile --client codex --clear
```

`--clear`는 해당 호스트를 공통 기본값으로 되돌립니다. 터미널이나 에이전트 명령에서 `collect --client codex` 또는 `collect --client claude`를 사용하면 해당 기본값을 적용하며, `collect --profile`로 명시한 값이 우선합니다. 호스트 기본값을 사용할 수 없으면 기본값으로 번들을 수집할 수 없고, 기존 번들의 프로필과 공급자는 유지됩니다. `rebut doctor --client codex` 또는 `--client claude`로 설정을 확인합니다.

기존 등록은 `rebut setup --client codex --replace` 또는 `rebut setup --client claude --replace`로 갱신한 뒤 호스트를 다시 시작합니다. 로컬 환경변수 방식에서 필요한 키 변수가 바뀌면 다시 등록합니다. 프로필에서 사용할 모델은 `rebut profile set --model`로 정의합니다. 기본값으로 선택한 프로필의 모델·추론·요율이 사용됩니다. 호스트별 기본값을 지원하지 않는 버전으로 되돌릴 때는 두 호스트의 기본값을 먼저 지우고, 이전 CLI로 두 MCP 호스트를 다시 등록합니다.

기본 제공 `astra-medium` 프로필은 GPT-6.2 Astra(`gpt-6.2-astra`)와 medium 추론을 사용합니다. 예제의 [짧은 컨텍스트 Standard 요율](https://developers.openai.com/api/docs/models/gpt-6.2-astra)은 100만 토큰당 입력 $8, 출력 $40입니다. 기존 Worker와 로컬 프로필 오버라이드는 저장된 설정을 유지합니다. 전환하려면 `rebut profile list`를 확인하고 모델 `gpt-6.2-astra`, 추론 `medium`, 두 요율과 가격 버전 `openai-standard-2026-11-18`을 현재 `--if-revision`으로 한 번에 갱신합니다. 클라이언트가 이전 모델 ID를 명시했다면 해당 설정을 갱신하거나 프로필 ID로 `astra-medium`을 선택합니다.

로컬 프로필은 OS 소유자가 관리합니다. Worker 변경에는 `0002` 마이그레이션과 `ADMIN_TOKEN_SHA256`, 별도 관리자 토큰이 필요합니다. 프로필 목록을 조회할 때는 모델을 호출하지 않습니다.

```sh
rebut profile set PROFILE_ID --model MODEL_ID --reasoning medium --max-output-tokens 8192 --input-usd-per-million INPUT_USD --output-usd-per-million OUTPUT_USD --price-version PRICE_VERSION
rebut profile remove PROFILE_ID --if-revision N
```

명령에서 `PROFILE_ID`와 `MODEL_ID` 같은 자리표시자는 실제 값으로 바꾸세요. 모델이 지정한 추론 수준을 지원하는지, 입력·출력 요율이 얼마인지 확인하세요. 두 요율과 가격 버전은 필수입니다. `set`에도 `--if-revision N`을 사용할 수 있습니다. 리비전이 충돌하면 자동으로 덮어쓰지 말고 최신 목록을 확인하세요.

수정은 이후 요청에만 적용합니다. 제거는 이력을 지우지 않는 비활성화(tombstone)이며 초기 프로필을 되살리지 않습니다. 기존 ID의 모델·리비전·예약은 유지합니다. 동적 프로필 변경에는 Worker 재배포가 필요 없습니다.

## 예산

| 항목             | 기본값 | 로컬 변경 명령                      |
| ---------------- | ------ | ----------------------------------- |
| UTC 하루         | $6.66  | `rebut set daily-budget USD`        |
| UTC 월           | $200   | `rebut set monthly-budget USD`      |
| 요청당           | $6.66  | `rebut set request-budget USD`      |
| 미해결 동시 요청 | 1      | `rebut set max-concurrent N` (1–10) |
| 하루 신규 요청   | 100    | 배포/초기 설정                      |

로컬은 디렉터리 단위, Worker는 배포 전체의 한도입니다. 다른 기기·Worker·API 사용이나 OpenAI 계정 잔액을 합산하지 않습니다. Worker 한도는 `REBUT_CONFIG`에서 관리합니다. 일·월·요청 한도는 독립적이며 하나를 바꿔도 다른 한도가 늘지 않습니다. 설정 변경 후 호스트를 재시작하세요.

호출 전 입력과 최대 출력을 보수적으로 예약하고 확인된 사용량으로 정산합니다. 예상 비용은 청구서가 아닙니다. unknown은 전액 예약과 동시성 슬롯을 유지하며, 날짜가 바뀌어도 슬롯은 해제되지 않습니다. 기간별 비용은 원래 제출한 UTC 날짜·월에 귀속됩니다.

`rebut budget`으로 월간 예산 반영액, 다음 UTC 갱신 시각, 미해결 요청이 점유한 슬롯을 확인합니다. 금액은 Rebut에 기록된 사용량과 예약액을 기준으로 계산하며, 공급자 크레딧 잔액과 별개입니다. Worker 모드에서는 이 명령에 Worker 관리자 토큰을 사용합니다. 월간 반영액과 월 한도, 점유 슬롯과 동시 실행 한도를 비교할 수 있습니다. 일일·요청별 한도도 적용됩니다.

월간 UTC 시작일을 바꾸려면 `rebut budget set-start-day DAY`(1~28)를 실행합니다. 요청 기록이 없으면 즉시 적용됩니다. 기록이 있으면 현재 달력월 예산을 다음 달의 선택한 날짜까지 연장합니다. 예를 들어 11월에 15일로 설정하면 12월 15일 00:00 UTC까지 11월 예산을 사용합니다. 기본은 1일이며 로컬 데이터 디렉터리나 Worker의 D1 데이터베이스마다 시작일을 한 번만 바꿀 수 있습니다. 같은 설정을 반복하는 것은 안전하고 다른 값으로 다시 변경하면 거부됩니다.

Worker에서 맞춤 시작일을 설정하기 전에 새 코드를 배포하고 D1 마이그레이션 `0003_budget_cycle.sql`을 적용합니다. 달력월 모드에는 이 마이그레이션이 필요하지 않습니다. 로컬에서는 전환에 성공하면 Rebut이 SQLite 파일을 자동으로 업그레이드합니다. 업그레이드한 파일은 이전 CLI 버전으로 열 수 없습니다. 이전 Worker 버전은 전환 후 신규 예약을 할 수 없습니다. 기존 요청 ID, 비용 귀속 기간, 미해결 슬롯은 보존됩니다.

## 입력·결과 계약

| 항목              | 한도                 |
| ----------------- | -------------------- |
| 정규화 UTF-8 입력 | 128,000바이트        |
| 파일              | 40개                 |
| diff / 요구사항   | 100,000자 / 16,000자 |
| 전송 봉투         | 160,000바이트        |

SHA-256은 마스킹한 `{schema_version,provider,task_kind,requirements,files,diff}`를 JavaScript의 간결한 JSON 직렬화로 만든 UTF-8 바이트를 사용합니다. 파일 키 순서는 `{path,start_line,content}`입니다. 입력 스키마 1은 `provider`를 생략합니다. 확장 출력을 선택하면 마지막에 `result_format`을 추가하고 내부 키 순서 `{version,criterion_ids}`와 기준 ID 배열 순서를 유지합니다. 요청 ID와 프로필은 해시 대상에서 제외합니다. 입력 `schema_version`과 출력 `result_format.version`은 별개입니다. [전체 스키마](../../../src/contracts.ts)를 참고하세요.

입력 스키마 2에서 기존 출력을 쓰는 예시입니다.

```json
{"schema_version":2,"provider":"openai","task_kind":"code","requirements":"AC-1: Preserve 순서.","files":[{"path":"sample.ts","start_line":1,"content":"export const value = 1;"}],"diff":""}
```

같은 자료의 SHA-256은 `provider`를 뺀 입력 스키마 1이 `412b5f538cfa6fac93c83813b6f4b723156f40ae06d50848072c58a5dabc8ca0`, 위 예시가 `f8add8f03abd7292de2918d02a70b435953019074a35d6a45d3a182f177417c5`, 마지막 키에 `result_format: {"version":2,"criterion_ids":["AC-1"]}`을 추가한 입력 스키마 2가 `fd39d1847c3a55e9a318020874a96b55fcaad132c5c7c2df6325d4e8d1cf032a`입니다.

| CLI와 백엔드 | 사용할 출력 |
| --- | --- |
| v0.5.0 CLI와 호환 로컬 런타임 또는 Worker | 기존 출력 |
| 갱신한 CLI와 v0.5.0 Worker | 기본값 또는 `--output-schema 1` |
| 갱신한 CLI와 확장 출력을 지원하는 로컬 런타임 또는 Worker | 기존 출력 또는 `--criterion-id ID`를 지정한 확장 출력 |

수집할 때 프로필 ID와 공급자를 고정합니다. 실제 모델·추론 수준·요율은 백엔드가 첫 예약 직전에 현재 프로필에서 읽습니다. 이미 기록된 요청은 원래 ID의 저장된 메타데이터를 반환합니다.

셸 자동화에서 `rebut review --strict-exit`은 요청한 형식의 완료 본문이 있을 때만 종료 코드 0을 반환합니다. 이미 처리한 요청에서 `completed` 메타데이터만 받으면 0이 아닌 코드로 종료합니다. stdout의 JSON 형식은 그대로입니다. 불확실한 결과는 JSON의 상태와 원래 요청 ID로 확인하세요.

- `review`: 고정 자료로 검토합니다. 새 `completed` 본문은 파일·diff 행 근거, 모델·입력 해시·사용량·예상 비용을 반환합니다. 빈 findings만으로 정확성을 보장하지 않습니다.
- `review_status`는 원래 인증 주체에게만 메타데이터를 반환합니다. 같은 백엔드에서 같은 인증 주체의 요청 ID가 이미 기록돼 있으면 같은 입력 해시와 프로필로 `review`를 다시 제출해도 공급자를 다시 호출하지 않습니다. 해시나 프로필이 다르면 `conflict`를 반환합니다. 상태 조회로 리뷰 본문을 다시 받을 수 없습니다.

요청·사용량 기록에는 메타데이터만 저장합니다. 코드와 검토 본문, 키는 이 기록에 포함하지 않습니다. 자료는 프로필에 지정된 공급자로 전송합니다. OpenAI의 `store:false`는 공급자가 자료를 전혀 보관하지 않는다는 보장이 아닙니다. 프롬프트는 자료 속 지시를 검토 데이터로 취급하도록 모델에 지시하며, 모델에 저장소·URL 조회, 셸·테스트·편집·PR 도구는 제공하지 않습니다.

## Claude 공급자 — 0.3.0

`rebut set provider anthropic` 후 기존 `rebut set api-key`로 키 하나를 설정합니다. Keychain 서비스는 `com.abruption.rebut`, 계정은 `anthropic-api-key`입니다. Vaultwarden은 선택한 백엔드에서 `rebut set vaultwarden-api-key-item NAME`으로 항목을 지정하며 기본 이름은 `Rebut — Anthropic API Key`입니다. 계정 별칭·키 순환·공급자 fallback은 없습니다.

`claude-medium`은 Claude Opus 5.5 / medium 프로필입니다. 새 Anthropic 프로필은 `profile set`에 `--provider anthropic`을 명시합니다. 생략하면 기존 활성 프로필의 공급자를 유지하며, 새/비활성 프로필은 OpenAI로 간주합니다. 키 선택 설정을 상속하지 않습니다. provider가 없는 기존 프로필은 OpenAI입니다. 고정 번들의 프로필이 실제 공급자와 키를 정하므로, 환경설정 변경 후에도 원래 번들·ID를 유지하세요.

로컬과 Worker는 각각 두 공급자의 사용액과 예약액을 합산해 예산 한도를 적용합니다. 동시 실행 한도도 두 공급자가 공유합니다. 새 요청의 `requested_provider`는 예약·완료·오류에 보존하며 과거 행은 다시 쓰지 않습니다. Claude thinking 세부값이 없으면 `reasoning_tokens`를 생략합니다. 캐시 읽기는 보수적으로 기본 입력 요율로 계산하며 요청하지 않은 캐시 쓰기나 비표준 사용량은 unknown으로 유지합니다.

Claude 요청은 standard tier·global geo, 도구·캐싱 없는 Messages API를 사용합니다. workspace 지역 제한으로 거부될 수 있으며, 오류를 다른 키로 재시도하지 않습니다. Worker는 기존 OpenAI 설정을 유지해 0.3.0 코드를 먼저 배포하고, 클라이언트 업데이트 뒤 `ANTHROPIC_API_KEY` 시크릿과 Anthropic 프로필을 추가합니다. 관리자 토큰을 호스트에 전달하지 않습니다.

API 비용과 크레딧 적용은 [Claude Console 청구 안내](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage)에서 확인하세요. Claude Code 구독 사용량과 Rebut API 호출을 혼동하지 마세요.

새 번들은 schema 2로 공급자를 고정하고 해시에 포함합니다. 수집 시 선택한 백엔드의 프로필 메타데이터를 조회하므로 Worker 모드에는 접속 토큰이 필요합니다. 제출 시 현재 프로필의 공급자가 다르면 `provider_mismatch`로 키 조회·예약 전에 거부합니다. 기존 schema 1의 새 요청은 OpenAI로만 허용하고, 이미 제출된 ID는 원래 번들로 메타데이터를 조회합니다. 공급자 변경을 확인한 뒤 새 번들을 수집하세요.

로컬 수집은 프로필 저장소를 초기화할 수 있습니다. schema 1의 해시 순서에는 provider가 없으며 기존 값 그대로입니다.
