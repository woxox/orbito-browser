<div align="center">

# Orbito

**차분하고 집중하기 좋은 웹 브라우저. Firefox 위에 만들었다.**

세로 탭, 생활 영역마다 나뉘는 Space, 무엇이든 치는 입력창 하나,
그리고 내용으로 찾을 수 있는 방문 기록.

[**다운로드**](../../releases/latest) · [기능](#기능) · [개인정보](#개인정보) · [소스에서 빌드](#소스에서-빌드)

[English](README.md) · 한국어

</div>

---

## Orbito를 쓰는 이유

- **탭이 거슬리지 않는다.** Firefox의 탭 바와 툴바 대신 조용한 Sidebar를 두어 페이지가 창 전체를 쓴다.
- **Space로 맥락을 나눈다.** 일, 개인 프로젝트, 읽을거리마다 탭과 고정 사이트를 따로 둔다.
- **입력창은 하나.** 주소와 검색을 같은 Command bar에서 친다.
- **읽은 것을 다시 찾는다.** "지난주에 본 그 글"을 제목이 아니라 내용으로 찾는다. 색인과 검색 모델은 기기 밖으로
  나가지 않는다.
- **엔진은 Firefox.** 웹 표준, 확장, 보안은 Firefox의 엔진인 Gecko가 맡는다.

## 다운로드

[**Releases**](../../releases/latest)에서 최신 버전을 받는다.

| OS | 파일 |
| --- | --- |
| macOS (Apple silicon) | `Orbito-<버전>-macos-aarch64.dmg` |
| Windows (x86_64) | `Orbito-<버전>-windows-x86_64-setup.exe` (설치 프로그램) |
| Windows (x86_64, 포터블) | `Orbito-<버전>-windows-x86_64.zip` |
| Linux (x86_64) | `Orbito-<버전>-linux-x86_64.tar.xz` |

- **macOS**: Developer ID로 서명하고 Apple 공증을 받았다. dmg를 열고 Orbito를 응용 프로그램 폴더로 끌어 놓는다.
- **Windows**: 아직 서명하지 않아 처음 실행할 때 SmartScreen 경고가 뜰 수 있다. 설치 프로그램은 시작 메뉴
  바로가기와 제거 항목을 만들고, 업데이트를 관리자 확인 없이 적용하는 서비스를 함께 설치한다. zip은 압축을 푼
  폴더에서 바로 실행하며, 업데이트하려면 그 폴더에 쓰기 권한이 있어야 한다.
- **Linux**: 압축을 푼 `orbito/` 폴더의 `orbito`를 실행한다. zip과 같이 업데이트하려면 그 폴더에 쓰기 권한이
  있어야 한다.

받거나 쓰는 데 계정은 필요 없다. 설치한 뒤에는 앱이 새 릴리즈를 확인해 받아 두고, 다시 시작하면 적용한다.
설정의 업데이트 항목에서 직접 확인할 수도 있다.

## 기능

### 세로 레이아웃 Shell

- **Sidebar**: 창 왼쪽 전체 높이. 맨 위 **Pin**(모든 Space 공통 아이콘), 그 아래 **Dock**(이 Space의 고정 탭),
  탭 목록, 맨 아래 Space 전환기.
- **Top bar**: 페이지 위 짧은 막대. 사이트 정보, URL, 확장, 리더 보기.
- **Command bar**: ⌘T / ⌘L로 여는 입력창. 주소와 검색을 한곳에서 받는다.

### Space

탭과 Dock을 작업 맥락별로 묶는다. Space를 바꾸면 Sidebar의 탭과 Dock이 그 Space 것으로 바뀌어, 하던 곳에서
바로 이어 간다.

### 브라우징 기억

10초 이상 머물거나 스크롤한 페이지의 본문을 **이 기기 안에만** 색인한다. 키워드 검색에 의미 검색을 더해,
제목이 기억나지 않는 페이지도 내용으로 찾는다.

- 주소창의 "기억에서" 제안과 날짜별 타임라인에서 쓴다.
- 의미 검색 모델(EmbeddingGemma 300M)을 앱에 같이 넣었다. 인터넷 없이 첫 실행부터 동작한다.
- 사생활 보호 창, 비밀번호 입력란이 있는 페이지, 은행·메일 같은 민감 사이트는 기억하지 않는다.

### 선택 기능: Assistant panel

오른쪽에 쓰고 싶을 때만 켜는 어시스턴트 패널이 있다(macOS ⌥⌘A, Windows Ctrl+Shift+Space). 설정에서 직접
AI 제공업체를 연결하기 전까지는 동작하지 않고, 연결하든 안 하든 브라우징은 똑같다.

연결하면 지금 탭에 대해 묻거나, 승인을 받아 페이지를 열고 읽게 할 수 있다. 어시스턴트가 연 탭은 Sidebar에
묶여 보이고, 끝나면 남길지 닫을지 고른다. **Show Orbito**로 한 번 해 보인 작업을 기록해 두면 어시스턴트가
따라 한다.

## 개인정보

- **브라우징 기억은 기기 안에 남는다.** 색인하고 찾을 때 기기 밖으로 보내는 것은 없다. 타임라인의 "요약"을
  눌렀을 때만 연결한 AI 제공업체를 부른다. 민감 사이트 목록, 보존 기간(30일~무기한), 일시정지, 전체 삭제는
  설정에서 바꾼다.
- **어시스턴트는 직접 켜야 한다.** 설정하기 전에는 어떤 AI 제공업체에도 연결하지 않는다. 질문할 때는 맥락으로
  고른 탭의 본문만 가고, 제외 사이트로 지정한 탭은 빠진다.
- **텔레메트리는 꺼 두었다.** Orbito 빌드는 Firefox의 텔레메트리 보고와 상태 보고를 끈다.

## AI 제공업체 (선택)

어시스턴트를 쓰려면 설정(`about:orbito-settings`)에서 고른다. 계정이나 API 키는 직접 준비해야 한다.

| 제공업체 | 인증 | 요청이 가는 곳 |
| --- | --- | --- |
| Claude | Claude 계정 로그인, Anthropic API 키, 또는 클라우드 제공업체(Amazon Bedrock, Google Cloud Vertex AI, Microsoft Foundry) | Anthropic API 또는 고른 클라우드 제공업체 (앱에 같이 넣은 Claude Code CLI를 거친다) |
| ChatGPT | Sign in with ChatGPT | OpenAI. 서버에 대화를 저장하지 않도록(`store: false`) 보낸다 |
| OpenAI 호환 | API 키와 주소 | 지정한 Chat Completions 서버 (로컬 서버도 된다) |

- Claude의 CLI는 프로필 안에 따로 설정 폴더를 두어, 이 PC의 `~/.claude` 로그인·설정과 섞이지 않는다.
  CLI 내장 도구(Bash, 파일 등)는 꺼 두고 Orbito의 브라우저 도구만 쓴다.

## 소스에서 빌드

이 저장소는 릴리즈마다 그 버전의 소스를 커밋 하나로 올린다. [Zen](https://github.com/zen-browser/desktop)과
같은 방식으로 [surfer](https://github.com/zen-browser/surfer)를 써서 Firefox 소스에 Orbito의 패치와 소스를
얹어 빌드한다.

```sh
pnpm install
pnpm run init      # Firefox 소스 받기 → 패치 적용 → 빌드 도구 설치
pnpm build         # 첫 빌드는 오래 걸린다 (M1/M2 기준 30분~1시간+)
pnpm start
```

- `pnpm build`는 빌드 전에 Claude Code CLI(`scripts/agent-runtime.py`, 타깃당 약 270MB)와 의미 검색 모델
  (`scripts/recall-model.py`, 약 220MB)을 받아 `dist/`에 둔다. 받은 파일은 고정한 해시로 검증한다.
- UI(JS/CSS)만 바꿨다면 `pnpm build:ui`로 빠르게 다시 빌드한다.
- Windows는 [MozillaBuild](https://wiki.mozilla.org/MozillaBuild) 셸에서 돌리고, 먼저
  `git config core.autocrlf false`를 해 둔다(CRLF로 받으면 패치 적용이 깨진다).

| 경로 | 내용 |
| --- | --- |
| `surfer.json` | 기반 Firefox 버전, 앱 이름, 브랜드 설정 |
| `configs/` | mozconfig, 브랜딩 이미지 |
| `src/` | `engine/`(받아 온 Firefox 소스)에 얹는 Orbito 소스 |
| `src/**/*.patch` | Firefox 파일에 적용하는 패치 |
| `src/browser/base/content/orbito/` | Shell, Assistant panel, 브라우징 기억, 설정 페이지 |
| `src/browser/app/profile/orbito.js` | Orbito 기본 prefs |

## 라이선스

### Orbito

이 저장소의 소스는 [Mozilla Public License 2.0](LICENSE)(MPL-2.0)을 따른다.

### Firefox(Gecko)

Orbito는 Mozilla Firefox 소스로 만든다. 그 소스는 이 저장소에 없고 `pnpm run init`이 받아 오며, 대부분
MPL-2.0이고 일부는 각 파일에 적힌 다른 오픈소스 라이선스를 따른다. 전체 목록은 앱에서 `about:license`로 본다.

Firefox와 Mozilla는 Mozilla Foundation의 상표다. Orbito는 Mozilla와 관계가 없고, Mozilla가 보증하거나
지원하지 않는다.

### 앱에 같이 넣은 구성 요소

아래 두 가지는 배포 패키지에 들어 있지만 MPL-2.0이 아니라 각자의 약관을 따른다. 이 저장소에는 없고,
빌드할 때 원래 배포처에서 받는다.

| 구성 요소 | 권리자 | 약관 |
| --- | --- | --- |
| Claude Code CLI (`orbito-agent/`) | Anthropic PBC | Anthropic의 [Legal Agreements](https://code.claude.com/docs/en/legal-and-compliance). 수정하지 않은 원본 바이너리를 넣는다 |
| EmbeddingGemma 300M (`browser/orbito-models/`) | Google | [Gemma Terms of Use](https://ai.google.dev/gemma/terms)와 [Prohibited Use Policy](https://ai.google.dev/gemma/prohibited_use_policy) |

- Claude Code CLI는 Anthropic 소유(© Anthropic PBC, All rights reserved)다. Orbito는 이 약관에 맞춰 넣는다.
  - 바이너리를 고치지 않고, 내장 인증 방식(Claude 계정, API 키, 클라우드 제공업체)을 막거나 빼지 않는다.
  - 사용자가 자기 API 키, 구독, 클라우드 자격증명으로 인증한다. Orbito는 사용량을 대신 결제·재판매·중개하지 않는다.
  - 계정 로그인은 CLI가 Anthropic의 흐름으로 하고, Orbito는 계정 토큰을 읽거나 저장하지 않는다.
- Claude 계정(구독) 방식의 사용 범위는 Anthropic이 예고 없이 바꿀 수 있다. 언제든 막히거나 따로 과금될 수 있으니
  계속 쓸 용도라면 API 키나 클라우드 제공업체를 권한다.
- EmbeddingGemma는 [onnx-community의 ONNX 변환본](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX)을
  Orbito가 고친 것이다(가중치를 모델 파일 안에 넣고, 출력 하나를 문장 벡터로 바꿨다). 모델 옆 `NOTICE`에
  출처와 고친 내용을 적어 두었다.
- ChatGPT, OpenAI 호환 제공업체를 쓰면 그 서비스의 약관이 적용된다.
