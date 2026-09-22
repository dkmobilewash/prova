import { Directory, File, Paths, UploadType } from "expo-file-system";

/**
 * Where a photo waits while it is queued.
 *
 * A camera or picker hands back a file in the CACHE directory, which iOS is
 * free to empty whenever it wants space. A photo taken in a basement may sit
 * in the queue for hours, so the queued copy is moved into the app's
 * document directory, which the system does not clear.
 *
 * Every function here swallows its own failure: losing the local copy of a
 * photo that has already gone up is nothing, and a screen must never crash
 * because a file is missing.
 */

const FOLDER = "queued-photos";

function folder(): Directory {
  const dir = new Directory(Paths.document, FOLDER);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Copies a just-taken photo somewhere it will still be after a restart.
 * Returns the new uri, or the original if the copy could not be made — a
 * queued photo with a cache uri is better than no photo. */
export function keepForUpload(uri: string, fileName: string): string {
  try {
    const destination = new File(folder(), fileName);
    if (destination.exists) destination.delete();
    new File(uri).copy(destination);
    return destination.uri;
  } catch {
    return uri;
  }
}

/** Removes a queued photo once the server has it (or has refused it). */
export function discardQueuedPhoto(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists && file.uri.includes(FOLDER)) file.delete();
  } catch {
    // Already gone, or never ours to delete.
  }
}

/** True when the queued file is still on disk. A photo whose file the
 * system cleared anyway cannot be uploaded, and the queue drops it rather
 * than retrying an empty path forever. */
export function queuedPhotoExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/**
 * Sends one queued photo to the API as multipart form data.
 *
 * NOT `fetch` with a `{ uri, name, type }` part: that shape is React
 * Native's own, and the runtime's newer WinterCG `fetch` refuses it with
 * "Unsupported FormDataPart implementation" — which is exactly how a photo
 * sat in the queue saying "Syncing…" forever. This is the file system's own
 * native multipart upload, which streams the file from disk rather than
 * pulling it through JavaScript.
 *
 * Returns the HTTP status and body so the queue can tell a refusal (the
 * server read it and said no) from a retry (no signal, a 5xx).
 */
export async function uploadQueuedPhoto(
  fileUri: string,
  url: string,
  token: string,
  mimeType: string,
  parameters: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const task = new File(fileUri).createUploadTask(url, {
    httpMethod: "POST",
    uploadType: UploadType.MULTIPART,
    fieldName: "file",
    mimeType,
    parameters,
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await task.uploadAsync();
  return { status: result.status, body: result.body };
}
