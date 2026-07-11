# CLAUDE.md -- agentic_financial_tracker_for_zakat
# Created: 2026-04-05
#
# TODO: Add project-specific stack, structure, and conventions above.

---

## Wiki Integration

This project is wired to Bashir's central wiki at:
`C:\Users\user\Documents\GitHub\my-wiki`

### Session export
Every Claude Code session in this repo is automatically exported to:
`my-wiki/sessions/exports/` and indexed in `my-wiki/sessions.db`

### Querying the wiki from this project
To get relevant wiki context before starting a feature:
```
> Check my wiki at C:\Users\user\Documents\GitHub\my-wiki
  for everything relevant to [topic]
```

### Updating the wiki after a session
At the end of any session where domain knowledge was established:
```
> Update the wiki at C:\Users\user\Documents\GitHub\my-wiki
  with what we learned today. Update relevant pages and log.md.
```

### Recall past sessions across all projects
```
python C:\Users\user\Documents\GitHub\my-wiki\.claude\scripts\recall.py "search terms"
python C:\Users\user\Documents\GitHub\my-wiki\.claude\scripts\recall.py --recent 5
```

### Confidential sessions
```
# Before starting: touch the sentinel
python -c "open(r'C:\\Users\\user\\Documents\\GitHub\\my-wiki\\.claude\\no-export', 'w').close()"
# Or say "This session is confidential" at the first prompt
```
