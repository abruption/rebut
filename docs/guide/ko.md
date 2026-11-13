# Rebut 사용자 가이드

**한국어** · [English](en.md) · [简体中文](zh-CN.md) · [日本語](ja.md)

[Rebut](../../README.md)

Rebut은 자신의 OpenAI Responses API 키로 실행하는 로컬 기본·명시적 선택형 코드 검토 MCP입니다. 새 설치는 로컬 stdio로 실행하고 중앙 장부용 Cloudflare Worker는 선택 사항입니다. 고정해 제공한 자료만 검토하며 모델에 저장소·URL 조회·셸·테스트·편집·PR 도구를 주지 않습니다.

rebut-mcp를 설치하고 로컬 공급자 키를 설정한 뒤 rebut setup --client codex를 실행합니다. 기존 endpoint 설정은 Worker로 유지합니다. Keychain·Vaultwarden·env와 선택적 Worker는 [설치](ko/installation.md)를 참고하세요.

| 가이드                                    | 내용                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| [설치](ko/installation.md)                | 요구 사항, 소스 설정, 입력 수집, 비공개 배포, MCP 클라이언트             |
| [설정](ko/configuration.md)               | 프로필, 모델·테스트 정책, UTC 예산, 입력·해시·도구 계약, 개인정보 보호   |
| [운영](ko/operations.md)                  | 시간 초과·unknown 상태 대조 및 정리, 원장 보존, 업그레이드, 교체 및 제거 |
| [검토자 연동](ko/reviewer-integration.md) | 명시적 검토자 선택, 동일한 고정 증거 자료, Vaultwarden 래퍼, 결과 확인   |
| [아키텍처](ko/architecture.md)            | MCP·공급자 경계, 원자적 예약 및 중복 방지                                |
| [검증](ko/validation.md)                  | 모의 테스트, 실제 Luna 스모크 테스트, 사용량 및 미검증 범위              |

설치와 설정부터 시작하세요. 실행 결과를 알 수 없는 요청을 처리하거나 배포를 변경하기 전에 운영 가이드를 읽으세요. 기존 Claude/Gemini 기본 정책은 호스트가 계속 관리합니다.
