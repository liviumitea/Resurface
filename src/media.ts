import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync, randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import * as SecureStore from "expo-secure-store";
import { fromByteArray } from "base64-js";
import { Image } from "react-native";
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
/**
 * Longest edge kept for a saved photo. Full camera resolution (~4 MB each) made saving and opening
 * take many seconds and would make backups too large to hold in memory; 2048 px keeps text legible.
 */
const MAX_PHOTO_EDGE = 2048;

function imageSize(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => Image.getSize(uri, (width, height) => resolve({ width, height }), () => resolve(null)));
}

export async function encryptImageFromUri(uri: string, imageId: string): Promise<string> {
  const size = await imageSize(uri);
  // Only ever shrink. Without a known size the photo is kept as it is rather than risk upscaling.
  const resize = size && Math.max(size.width, size.height) > MAX_PHOTO_EDGE
    ? (size.width >= size.height ? { width: MAX_PHOTO_EDGE } : { height: MAX_PHOTO_EDGE })
    : null;
  // SDK 57's contextual API (manipulateAsync is deprecated). On the iOS simulator, decoding a
  // full-size library HEIC here took 13–115 s with either API; measure on a real device.
  const context = ImageManipulator.ImageManipulator.manipulate(uri);
  let normalized: ImageManipulator.ImageResult;
  try {
    if (resize) context.resize(resize);
    const image = await context.renderAsync();
    try { normalized = await image.saveAsync({ compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }); }
    finally { image.release(); }
  } finally { context.release(); }
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

/** Must match the app group the expo-sharing plugin gives the share extension (group.<bundle id>). */
const SHARE_APP_GROUP = "group.app.resurface.mobile";
const SHARED_DRAFT_DIRECTORY = "SharedPhoto";
/** Larger shares are refused rather than decoded; a 48 MP HEIC is well under this. */
export const MAX_SHARED_IMAGE_BYTES = 64 * 1024 * 1024;

export class SharedImageError extends Error {
  constructor(readonly reason: "unreadable" | "too_large") {
    super(reason === "too_large" ? "The shared photo is too large." : "The shared photo could not be read.");
  }
}

function shareContainer(): Directory | null {
  try { return Paths.appleSharedContainers?.[SHARE_APP_GROUP] ?? null; } catch { return null; }
}

/**
 * The iOS share extension leaves a plaintext copy of a shared photo in the app-group container,
 * which is shared with the extension and outlives our cache sweep. The photo is copied into the
 * app's cache (deleted on save or cancel, and swept at launch) and the container copy is removed.
 * On Android the value is another app's content URI, which is only read.
 */
export async function takeSharedImage(uri: string): Promise<string> {
  const source = new File(uri);
  try {
    if (!source.exists) throw new SharedImageError("unreadable");
    if ((source.size ?? 0) > MAX_SHARED_IMAGE_BYTES) throw new SharedImageError("too_large");
    const directory = new Directory(Paths.cache, SHARED_DRAFT_DIRECTORY);
    directory.create({ idempotent: true, intermediates: true });
    const extension = /^\.[a-z0-9]{1,5}$/i.test(source.extension) ? source.extension : ".img";
    const target = new File(directory, `${randomUUID()}${extension}`);
    try { await source.copy(target); } catch { throw new SharedImageError("unreadable"); }
    return target.uri;
  } catch (error) {
    throw error instanceof SharedImageError ? error : new SharedImageError("unreadable");
  } finally {
    clearShareContainerFiles();
  }
}

/**
 * Deletes the files the share extension left in the app-group container, including copies from
 * shares that were replaced or never opened. Only visible files at its top level are touched: the
 * pending-share list lives in a subfolder, and iOS keeps a hidden metadata file at the top level
 * whose removal detaches the container from the app (seen on the simulator).
 */
export function clearShareContainerFiles(): void {
  const container = shareContainer();
  if (!container) return;
  try {
    for (const entry of container.list()) {
      if (!(entry instanceof File) || entry.name.startsWith(".")) continue;
      try { entry.delete(); } catch { /* Retried on the next share. */ }
    }
  } catch { /* Best effort. */ }
}

/**
 * Native pickers and the image manipulator keep plaintext copies in these cache folders, and a
 * backup file waiting for the share sheet sits in the cache root. Capture drafts and pending
 * shares never survive a restart, so anything left there at launch is safe to remove.
 */
export function clearTransientCaches(): void {
  for (const name of ["ImagePicker", "ImageManipulator", "DocumentPicker", SHARED_DRAFT_DIRECTORY]) {
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
