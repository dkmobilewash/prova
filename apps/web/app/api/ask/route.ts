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
 * this side and are passed down as arguments. So there is nothing a caller
 * could put in a payload to reach another company's rows or act as somebody
 * else.
 *
 * THIS COMMENT USED TO SAY "nothing is read from the request body except
 * the question and, for a chip answer, the pick", and that is no longer
 * literally true — `pagePath` was added so the assistant knows which page
 * the person is standing on. It is amended rather than left to go quietly
 * false, because a security invariant nobody has re-read is the kind of
 * sentence this repo has paid for before.
 *
 * What makes the addition safe is not that the path is validated — it is
 * that the path CANNOT WIDEN ACCESS. It is parsed to an id
 * (`lib/ask/page-context.ts`, which reads no rows) and then looked up
 * through this session's own companyId (`lib/ask/page-context-query.ts`),
 * so a forged path naming another company's job resolves to null, which is
 * byte-identical to sending no path. The worst a hostile payload achieves
 * is a wrong default among jobs the caller can already see. `/api/ask` is also on the
 * middleware's protected list — requireCompanyContext already redirects
 * an anonymous caller, but that list is the allowlist a reader checks,
 * and a route missing from it looks public whether or not it is.
 */

export const runtime = "nodejs";
// Never cached and never prerendered: the answer depends on the session
// and on rows that change.
export const dynamic = "force-dynamic";

type Body = { question?: unknown; pagePath?: unknown; continuation?: unknown };

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

/** A route, bounded. Length-capped because it is a path rather than prose
 * and an unbounded string from a browser has no business reaching a parser;
 * anything longer is not a route this app serves. The parser rejects
 * whatever shape survives, so this is a belt, not the braces. */
function pagePathOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512) return undefined;
  return trimmed;
}

function parseRequest(body: Body): AskRequest {
  const question = typeof body.question === "string" ? body.question : "";
  const pagePath = pagePathOf(body.pagePath);
  const raw = body.continuation;
  if (typeof raw !== "object" || raw === null) return { question, pagePath };
  const c = raw as { command?: unknown; partialInput?: unknown; answers?: unknown };
  if (typeof c.command !== "string") return { question };
  return {
    question,
    pagePath,
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
