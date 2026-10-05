### The fix that made the build pass broke the runtime (Diego)
`diego/trace-canvas-into-function`

No migration. Two lines of Next config and one try/catch split in two.

**THE FULL SHAPE, because each step was reasonable and the result was a feature
that could not work:**

1. `@napi-rs/canvas` ships a native `.node` binary. webpack tried to PARSE it
   and the build died. (#621's second commit.)
2. `serverExternalPackages: ["@napi-rs/canvas"]` fixed that — it is the
   documented answer for a package that cannot be bundled.
3. **And it also took the package out of the bundle Vercel TRACES**, so nothing
   shipped the binary into the serverless function. pdf.js loads it at call
   time, found nothing, and could not polyfill `DOMMatrix`.

Every check was green at every step: typecheck, 8,927 tests, `expo lint`, and a
full production build. The only place the truth existed was Vercel's runtime
log, which said it plainly:

```
Cannot load "@napi-rs/canvas" package: Error: Cannot find module
  Require stack: …/pdfjs-dist/legacy/build/pdf.mjs
Warning: Cannot polyfill `DOMMatrix`, rendering may be broken.
```

`outputFileTracingIncludes` now names the package for the routes that use it,
beside the entry Prisma's client already needed for the same reason. The glob
is pnpm-shaped because `node_modules/@napi-rs/canvas` is only a symlink to
`.pnpm/@napi-rs+canvas@…`, and a symlink is not what gets traced.

**AND THE ERROR MESSAGE THAT SENT THE INVESTIGATION THE WRONG WAY.** The action
wrapped the fetch AND the parse in one try/catch, so a PARSE failure reported
itself as *"that drawing could not be fetched"*. An hour went on the network —
checking the URL from a shell (200), checking CORS, swapping the file for a
different host — while the real cause sat in a log. They are two messages now,
and the parse failure is `console.error`'d as well as returned, because it is
this app's problem rather than the user's and the sentence a person sees cannot
carry what a maintainer needs.

**The transferable rule: a `catch` around two different operations tells you
which one failed only by accident.** This repo has a whole directory of entries
about checks that answer a question nobody asked; an error message that names
the wrong half of its own try block is the same failure wearing a sentence.

573 files / 8927 tests, typecheck, lint and a full production build clean.
**Not yet proved on production** — the point of this change is something only a
deploy can show, and the runtime log is where to look.
