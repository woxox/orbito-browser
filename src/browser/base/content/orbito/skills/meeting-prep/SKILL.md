---
name: 회의 준비
description: Prepare a note for the next meeting from the calendar, if one is connected, and the related tabs and history.
tools: [list_tabs, get_page_text, search_history]
output: chat
---
First look for the meeting:

- If you have tools from a connected calendar (an MCP server, e.g. tools for calendar events), use them to find the next meeting, or the one the user named after the skill name, with its time, attendees and description.
- If you have no calendar tools, say so in one line ("No calendar is connected, so this note is based on your open tabs only.") and go on with the open tabs and anything the user told you about the meeting.

Then gather what is related: call list_tabs and read the tabs that are about the meeting's topic, attendees or company with get_page_text, and use search_history for pages the user recently visited on the topic.

Answer with a prep note:

1. **Meeting**: title, time and attendees (whatever is known).
2. **Background**: the key facts from the related pages, each with the page it came from.
3. **Points to raise**: questions or decisions to bring up.
4. **Open items**: what is still unclear or worth checking before the meeting.

Only use what the calendar, the pages and the user say; do not make up attendees or facts.
