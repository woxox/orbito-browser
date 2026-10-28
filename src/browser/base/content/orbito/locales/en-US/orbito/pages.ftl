# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Library (about:orbito-library)

orbito-library-page-title = Orbito Library
orbito-library-heading = Library
orbito-library-search =
    .placeholder = Search documents and Threads
    .aria-label = Search
orbito-library-tab-documents = Documents
orbito-library-tab-threads = Threads
orbito-library-no-documents = No documents yet.
orbito-library-no-documents-match = No documents match.
orbito-library-no-threads = No Threads yet.
orbito-library-no-threads-match = No Threads match.
# $date is when the document last changed.
orbito-library-document-meta = Changed { $date }
# $date is when the document last changed, $thread the title of the
# Thread that made it.
orbito-library-document-meta-from = Changed { $date } · from “{ $thread }”
# $date is when the Thread last had a question.
orbito-library-thread-meta = Last asked { $date }
# $backend is the name of the model backend that answered, e.g. "Claude".
orbito-library-thread-meta-backend = Last asked { $date } · { $backend }
# Which documents and Threads are listed.
orbito-library-scope =
    .aria-label = Show
orbito-library-this-space = This Space
orbito-library-all-spaces = All Spaces
# A document's Space, a menu ("All Spaces" lists it in every Space).
orbito-library-document-space = Space
orbito-library-space-gone = Removed Space
orbito-library-open-thread = Open Thread
orbito-library-open-thread-title = Open the Thread that made this document in the Assistant panel
# How many documents a Thread made.
orbito-library-thread-documents =
    { $count ->
        [0] No documents
        [one] 1 document
       *[other] { $count } documents
    }
orbito-library-delete-document-question = Delete this document and all its versions?
orbito-library-delete-thread-question = Delete this Thread? The documents it made stay.
orbito-library-cancel = Cancel
orbito-library-delete = Delete
orbito-library-timeline-hint = The pages you read are in the <a data-l10n-name="open-timeline">timeline</a>.

## Timeline (about:orbito-timeline)

orbito-timeline-page-title = Orbito Timeline
orbito-timeline-heading = Timeline
orbito-timeline-hint = The pages you read, as Browsing recall remembers them. Manage what it keeps in <a data-l10n-name="open-settings">settings</a>.
orbito-timeline-search =
    .placeholder = Search the pages you read
    .aria-label = Search the pages you read
orbito-timeline-today = Today
orbito-timeline-yesterday = Yesterday
orbito-timeline-read-briefly = read for less than a minute
# Variables:
#   $minutes (Number): minutes spent on the page
orbito-timeline-read-minutes = read for { $minutes } min
# Variables:
#   $hours (Number), $minutes (Number): time spent on the page
orbito-timeline-read-hours = read for { $hours } h { $minutes } min
orbito-timeline-empty = No pages yet. Pages you read for a while show up here.
orbito-timeline-no-match = No pages you read match.
orbito-timeline-summarize = Summarize
orbito-timeline-summarizing = Summarizing…
orbito-timeline-forget-question = Forget this page?
orbito-timeline-cancel = Cancel
orbito-timeline-forget = Forget
# Variables:
#   $title (String): the page's title
orbito-timeline-forget-label = Forget { $title }

## New tab page

orbito-newtab-page-title = New Tab
orbito-newtab-ask = Ask or enter address
orbito-newtab-ask-placeholder = Ask anything or enter an address
orbito-newtab-recent = Recent visits
# The remembered pages related to what is typed.
orbito-newtab-memory = From memory
# Opens the timeline of every remembered page.
orbito-newtab-memory-all = See all

## Document page (about:orbito-doc)

orbito-doc-page-title = Document
orbito-doc-untitled = New document
orbito-doc-save-markdown = Save as Markdown
orbito-doc-save-pdf = Save as PDF
orbito-doc-versions =
    .aria-label = Version
orbito-doc-restore = Restore this version
# $version is the version's number, $date when it was made.
orbito-doc-version = Version { $version }, { $date }
orbito-doc-version-current = Version { $version } (current), { $date }
orbito-doc-status-writing = Writing…
orbito-doc-status-stopped = Writing stopped. This document was not saved.
# Followed by a link for each page the document was based on.
orbito-doc-sources = Sources:{ " " }
orbito-doc-not-shown = This document could not be shown.
orbito-doc-gone = This document is gone.
orbito-doc-gone-private = This document is gone. Documents made in private windows are forgotten when the last one closes.
# $error is the reason the system gave.
orbito-doc-save-failed = The file could not be saved: { $error }
# The suggested file name, before ".md", when the document has no title.
orbito-doc-file-name = Document
