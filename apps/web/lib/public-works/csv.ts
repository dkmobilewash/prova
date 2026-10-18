/**
 * A streaming CSV reader for one purpose: CSLB's 78 MB master file and 86 MB
 * personnel file, read inside a serverless function that keeps a few thousand
 * rows and throws the rest away. Nothing is buffered beyond one record.
 *
 * RFC 4180 as CSLB actually writes it: commas split, double quotes wrap a
 * field holding a comma or a quote, a doubled quote inside is one quote, and
 * a quoted field may (rarely) hold a newline. Twenty lines rather than a
 * dependency, because the only thing a library would add is an opinion on
 * line endings.
 */

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  out.push(field);
  return out;
}

/** Text chunks in, complete records out, however the chunks were cut —
 * mid-line, mid-quote, mid-CRLF. A newline inside an open quote does not end
 * a record. */
export async function* csvRecords(chunks: AsyncIterable<string>): AsyncGenerator<string[]> {
  let buffer = "";
  for await (const chunk of chunks) {
    buffer += chunk;
    let start = 0;
    let quoted = false;
    for (let i = 0; i < buffer.length; i++) {
      const ch = buffer[i];
      if (ch === '"') quoted = !quoted;
      else if (ch === "\n" && !quoted) {
        const line = buffer.slice(start, i);
        if (line.trim()) yield parseCsvLine(line);
        start = i + 1;
      }
    }
    buffer = buffer.slice(start);
  }
  if (buffer.trim()) yield parseCsvLine(buffer);
}

/** Records as objects keyed by the header row, matched case-insensitively. */
export async function* csvObjects(chunks: AsyncIterable<string>): AsyncGenerator<Record<string, string>> {
  let header: string[] | null = null;
  for await (const record of csvRecords(chunks)) {
    if (!header) {
      header = record.map((h) => h.trim().toLowerCase());
      continue;
    }
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h] = record[i] ?? "";
    });
    yield row;
  }
}

/** A fetch body as text chunks. */
export async function* textChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8");
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value, { stream: true });
  }
  const tail = decoder.decode();
  if (tail) yield tail;
}
