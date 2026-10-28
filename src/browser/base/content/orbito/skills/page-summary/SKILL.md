---
name: 페이지 요약
description: Summarize the page in this tab with its key point, the main points as a list and a one-line conclusion.
tools: [get_page_text]
output: chat
---
Read the page in the tab the user is asking from with get_page_text. Do not summarize from the title or URL alone.

Answer in three parts:

1. **Key point**: what the page is about, in one or two sentences.
2. **Main points**: a list of the most important points, at most seven, each one line.
3. **Conclusion**: one line saying what the reader should take away.

Keep the page's own facts and numbers; do not add opinions it does not hold. If the user added instructions after the skill name, follow them (e.g. a length or a focus).
