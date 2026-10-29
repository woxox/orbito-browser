# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Settings page

orbito-settings-title = Orbito 설정
orbito-settings-heading = Orbito 설정
orbito-settings-library-hint = 지난 문서와 Thread는 <a data-l10n-name="open-library">라이브러리</a>에 있어요.
orbito-settings-panes =
    .aria-label = 설정 항목
orbito-settings-general = 일반
# The rail's group of the Assistant's panes.
orbito-settings-assistant = Assistant

## Shared

orbito-settings-cancel = 취소
orbito-settings-save = 저장
orbito-settings-delete = 삭제
orbito-settings-edit = 편집
orbito-settings-on = 사용
orbito-settings-name = 이름

## Appearance

orbito-settings-appearance = 모양
orbito-settings-theme = 테마
orbito-settings-theme-hint = 시스템 설정을 따르거나 직접 고릅니다.
orbito-settings-accent = Accent 색
orbito-settings-accent-hint = 창 테두리 그라데이션과 강조 색이 함께 바뀝니다.
orbito-settings-no-firefox-themes =
    Firefox 테마는 쓰지 않습니다. 부가 기능은 테마를 설치하거나
    브라우저 색상을 바꿀 수 없습니다.
orbito-appearance-theme-system = 시스템
orbito-appearance-theme-light = 라이트
orbito-appearance-theme-dark = 다크
orbito-appearance-accent-violet = 보라 (기본)
orbito-appearance-accent-blue = 파랑
orbito-appearance-accent-green = 초록
orbito-appearance-accent-coral = 산호
orbito-appearance-accent-graphite = 흑연

## Layout

orbito-settings-layout = 레이아웃
# $shortcut is the keyboard shortcut, e.g. "⌘S".
orbito-settings-sidebar-collapsed = Sidebar 자동 숨김
orbito-settings-sidebar-collapsed-hint =
    창 왼쪽 끝에 포인터를 대면 나타납니다. { $shortcut }로도 바꿉니다.
orbito-settings-assistant-auto-open = Assistant panel 자동 열기
orbito-settings-assistant-auto-open-hint = 새 창을 열 때 오른쪽 패널을 함께 엽니다.

## Account

orbito-settings-account = 계정
orbito-settings-sync = Mozilla 계정으로 동기화
orbito-settings-sync-hint = 북마크, 기록, 비밀번호, 열린 탭을 다른 기기와 맞춥니다.
orbito-settings-sync-disabled = 이 브라우저에서는 동기화가 꺼져 있어요.
orbito-settings-sync-login-failed = { $email } 계정으로 계속 동기화하려면 다시 로그인하세요.
orbito-settings-sync-not-verified = { $email } 주소로 보낸 이메일에서 계정을 확인하세요.
orbito-settings-sync-off = { $email } 계정으로 로그인했어요. 동기화가 꺼져 있어요.
orbito-settings-sync-syncing = { $email } 계정으로 로그인했어요. 동기화 중…
# $date is when Sync last ran, as a date and time.
orbito-settings-sync-last-synced = { $email } 계정으로 로그인했어요. 마지막 동기화: { $date }
orbito-settings-sync-not-synced = { $email } 계정으로 로그인했어요. 아직 동기화하지 않았어요.
orbito-settings-not-signed-in = 로그인하지 않았어요.
orbito-settings-sign-in = 로그인
orbito-settings-sign-in-again = 다시 로그인
orbito-settings-sign-out = 로그아웃
orbito-settings-manage-account = 계정 관리
orbito-settings-confirm-account = 계정 확인
orbito-settings-turn-on-sync = 동기화 켜기
orbito-settings-choose-what-to-sync = 동기화할 항목 선택
orbito-settings-sync-now = 지금 동기화

## Backends

orbito-settings-backends = 백엔드
orbito-settings-chatgpt-hint =
    ChatGPT 백엔드에서 ChatGPT Plus 또는 Pro 구독을 사용합니다.
    로그인은 OpenAI 페이지에서 하며, Orbito는 비밀번호를 볼 수 없습니다.
