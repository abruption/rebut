# 설정 및 MCP 계약

**한국어** · [English](../en/configuration.md) · [简体中文](../zh-CN/configuration.md) · [日本語](../ja/configuration.md)

[Rebut](../../../README.md) · [사용자 가이드](../ko.md)

## 로컬 프로필과 예산 범위

새 설정은 로컬 모드를 사용하고 endpoint만 있던 기존 설정은 Worker로 유지합니다. `rebut set api-key`는 로컬 OpenAI 키를 Keychain에 저장하며 Worker의 set token·set admin-token과 다른 자격증명입니다. env 방식은 로컬 REBUT_OPENAI_API_KEY, Worker REBUT_TOKEN/REBUT_ADMIN_TOKEN을 사용합니다. Vaultwarden 로컬 키는 vaultwarden-api-key-item을 지정합니다. `rebut profile list/set/remove`는 선택한 backend를 대상으로 하며 로컬에서는 Worker 관리자 토큰이 필요 없습니다. 프로필·리비전·메타데이터는 private SQLite에 저장합니다. 예산은 해당 데이터 디렉터리 한 곳에만 적용되며 다른 기기나 OpenAI 계정 전체 사용량을 합산하지 않습니다. 중앙 장부가 필요하면 Worker를 공유합니다. 모드 전환은 불확실한 요청을 이전하거나 예약을 해제하지 않습니다.

## 모델 및 추론 환경설정

새로 수집할 번들의 로컬 환경설정을 지정하거나 서버 프로필을 직접 선택합니다.

```sh
rebut set model MODEL_ID
rebut set reasoning EFFORT
rebut set profile PROFILE_ID
```

`MODEL_ID`, `EFFORT`, `PROFILE_ID`는 자리표시자입니다. 모델·추론 환경설정은 서버 허용 목록의 프로필로 해석되며 임의 모델 접근 권한을 주지 않습니다. 수집기의 명시적 `--profile`이 로컬 환경설정보다 우선합니다. 환경설정이 없으면 기본값은 `astra-medium`입니다. `rebut review`는 고정 번들에 포함된 프로필을 유지하며 현재 환경설정으로 바꾸지 않습니다.

## 소유자 서버 프로필 관리

Worker 모드 전용입니다. 로컬 프로필 관리에는 이 관리자 자격증명이 필요하지 않습니다.

이 절의 소유자·관리자 설명은 Worker 모드에만 적용됩니다. 로컬 프로필 명령은 OS 소유권과 로컬 SQLite 레지스트리를 사용합니다.

`rebut profile list`는 인증된 읽기 전용 GET으로 서버 프로필, 모델, 추론 설정, 출력 한도, 요금, 리비전을 조회합니다. 공급자를 호출하거나 유료 검토를 시작하지 않습니다.

```sh
rebut profile list
rebut set admin-token
```

프로필 변경에는 별도의 소유자 admin bearer가 필요합니다. `rebut set admin-token`은 입력을 숨기는 대화형 프롬프트를 사용하며 `rebut set admin-token --stdin`은 보호된 파이프 입력을 명시적으로 받습니다. 토큰을 인자나 추적되는 파일에 넣지 마세요. macOS Keychain 서비스는 `com.abruption.rebut`, 검토 계정은 `codex-mcp-bearer`, 관리자 계정은 `codex-mcp-admin`입니다. 선택한 Vaultwarden 백엔드는 별도의 사용자 지정 항목을 사용할 수 있습니다. 기본값은 `Rebut — MCP Admin Token`이며 `rebut set vaultwarden-admin-item NAME`으로 변경합니다. env 백엔드는 안전한 실행 환경의 `REBUT_ADMIN_TOKEN`을 읽습니다. 관리자 토큰은 Codex에 전달되지 않습니다. 자동 백엔드 대체는 없습니다.

