import { Directory, File, Paths } from "expo-file-system";

/**
 * Drawing files kept ON THE PHONE, so a revision can be opened in a
 * basement.
 *
 * The rest of Gap 5 caches ROWS — cheap, automatic, and refreshed behind
 * your back. A drawing file is neither: it is megabytes, it is somebody's
 * cellular plan, and which ones matter is a judgement only the person
 * walking the job can make. So this is explicit and per revision: you
 * tap to keep one, and the row then says it is held.
 *
 * Named by REVISION ID rather than by file name. Two sets both issuing
 * "Rev 2.pdf" is not a coincidence, it is Tuesday.
 */

const FOLDER = "drawings";

function folder(): Directory {
  return new Directory(Paths.document, FOLDER);
}

/** The extension carries over so the OS knows what it is opening; a PDF
 * with no suffix arrives at a viewer that shrugs. */
function fileFor(revisionId: string, fileName: string | null): File {
  const suffix = fileName?.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : ".pdf";
  return new File(folder(), `${revisionId}${suffix}`);
}

export function heldFile(revisionId: string, fileName: string | null): string | null {
  const file = fileFor(revisionId, fileName);
  return file.exists ? file.uri : null;
}

/** Downloads a revision's file for offline use. Returns where it landed,
 * so the caller can open it straight away. */
export async function keepForOffline(
  revisionId: string,
  fileName: string | null,
  url: string,
): Promise<string> {
  const directory = folder();
  if (!directory.exists) directory.create({ intermediates: true });

  const target = fileFor(revisionId, fileName);
  if (target.exists) target.delete();

  const downloaded = await File.downloadFileAsync(url, target);
  return downloaded.uri;
}

/** Gives the space back. A superseded revision nobody opens is still
 * megabytes on a phone that also holds the photos. */
export function forgetFile(revisionId: string, fileName: string | null): void {
  const file = fileFor(revisionId, fileName);
  if (file.exists) file.delete();
}

/** How much of the phone the held drawings are using, for the line that
 * tells somebody before they wonder. */
export function heldBytes(): number {
  const directory = folder();
  if (!directory.exists) return 0;
  return directory
    .list()
    .reduce((total, entry) => total + (entry instanceof File ? (entry.size ?? 0) : 0), 0);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