orbito-settings-chatgpt-login = ChatGPT로 로그인
orbito-settings-chatgpt-signing-in = 새 탭에서 로그인하기를 기다리는 중…
orbito-settings-chatgpt-signed-in-as = { $email } 계정으로 로그인했어요.
orbito-settings-chatgpt-signed-in = 로그인했어요.
orbito-settings-chatgpt-needs-login = 다시 로그인하세요. 로그인이 만료됐거나 취소됐어요.
orbito-settings-claude-hint =
    Orbito는 Anthropic의 CLI인 Claude Code를 Anthropic API 키, Claude 구독, 클라우드 제공업체 중 하나로 실행합니다.
    Claude Code에는 Anthropic의 약관이 적용되며, 구독으로 쓸 수 있는 범위는 Anthropic이 바꿀 수 있습니다.
    Claude Code가 브라우저에서 Orbito 전용으로 로그인하며, 이 컴퓨터의 Claude Code 로그인은 쓰지 않습니다.
orbito-settings-claude-auth =
    .aria-label = 인증 방식
orbito-settings-claude-api-key = API 키
orbito-settings-claude-account = Claude 계정
orbito-settings-claude-cloud = 클라우드 제공업체
orbito-settings-claude-cloud-provider = 제공업체
orbito-settings-claude-cloud-region = 리전
orbito-settings-claude-cloud-profile = AWS 프로필
orbito-settings-claude-cloud-project = 프로젝트 ID
orbito-settings-claude-cloud-resource = 리소스 이름
orbito-settings-claude-cloud-key = API 키 (선택)
orbito-settings-claude-cloud-bedrock-hint =
    Amazon Bedrock API 키가 없으면 Claude Code는 이 컴퓨터의 ~/.aws에 있는 AWS 자격증명을 씁니다
    (터미널에서 aws sso login이나 aws configure로 로그인). 프로필에 리전이 있으면 리전은 비워 둬도 됩니다.
orbito-settings-claude-cloud-vertex-hint =
    Claude Code는 이 컴퓨터의 Google Cloud 애플리케이션 기본 자격증명을 씁니다
    (터미널에서 gcloud auth application-default login으로 로그인). 리전을 비우면 us-east5를 씁니다.
orbito-settings-claude-cloud-foundry-hint =
    리소스는 URL이 아니라 이름만 넣습니다. API 키가 없으면 Claude Code가 Azure CLI(az login)로 로그인하는데,
    Orbito를 터미널에서 띄우지 않았다면 az를 찾지 못할 수 있습니다. API 키는 어느 쪽이든 됩니다.
orbito-settings-claude-cloud-set-up = 제공업체를 고르고 설정을 채운 뒤 저장하세요.
# $provider is the cloud provider's name, e.g. "Amazon Bedrock".
orbito-settings-claude-cloud-ready = Claude를 { $provider }로 씁니다.
orbito-settings-claude-uses-key = 키는 Assistant panel의 설정에서 넣습니다.
orbito-settings-claude-choose = Claude를 어떻게 쓸지 고르세요.
orbito-settings-claude-login = Claude로 로그인
orbito-settings-claude-signing-in = 브라우저에서 로그인하기를 기다리는 중…
orbito-settings-claude-signed-in-as = { $email } 계정으로 로그인했어요.
orbito-settings-claude-signed-in = 로그인했어요.

## Spaces

orbito-settings-spaces = Space
orbito-settings-spaces-hint =
    Space마다 이름, 새 Thread가 시작할 때 쓸 백엔드와 모델, 그 Space에서만 쓰는 것을 봐요.
    비워 두면 Assistant panel에서 고른 백엔드와 모델을 따라요. Thread는 시작한 뒤에는 백엔드를 바꾸지 않아요.
orbito-settings-space-backend-default = 전체 설정 따르기
orbito-settings-space-name = 이름
orbito-settings-space-memories = 이 Space에서만 쓰는 메모리
orbito-settings-space-skills = 이 Space에서만 쓰는 스킬
orbito-settings-space-none = 없어요
orbito-settings-space-remove = Space 지우기

## Memory

orbito-settings-memory = 메모리
orbito-settings-memory-hint =
    Assistant에게 기억하라고 한 사실이에요. 새 Thread마다 들어가고,
    사생활 보호 창에서는 쓰지 않아요.
