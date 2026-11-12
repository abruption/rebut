# 설정 및 MCP 계약

**한국어** · [English](../en/configuration.md) · [简体中文](../zh-CN/configuration.md) · [日本語](../ja/configuration.md)

[Rebut](../../../README.md) · [사용자 가이드](../ko.md)

## 로컬 CLI 설정

`npm install -g rebut-mcp`로 설치하고 `rebut set endpoint https://YOUR_HOST/mcp`로 Worker를 설정합니다. macOS 기본값은 Keychain입니다. `rebut set token`은 입력을 숨기는 대화형 프롬프트, `rebut set token --stdin`은 명시적인 보호된 파이프 입력을 사용합니다. bearer 값을 인자나 추적되는 파일에 넣지 마세요. 기존 Vaultwarden 작업 흐름은 `rebut set secret-store vaultwarden`으로 선택합니다. 기본 항목은 `Rebut — MCP Access Token`이며 `rebut set vaultwarden-item NAME`으로 변경합니다. macOS 외 환경은 `rebut set secret-store env`를 명시하고 안전한 실행 환경으로 `REBUT_TOKEN`을 제공합니다. 백엔드 자동 대체는 없습니다.

`env` 백엔드에서 Codex 설정은 값 없이 변수명만 `env_vars = ['REBUT_TOKEN']`로 저장합니다. 토큰은 실제 Codex 호스트의 안전한 실행 환경에 제공해야 합니다. 설정 명령에만 제공한 환경 변수는 이후 Codex 세션에 전달되지 않습니다.

`rebut setup --client codex`는 `CODEX_HOME` 또는 `~/.codex`를 사용하며 `--codex-home PATH`로 경로를 지정합니다. `rebut mcp`를 등록하고 다른 MCP 항목을 보존합니다. 기존 비공개 `rebut` 브리지 이전에는 `--replace`가 필요합니다. `rebut doctor`는 민감한 값을 제거한 로컬 설정과 자격증명 사용 가능 여부를, `rebut doctor --connect`는 무료 원격 `tools/list`를 확인합니다. 유료 검토는 수행하지 않습니다. [설치](installation.md)를 참고하세요.

## 서버 설정

[`config.example.json`](../../../config.example.json)은 `REBUT_CONFIG` 시크릿의 구조를 정의합니다. `hostname`을 정확한 엔드포인트 호스트명으로 지정하고, 서버 측 프로필 ID와 배포 전체의 한도를 설정합니다. 클라이언트는 프로필 ID를 선택하며 모델명이나 공급자 URL을 재정의할 수 없습니다. 예시는 설정을 보여 주며 계정 수준의 모델 접근 권한을 보장하지 않습니다.

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
