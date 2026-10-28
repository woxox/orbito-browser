# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Assistant panel

orbito-assistant-context-tab = 이 탭
orbito-assistant-context-tabs = 열린 탭 전체
orbito-assistant-context-none = 없음
orbito-assistant-effort-low = 낮음
orbito-assistant-effort-medium = 보통
orbito-assistant-effort-high = 높음
orbito-assistant-effort-max = 최대
orbito-assistant-starter-summarize = 이 페이지 요약
orbito-assistant-starter-takeaways = 핵심 요점
orbito-assistant-starter-explain = 쉽게 설명
orbito-assistant-starter-summarize-prompt = 이 페이지를 요약해 줘.
orbito-assistant-starter-takeaways-prompt = 이 페이지의 핵심 요점을 정리해 줘.
orbito-assistant-starter-explain-prompt = 이 페이지가 무슨 내용인지 쉽게 설명해 줘.
orbito-assistant-draft-skill = 이 Thread를 스킬로 저장
orbito-assistant-drafting-skill = 스킬 초안 작성 중…
# $error is why it failed.
orbito-assistant-draft-skill-failed = 스킬 초안을 만들지 못했어요: { $error }
# $name is what was typed after "/".
orbito-assistant-unknown-skill = /{ $name } 스킬이 없어요. /를 입력하면 스킬 목록을 볼 수 있어요.
orbito-assistant-stopped-denied = 단계를 거절해서 작업을 멈췄어요.
orbito-assistant-signed-in = 로그인했어요.
orbito-assistant-signed-in-as = { $email } 계정으로 로그인했어요.
orbito-assistant-not-signed-in = 로그인하지 않았어요. 설정 페이지에서 로그인하세요.
orbito-assistant-new-thread = 새 Thread
orbito-assistant-start-thread = 새 Thread
orbito-assistant-skill = 스킬
orbito-assistant-skill-used = 사용한 스킬
orbito-assistant-sources = 출처
orbito-assistant-open = 열기
orbito-assistant-open-settings = 설정 열기
orbito-assistant-open-settings-page = 설정 페이지 열기
orbito-assistant-approval-needed = 승인 요청
orbito-assistant-allow = 허용
orbito-assistant-deny = 거절
orbito-assistant-approval = 승인
orbito-assistant-approval-allowed = 승인해서 실행했어요
orbito-assistant-approval-denied = 거절해서 작업을 멈췄어요
orbito-assistant-approval-stopped = 작업이 멈춰 응답하지 않았어요
orbito-assistant-approval-not-allowed = 허용되지 않았어요
orbito-assistant-approval-bypassed = 권한 우회 모드라 묻지 않고 실행했어요
orbito-assistant-orbit-wrap-up = Orbit 정리
orbito-assistant-orbit-kept = 결과만 남겼어요.
orbito-assistant-orbit-released = 탭으로 풀었어요.
orbito-assistant-orbit-closed = 그룹 탭 삭제를 골랐어요
orbito-assistant-orbit-gone = 탭이 이미 닫혀서 넘어갔어요.
orbito-assistant-orbit-grouped = 그룹 탭 유지를 골랐어요
orbito-assistant-orbit-stopped-title = 작업을 멈췄어요
orbito-assistant-orbit-done-title = 작업을 마쳤어요
# $count is how many tabs the task opened (and read), done or stopped.
orbito-assistant-orbit-tabs = 읽은 탭 { $count }개는 어떻게 할까요?
orbito-assistant-orbit-close-tabs = 그룹 탭 삭제
orbito-assistant-orbit-keep-group = 그룹 탭 유지
# $text is the memory.
orbito-assistant-memory-forgot = 잊었어요: { $text }
# $text is the memory.
orbito-assistant-memory-remembered = 기억했어요: { $text }
orbito-assistant-memory-undo = 실행 취소
orbito-assistant-memories-used = 메모리 { $count }개를 썼어요
orbito-assistant-memory-forgotten = 잊었어요
orbito-assistant-thought-for = { $seconds }초 동안 생각했어요
orbito-assistant-thinking = 생각하는 중…
orbito-assistant-waiting = 모델의 응답을 기다리는 중…
orbito-assistant-empty = 이 페이지에 대해 무엇이든 물어보세요.
orbito-assistant-session-settings = 세션 설정
orbito-assistant-context = 맥락
orbito-assistant-permission = 권한 모드
# $mode는 고른 모드의 이름입니다.
orbito-assistant-permission-button = 권한 모드: { $mode }
orbito-assistant-permission-ask = 매번 묻기
orbito-assistant-permission-ask-description = 스크롤, 탭 묶기, 탭 열기, 페이지 조작 전에 승인을 받습니다
orbito-assistant-permission-auto = 가벼운 작업 자동 허용
orbito-assistant-permission-auto-description = 스크롤과 탭 묶기는 바로 하고, 탭 열기·페이지 이동·조작은 묻습니다
orbito-assistant-permission-bypass = 권한 우회
orbito-assistant-permission-bypass-description = 아무것도 묻지 않고 바로 실행합니다
orbito-assistant-backend-and-key = 백엔드 및 키…
orbito-assistant-threads = Thread 목록
orbito-assistant-threads-busy = Thread 목록, 다른 Thread가 작업 중이에요
orbito-assistant-threads-waiting = Thread 목록, 다른 Thread가 승인을 기다려요
orbito-assistant-threads-heading = Thread
orbito-assistant-threads-back = Thread로 돌아가기
orbito-assistant-threads-back-title = Thread로 돌아가기 (Esc)
orbito-assistant-threads-scope = 보여줄 Thread
orbito-assistant-threads-this-space = 이 Space
orbito-assistant-threads-all-spaces = 모든 Space
orbito-assistant-threads-library = Library에서 모두 보기
orbito-assistant-documents-button = 이 Thread의 문서 { $count }개
orbito-assistant-documents-heading = 이 Thread의 문서
orbito-assistant-documents-none = 이 Thread에서 만든 문서가 아직 없어요
orbito-assistant-threads-just-now = 방금
orbito-assistant-threads-minutes-ago = { $count }분 전
orbito-assistant-threads-hours-ago = { $count }시간 전
orbito-assistant-threads-days-ago = { $count }일 전
orbito-assistant-thread-documents = 문서 { $count }
orbito-assistant-thread-scheduled = 예약 작업
orbito-assistant-thread-running = 작업 중
orbito-assistant-thread-waiting = 승인 대기
orbito-assistant-model-menu = 모델 및 생각 깊이
orbito-assistant-model = 모델
orbito-assistant-backend = 백엔드
orbito-assistant-backend-space = 이 Space의 기본값을 바꿔요.
orbito-assistant-model-search = 모델 검색
orbito-assistant-effort = 생각 깊이
orbito-assistant-effort-note = 깊을수록 답이 느리고 토큰을 더 씁니다.
orbito-assistant-usage-system = 시스템 프롬프트
orbito-assistant-usage-tools = 도구 정의
# $context is what questions share, e.g. "This tab".
orbito-assistant-usage-tabs = 탭 맥락 · { $context }
orbito-assistant-usage-history = Thread 기록
orbito-assistant-usage-label = 사용량 자세히 보기. 컨텍스트 { $percent }% 사용
# $used and $total are token counts.
orbito-assistant-usage-title = 컨텍스트 { $percent }% 사용 · { $used } / { $total } 토큰
orbito-assistant-subscription = 구독 사용량
orbito-assistant-subscription-plan = 구독 사용량 · { $plan }
# $date is when the limit resets.
orbito-assistant-limit-resets = { $date }에 초기화
orbito-assistant-claude-limit-five-hour = 5시간 한도
orbito-assistant-claude-limit-seven-day = 주간 한도
orbito-assistant-claude-limit-seven-day-opus = 주간 Opus 한도
orbito-assistant-claude-limit-seven-day-sonnet = 주간 Sonnet 한도
# $name is the limit's name as the Claude Code CLI gives it.
orbito-assistant-claude-limit-other = 한도: { $name }
orbito-assistant-claude-plan-pro = Pro
orbito-assistant-claude-plan-max = Max
orbito-assistant-claude-plan-team = Team
orbito-assistant-claude-plan-enterprise = Enterprise
# $used and $total are token counts.
orbito-assistant-usage-context = 컨텍스트 · { $used } / { $total } 토큰
orbito-assistant-usage-free = 남은 여유
orbito-assistant-usage-note = 다음 질문이 보내는 내용으로 추정한 값입니다.
orbito-assistant-settings-backend = 백엔드
orbito-assistant-settings-base = API 기본 URL
orbito-assistant-settings-key-hint = 키는 브라우저의 비밀번호 관리자에 저장됩니다.
orbito-assistant-settings-auth = 인증 방식
orbito-assistant-auth-choose = 고르세요…
orbito-assistant-auth-api-key = API 키
orbito-assistant-auth-claude-account = Claude 계정
orbito-assistant-settings-claude-hint = Orbito에 함께 들어 있는 Claude Code CLI를 API 키나 Claude 계정으로 실행합니다.
orbito-assistant-settings-all = 모든 설정
orbito-assistant-settings-cancel = 취소
orbito-assistant-settings-save = 저장
orbito-assistant-log = Thread
orbito-assistant-chip-dismiss = 닫기
# $label is the suggestion's label.
orbito-assistant-chip-dismiss-label = { $label } 닫기
orbito-assistant-skills = 스킬
orbito-assistant-input-placeholder = 이 페이지에 대해 묻기
orbito-assistant-input = Assistant에게 질문
# $effort is the thinking depth, e.g. "Medium".
orbito-assistant-model-button = 모델 및 생각 깊이: { $model }, { $effort }
orbito-assistant-model-button-title = 모델과 생각 깊이 고르기
orbito-assistant-stop = 응답 멈추기
orbito-assistant-send = 보내기
orbito-assistant-resize = Assistant panel 폭 조절
orbito-assistant-resize-title = 드래그해서 폭 조절, 두 번 눌러 되돌리기
orbito-assistant-plus = 더 많은 작업

