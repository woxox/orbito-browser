# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Library (about:orbito-library)

orbito-library-page-title = Orbito 라이브러리
orbito-library-heading = 라이브러리
orbito-library-search =
    .placeholder = 문서 및 Thread 검색
    .aria-label = 검색
orbito-library-tab-documents = 문서
orbito-library-tab-threads = Thread
orbito-library-no-documents = 아직 문서가 없어요.
orbito-library-no-documents-match = 일치하는 문서가 없어요.
orbito-library-no-threads = 아직 Thread가 없어요.
orbito-library-no-threads-match = 일치하는 Thread가 없어요.
# $date is when the document last changed.
orbito-library-document-meta = { $date }에 수정됨
# $date is when the document last changed, $thread the title of the
# Thread that made it.
orbito-library-document-meta-from = { $date }에 수정됨 · “{ $thread }”에서 만듦
# $date is when the Thread last had a question.
orbito-library-thread-meta = 마지막 질문: { $date }
# $backend is the name of the model backend that answered, e.g. "Claude".
orbito-library-thread-meta-backend = 마지막 질문: { $date } · { $backend }
orbito-library-scope =
    .aria-label = 보여줄 범위
orbito-library-this-space = 이 Space
orbito-library-all-spaces = 모든 Space
orbito-library-document-space = Space
orbito-library-space-gone = 지운 Space
orbito-library-open-thread = Thread 열기
orbito-library-open-thread-title = 이 문서를 만든 Thread를 Assistant panel에 열어요
orbito-library-thread-documents =
    { $count ->
        [0] 문서 없음
       *[other] 문서 { $count }개
    }
orbito-library-delete-document-question = 이 문서와 모든 버전을 삭제할까요?
orbito-library-delete-thread-question = 이 Thread를 삭제할까요? Thread에서 만든 문서는 남아요.
orbito-library-cancel = 취소
orbito-library-delete = 삭제
orbito-library-timeline-hint = 읽은 페이지는 <a data-l10n-name="open-timeline">타임라인</a>에 있습니다.

## Timeline (about:orbito-timeline)

orbito-timeline-page-title = Orbito 타임라인
orbito-timeline-heading = 타임라인
orbito-timeline-hint = 브라우징 기억이 보관한, 읽은 페이지입니다. 보관할 내용은 <a data-l10n-name="open-settings">설정</a>에서 관리합니다.
orbito-timeline-search =
    .placeholder = 읽은 페이지 검색
    .aria-label = 읽은 페이지 검색
orbito-timeline-today = 오늘
orbito-timeline-yesterday = 어제
orbito-timeline-read-briefly = 1분 미만 읽음
# Variables:
#   $minutes (Number): minutes spent on the page
orbito-timeline-read-minutes = { $minutes }분 읽음
# Variables:
#   $hours (Number), $minutes (Number): time spent on the page
orbito-timeline-read-hours = { $hours }시간 { $minutes }분 읽음
orbito-timeline-empty = 아직 페이지가 없어요. 한동안 읽은 페이지가 여기에 나와요.
orbito-timeline-no-match = 일치하는 페이지가 없어요.
orbito-timeline-summarize = 요약
orbito-timeline-summarizing = 요약 중…
orbito-timeline-forget-question = 이 페이지를 기억에서 지울까요?
orbito-timeline-cancel = 취소
orbito-timeline-forget = 지우기
# Variables:
#   $title (String): the page's title
orbito-timeline-forget-label = { $title } 지우기

## New tab page

orbito-newtab-page-title = 새 탭
orbito-newtab-ask = 묻거나 주소 입력
orbito-newtab-ask-placeholder = 무엇이든 묻거나 주소를 입력하세요
orbito-newtab-recent = 최근 방문
# The remembered pages related to what is typed.
orbito-newtab-memory = 기억에서
# Opens the timeline of every remembered page.
orbito-newtab-memory-all = 모두 보기

## Document page (about:orbito-doc)

orbito-doc-page-title = 문서
orbito-doc-untitled = 새 문서
orbito-doc-save-markdown = Markdown으로 저장
orbito-doc-save-pdf = PDF로 저장
orbito-doc-versions =
    .aria-label = 버전
orbito-doc-restore = 이 버전으로 복원
# $version is the version's number, $date when it was made.
orbito-doc-version = 버전 { $version }, { $date }
orbito-doc-version-current = 버전 { $version } (현재), { $date }
orbito-doc-status-writing = 작성 중…
orbito-doc-status-stopped = 작성을 멈췄어요. 이 문서는 저장되지 않았어요.
# Followed by a link for each page the document was based on.
orbito-doc-sources = 출처:{ " " }
orbito-doc-not-shown = 이 문서를 표시할 수 없어요.
orbito-doc-gone = 이 문서는 이제 없어요.
orbito-doc-gone-private = 이 문서는 이제 없어요. 사생활 보호 창에서 만든 문서는 마지막 사생활 보호 창을 닫으면 지워져요.
# $error is the reason the system gave.
orbito-doc-save-failed = 파일을 저장하지 못했어요: { $error }
# The suggested file name, before ".md", when the document has no title.
orbito-doc-file-name = 문서
