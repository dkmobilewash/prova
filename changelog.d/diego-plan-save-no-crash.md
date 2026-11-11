### A dropped save after a plan upload says so instead of crashing the page (Diego)
`diego/plan-save-no-crash`

"Add a drawing" uploads the file straight to the store and then saves it to the job with a
server action. When that save's request failed on the network, the action's promise rejected
inside a React transition, and the rejection reached the error boundary: the whole Takeoff tab
became "This page didn't load", with no digest and no server log, while the file sat in the store.
The daily synthetic check hit it on a preview (token minted 00:59:03Z, no save request ever
logged), and failing that one request on purpose reproduced it.

The uploader now catches it and says: the drawing was uploaded, saving it did not finish, reload
to see whether it is there before adding it again. It does not retry by itself, because a save
that landed and only lost its answer would then add the drawing twice.

Check: `components/takeoffPlanUploaderDroppedSave.test.tsx` (red with the catch removed).