[설치](installation.md)의 일회성 Worker 업그레이드, D1 마이그레이션 `0002`, `ADMIN_TOKEN_SHA256` 시크릿 설정 후 소유자는 프로필을 추가·수정할 수 있습니다. 다음 예시는 기존 Astra/medium 설정과 2026-11-12 Standard 요금을 사용합니다. 값을 선택하기 전에 공식 [모델](https://developers.openai.com/api/docs/models/gpt-6-astra)·[가격](https://developers.openai.com/api/docs/pricing) 문서를 확인하세요. 새 모델에는 자리표시자 `MODEL_ID`를 검증된 Responses 호환 모델 ID로 바꾸고 지원되는 추론 설정, 출력 한도, 공식 요금을 모두 명시합니다.

```sh
rebut profile set astra-medium --model gpt-6-astra --reasoning medium --max-output-tokens 8192 --input-usd-per-million 10 --output-usd-per-million 50 --price-version official-2026-11-12
```

두 요금과 `--price-version`은 필수이며 서버는 이를 예산 예약과 비용 추정에 사용합니다. Rebut은 가격을 자동 조회하거나 공급자 모델 엔드포인트를 호출하지 않습니다. `--if-revision N`은 set/remove에 명시적인 비교 후 교환 리비전 조건을 추가합니다. `409` 충돌이 나면 `rebut profile list`를 다시 읽고 변경 여부를 판단하세요. 자동으로 덮어쓰지 마세요.

```sh
rebut profile remove PROFILE_ID --if-revision N
```

제거는 검토 이력을 지우지 않고 비활성화 tombstone을 남깁니다. Worker/D1 지원을 한 번 설치하면 프로필 변경은 D1만 기록합니다. Responses 호환 새 모델 ID나 추론 값에는 Worker 빌드·배포 또는 npm 업그레이드가 필요하지 않습니다. 기존 요청은 프로필 수정·제거 후에도 원래 모델과 리비전을 유지합니다. 변경으로 요청을 재실행하거나 예약을 자동 해제·환불하지 않습니다. 일반 검토 bearer는 프로필을 변경할 수 없습니다. 이 소유자 API는 MCP 도구로 노출되지 않으며 예산, 인증, 공급자 URL을 변경할 수 없습니다.

## 서버 설정

[`config.example.json`](../../../config.example.json)은 `REBUT_CONFIG` 시크릿의 구조를 정의합니다. `hostname`을 정확한 엔드포인트 호스트명으로 지정하고, 서버 측 프로필 ID와 배포 전체의 한도를 설정합니다. 클라이언트는 프로필 ID를 선택하며 모델명이나 공급자 URL을 재정의할 수 없습니다. 예시는 설정을 보여 주며 계정 수준의 모델 접근 권한을 보장하지 않습니다.

`REBUT_CONFIG`는 초기 프로필을 제공합니다. D1 재정의와 비활성화 tombstone이 우선하므로 프로필을 제거해도 같은 ID의 초기 프로필이 다시 활성화되지 않습니다. 서버는 각 예약 요청에 해석된 프로필과 리비전을 고정합니다.

| 프로필         | 모델          | 추론     | 최대 출력 토큰 | 1M 토큰당 Standard 입력/출력 |
| -------------- | ------------- | -------- | -------------- | ---------------------------- |
| `astra-medium` | `gpt-6-astra` | `medium` | 8,192          | $10 / $50                    |
| `luna-test`    | `gpt-6-luna`  | `medium` | 2,048          | $0.10 / $0.50                |

출력 한도에는 추론 토큰이 포함됩니다. 날짜가 지정된 가격표는 `openai-standard-2026-11-12`이며, 예상 비용에는 캐시 입력 할인을 적용하지 않습니다. **실제 API 테스트에는 Luna**를, 자동화 테스트에는 모의 응답을 사용하세요. 운영 프로필은 Astra/medium을 유지합니다. Luna 결과로 Astra 런타임의 사용 가능 여부나 동등한 검토 품질을 입증할 수는 없습니다. 배포 전에 공식 [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [가격](https://developers.openai.com/api/docs/pricing) 문서를 확인하세요.

요청은 `service_tier:default`와 `prompt_cache_options.mode:explicit`을 고정하고 중단점을 두지 않아, 이 프로필의 프롬프트 캐싱을 비활성화합니다. 실행 도구는 제공하지 않습니다. 예상 비용은 청구서가 아니며 같은 키나 프로젝트를 공유하는 다른 서비스의 비용을 반영하지 않습니다.

## 예산 및 동시 실행

| 설정                         | 예시 값                            |
| ---------------------------- | ---------------------------------- |
| UTC 달력 기준 하루           | $6.66 (`dailyMicrousd:6660000`)    |
| UTC 달력 기준 한 달          | $200 (`monthlyMicrousd:200000000`) |
| 요청당                       | $6.66 (`requestMicrousd:6660000`)  |
| 동시 pending/unknown 요청    | 1 (`maxConcurrent:1`)              |
| UTC 기준 하루 신규 검토 요청 | 100 (`dailyRequests:100`)          |

이 한도는 배포 내 모든 인증 주체에 합산 적용됩니다. 호출 전에 예약합니다. 직렬화된 요청 바이트와 프레이밍 여유분을 입력 토큰으로 계산하고 최대 출력 예산을 예약합니다. 검증된 사용량은 캐시되지 않은 Standard 요율로 보수적으로 정산합니다. 실행 결과를 알 수 없거나 사용량이 없으면 전체 예약을 유지합니다. UTC 날짜나 월이 바뀌면 해당 기간의 지출 집계 구간이 초기화되지만, 미해결 실행은 계속 동시 실행 슬롯을 차지합니다. 예산 집계 구간은 구독 크레딧의 지급일이나 만료일이 아닌 최초 제출일을 따릅니다. 이 원장으로는 다른 사용 주체를 포함한 OpenAI 계정 전체 한도를 강제할 수 없습니다. 계정·조직의 크레딧 적용 자격은 별도로 확인하세요.

## 입력 한도 및 해시

| 자료                            | 한도          |
| ------------------------------- | ------------- |
| 정규화 직렬화된 UTF-8 JSON 입력 | 128,000바이트 |
| 파일                            | 40개          |
| Diff                            | 100,000자     |
| 요구 사항                       | 16,000자      |
| 전송 봉투                       | 160,000바이트 |

SHA-256은 마스킹 후 정규화한 `{schema_version,task_kind,requirements,files,diff}`를 대상으로 하며, 파일 키 순서는 `{path,start_line,content}`입니다. 요청 ID와 프로필명은 이 고정 증거 해시와 별개입니다. 전체 계약은 [`ReviewInputSchema`](../../../src/contracts.ts)를 참고하세요. 독립적인 1차 검토자에게는 같은 증거 자료를 제공하고 각 출력을 분리하여 보관하세요.

## MCP 도구

- `review`: 허용 목록의 프로필 ID를 선택하고 고정 자료를 제공합니다. 상태, 검증된 지적 사항, 공급자 모델·ID, 해시, 사용량, 예상 microUSD를 반환합니다. 성공한 검토는 `completed`뿐입니다. 거부, 불완전한 생성, 잘못된 출력, 결과를 알 수 없는 실행은 서로 구분됩니다. 모든 지적 사항은 제공한 파일 행 또는 제공한 diff의 새 파일 쪽 행을 참조해야 합니다. 비어 있지 않은 요약과 빈 지적 사항 배열은 유효하지만, 비어 있거나 형식이 잘못된 응답은 유효하지 않습니다.
- `review_status`: `{request_id}`는 호출자의 인증 주체에 속한 메타데이터만 반환합니다. 검토 본문은 다시 제공할 수 없습니다.

시간 초과 후에는 **같은 요청 ID**로 조회하세요. 같은 ID를 반복해도 공급자 실행을 새로 만들지 않습니다. 입력 해시나 프로필을 바꿔 ID를 재사용하면 `conflict`를 반환합니다. 완료된 요청을 중복 제출하면 검토 본문 대신 메타데이터를 반환하므로, 클라이언트는 최초 응답을 로컬에 저장해야 합니다. 대조 및 정리 절차는 [운영](operations.md)을 참고하세요. 전송 실패 후의 `not_found`만으로는 새 ID를 사용할 근거가 되지 않습니다.

## 저장 및 개인정보 보호

메타데이터 전용 D1 원장은 요청 ID, 해시, 프로필, 상태, 예약, 정제된 공급자 ID와 사용량을 보관합니다. 소스나 검토 텍스트는 저장하지 않습니다. 예시에서는 Worker 관측 기능을 비활성화합니다. `AUTH_TOKENS`에는 bearer 값이 아닌 토큰 다이제스트가 들어갑니다. 원본 bearer 토큰은 비밀번호 관리자에 보관하세요. 설정 방법은 [설치](installation.md)를 참고하세요.

OpenAI 요청에는 `store:false`를 사용합니다. 이는 공급자의 보관 기간이 0임을 보장하거나 조직의 데이터 정책을 대체하지 **않습니다**. [OpenAI 데이터 제어](https://developers.openai.com/api/docs/guides/your-data)를 참고하세요. 자격증명과 비공개 배포 식별자는 공개 소스와 로그에 포함하지 마세요.

결과가 `invalid_output`이면 `invalid_output_reason`으로 원문이나 검토 본문을 보관하지 않고도 실패한 검증 단계를 구분할 수 있습니다. 중간 `commentary` 메시지는 제외하고 `final_answer` 또는 phase가 없는 기존 형식의 메시지만 구조화된 검토로 해석합니다. 최종 출력 중복, JSON·스키마 오류, 제공된 근거 범위를 벗어난 지적은 계속 오류로 처리합니다.

## Claude 공급자 — 0.3.0

`rebut set provider anthropic` 후 기존 `rebut set api-key`로 키 하나를 설정합니다. Keychain 서비스는 `com.abruption.rebut`, 계정은 `anthropic-api-key`입니다. Vaultwarden은 선택한 백엔드에서 `rebut set vaultwarden-api-key-item NAME`으로 항목을 지정하며 기본 이름은 `Rebut — Anthropic API Key`입니다. 계정 별칭·키 순환·공급자 fallback은 없습니다.

`claude-medium`은 Claude Opus 5.5 / medium 프로필입니다. 새 Anthropic 프로필은 `profile set`에 `--provider anthropic`을 명시합니다. 생략하면 기존 활성 프로필의 공급자를 유지하며, 새/비활성 프로필은 OpenAI로 간주합니다. 키 선택 설정을 상속하지 않습니다. provider가 없는 기존 프로필은 OpenAI입니다. 고정 번들의 프로필이 실제 공급자와 키를 정하므로, 환경설정 변경 후에도 원래 번들·ID를 유지하세요.

로컬/Worker 각각의 한 장부에서 두 공급자의 예산·동시성을 합산합니다. 새 요청의 `requested_provider`는 예약·완료·오류에 보존하며 과거 행은 다시 쓰지 않습니다. Claude thinking 세부값이 없으면 `reasoning_tokens`를 생략합니다. 캐시 읽기는 보수적으로 기본 입력 요율로 계산하며 요청하지 않은 캐시 쓰기나 비표준 사용량은 unknown으로 유지합니다.

Claude 요청은 standard tier·global geo, 도구·캐싱 없는 Messages API를 사용합니다. workspace 지역 제한으로 거부될 수 있으며, 오류를 다른 키로 재시도하지 않습니다. Worker에는 별도 `ANTHROPIC_API_KEY` 시크릿과 Anthropic 프로필을 추가하고 클라이언트 → Worker 순서로 업데이트합니다. 관리자 토큰을 호스트에 전달하지 않습니다.

API 비용과 크레딧 적용은 [Claude Console 청구 안내](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage)에서 확인하세요. Claude Code 구독 사용량과 Rebut API 호출을 혼동하지 마세요.
