# 0.2.0 릴리즈 준비 및 발행

이 문서는 발행 절차입니다. 체크 항목은 수행한 근거를 확인한 뒤 완료로 표시합니다. PR·CI 성공은 병합이나 npm 발행 승인이 아닙니다.

## 후보 준비

- [x] npm 0.1.0 배포 메타데이터와 포함 문서를 대조해 [최초 릴리즈 기록](0.1.0.ko.md) 작성
- [x] #11의 로컬 실행 변경을 main 기준 후속 릴리즈 작업 브랜치에 반영
- [x] `package.json`, lockfile, CLI/MCP 식별 버전 0.2.0 확인
- [x] [0.2.0 한국어 릴리즈 노트](0.2.0.ko.md) 작성
- [x] 타입 검사 → 빌드 → 테스트 166개 → 설치된 tarball smoke 통과(실제 공급자 호출 없음)
- [x] 동일 동결 입력으로 Claude·Antigravity 독립 리뷰 및 지적 처리(통합·릴리즈 문서 범위)
- [ ] Issue를 연결한 main 대상 Draft PR 생성 및 CI 통과

## 검토와 병합

- [ ] 사용자가 Draft를 확인한 뒤 Ready for review로 전환
- [ ] Codex 자동리뷰 지적 수정, 수정한 스레드 Resolve, 필수 검사 통과
- [ ] 사람이 직접 병합하거나 명시적 병합 승인 후 에이전트가 병합
- [ ] main에 로컬 실행 변경과 0.2.0 메타데이터가 실제 포함됐는지 확인

## 발행 승인 후 수행

- [ ] 병합된 main의 정확한 커밋을 고정하고 깨끗한 체크아웃에서 재현 가능한 발행 tarball 준비
- [ ] `npm pack --dry-run`과 설치 smoke로 CLI·마이그레이션 포함, 비밀·개인 배포 설정 제외 확인
- [ ] 실제 tarball의 name/version/무결성을 기록하고 명시적 발행 승인 확인
- [ ] 승인된 tarball을 npm `rebut-mcp@0.2.0`으로 발행하고 레지스트리 버전·무결성 확인. `gitHead`가 있으면 고정한 소스 커밋과 일치하는지 확인하고, 없으면 GitHub 릴리즈에 소스 커밋 SHA와 tarball 무결성을 명시
- [ ] 같은 소스 커밋에 `v0.2.0` 태그와 한국어 GitHub 릴리즈 작성. GitHub Release 본문에서 후보 문구를 실제 발행 결과로 바꾸고 커밋·npm 무결성을 기재. 저장소의 후보 문서 갱신이 필요하면 별도 Issue/PR로 처리하며 태그를 이동하지 않음
- [ ] 기존 클라이언트 업데이트 및 Worker 배포는 각각 승인 범위에서 수행하고 CLI → MCP 등록 → 호스트 재시작 → Worker 순서를 지킴

0.1.0에는 확인된 Git 태그·npm `gitHead`가 없습니다. 최초 릴리즈 문서는 실제 npm 배포물을 기준으로 하며, 나중 커밋을 최초 배포 커밋으로 추정해 `v0.1.0` 태그를 만들지 않습니다.

## 보존할 운영 상태

기존 자격증명, 모델 프로필, 요청 ID, 미해결 예약·사용량은 초기화하지 않습니다. 백엔드 전환은 장부 이관이 아니며, unknown은 추가 유료 호출이나 환불의 근거가 아닙니다. 롤백 시에도 같은 장부와 원래 요청 ID를 보존해야 합니다. 로컬 원장을 사용하는 상태에서 로컬 기능이 없는 0.1.0으로 내려가면 같은 백엔드의 상태 조회를 계속할 수 없으므로 단순한 버전 교체를 복구 절차로 간주하지 않습니다.

## GitHub Actions Trusted Publisher

`.github/workflows/publish.yml`은 수동 실행 전용입니다. main push, PR 병합, GitHub Release 게시만으로 npm 발행을 시작하지 않습니다. 이 워크플로가 main에 병합되고 npm 설정이 등록된 뒤부터 사용할 수 있습니다. 이미 발행한 버전을 다시 게시하지 않습니다.

npm의 `rebut-mcp` Trusted Publisher 입력값:

| 항목                 | 값                        |
| -------------------- | ------------------------- |
| Publisher            | GitHub Actions            |
| Organization or user | `abruption`               |
| Repository           | `rebut`                   |
| Workflow filename    | `publish.yml` (경로 제외) |
| Environment name     | `npm`                     |
| Allow npm publish    | 선택                      |
| Allow npm dist-tag   | 선택하지 않음             |

GitHub Environment `npm`은 `main` 브랜치만 허용하며 `abruption`의 실행별 승인을 요구합니다. 단독 소유자가 직접 실행·승인할 수 있도록 self-review 금지는 사용하지 않습니다. 관리자 승인 우회는 허용하지 않습니다. 토큰을 Actions secret으로 추가하지 않습니다. [npm 공식 문서](https://docs.npmjs.com/trusted-publishers/)의 OIDC 인증과 provenance를 사용합니다.

1. 새 버전 변경을 기존 Issue → Draft PR → 사용자 Ready → Codex 리뷰 → 승인된 병합 순서로 main에 반영합니다.
2. 현재 npm `latest`보다 높은 버전을 선택하고, 현재 main 커밋에 패키지 버전과 일치하는 안정 버전 태그(`v0.2.1` 등)를 생성합니다. 이 예시는 지금 새 버전을 발행하라는 지시가 아닙니다.
3. Actions에서 `Publish npm package`를 main 대상으로 수동 실행하고 해당 태그를 입력합니다. 태그 커밋과 workflow 실행의 main SHA가 정확히 같아야 합니다. 실행 전 main이 이동했다면 올바른 커밋을 다시 확인합니다.
4. 빌드 작업이 타입 검사·빌드·테스트·설치 smoke·패키지 목록을 확인하고 tarball 한 개와 SHA-256을 생성합니다. 빌드 작업에는 OIDC 쓰기 권한이 없습니다.
5. 빌드 요약의 소스·버전·SHA-256을 확인한 후 **7일 이내에** Environment 배포를 명시적으로 승인합니다. artifact 보존 기간이 지났다면 원래 버전의 발행 여부를 먼저 확인한 뒤 새 실행을 준비합니다. 이것이 해당 버전의 npm 발행 승인 단계입니다. 승인하지 않을 실행은 거부하거나 취소해 후속 실행을 막지 않도록 합니다.
6. 게시 직전에도 버전 존재 여부와 `latest`보다 높은지 재확인합니다. 게시 작업만 `id-token: write`를 가지며 검증한 tarball을 재빌드 없이 게시합니다. npm 레지스트리에서 내려받은 파일의 SHA-256과 provenance 메타데이터 존재를 확인합니다.

게시가 성공한 뒤 레지스트리 처리 지연이나 검증 오류가 나면 **전체 워크플로를 무작정 재실행하지 않습니다.** 원래 실행과 해당 버전의 공개 상태·무결성을 먼저 확인합니다. GitHub Release는 확정된 소스·버전·무결성을 기재해 별도로 한국어로 작성합니다. Worker 배포와 기존 설치 업데이트는 이 워크플로에 포함되지 않습니다. 과거 0.2.0 배포물에는 OIDC provenance가 소급 추가되지 않습니다.
