import { Directory, File, Paths } from "expo-file-system";

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
