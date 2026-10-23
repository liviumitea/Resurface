import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import * as SecureStore from "expo-secure-store";
import { fromByteArray } from "base64-js";
import { BACKUP_EXTENSION } from "./backup";

export const IMAGE_KEY_NAME = "resurface.image-key.v1";
export const IMAGE_DIRECTORY_NAME = "resurface-images";

async function imageKey(): Promise<AESEncryptionKey> {
  const saved = await SecureStore.getItemAsync(IMAGE_KEY_NAME);
  if (saved) return AESEncryptionKey.import(saved, "hex");
  // Encrypted photos without a key mean the key is unavailable or lost; a replacement
  // would overwrite it if it reappears and make those photos permanently unreadable.
  if (imageDirectory().list().some((entry) => entry.name.endsWith(".enc"))) {
    throw new Error("The photo key is unavailable on this device. Your photos have not been changed.");
  }
  const created = await AESEncryptionKey.generate();
  await SecureStore.setItemAsync(IMAGE_KEY_NAME, await created.encoded("hex"));
  return created;
}

function imageDirectory(): Directory {
  const directory = new Directory(Paths.document, IMAGE_DIRECTORY_NAME);
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

/** The picker output is normalized to JPEG so the encrypted copy has one display format. */
export async function encryptImageFromUri(uri: string, imageId: string): Promise<string> {
  const normalized = await ImageManipulator.manipulateAsync(uri, [], {
    compress: 0.82,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  try {
    const plaintext = await new File(normalized.uri).bytes();
    const sealed = await aesEncryptAsync(plaintext, await imageKey());
    const target = new File(imageDirectory(), `${imageId}.enc`);
    target.create({ overwrite: true });
    target.write(await sealed.combined());
    return target.uri;
  } finally {
    // ImageManipulator creates this temporary copy in the app's cache.
    const temporary = new File(normalized.uri);
    if (temporary.exists) temporary.delete();
  }
}

/** Decrypted JPEG bytes, or null when the encrypted file is missing. Never write these to disk. */
/**
 * Stored photo paths are absolute URIs, but iOS can move the app's data container on update or
 * reinstall. Only the file name is trusted; it is resolved against the current photo folder.
 */
function storedImageFile(encryptedPath: string): File {
  return new File(imageDirectory(), encryptedPath.split("/").pop() ?? "");
}

export async function readImageBytes(encryptedPath: string): Promise<Uint8Array | null> {
  const file = storedImageFile(encryptedPath);
  if (!file.exists) return null;
  const sealed = AESSealedData.fromCombined(await file.bytes());
  return new Uint8Array(await aesDecryptAsync(sealed, await imageKey()));
}

export async function imageDataUri(encryptedPath: string | null): Promise<string | null> {
  if (!encryptedPath) return null;
  const plaintext = await readImageBytes(encryptedPath);
  return plaintext ? `data:image/jpeg;base64,${fromByteArray(plaintext)}` : null;
}

/** Encrypts restored JPEG bytes under this device's photo key into a new app-private file. */
export async function writeEncryptedImage(plaintext: Uint8Array, fileName: string): Promise<string> {
  const sealed = await aesEncryptAsync(plaintext, await imageKey());
  const target = new File(imageDirectory(), `${fileName}.enc`);
  target.create({ overwrite: true });
  target.write(await sealed.combined());
  return target.uri;
}

/**
 * Removes encrypted photo files that no insight references, such as leftovers of a replaced restore.
 * Matches by file name, not full URI, so a differently spelled path can never delete a live photo.
 */
export function deleteUnreferencedImages(referencedPaths: (string | null)[]): void {
  const referenced = new Set(referencedPaths.filter((path): path is string => !!path).map((path) => path.split("/").pop()));
  for (const entry of imageDirectory().list()) {
    if (entry instanceof File && entry.name.endsWith(".enc") && !referenced.has(entry.name)) {
      try { entry.delete(); } catch { /* Best effort; an orphan is ciphertext only. */ }
    }
  }
}

export function deleteEncryptedImage(encryptedPath: string | null): void {
  if (!encryptedPath) return;
  const file = storedImageFile(encryptedPath);
  if (file.exists) file.delete();
}

/**
 * Native pickers and the image manipulator keep plaintext copies in these cache folders, and a
 * backup file waiting for the share sheet sits in the cache root. Capture drafts and pending
 * shares never survive a restart, so anything left there at launch is safe to remove.
 */
export function clearTransientCaches(): void {
  for (const name of ["ImagePicker", "ImageManipulator", "DocumentPicker"]) {
    try {
      const directory = new Directory(Paths.cache, name);
      if (directory.exists) directory.delete();
    } catch { /* Best effort; the OS may also purge caches. */ }
  }
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      if (entry instanceof File && entry.name.endsWith(`.${BACKUP_EXTENSION}`)) entry.delete();
    }
  } catch { /* Best effort; backup files contain only ciphertext. */ }
}

/** The picker may leave a plaintext copy in our own cache; never touch external files. */
export function deletePickedImageFromCache(uri: string | null): void {
  const cachePrefix = `${Paths.cache.uri.replace(/\/$/, "")}/`;
  if (!uri || !uri.startsWith(cachePrefix)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // OS cache cleanup is best effort. App-private storage contains only ciphertext.
  }
}