orbito-settings-memory-enabled = 메모리 사용
orbito-settings-memory-enabled-hint = Thread에서 메모리를 읽고, 요청하면 새로 저장
orbito-settings-memory-space = 쓰는 Space
orbito-settings-memory-all-spaces = 모든 Space
orbito-settings-memory-space-gone = 지운 Space
orbito-settings-memories-empty = 아직 메모리가 없어요.
orbito-settings-memories-clear-question = 모든 메모리를 삭제할까요? 되돌릴 수 없습니다.
orbito-settings-memories-clear-confirm = 모두 삭제
orbito-settings-memories-clear-start = 모든 메모리 삭제
# $saved and $used are dates and times.
orbito-settings-memory-meta-used = 저장: { $saved }, 마지막 사용: { $used }
orbito-settings-memory-meta-unused = 저장: { $saved }, 아직 사용 안 함
# Followed by the address of the page the memory was saved from.
orbito-settings-memory-source = 출처:

## Skills

orbito-settings-skills = 스킬
orbito-settings-skills-hint =
    패널이나 Command bar에서 /이름으로 부르는 지침입니다. Assistant가
    알맞은 스킬을 직접 고를 수도 있습니다. 기본 스킬은 바꿀 수 없지만
    사본은 바꿀 수 있으며, 사본이 기본 스킬을 대신합니다.
orbito-settings-skill-new = 새 스킬
orbito-settings-skill-from-demo = 시연으로 만들기
orbito-settings-skill-new-from-thread = Thread로 만든 새 스킬
# $name is the skill's name.
orbito-settings-skill-copy-title = /{ $name } 사본
orbito-settings-skill-edit-title = /{ $name } 편집
orbito-settings-skill-builtin = 기본 제공
orbito-settings-skill-yours = 내 스킬
orbito-settings-skill-from-demo-kind = 시연으로 만든 스킬
orbito-settings-skill-rerecord = 다시 기록
orbito-settings-skill-copy = 복사
orbito-settings-skill-space = 쓰는 Space
orbito-settings-skill-all-spaces = 모든 Space
orbito-settings-skill-space-gone = 지운 Space
orbito-settings-description = 설명
orbito-settings-skill-description-input =
    .placeholder = Assistant가 언제 쓸지
orbito-settings-tools = 도구
orbito-settings-skill-tools-hint =
    지침에서 쓰는 도구를 쉼표로 구분해 적습니다. 여기에만 표시되며,
    Assistant는 여전히 어떤 도구든 쓸 수 있습니다.
orbito-settings-output = 출력
orbito-settings-output-chat = 채팅
orbito-settings-output-document = 문서
orbito-settings-skill-instructions = 지침

## Scheduled tasks

orbito-settings-tasks = 예약 작업
orbito-settings-tasks-hint =
    Assistant가 창 없이 스스로 답하는 질문입니다. 답은 문서로 저장되고,
    준비되면 알림이 옵니다. 작업은 아무것도 바꾸지 않는 도구와
    허용한 다른 도구만 씁니다.
orbito-settings-tasks-empty = 아직 작업이 없어요.
orbito-settings-task-morning-brief = 아침 브리핑
orbito-settings-task-new = 새 작업
# $name is the task's name.
orbito-settings-task-edit-title = { $name } 편집
orbito-settings-task-name-input =
    .placeholder = 리뷰 요청 확인
orbito-settings-skill = 스킬
orbito-settings-task-no-skill = 없음: 질문하기
orbito-settings-question = 질문
orbito-settings-task-prompt-placeholder = 매번 Assistant에게 묻는 내용
orbito-settings-task-prompt-skill-placeholder = 스킬 이름 뒤에 붙일 말 (있으면)
orbito-settings-task-direct-warning = 직접 입력 단계가 있어 실행 중 멈춥니다
orbito-settings-task-inputs = 스킬 입력
orbito-settings-task-inputs-hint = 실행할 때마다 이 값으로 채워요.
orbito-settings-repeat = 반복
orbito-settings-repeat-hourly = 매시간
orbito-settings-repeat-daily = 매일
orbito-settings-repeat-weekly = 매주
orbito-settings-minute = 분
orbito-settings-day = 요일
orbito-settings-weekday-monday = 월요일
orbito-settings-weekday-tuesday = 화요일
orbito-settings-weekday-wednesday = 수요일
orbito-settings-weekday-thursday = 목요일
orbito-settings-weekday-friday = 금요일
orbito-settings-weekday-saturday = 토요일
orbito-settings-weekday-sunday = 일요일
orbito-settings-time = 시간
orbito-settings-task-space = Space
orbito-settings-task-all-spaces = 모든 Space
orbito-settings-task-space-gone = 지운 Space
orbito-settings-task-backend-space = Space 기본값
orbito-settings-backend = 백엔드
orbito-settings-model = 모델
orbito-settings-task-model-input =
    .placeholder = 백엔드의 현재 모델
