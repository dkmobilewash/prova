import { requireCompanyContext } from "@/lib/auth";
import { streamAnswer } from "@/lib/ask/answer";

/** Ask, streamed.
 *
 * A route handler rather than a Server Action because an action returns
 * one value, and the point here is that the answer arrives while it is
 * being written. A multi-tool question spends 8-11 seconds against a real
 * database, and a static "Reading your records…" for that long reads as a
 * hang rather than as work.
 *
 * PROTECTED. The company comes from the Clerk session on this side and is
 * passed down as an argument; it is never read from the request body, so
 * there is nothing a caller could put in a payload to reach another
 * company's rows. `/api/ask` is also on the middleware's protected list —
 * requireCompanyContext already redirects an anonymous caller, but that
 * list is the allowlist a reader checks, and a route missing from it looks
 * public whether or not it is.
 */

export const runtime = "nodejs";
// Never cached and never prerendered: the answer depends on the session
// and on rows that change.
export const dynamic = "force-dynamic";

type Body = { question?: unknown };

export async function POST(request: Request) {
  const { company } = await requireCompanyContext();

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return new Response("Malformed body", { status: 400 });
  }
  const question = typeof body.question === "string" ? body.question : "";

  const encoder = new TextEncoder();
  const events = streamAnswer(company.id, question);

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await events.next();
        if (next.done) {
          controller.close();
          return;
        }
        // Newline-delimited JSON. Chosen over SSE because the browser side
        // is a plain fetch reader — no EventSource, which cannot POST —
        // and one object per line needs no framing beyond split("\n").
        controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
      } catch {
        // A throw here is a genuine bug, not an expected failure: the
        // generator turns those into error events itself. Say something
        // readable rather than truncating the stream silently, which the
        // client would render as an empty answer.
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ type: "error", error: "Something went wrong reading your data." })}\n`,
          ),
        );
        controller.close();
      }
    },
    cancel() {
      // The reader navigated away or asked something else. Stop the
      // conversation rather than letting it run on and bill for an answer
      // nobody will see.
      void events.return(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Proxies that buffer would defeat the whole point of streaming.
      "X-Accel-Buffering": "no",
    },
  });
}
