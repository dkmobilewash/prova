import { requireCompanyContext } from "@/lib/auth";
import { viewerToday } from "@/lib/viewerToday";
import { streamAnswer, type AskRequest } from "@/lib/ask/answer";
import type { CommandContext } from "@/lib/ask/commands";

/** Ask, streamed.
 *
 * A route handler rather than a Server Action because an action returns
 * one value, and the point here is that the answer arrives while it is
 * being written. A multi-tool question spends 8-11 seconds against a real
 * database, and a static "Reading your records…" for that long reads as a
 * hang rather than as work.
 *
 * The one thing this route does NOT do is write anything a person would
 * call a record. A command ends the stream with a card; the tap that
 * executes it is a Server Action (lib/actions/ask.ts), for the reason
 * given there.
 *
 * PROTECTED. The company AND the person come from the Clerk session on
 * this side and are passed down as arguments; nothing is read from the
 * request body except the question and, for a chip answer, the pick. So
 * there is nothing a caller could put in a payload to reach another
 * company's rows or act as somebody else. `/api/ask` is also on the
 * middleware's protected list — requireCompanyContext already redirects
 * an anonymous caller, but that list is the allowlist a reader checks,
 * and a route missing from it looks public whether or not it is.
 */

export const runtime = "nodejs";
// Never cached and never prerendered: the answer depends on the session
// and on rows that change.
export const dynamic = "force-dynamic";

type Body = { question?: unknown; continuation?: unknown };

/** Only string values, only string keys, and never more than a handful:
 * a chip answer is one field. */
function stringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof value !== "object" || value === null) return out;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 12)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

function parseRequest(body: Body): AskRequest {
  const question = typeof body.question === "string" ? body.question : "";
  const raw = body.continuation;
  if (typeof raw !== "object" || raw === null) return { question };
  const c = raw as { command?: unknown; partialInput?: unknown; answers?: unknown };
  if (typeof c.command !== "string") return { question };
  return {
    question,
    continuation: {
      command: c.command,
      partialInput: stringRecord(c.partialInput),
      answers: stringRecord(c.answers),
    },
  };
}

export async function POST(request: Request) {
  const context = await requireCompanyContext();

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return new Response("Malformed body", { status: 400 });
  }

  // Everything that reads the request (the session, the timezone cookie)
  // is resolved HERE, before the stream starts: a ReadableStream's pull
  // runs after this handler has returned, outside the request scope, and
  // cookies() would not answer there.
  const ctx: CommandContext = {
    companyId: context.company.id,
    userId: context.id,
    principal: { role: context.role, jobFunction: context.jobFunction },
    today: await viewerToday(),
  };

  const encoder = new TextEncoder();
  const events = streamAnswer(ctx, parseRequest(body));

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