## Show Orbito: recording a demo in the Assistant panel. "Show Orbito" is
## the feature's name and stays as it is.

orbito-show = Show Orbito
orbito-show-description = 한 번 해 보이면 Orbito가 스킬로 배워요
orbito-show-goal-label = 무엇을 보여줄 건가요?
orbito-show-goal-placeholder = 선택 사항, 예: 늘 마시는 커피 주문
orbito-show-goal-hint = 지금 탭부터, 이 창의 탭에서 하는 일을 기록해요.
orbito-show-start = 시작
orbito-show-cancel = 취소
orbito-show-watching = Orbito가 보고 있어요
orbito-show-stop = 정지
# $shortcut is the keyboard shortcut, e.g. "⌘⇧.".
orbito-show-stop-title = 기록 멈추기 ({ $shortcut })
orbito-show-steps = 단계
# $count is how many actions the demo has so far.
orbito-show-recording = 기록 중 · { $count }개 동작
orbito-show-recorded = 시연을 기록했어요
orbito-show-recorded-count = { $count }개 동작을 기록했어요
orbito-show-stopped-timeout = 30분이 지나 멈췄어요.
orbito-show-discard = 버리기
orbito-show-agent-busy = 이 창에서 Orbito가 작업을 마치면 Show Orbito를 시작할 수 있어요.
orbito-show-input-blocked = Show Orbito를 마치면 다시 물어볼 수 있어요
orbito-show-converting = 시연을 스킬로 만드는 중…
# $error says what went wrong.
orbito-show-review-failed = 시연을 스킬로 만들지 못했어요: { $error }
orbito-show-review-not-skill = 응답이 스킬 형식이 아니에요 ({ $error })
orbito-show-retry = 다시 시도
orbito-show-review = 스킬 검토
# $name is the name of the skill the demo records again.
orbito-show-review-again = 다시 기록한 /{ $name } 검토
orbito-show-review-hint = 시연으로 만든 스킬이에요. 저장하기 전에 확인하세요.
orbito-show-review-name = 이름
orbito-show-review-description = 설명
orbito-show-review-inputs = 입력
orbito-show-review-inputs-hint = 인자는 스킬을 쓸 때마다 채우고, 고정값은 시연 때 값 그대로 써요.
orbito-show-review-as-input = 인자로
orbito-show-review-as-fixed = 고정값으로
# $value is what was typed in the demo.
orbito-show-review-demo-value = 시연 때 값: { $value }
orbito-show-review-fixed-value = 항상: { $value }
# Under an input with personal information (an email, a name, ...) made a fixed value.
orbito-show-review-personal-warning = 이 값은 스킬 파일에 그대로 저장되고, 스킬을 쓸 때마다 모델에 보내져요.
orbito-show-review-steps-hint = 위·아래 방향키로 단계를 오가고, Alt를 함께 누르면 단계를 옮겨요.
# $n is the step's number.
orbito-show-review-step = { $n }단계
orbito-show-review-step-up = { $n }단계를 위로
orbito-show-review-step-down = { $n }단계를 아래로
orbito-show-review-step-delete = { $n }단계 삭제
orbito-show-review-user-enters = 직접 입력하는 단계
orbito-show-rerecord = 다시 기록
orbito-show-save = 저장
orbito-show-saving = 저장 중…
# $name is the skill's name.
orbito-show-saved = /{ $name } 스킬을 저장했어요

