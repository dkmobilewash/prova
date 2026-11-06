### takeoff-demoted: capture the check's own response, not the first action POST

- **What happened:** "switch off, a verdict" failed and then passed on retry in two unrelated PRs' CI (#994, #1009). Its `replayVerdict` found no refusal row, because the capture had taken `{"ok":true,"value":null}`, another Server Action's answer that came first.
- **Fix:** the capture now waits for the action response that carries the refusal.
