import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";

/** Every string a pdf-lib document drew, read back out of its bytes: pdf-lib
 * writes each as a hex string followed by `Tj`. For tests that must prove
 * what a reader's viewer will show, not what the builder was handed. */
export async function drawnStrings(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const page of pdf.getPages()) {
    const contents = page.node.Contents();
    const streams =
      contents instanceof PDFArray ? contents.asArray().map((ref) => pdf.context.lookup(ref)) : [contents];
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) throw new Error("content stream is not a raw stream");
      const text = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
      for (const match of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
        out.push(Buffer.from(match[1], "hex").toString("latin1"));
      }
    }
  }
  return out;
}
