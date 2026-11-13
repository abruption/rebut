# 명시적으로 선택하는 독립 검토

**한국어** · [English](../en/reviewer-integration.md) · [简体中文](../zh-CN/reviewer-integration.md) · [日本語](../ja/reviewer-integration.md)

[Rebut](../../../README.md) · [사용자 가이드](../ko.md)

기존 호스트의 검토 정책을 유지하고 명시적으로 OpenAI 검토를 요청한 경우에만 Rebut을 선택합니다. 자동 대체나 검토자 세 명 호출은 없습니다.

1. 필요한 증거만 수집·마스킹·확인하고 고정한 뒤 canonical SHA-256을 기록합니다. 독립 검토자에게 같은 자료를 제공하되 서로의 결과는 주지 않습니다.
2. 로컬 또는 Worker backend와 활성 프로필을 선택합니다. 의도적인 새 검토만 새 ID를 쓰고 불확실한 검토는 원래 ID와 backend를 유지합니다.
3. 로컬은 OpenAI API 키(set api-key, env REBUT_OPENAI_API_KEY, 또는 vaultwarden-api-key-item)가 필요합니다. Worker는 별도 endpoint·접속 토큰(set token, REBUT_TOKEN, vaultwarden-item)을 사용하고 공급자 키는 Worker에 둡니다.
4. 명시적 유료 선택 후 `rebut review < /protected/path/request-001.bundle.json`을 실행하고 최초 응답을 제한적인 권한으로 보존합니다. 자격증명을 인자나 추적 파일에 넣지 마세요.
5. completed·예상 모델/프로필/해시·사용량을 확인하고 각 결함을 원본 근거와 대조합니다. 빈 지적이나 유효 JSON은 정확성 증거가 아닙니다. 실제 모델·사용량 추정·근거와 한계를 보고합니다.
6. 시간 초과·취소·불확실한 결과 뒤에는 rebut status REQUEST_ID로 조회합니다. reserved/unknown은 청구된 실행일 수 있어 예약을 유지하고 중복 호출은 메타데이터만 반환합니다. 다른 backend로 우회 재실행하지 마세요.

모델에 실행·공개 권한을 부여하지 않습니다. doctor --connect는 공급자 호출 없이 선택 backend를 확인하며 API 계정 접근 증거는 아닙니다. 로컬 예산은 한 디렉터리 기준이며 기기 간 공유하지 않습니다. 추가 MCP 호스트는 호환성과 대기 제한을 별도로 확인합니다.
