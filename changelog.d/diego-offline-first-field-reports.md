### Offline-first field reports: idempotent create and last-write-wins edit (Diego)
`diego/offline-first-field-reports`

A phone that loses its connection retries the same `POST`, and a retried
create used to double-file: no create action in this app is idempotent.
`DailyFieldReport` gains three nullable sync columns (`clientId`,
`clientOperationId`, `clientUpdatedAt`) and a
`@@unique([companyId, clientOperationId])`, so a retried `POST` with the
same create-intent key replays the row it already made instead of filing a
second one. Edits resolve by last-write-wins: a phone stamps
`clientUpdatedAt`, and a stale offline edit is answered `{ applied: false }`
rather than clobbering the newer one — while a web edit (no client clock)
always applies, so `@updatedAt` stays authoritative for it. Web behaviour is
unchanged. Checked by: typecheck/lint green, six new FakeDb core tests
(idempotent replay, concurrent-replay race on the new unique, stale-vs-newer
edit, web edit, cross-company refusal), and the existing 2595 tests green.
