---
name: 번역
description: Translate the page or the given text into the language the user names (by default, the browser's language).
tools: [get_page_text]
output: chat
---
Work out the target language: the language the user named after the skill name (e.g. "일본어로", "into French"). If they named none, translate into the browser's interface language, which the system prompt gives; if the page is already in that language, ask which language they want.

Work out what to translate: text the user added after the skill name, if they gave some; otherwise the page in the tab they are asking from, read with get_page_text.

Translate faithfully and completely, keeping the structure: headings, lists, tables and links stay as they are, in Markdown. Do not summarize or add comments, except one line at the start saying what was translated and into which language. For a very long page, translate the main content and say what was left out (e.g. menus and footers).