## Doing a skill made from a demo again

# $name is the skill's name.
orbito-assistant-skill-steps = /{ $name } 단계
# $count is how many steps the skill has; $n is the step the agent is on.
orbito-assistant-skill-steps-count = { $count }단계
orbito-assistant-skill-steps-at = { $count }단계 중 { $n }단계
orbito-assistant-skill-steps-failed = { $n }단계에서 멈췄어요
orbito-assistant-skill-steps-done = { $count }단계 완료
orbito-assistant-skill-steps-show = 단계 모두 보기
orbito-assistant-skill-steps-hide = 단계 접기
# $what is what the agent could not find on the page.
orbito-assistant-skill-step-not-found = 찾지 못함: { $what }
orbito-assistant-skill-step-enter = 직접 입력한 뒤 계속을 눌러 주세요
# $n is the step's number.
orbito-assistant-skill-step-entered = { $n }단계 직접 입력
orbito-assistant-skill-step-continue = 계속
orbito-assistant-skill-step-stop = 중지
orbito-assistant-skill-step-continued = 직접 입력하고 계속했어요
orbito-assistant-skill-step-stopped = 직접 입력 단계에서 멈췄어요.

## Suggestion chips

orbito-suggestions-summarize = 요약
orbito-suggestions-translate = 번역
orbito-suggestions-compare = 비교

