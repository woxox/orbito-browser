# Orbito

Firefox(Gecko) 기반 커스텀 브라우저. [Zen](https://github.com/zen-browser/desktop)과 같은 방식으로
[surfer](https://github.com/zen-browser/surfer)를 사용해 Firefox 소스 위에 패치/소스를 얹어 빌드한다.

빌드된 macOS·Windows 패키지는 [Releases](../../releases)에서 받을 수 있다. 이 저장소는 릴리즈마다
그 버전의 소스를 커밋 하나로 올린다.

## 구조

| 경로 | 설명 |
| --- | --- |
| `surfer.json` | 기반 Firefox 버전, 앱 이름/ID, 브랜드 설정 |
| `configs/` | mozconfig(공통/OS별), 브랜딩 이미지 |
| `src/` | `engine/`에 그대로 복사(심볼릭 링크)되는 커스텀 소스 |
| `src/**/*.patch` | `engine/`의 Firefox 파일에 적용되는 패치 |
| `engine/` | 다운로드된 Firefox 소스 (git 추적 안 함) |
| `src/browser/themes/shared/orbito/orbito.css` | Shell의 `--orbito-*` 토큰(라이트/다크, accent 하나), 고정 레이아웃, 숨기는 Firefox 크롬 |
| `src/browser/base/content/orbito/shell/` | Shell 컴포넌트(`MozLitElement`): Sidebar, 탭 목록, Top bar, 창 버튼. `shell.mjs`가 창에 넣고 F6 영역 이동을 맡는다. `removed-features.mjs`는 없앤 Firefox 기능(Firefox View, 북마크 툴바, ☰ 앱 메뉴, 맞춤 모드)의 진입점을 막는다. |
| `src/browser/base/content/orbito/assistant.js` | 오른쪽 AI 패널 (OpenAI 호환 API로 페이지 요약/질문, macOS ⌥⌘A, 그 외 Ctrl+Shift+Space) |
| `src/browser/base/content/orbito/OrbitoUrlbarProvider.sys.mjs` | 주소창 "Ask Orbito" 결과. `OrbitoRouter.sys.mjs`가 입력을 주소/검색어/질문으로 나누고, 질문이면 Enter로 패널에 묻는다 (`orbito.assistant.urlbar`로 끔) |
| `src/browser/base/content/orbito/ClaudeCLI.sys.mjs` | 번들한 Claude Code CLI를 질문마다 띄우고(stream-json) Claude 계정 로그인을 CLI에 맡긴다. 브라우저 도구는 `OrbitoMCPServer.sys.mjs`의 localhost MCP로 넘긴다 |
| `src/browser/base/content/orbito/OrbitoMCP.sys.mjs` | 설정에서 추가한 HTTP MCP 서버에 붙어 그 도구를 레지스트리에 등록한다. 메시지·SSE 파싱은 `OrbitoMCPProtocol.sys.mjs` |
| `src/browser/base/content/orbito/settings/` | `about:orbito-settings` 설정 페이지. `OrbitoPages.sys.mjs`가 Firefox 파일 패치 없이 실행 중에 about 페이지로 등록한다 |
| `src/browser/base/content/orbito/OrbitoOAuth.sys.mjs` | 탭에서 하는 OAuth 로그인. loopback 콜백 주소로 가는 요청을 네트워크로 나가기 전에 막고 `code`를 꺼낸다. PKCE·URL·콜백 파싱은 `OrbitoOAuthProtocol.sys.mjs` |
| `src/browser/base/content/orbito/OrbitoChatGPT.sys.mjs` | Sign in with ChatGPT 로그인과 토큰 보관 |
| `src/browser/base/content/orbito/backends/` | 백엔드: Claude(Claude Code CLI), OpenAI 호환(Chat Completions), ChatGPT(Responses API, `store: false`로 매번 전체 기록을 보냄) |
| `src/browser/app/profile/orbito.js` | Orbito 기본 prefs (세로 탭 등), `firefox.js` 끝에서 include |

## 시작하기

```sh
pnpm install
pnpm run init      # download → import → bootstrap
pnpm build         # 첫 빌드는 오래 걸린다 (M1/M2 기준 30분~1시간+)
pnpm start
```

UI(JS/CSS)만 바꿨다면 `pnpm build:ui`로 빠르게 재빌드할 수 있다.

## Firefox 파일 수정 흐름

1. `engine/` 안의 Firefox 파일을 직접 수정
2. `pnpm run export <engine 기준 경로>` → `src/` 아래에 `.patch` 생성
3. 패치를 커밋

## Firefox 버전 올리기

`surfer.json`의 `version` 수정 후 `pnpm sync:raw` (또는 `pnpm reset-ff && pnpm run init`).

## Windows

[MozillaBuild](https://wiki.mozilla.org/MozillaBuild)를 `C:\mozilla-build`에 설치하고, 명령은 모두
MozillaBuild 셸(`C:\mozilla-build\start-shell.bat`)에서 돌린다. pnpm 스크립트가 POSIX sh라서 이 셸에서는
`npm_config_script_shell`을 MozillaBuild의 bash로 둔다(예: `~/.bash_profile`에서 `$MOZILLABUILD`가 있을 때 export).

```sh
git config core.autocrlf false    # 패치·셸 스크립트가 CRLF로 체크아웃되면 import가 깨진다
pnpm install
pnpm run init
pnpm build
pnpm start
```

- Windows에서는 surfer가 `src/`를 `engine/`에 심볼릭 링크하지 않고 복사한다. `src/`를 고친 뒤에는
  `pnpm run import`를 다시 돌려야 `engine/`에 반영된다.

## Claude 백엔드 (Claude Code CLI)

어시스턴트 설정에서 Backend를 Claude로 고르면, 앱에 같이 넣은 Claude Code CLI(`claude`)를 질문마다
`claude -p --input-format stream-json --output-format stream-json`으로 띄운다(`ClaudeCLI.sys.mjs`).
모델은 Orbito의 브라우저 도구만 쓸 수 있고(`OrbitoMCPServer.sys.mjs`가 127.0.0.1에 여는 MCP), Bash·파일 등
CLI 내장 도구는 꺼져 있다.

- CLI는 Anthropic의 npm 패키지(`@anthropic-ai/claude-code-<플랫폼>`)에서 수정 없이 꺼내 브라우저 바이너리 옆
  `orbito-agent/`에 넣는다(타깃당 약 270MB).
  - `pnpm build`가 빌드 전에 `scripts/agent-runtime.py`로
    `dist/agent-runtime/<타깃>/`를 채운다. 버전은 스크립트의 `CLAUDE_VERSION`, 받은 파일은 npm integrity로 검증한다.
  - 다른 타깃은 `pnpm agent-runtime <타깃>`(또는 `all`). 타깃: `{aarch64,x86_64}-apple-darwin`,
    `{aarch64,x86_64}-unknown-linux-gnu`, `{aarch64,x86_64}-pc-windows-msvc`. 실제 실행 확인은 호스트 타깃만 한다.
  - 런타임이 없는 빌드에서는 `orbito.agent.claude`에 `claude` 경로를 지정한다.
- 인증 방식은 설정에서 고른다. CLI는 프로필 아래 `orbito-agent/claude`를 `CLAUDE_CONFIG_DIR`로 써서, 이 PC의
  `~/.claude` 로그인·설정을 쓰지 않는다.
  - API 키: `ANTHROPIC_API_KEY`로 넘긴다. `orbito.agent.baseURL`을 지정하면 `ANTHROPIC_BASE_URL`로 넘긴다.
  - Claude 계정: CLI의 `auth login --claudeai`로 로그인한다. 계정 자격증명이 Anthropic API로만 가도록
    `orbito.agent.baseURL`은 쓰지 않는다.
- macOS 배포용 서명·공증은 아직 없다. 번들 안 `claude`는 Anthropic의 원래 서명을 그대로 둬야 한다.
  앱 인증서로 다시 서명하지 말고, 앱 번들 서명에 `--deep`을 쓰지 않는다.

## 브라우징 기억 embedding 모델

브라우징 기억(`OrbitoRecall.sys.mjs`)의 의미 검색은 앱에 같이 넣은 Google EmbeddingGemma 300M(q4 ONNX,
Gemma 이용약관)을 Firefox ML engine의 native ONNX runtime으로 돌린다. 네트워크 없이 첫 실행부터 동작한다.
벡터는 앞 256차원만 쓴다(Matryoshka).

- `pnpm build`가 빌드 전에 `scripts/recall-model.py`로
  `dist/recall-model/`을 채운다(약 220MB). 받은 파일과 고친 모델은 revision과 sha256으로 고정한다.
- 공개 ONNX 파일을 두 가지 고친다(스크립트가 `dist/recall-model-tools/` virtualenv의 `onnx`로 처리).
  - 가중치(`.onnx_data`)를 모델 파일 안에 넣는다. native runtime은 모델을 바이트로만 읽어서 따로 둔 가중치를 못 찾는다.
  - `last_hidden_state` 출력을 모델의 최종 벡터(`sentence_embedding`)를 토큰마다 복사한 값으로 바꾼다.
    Firefox의 feature-extraction이 이것을 평균 내면 모델의 최종 벡터가 그대로 나온다.
- 빌드는 이 디렉터리를 `browser/orbito-models/`(`resource:///orbito-models/`)로 넣는다. 모델이 없는 빌드는
  키워드 검색만 한다.
- ML engine은 처음 쓸 때 모델 파일을 프로필의 OPFS 캐시로 복사한다(프로필당 약 220MB 더).
- Firefox의 다른 AI 기능은 `orbito.js`에서 계속 잠가 두고 `browser.ml.enable`만 켠다.

## 라이선스

Orbito의 소스는 [MPL 2.0](https://mozilla.org/MPL/2.0/)을 따른다. 기반이 되는 Firefox 소스는
`surfer.json`의 버전으로 `pnpm run init`이 받아 오며, 각 파일의 라이선스를 따른다.
