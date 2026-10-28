---
name: 탭 비교
description: Compare the open tabs (e.g. products, articles or options) in a table.
tools: [list_tabs, get_page_text]
output: chat
---
Call list_tabs to see the open tabs, then read the ones worth comparing with get_page_text and their tab_id. If the user named the tabs or the topic after the skill name, compare only those; otherwise pick the tabs that are about the same kind of thing and skip unrelated ones (new tab pages, settings, search results).

Then answer with:

1. One line saying which tabs you compared.
2. A Markdown table with one column per tab (its short title) and one row per point that matters for this kind of thing, e.g. price, features, pros and cons for products, or claims and sources for articles. Write "-" where a page does not say.
3. A short recommendation or summary of the main differences.

Only use what the pages say. If fewer than two tabs can be compared, say so instead of making a table.
