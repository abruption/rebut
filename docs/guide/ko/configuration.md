# 설정

**한국어** · [English](../en/configuration.md) · [简体中文](../zh-CN/configuration.md) · [日本語](../ja/configuration.md)

[README](../../../README.md) · [설치](installation.md) · [운영](operations.md)

## 모드와 저장 위치

| 모드                | 선택                                                                       | 장부 범위                              |
| ------------------- | -------------------------------------------------------------------------- | -------------------------------------- |
| 로컬 (새 설치 기본) | `rebut set mode local`                                                     | 해당 데이터 디렉터리의 private SQLite  |
| Worker              | `rebut set endpoint URL` 또는 `rebut set mode worker` (기존 endpoint 필요) | 해당 배포의 D1, 여러 클라이언트가 공유 |

기존 endpoint 설정은 Worker로 유지하며 장애 시 다른 모드로 대체하지 않습니다. 전환은 기록·예약을 이전하거나 해제하지 않습니다.

설정은 `~/.config/rebut/config.json`, 로컬 장부는 `~/.local/share/rebut/local/ledger.sqlite`입니다(macOS/Linux). `REBUT_CONFIG_DIR`을 지정하면 그 안의 `config.json`과 `local/`을 사용합니다. 등록과 상태 조회도 같은 디렉터리를 사용해야 합니다.

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

로컬 프로필은 OS 소유자가 관리합니다. Worker 변경에는 `0002` 마이그레이션과 `ADMIN_TOKEN_SHA256`, 별도 관리자 토큰이 필요합니다. 조회는 유료 모델을 호출하지 않습니다.

```sh
rebut profile set PROFILE_ID --model MODEL_ID --reasoning medium --max-output-tokens 8192 --input-usd-per-million INPUT_USD --output-usd-per-million OUTPUT_USD --price-version PRICE_VERSION
rebut profile remove PROFILE_ID --if-revision N
```

대문자는 확인한 값으로 바꿉니다. 모델·추론 지원과 요금을 직접 확인하며, 두 요금과 가격 버전은 필수입니다. `set`에도 `--if-revision N`을 사용할 수 있습니다. 충돌 시 목록을 다시 조회해 판단하고 자동 덮어쓰지 마세요.

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

## 입력·결과 계약

| 항목              | 한도                 |
| ----------------- | -------------------- |
| 정규화 UTF-8 입력 | 128,000바이트        |
| 파일              | 40개                 |
| diff / 요구사항   | 100,000자 / 16,000자 |
| 전송 봉투         | 160,000바이트        |

SHA-256 대상은 마스킹한 `{schema_version,task_kind,requirements,files,diff}`이며 파일 키 순서는 `{path,start_line,content}`입니다. ID·프로필은 증거 해시와 별개입니다. [전체 스키마](../../../src/contracts.ts)를 참고하세요.

- `review`: 고정 자료로 검토합니다. 성공 상태는 `completed`이며 파일·diff 행 근거, 모델·입력 해시·사용량·예상 비용을 반환합니다. 빈 findings만으로 정확성을 보장하지 않습니다.
- `review_status`: 원래 인증 주체의 메타데이터만 조회합니다. 같은 ID 재제출은 새 공급자 호출을 만들지 않으며 해시·프로필을 바꾸면 conflict입니다. 본문은 재생하지 않습니다.

장부는 요청·사용량 메타데이터만 보관합니다. 코드·리뷰 원문·키를 저장하지 않습니다. 자료는 OpenAI로 전송하며 `store:false`는 공급자의 보관 기간 0을 보장하지 않습니다. 프롬프트는 자료 속 지시를 검토 데이터로 취급하도록 모델에 지시하며, 모델에 저장소·URL 조회, 셸·테스트·편집·PR 도구는 제공하지 않습니다.
