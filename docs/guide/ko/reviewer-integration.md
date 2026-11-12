# 명시적으로 선택하는 독립 검토

**한국어** · [English](../en/reviewer-integration.md) · [简体中文](../zh-CN/reviewer-integration.md) · [日本語](../ja/reviewer-integration.md)

[Rebut](../../../README.md) · [사용자 가이드](../ko.md)

기존 검토자의 기본 정책을 유지하세요. 사용자가 OpenAI API 검토자를 명시적으로 요청할 때만 Rebut을 선택합니다. Rebut을 선택했다고 Claude/Gemini 호출까지 허가한 것은 아니며, 이 어댑터가 있다는 이유로 검토자 세 명을 동시에 호출해서는 안 됩니다.

1. 필요한 증거 자료만 수집하고, 비밀정보를 제거하고, 확인한 뒤 고정하여 정규화 SHA-256을 기록합니다. 독립 검토자에게 같은 증거 자료를 제공하고 각 출력을 분리하여 보관하세요. 독립적인 1차 검토에는 다른 검토자의 출력이나 주 에이전트의 중간 결론을 포함하지 마세요.
2. 서버의 허용 목록에 있는 프로필을 선택합니다. 제공된 예시는 Astra/medium을 사용합니다. 의도적으로 새 검토를 시작할 때는 새 요청 ID를 설정하고, 시간 초과나 불확실한 응답 이후에는 같은 ID를 유지합니다.
3. 사용자가 유료 검토를 명시적으로 선택한 뒤에만 `rebut review < /protected/path/request-001.bundle.json`을 실행합니다. [설치](installation.md)에 따라 엔드포인트와 자격증명 백엔드를 설정하세요. 응답은 제한적인 권한으로 로컬에 저장합니다. bearer 값을 명령 인자나 추적되는 파일에 넣지 마세요.
4. macOS 기본값은 Keychain(`rebut set token`, 숨김 프롬프트)입니다. 기존 Vaultwarden 작업 흐름은 `rebut set secret-store vaultwarden`으로 명시적으로 선택합니다. 기본 항목은 `Rebut — MCP Access Token`이며 `rebut set vaultwarden-item NAME`으로 변경합니다. macOS 외 환경에서는 `rebut set secret-store env`를 명시하고 안전한 실행 환경으로 `REBUT_TOKEN`을 제공합니다. 자동 백엔드 대체는 없습니다. OpenAI 키는 클라이언트에 전달하지 않습니다. `rebut doctor --connect`와 `rebut status REQUEST_ID`는 무료 확인이며 유료 검토를 수행하지 않습니다.
5. `completed` 상태, 예상 모델·프로필·해시, 유효한 지적 사항·사용량을 확인합니다. 지적 사항이 비어 있다고 정확성이 입증되지는 않습니다. 주장된 결함을 각각 원본 소스와 대조하세요. 실제 모델, 입력 해시, 사용량, 예상 비용, 한계를 보고하세요. 스키마 준수는 지적 사항의 진실성을 검증하지 않습니다.
6. 실패·시간 초과 요청에는 `rebut status REQUEST_ID`를 사용합니다. 새 ID로 자동 재시도하지 마세요. `unknown`/`reserved`는 과금된 실행일 수 있으며 예약을 유지합니다. 완료된 요청을 중복 제출하면 메타데이터만 반환합니다. 첫 응답을 로컬에 보존하세요.

이 API 어댑터는 Codex CLI와 별개이며 검토자에게 도구, 저장소 접근, 셸 실행, 코드 변경, 공개 권한을 부여하지 않습니다. 호환성을 주장할 수 있는 대상은 해당 배포에서 테스트한 클라이언트·기기뿐입니다. 브라우저 프로필이나 자격증명을 복사하지 말고 추가 호스트를 각각 별도로 검증하세요.