## Assistant backends and errors

orbito-assistant-backend-openai = OpenAI 호환
orbito-assistant-backend-claude-settings = Claude (Claude Code)
orbito-assistant-backend-openai-settings = OpenAI 호환 API
orbito-assistant-backend-chatgpt-settings = ChatGPT (ChatGPT로 로그인)
orbito-assistant-key-anthropic = Anthropic API 키
orbito-assistant-key-openai = OpenAI API 키
# $key is the key's name, e.g. "Anthropic API key".
orbito-assistant-add-key = 시작하려면 설정에서 { $key }를 추가하세요.
orbito-assistant-already-answering = 이 Thread는 이미 질문에 답하는 중이에요.
orbito-assistant-no-skill = /{ $name } 스킬이 없어요.
orbito-assistant-turns-dropped = 처음 { $count }개 턴은 모델에 보내지 않았어요.
orbito-assistant-stopped = 응답을 멈췄어요.
orbito-assistant-stopped-tab-closed = 탭이 닫혀서 멈췄어요.
orbito-assistant-stopped-tool-calls = 에이전트가 실행할 수 없는 도구 호출을 계속해서 멈췄어요.
# $tools lists each tool with why, e.g. "search (bad schema)".
orbito-assistant-tools-not-offered = 일부 도구를 모델에 제공하지 못했어요: { $tools }
orbito-assistant-thread-empty = Thread가 비어 있어요.
# $error is why the draft is not a skill.
orbito-assistant-draft-not-skill = 초안이 스킬 형식이 아니에요: { $error }
orbito-assistant-skill-missing = 스킬이 스킬 폴더에 더 이상 없어요.
orbito-assistant-skill-exists = { $name } 스킬이 이미 있어요.
# $name is the tool's name.
orbito-assistant-allow-tool = { $name }을(를) 허용할까요?
orbito-assistant-task-running = 작업이 아직 실행 중이에요.
orbito-assistant-reply-writing = 답변을 아직 쓰는 중이에요.
orbito-assistant-reply-no-text = 이 답변에는 텍스트가 없어요.
orbito-assistant-no-document = 그런 문서가 없어요.
orbito-assistant-private-thread = 사생활 보호 창에서는 그 창의 Thread만 열 수 있어요.
orbito-assistant-private-no-document = 사생활 보호 창에서는 문서를 만들지 않아요.
orbito-assistant-no-thread = 그런 Thread가 없어요.
# $status is the HTTP status; $detail is the server's message, maybe empty.
orbito-assistant-openai-error = OpenAI API 오류 { $status }. { $detail }
orbito-assistant-chatgpt-login-rejected = ChatGPT가 로그인을 받아들이지 않았어요. 설정에서 다시 로그인하세요.
# $status is the HTTP status; $detail is the server's message, maybe empty.
orbito-assistant-chatgpt-error-status = ChatGPT 오류 { $status }. { $detail }
orbito-assistant-chatgpt-incomplete = ChatGPT가 응답을 끝내기 전에 멈췄어요.
# $reason is ChatGPT's reason, e.g. "max_output_tokens".
orbito-assistant-chatgpt-incomplete-reason = ChatGPT가 응답을 끝내기 전에 멈췄어요({ $reason }).
# $error is ChatGPT's message, or orbito-assistant-chatgpt-response-failed.
orbito-assistant-chatgpt-error = ChatGPT 오류: { $error }.
orbito-assistant-chatgpt-response-failed = 응답에 실패했어요
orbito-assistant-chatgpt-ended-early = ChatGPT 응답이 완료되기 전에 끝났어요.
# $scopes are the permissions that were not granted.
orbito-assistant-chatgpt-scope-missing = ChatGPT 계정이 Orbito의 직접 사용을 허용하지 않았어요({ $scopes } 권한을 받지 못함). 요금제나 워크스페이스에서 지원하지 않을 수 있어요.
orbito-assistant-chatgpt-login-expired = ChatGPT 로그인이 만료됐어요. 설정에서 다시 로그인하세요.
orbito-assistant-chatgpt-sign-in = ChatGPT 백엔드를 쓰려면 설정에서 ChatGPT로 로그인하세요.
# $path is where the Claude Code CLI was looked for.
orbito-assistant-claude-missing = { $path }에서 Claude Code CLI를 찾지 못했어요. orbito.agent.claude에 경로를 설정하세요.
# $path is the Claude Code CLI; $error is why it did not run.
orbito-assistant-claude-failed = { $path }에서 Claude Code CLI를 실행하지 못했어요: { $error }
# $code is the exit code; $output is the end of what the CLI wrote to stderr.
orbito-assistant-claude-exited = Claude Code CLI가 답하지 않고 종료됐어요(종료 코드 { $code }). { $output }
orbito-assistant-claude-key-rejected = Anthropic이 API 키를 받아들이지 않았어요. 설정에서 키를 확인하세요.
orbito-assistant-claude-outdated = 이 버전의 Orbito에 든 Claude Code는 Anthropic이 더 이상 받지 않아요. Claude를 계속 쓰려면 Orbito를 업데이트하세요.
orbito-assistant-claude-login-rejected = Claude 계정에 로그인되어 있지 않거나 로그인이 만료됐어요. 설정 페이지에서 다시 로그인하세요.
orbito-assistant-claude-choose-auth = 설정에서 Claude를 API 키로 쓸지 Claude 계정으로 쓸지 고르세요.
orbito-assistant-claude-sign-in = Claude를 쓰려면 설정 페이지에서 Claude 계정으로 로그인하세요.
orbito-assistant-claude-login-failed = 로그인을 마치지 못했어요. 브라우저가 열리지 않았거나 코드를 붙여넣으라고 했다면 터미널에서 이 명령으로 로그인하세요:
orbito-assistant-login-cancelled = 로그인을 취소했어요.
orbito-assistant-login-needs-window = 로그인하려면 일반 브라우저 창을 여세요.
# $error is the login server's message.
orbito-assistant-login-failed = 로그인하지 못했어요: { $error }
orbito-assistant-mcp-needs-name = 서버 이름을 입력하세요.
orbito-assistant-mcp-invalid-url = 올바른 URL이 아니에요.
orbito-assistant-mcp-http-only = http와 https 서버만 지원해요.
orbito-assistant-mcp-no-server = 그런 서버가 없어요.
# $error is why the connection was lost.
orbito-assistant-mcp-connection-lost = 연결이 끊어졌어요: { $error }
orbito-assistant-mcp-logged-out = 로그아웃했어요.
# $name is the MCP tool's name.
orbito-assistant-mcp-tool-bad-schema = { $name } 도구를 뺐어요: 입력 스키마가 객체가 아니에요.
# $name is the MCP tool's name; $error is why it was left out.
orbito-assistant-mcp-tool-left-out = { $name } 도구를 뺐어요: { $error }
orbito-assistant-mcp-no-login-server = 서버가 로그인할 곳을 알려 주지 않았어요(보호된 리소스 메타데이터 없음).
# $issuer is the login server's address.
orbito-assistant-mcp-login-metadata = 로그인 서버의 메타데이터를 읽지 못했어요({ $issuer }).
orbito-assistant-mcp-needs-client = 이 서버의 로그인은 앱을 자동으로 등록하지 않아요. 서버 설정에서 Orbito용 클라이언트 ID를 입력하세요.
orbito-assistant-mcp-register-failed = 로그인 서버에 Orbito를 등록하지 못했어요.
# $reason is the login server's message.
orbito-assistant-mcp-register-failed-reason = 로그인 서버에 Orbito를 등록하지 못했어요: { $reason }

