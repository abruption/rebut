<div align="center">

# Rebut

[![npm version](https://img.shields.io/npm/v/rebut-mcp)](https://www.npmjs.com/package/rebut-mcp)
[![npm downloads](https://img.shields.io/npm/dm/rebut-mcp)](https://www.npmjs.com/package/rebut-mcp)
[![MIT license](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/abruption/rebut/blob/main/LICENSE)

**로컬에서 바로 실행하는 독립 코드 검토 MCP. Cloudflare Worker는 선택 사항입니다.**

**한국어** · [English](README.en.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

</div>

Rebut은 지정한 코드와 diff를 OpenAI 또는 Claude API로 보내 검토하는 MCP 서버입니다. 검토 자료는 선택한 공급자에게 전송합니다.

Claude 지원은 0.3.0 이상에서 `rebut set provider anthropic` → `rebut set api-key` → `rebut setup --client claude` 순서로 설정합니다. 호스트와 공급자는 별도 선택입니다.

## 빠른 시작

Node.js 24 이상이 필요합니다. macOS Keychain을 사용하는 예입니다.

```sh
npm install -g rebut-mcp
rebut set api-key
rebut setup --client codex
rebut doctor --connect
```

등록 후 Codex를 재시작하세요. Linux/env·Vaultwarden 설정은 [설치 안내](docs/guide/ko/installation.md)를 참고하세요.

새 설치는 로컬 stdio를 사용합니다. 여러 기기의 예산·요청 장부를 공유하려면 [Worker 모드](docs/guide/ko/installation.md#선택적-worker-배포)를 선택하세요. 기존 Worker 설정은 유지됩니다.

`review`는 유료 호출입니다. `doctor --connect`로 연결을 확인할 때는 모델을 호출하지 않습니다. 결과가 불확실하면 새 ID로 재시도하지 말고 같은 백엔드에서 원래 요청 ID의 상태를 확인하세요.

## 사용 안내

- [설치](docs/guide/ko/installation.md)
- [설정](docs/guide/ko/configuration.md)
- [운영](docs/guide/ko/operations.md)

[릴리즈](https://github.com/abruption/rebut/releases) · [MIT](LICENSE)