orbito-settings-allowed-tools = 허용한 도구
orbito-settings-allowed-tools-hint = 무언가를 바꾸는 도구 중 작업이 묻지 않고 쓸 수 있는 도구입니다.
orbito-settings-no-such-tools = 해당하는 도구가 없어요.
orbito-settings-task-running = 실행 중…
# $date is a date and time.
orbito-settings-task-next-run = 다음 실행: { $date }
orbito-settings-task-off = 꺼짐
# $date is a date and time; $status is the run's status.
orbito-settings-task-last-run =
    마지막 실행 { $date }: { $status ->
        [ok] 완료
        [failed] 실패
        [skipped] 건너뜀
       *[other] { $status }
    }
# $state is the task's state (e.g. "Next run …"), $lastRun how its last run went.
orbito-settings-task-meta = { $state }, { $lastRun }
# $tokens is the token counts, e.g. "1,200 in, 80 out tokens".
orbito-settings-task-tokens = 지금까지 사용량: { $tokens }
# $input and $output are counts of tokens.
orbito-settings-tokens = 입력 { $input }, 출력 { $output } 토큰
orbito-settings-task-runs = 실행 기록
orbito-settings-task-run-now = 지금 실행
orbito-settings-runs-empty = 아직 실행 기록이 없어요.
orbito-settings-run-status =
    { $status ->
        [running] 실행 중…
        [ok] 완료
        [failed] 실패
        [skipped] 건너뜀
       *[other] { $status }
    }
orbito-settings-run-open-result = 결과 열기

## MCP servers

orbito-settings-mcp = MCP 서버
orbito-settings-mcp-hint =
    이 서버들의 도구는 모든 백엔드에 제공됩니다. Assistant는 도구를
    실행하기 전에 묻습니다.
orbito-settings-mcp-empty = 아직 서버가 없어요.
orbito-settings-mcp-add = 서버 추가
orbito-settings-mcp-name-input =
    .placeholder = 캘린더
orbito-settings-url = URL
orbito-settings-authentication = 인증
orbito-settings-auth-none = 없음
orbito-settings-auth-header = 헤더
orbito-settings-auth-oauth = OAuth 로그인
orbito-settings-header-name = 헤더
orbito-settings-header-value = 값
orbito-settings-header-hint = 값은 브라우저의 비밀번호 관리자에 저장됩니다.
orbito-settings-oauth-hint =
    로그인이 필요한 서버는 대개 Orbito를 직접 등록합니다.
    그럴 수 없는 서버라면 받은 클라이언트 ID(와 시크릿)를 입력하세요.
orbito-settings-client-id = 클라이언트 ID
orbito-settings-client-secret = 클라이언트 시크릿
orbito-settings-optional-input =
    .placeholder = 선택 사항
orbito-settings-mcp-add-submit = 서버 추가
orbito-settings-mcp-status =
    { $status ->
        [connected] 연결됨
        [connecting] 연결 중…
        [error] 실패
        [disabled] 꺼짐
        [needs_login] 로그인 필요
        [logging_in] 로그인 중…
       *[other] { $status }
    }
orbito-settings-mcp-tools = 도구 { $count }개
orbito-settings-mcp-tool-read-only = (묻지 않고 실행)
orbito-settings-mcp-trust-read-only = 읽기 전용 표시 신뢰
orbito-settings-mcp-trust-read-only-hint = 서버가 읽기 전용으로 표시한 도구는 묻지 않고 실행
orbito-settings-mcp-remove = 제거
orbito-settings-mcp-reconnect = 다시 연결
orbito-settings-mcp-cancel-login = 로그인 취소
orbito-settings-mcp-log-in = 로그인
orbito-settings-mcp-log-out = 로그아웃
orbito-settings-unchanged = 변경 안 함
orbito-settings-client-id-registered = 서버가 등록했어요