## Assistant tool steps and approvals

orbito-assistant-tool-forgetting = 잊는 중
orbito-assistant-tool-remembering = 기억하는 중
# $title is the tab's title.
orbito-assistant-tool-reading-tab = “{ $title }” 읽는 중
orbito-assistant-tool-reading-a-tab = 탭 읽는 중
# Shown on the tab being read, next to its title.
orbito-assistant-tool-reading-page = 페이지 읽는 중
# $count is how many more tabs there are, after the titles listed.
orbito-assistant-tool-more-tabs = 외 { $count }개
orbito-assistant-tool-grouping-into = 탭을 “{ $name }” 그룹으로 묶는 중
orbito-assistant-tool-grouping = 탭을 그룹으로 묶는 중
# $titles lists the tabs' titles, e.g. "“A”, “B”, 3 more".
orbito-assistant-tool-group-approval = { $titles }을(를) “{ $name }” 그룹으로 묶을까요?
orbito-assistant-tool-ungrouping = 탭 그룹 해제 중
# $titles lists the tabs' titles; $count is how many tabs there are.
orbito-assistant-tool-ungroup-approval = { $titles }을(를) 그룹에서 뺄까요?
orbito-assistant-tool-looking-tabs = 탭 살펴보는 중
orbito-assistant-tool-going-back = 뒤로 가는 중
orbito-assistant-tool-going-forward = 앞으로 가는 중
orbito-assistant-tool-reloading = 새로고침하는 중
orbito-assistant-tool-going-to = { $host }(으)로 이동하는 중
orbito-assistant-tool-going-to-page = 페이지로 이동하는 중
orbito-assistant-tool-go-to-approval = { $url }(으)로 이동할까요?
orbito-assistant-tool-back-approval = { $host }에서 뒤로 갈까요?
orbito-assistant-tool-forward-approval = { $host }에서 앞으로 갈까요?
orbito-assistant-tool-reload-approval = { $host }을(를) 새로고침할까요?
orbito-assistant-tool-opening = { $host } 여는 중
orbito-assistant-tool-opening-tab = 탭 여는 중
orbito-assistant-tool-open-tab-approval = 새 탭을 열어도 될까요?
orbito-assistant-tool-switching-tab = 탭 전환하는 중
orbito-assistant-tool-closing-tab = 탭 닫는 중
# $title is the tab's title.
orbito-assistant-tool-select-tab-approval = “{ $title }” 탭으로 전환할까요?
# $title is the tab's title.
orbito-assistant-tool-close-tab-approval = “{ $title }” 탭을 닫을까요?
orbito-assistant-tool-reading-document = 문서 읽는 중
orbito-assistant-tool-searching-memories = 메모리에서 “{ $query }” 검색 중
orbito-assistant-tool-searching-documents = 문서에서 “{ $query }” 검색 중
orbito-assistant-tool-screenshot = 스크린샷 찍는 중
orbito-assistant-tool-running-script = 페이지에서 스크립트 실행 중
orbito-assistant-tool-searching-history = 기록에서 “{ $query }” 검색 중
orbito-assistant-tool-looking-history = 기록 살펴보는 중
orbito-assistant-tool-searching-browsing = 읽은 페이지에서 “{ $query }” 검색 중
orbito-assistant-tool-searching-bookmarks = 북마크에서 “{ $query }” 검색 중
orbito-assistant-tool-using-skill = /{ $name } 스킬 사용 중
orbito-assistant-tool-updating-document = 문서 수정 중
# $title is the document's title.
orbito-assistant-tool-writing = “{ $title }” 작성 중
orbito-assistant-tool-writing-document = 문서 작성 중
# $target is the element, e.g. "“Sign in”".
orbito-assistant-tool-clicking = { $target } 클릭 중
# $target is the field, e.g. "“Search”".
orbito-assistant-tool-typing = { $target }에 입력 중
# $values lists the options, e.g. "“Red”, “Blue”".
orbito-assistant-tool-selecting = { $values } 선택 중
orbito-assistant-tool-scrolling =
    { $direction ->
        [up] 위로 스크롤하는 중
        [down] 아래로 스크롤하는 중
        [left] 왼쪽으로 스크롤하는 중
        [right] 오른쪽으로 스크롤하는 중
       *[other] { $direction } 스크롤하는 중
    }
