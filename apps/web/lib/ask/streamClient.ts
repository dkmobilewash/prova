/**
 * Reads `/api/ask`'s answer as it arrives: newline-delimited JSON, one event
 * per line, handed to `onEvent` in order.
 *
 * Shared by every box that asks — `components/AskPanel.tsx` in the CRM and the
 * C Stream Bid job box (`components/bid/guide/JobGuideAskBox.tsx`) — so the
 * framing rule lives once. It was inline in AskPanel and is lifted unchanged:
 *
 *   - a network chunk can split a line anywhere, so the trailing fragment
 *     stays in the buffer until its newline arrives — parsing it early would
 *     throw on valid output;
 *   - a malformed line is a bug on our side, and dropping it beats killing an
 *     answer that is otherwise arriving fine. The handler runs inside the
 *     same guard, exactly as the panel's loop had it.
 *
 * Client-safe: no imports, so nothing here can pull the database client into
 * a browser bundle (`client-prisma-boundary.test.ts`). An abort surfaces as
 * the reader's own rejection, for the caller to tell apart from a failure.
 */
export async function readAskStream<Event>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: Event) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line) as Event);
      } catch {
        // A malformed line, or a handler that threw on one: dropped, as the
        // panel always did, rather than ending the answer.
      }
    }
  }
}
