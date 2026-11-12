# 아키텍처

**한국어** · [English](../en/architecture.md) · [简体中文](../zh-CN/architecture.md) · [日本語](../ja/architecture.md)

[Rebut](../../../README.md) · [사용자 가이드](../ko.md)

클라이언트의 명시적 허용 목록 → 마스킹·고정·해시 계산 → 인증된 Streamable HTTP MCP → 프로필·해시 검증 → 원자적 D1 예약 → 한도가 설정된 Responses 호출 한 번 → 스키마·근거·사용량 검증 → 메타데이터 정산 → 클라이언트에 검토 반환.

호스트에 독립적인 계약과 공급자 어댑터는 `src/contracts.ts`와 `src/review.ts`에 있습니다. `src/worker.ts`는 MCP·인증을, `src/ledger.ts`는 D1 어댑터를 제공합니다. Cloudflare의 요청별 `createMcpHandler`는 MCP SDK v2를 사용하며 기존 무상태 클라이언트를 지원합니다. 상태 유지 세션, 백그라운드 작업, OAuth, 모델이 구동하는 도구, 저장소 접근, 저장된 검토 재조회는 이 MVP의 범위 밖입니다.

단일 `INSERT ... SELECT`가 요청 행을 기록하면서 전역 UTC 예산, 활성 예약, 일일 요청 수를 평가합니다. 고유한 `(principal,request_id)` 키로 예측할 수 없는 클레임을 가진 단일 소유자를 선택합니다. 해당 소유자만 공급자 호출을 보내고 행을 정산합니다. 충돌이나 중단이 생길 수 있는 구간에는 예약을 유지하며, 실행은 `waitUntil`이나 자동 만료되는 임대에 의존하지 않습니다. 제공된 자료에 포함된 지시는 데이터로 취급하고, 지적 사항은 제공한 행을 인용해야 하며, 모델에는 실행 도구가 없습니다.

2026-11-12에 확인한 참고 자료:

- [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [구조화된 출력](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Cloudflare MCP 핸들러](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/)
- [D1 Worker API](https://developers.cloudflare.com/d1/worker-api/d1-database/)

합성 업스트림 응답과 실제 로컬 Workers/D1 런타임을 통해 호환성을 확인했습니다. 이 결과로 임의 클라이언트 지원이나 다른 모델과 동등한 검토 품질을 입증할 수는 없습니다.