orbito-assistant-tool-pressing = { $key } 누르는 중

# Short names of the steps the user approves, shown in bold on an
# approval once it is answered.
# $host is the site, e.g. example.com.
orbito-assistant-tool-open-site-action = { $host } 열기
orbito-assistant-tool-go-to-action = 페이지 이동
orbito-assistant-tool-back-action = 뒤로 가기
orbito-assistant-tool-forward-action = 앞으로 가기
orbito-assistant-tool-reload-action = 새로고침
orbito-assistant-tool-click-action = 클릭
orbito-assistant-tool-type-action = 텍스트 입력
orbito-assistant-tool-select-action = 옵션 선택
orbito-assistant-tool-scroll-action = 스크롤
orbito-assistant-tool-press-key-action = 키 누르기
orbito-assistant-tool-group-action = 탭 그룹으로 묶기
orbito-assistant-tool-ungroup-action = 탭 그룹 해제
orbito-assistant-tool-select-tab-action = 탭 전환
orbito-assistant-tool-close-tab-action = 탭 닫기
orbito-assistant-tool-remember-action = 메모리 저장
orbito-assistant-tool-forget-action = 메모리 삭제
orbito-assistant-tool-run-script-action = 스크립트 실행

## Scheduled tasks

orbito-tasks-morning-brief = 아침 브리핑
orbito-tasks-needs-name = 작업 이름이 필요해요.
orbito-tasks-name-too-long = 이름은 최대 { $max }자예요.
orbito-tasks-needs-prompt = 작업에 질문이나 스킬이 필요해요.
orbito-tasks-no-skill = { $name } 스킬이 없어요.
# $name is the name of a skill's input.
orbito-tasks-needs-input = 스킬 입력 { $name }의 값을 채워 주세요.
orbito-tasks-choose-backend = 백엔드를 선택하세요.
# $tool is the tool's name.
orbito-tasks-not-allowable = 작업에는 { $tool }을(를) 허용할 수 없어요.
orbito-tasks-deleted = 작업을 삭제했어요.
orbito-tasks-limit-reached = 하루 작업 실행 한도({ $max }회)에 도달했어요.
orbito-tasks-run-stopped = 실행을 멈췄어요.
# $tools lists the tools' names.
orbito-tasks-not-allowed = 이 작업에 허용되지 않은 도구예요: { $tools }.
# $name is the task's name.
orbito-tasks-done = { $name }을(를) 마쳤어요
# $name is the task's name; $error is why it failed.
orbito-tasks-failed = { $name }에 실패했어요: { $error }
orbito-tasks-open-result = 누르면 결과를 열어요.
orbito-tasks-see-runs = 누르면 작업 실행 기록을 볼 수 있어요.

## Task schedules

orbito-schedule-choose-kind = 매시간, 매일, 매주 중에서 선택하세요.
orbito-schedule-minute-range = 분은 { $min }에서 { $max } 사이의 정수여야 해요.
orbito-schedule-hour-range = 시는 { $min }에서 { $max } 사이의 정수여야 해요.
orbito-schedule-day-range = 요일은 { $min }에서 { $max } 사이의 정수여야 해요.
# $minute is two digits, e.g. "05".
orbito-schedule-hourly = 매시 { $minute }분
# $time is e.g. "08:00".
orbito-schedule-daily = 매일 { $time }
# $weekday is 0 (Sunday) to 6 (Saturday); $time is e.g. "08:00".
orbito-schedule-weekly =
    { $weekday ->
        [0] 매주 일요일 { $time }
        [1] 매주 월요일 { $time }
        [2] 매주 화요일 { $time }
        [3] 매주 수요일 { $time }
        [4] 매주 목요일 { $time }
        [5] 매주 금요일 { $time }
       *[6] 매주 토요일 { $time }
    }
