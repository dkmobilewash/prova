### The mock that has to name every import (Claude)
`cyrus/sales-signals`

`#601`. Five sales `.dbtest.ts` files stopped LOADING — not failing an
assertion, failing to collect — the moment `lib/cslb/callList.ts` added
`import { unstable_cache } from "next/cache"`. `lib/actions/sales.ts` imports
the call list, and all five of those tests mock `next/cache` with a factory
returning `revalidatePath` alone. A vitest module mock is EXHAUSTIVE: importing
a name the factory does not define throws at collection, so the whole file dies
with zero tests run.

The fix is five one-line additions — `unstable_cache: (fn: unknown) => fn`, a
pass-through so the wrapped function runs uncached under test.

**What makes this worth writing down is the shape of the error, not the fix.**
It reads

    No "unstable_cache" export is defined on the "next/cache" mock.
    Did you forget to return it from "vi.mock"?

which names the MOCK and the TEST, and never names `callList.ts` — the file
that actually changed. Nothing in the message points at the import that broke
it, and the five dead files were all in the lane the commit touched, which
makes "my new code is broken" the obvious and wrong first reading.

And the count is the tell. CI reported `5 failed | 67 passed (72)`; each dead
file contributed **zero** tests, so 85 real tests were not run and nothing in
the totals said so. A file that fails to LOAD is invisible in a per-test count
— the same reason this repo reads the test TOTAL before the colour.

About a hundred other files in `apps/web` mock `next/cache` with
`revalidatePath` alone. Any one of them breaks the same way the first time
something it transitively imports reaches for another `next/cache` export, and
the error will again name the mock rather than the cause. A shared stub would
end the class; that is a hundred-file change and is not made here.
