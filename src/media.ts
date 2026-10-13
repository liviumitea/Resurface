import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import * as SecureStore from "expo-secure-store";
import { fromByteArray } from "base64-js";

const IMAGE_KEY_NAME = "resurface.image-key.v1";

async function imageKey(): Promise<AESEncryptionKey> {
  const saved = await SecureStore.getItemAsync(IMAGE_KEY_NAME);
  if (saved) return AESEncryptionKey.import(saved, "hex");
  const created = await AESEncryptionKey.generate();
  await SecureStore.setItemAsync(IMAGE_KEY_NAME, await created.encoded("hex"));
  return created;
}

function imageDirectory(): Directory {
  const directory = new Directory(Paths.document, "resurface-images");
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

export async function imageDataUri(encryptedPath: string | null): Promise<string | null> {
  if (!encryptedPath) return null;
  const file = new File(encryptedPath);
  if (!file.exists) return null;
  const sealed = AESSealedData.fromCombined(await file.bytes());
  const plaintext = await aesDecryptAsync(sealed, await imageKey());
  return `data:image/jpeg;base64,${fromByteArray(plaintext)}`;
}

export function deleteEncryptedImage(encryptedPath: string | null): void {
  if (!encryptedPath) return;
  const file = new File(encryptedPath);
  if (file.exists) file.delete();
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