## Updates

orbito-settings-updates = 업데이트
orbito-settings-update-version = Orbito { $version }
orbito-settings-update-check = 업데이트 확인
orbito-settings-update-checking = 업데이트를 확인하는 중…
orbito-settings-update-none = 최신 버전이에요.
orbito-settings-update-available = 새 버전 { $version }이 나왔어요.
orbito-settings-update-install = 업데이트하고 다시 시작
orbito-settings-update-downloading = 업데이트를 내려받는 중 { $percent }%
orbito-settings-update-staging = 업데이트를 준비하는 중…
orbito-settings-update-ready = 업데이트가 준비됐어요. 다시 시작하면 적용돼요.
orbito-settings-update-restart = 다시 시작
orbito-settings-update-manual = 새 버전 { $version }이 나왔어요. 릴리즈 페이지에서 내려받아 설치해 주세요.
orbito-settings-update-open-release = 릴리즈 페이지 열기
orbito-settings-update-check-failed = 업데이트를 확인하지 못했어요.
orbito-settings-update-download-failed = 업데이트를 내려받지 못했어요.
orbito-settings-update-other-instance = 다른 Orbito가 업데이트하는 중이에요.
orbito-settings-update-unsupported = 이 빌드는 자동으로 업데이트하지 않아요.

## Advanced

orbito-settings-advanced = 고급
orbito-settings-firefox-settings = Firefox 설정
orbito-settings-firefox-settings-hint = 검색엔진, 다운로드 위치 같은 세부 항목은 Firefox 설정에서 바꿉니다.
orbito-settings-open-firefox-settings = Firefox 설정 열기

## Browsing recall

orbito-settings-recall = 브라우징 기억
orbito-settings-recall-hint =
    읽은 페이지의 본문을 이 컴퓨터에 보관해서, Assistant가 전에 본 내용을
    찾을 수 있게 합니다. 사생활 보호 창, 비밀번호 칸이 있는 페이지, 아래
    도메인은 보관하지 않습니다.
orbito-settings-recall-enabled = 읽은 페이지 기억하기
orbito-settings-recall-retention = 보관 기간
orbito-settings-recall-retention-hint = 마지막 방문부터 셉니다.
# Variables:
#   $days (Number): how many days pages are kept
orbito-settings-recall-days = { $days }일
orbito-settings-recall-forever = 무기한
orbito-settings-recall-domains = 기억하지 않을 도메인
orbito-settings-recall-domains-hint =
    이 도메인과 하위 도메인의 페이지입니다. 추가하면 그 도메인에서 보관한
    내용도 지웁니다.
orbito-settings-recall-domain-input =
    .aria-label = 기억하지 않을 도메인
orbito-settings-recall-domain-add = 추가
orbito-settings-recall-domain-error = example.com처럼 도메인을 입력하세요.
orbito-settings-recall-domain-remove = 삭제
# Variables:
#   $domain (String): the domain the button removes
orbito-settings-recall-domain-remove-label = { $domain } 삭제
# Variables:
#   $pages (Number): how many pages are remembered
#   $size (String): the space they take, e.g. "1.5 MB"
orbito-settings-recall-stats = 페이지 { $pages }개 기억 중, { $size }.
orbito-settings-recall-open-timeline = 타임라인 열기

## Delete all agent data

orbito-settings-delete-data = 에이전트 데이터 전체 삭제
orbito-settings-delete-data-hint =
    기억한 페이지, Thread, 메모리, 문서와 예약 작업의 실행 기록을 지워요.
    설정, 스킬, 예약 작업 자체는 남아요.
orbito-settings-delete-data-question = 에이전트 데이터를 모두 지울까요? 되돌릴 수 없습니다.
orbito-settings-delete-data-confirm = 모두 삭제
orbito-settings-delete-data-start = 에이전트 데이터 전체 삭제
