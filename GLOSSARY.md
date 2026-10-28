# Glossary

## 브라우저 크롬 (Shell)

| 용어 | 뜻 | 피할 말 |
| --- | --- | --- |
| **Shell** | Firefox 크롬 DOM을 숨기고 그 위에 올린 Orbito 고유 UI 전체. [ADR 0001](docs/adr/0001-chrome-shell-view-replacement.md) | 테마, 스킨 |
| **Sidebar** | 창 왼쪽에서 전체 높이를 쓰는 영역. 위에서부터 Pin, Space 이름, Dock, 탭 목록(새 탭, Orbit, 탭 그룹, 일반 탭), 맨 아래 Space 전환기가 있다 | 탭 바, 세로 탭바 |
| **Pin** | Sidebar 맨 위 아이콘 그리드. 모든 Space가 같이 쓴다 | 고정 탭, 즐겨찾기 |
| **Dock** | Pin 아래, 현재 Space에만 속한 고정 탭 행. 열린 탭을 끌어다 놓아 만든다. 닫아도 자리는 남고 처음 고정한 URL로 돌아간다 | 핀, 고정 탭 |
| **Space** | 탭, Dock, Orbit, Thread, Thread가 만든 문서를 묶는 작업 맥락. Sidebar 하단 전환기나 단축키로 바꾼다. 창마다 보여주는 Space가 따로 있고, Space를 바꾸면 Assistant panel도 그 Space의 Thread로 바뀐다. 설정 페이지의 Space 항목에서 Space마다 기본 백엔드와 모델을 정한다(비우면 Assistant panel에서 고른 전체 설정). 예약 작업도 만든 Space에 속해, 실행할 때마다 그 Space에 Thread를 만들고 그 Space의 memory·skill·기본 백엔드(작업에 백엔드를 따로 고르지 않았을 때)·브라우징 기억을 쓴다. 실행이 연 탭은 그 Space에 들어가고 화면은 그대로다. Space 이름이나 전환기 점의 메뉴에서 이름을 바꾸고, 설정을 열고, 지운다. 지우면 탭은 닫히고, 나머지(Dock·Thread·memory·skill·문서·예약 작업·브라우징 기억)는 다른 Space로 옮기거나 같이 지운다. 옮기면 Dock은 그 Space의 Dock 뒤에 붙고, 이미 있는 URL은 빠진다. 5초 동안 실행 취소할 수 있고, 마지막 Space는 지울 수 없다. 탭 그룹은 Space 하나에 속해 옮기면 탭도 같이 간다. 사생활 보호 창도 같은 Space를 쓰지만 Thread는 메모리에만 두고 memory·문서·예약 작업은 만들지 않는다. 세부 동작은 마일스톤 E(#62) | 워크스페이스, 프로필 |
| **Thread** | Assistant와 나눈 질문과 답 한 줄기. Space에 속한다. 창은 Space마다 지금 Thread를 하나씩 기억하고, 같은 Space에서 탭을 바꿔도 그대로다. 두 창이 같은 Thread를 띄우면 똑같이 보인다. 새 Thread를 열어도 돌던 작업은 뒤에서 계속 돈다. Thread는 시작할 때 정해진 백엔드(Space의 기본값, 없으면 전체 설정)를 계속 쓰고, Space나 전체 설정의 기본값이 바뀌어도 그대로다. 시작한 Thread에서 Assistant panel의 모델 메뉴로 다른 백엔드를 고르면 그 Thread만 바뀐다. 인증이 실패해도 다른 백엔드로 넘어가지 않고 오류를 보여준다. Command bar의 Ask는 지금 Thread가 쉬고 있으면 거기로, 작업 중이면 새 Thread로 보낸다. Assistant panel 머리줄의 Thread 목록이 panel 안에서 대화 대신 Space의 Thread를 최근 순서로 보여주고, 작업 중(accent 점)·승인 대기(호박색 점)·예약 작업(시계)을 표시한다. 다른 Space의 Thread가 승인을 기다리면 Space 전환기의 그 Space 점이 호박색이 된다. 질문은 맥락이 "이 탭"이면 선택된 탭과 그 본문을, "열린 탭 전체"면 보낸 창에 있는 그 Thread의 Space 탭 목록과 선택된 탭 본문을 같이 보낸다(제외 사이트의 탭은 빼고). 에이전트 도구는 어느 쪽이든 그 Space 탭만 다룬다. 에이전트가 연 탭은 Thread의 Space에 들어가고 화면은 그대로다. Thread가 만든 문서는 그 Thread의 Space에 속하고(Library에서 옮길 수 있다), Assistant panel 머리줄의 문서 버튼(개수 표시)이 그 Thread의 문서 목록을 연다 | 대화, conversation, 세션, 채팅 |
| **Top bar** | Sidebar 오른쪽, 페이지 영역 위에 있는 짧은 막대. 현재 페이지 맥락(사이트 정보, URL 표시, 확장, 리더, Ask)을 보여준다. URL 표시를 끌면 창이 움직이고, 누르면 Command bar가 열린다 | 주소창, nav bar, 툴바 |
| **Command bar** | ⌘T/⌘L로 여는 떠 있는 입력창. 주소, 검색, Ask Orbito를 한곳에서 받는다. ⌘T로 열면 Enter를 눌러야 탭이 생긴다 | 주소창, urlbar, 커맨드 팔레트 |
| **Assistant panel** | 프레임 위에 바로 그리는 오른쪽 AI 패널. Windows에서는 전체 높이, macOS에서는 Top bar 아래에 둔다. 에이전트의 승인 요청과 작업 정리 선택도 여기서 받는다 | 사이드 패널, 채팅창 |
| **Orbit** | 에이전트 작업 하나가 연 탭을 Sidebar에 묶어 보여주는 묶음. 머리줄에는 글자 없이 아이콘·진행 막대·테두리로만 상태를 보인다. 작업이 끝나면 Assistant panel의 Orbit 정리 카드에서 그룹 탭 삭제(탭을 모두 닫는다)나 그룹 탭 유지(작업 이름의 탭 그룹으로 남긴다)를 고른다 | 작업 그룹, 에이전트 탭 그룹 |
| **PermissionMode** | 창마다 정하는 에이전트 도구 승인 방식. 입력창의 방패 버튼으로 고른다. 매번 묻기(ask), 가벼운 작업 자동 허용(auto: 스크롤·탭 묶기만 바로 하고 탭 열기·이동·페이지 조작은 묻는다), 권한 우회(bypass: alwaysConfirm 도구 말고는 묻지 않는다). 읽기 전용 도구는 어느 모드에서나 묻지 않는다 | 자동 승인, PermissionBypass |
| **Frame state** | 창 테두리 색으로 보여주는 상태: 에이전트 작업 중(옅은 accent 색조가 7초 주기로 숨쉬기), 승인 대기(모서리에만 옅은 호박색, 4초 주기로 숨쉬기), 시연 기록 중(붉은색). 질문을 보낸 창에 보이고, 움직임 줄이기를 켜면 색만 남고 움직이지 않는다 | 테두리 효과 |
| **Show Orbito** | 사용자가 브라우저에서 직접 한 동작을 기록해, 군더더기를 뺀 의도 단위 단계의 skill로 바꾸는 기능. 기록하는 동안 Assistant panel에 AI가 요약한 단계가 보인다. 마일스톤 C(#61) | 녹화, semantic record, 매크로 |
