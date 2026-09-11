### Ask is back up: read tools stop leaking `capability` to the API (Cyrus, in Diego's lane — #251)
`cyrus/ask-tool-fields-251`

Every Ask request 400'd on `tools.0.custom.capability: Extra inputs are
not permitted` — the assistant fully down, every check green. The
permission-gating work put an internal `capability` field on every entry
in the read-tool registry, and `answer.ts` spread those entries into
`options.tools` raw while commands went through `toToolDefinition` and
were stripped correctly. No typecheck can catch this: a registry entry is
structurally ASSIGNABLE to the API's tool shape, so the extra field rides
along silently and the API rejects the whole request.

The fix is the projection the commands already had: `toAskToolDefinition`
in `tools.ts` picks exactly `{name, description, input_schema}` — an
explicit pick, not a strip of the fields known today — and `offeredTools()`
in `answer.ts` is now the one place the model's tool list is assembled.

The check that keeps it fixed: a census in `answer.test.ts` runs the real
`offeredTools()` for an OWNER, asserts every entry carries ONLY the three
API fields, and pins the list's size to `TOOLS.length + COMMANDS.length`
so the loop cannot pass vacuously over a short or empty list. Mutation
tested both ways: restoring the raw spread went red (2 tests), dropping
`description` from the projection went red (3 tests).

End-to-end evidence is in #251 (curl differential isolating the payload,
and the Ask box working once the tools were stripped locally); this PR is
the clean, tested version of that day's manual workaround.
