import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useRef } from "react";
import { Alert, AppState, Linking } from "react-native";
import { draftFromShared, type SharedDraft } from "../domain";
import { t } from "../i18n";
import { SharedImageError, clearShareContainerFiles, deletePickedImageFromCache, takeSharedImage } from "../media";

/**
 * Content shared from another app arrives through the share extension, which opens
 * resurface://expo-sharing. It sits unencrypted in the shared app-group store until read, so it
 * is read and cleared at once and kept only as an in-memory draft; nothing is saved without Save.
 * A shared photo is moved into the app's cache like a picked one and encrypted only on Save.
 *
 * `hasUnsavedDraft` decides whether to ask before replacing the current capture draft;
 * `openDraft` receives the draft and the cached photo, if any.
 */
export function useSharedContent({ enabled, hasUnsavedDraft, openDraft }: {
  enabled: boolean;
  hasUnsavedDraft: () => boolean;
  openDraft: (draft: SharedDraft, imageUri: string | null) => void;
}) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const callbacks = useRef({ hasUnsavedDraft, openDraft });
  callbacks.current = { hasUnsavedDraft, openDraft };
  const sharingRef = useRef(false);

  const readSharedContent = async () => {
    let items: { shareType: string; value: string; mimeType?: string }[];
    try {
      items = Sharing.getSharedPayloads();
      if (!items.length) { clearShareContainerFiles(); return; }
      Sharing.clearSharedPayloads();
    } catch { return; }
    const draft = draftFromShared(items);
    if (!draft) { clearShareContainerFiles(); Alert.alert(t("share.unsupportedTitle"), t("share.unsupportedBody")); return; }
    let imageUri: string | null = null;
    if (draft.imageUri) {
      try { imageUri = await takeSharedImage(draft.imageUri); } catch (error) {
        const tooLarge = error instanceof SharedImageError && error.reason === "too_large";
        Alert.alert(t("share.photoFailedTitle"), t(tooLarge ? "share.photoTooLarge" : "share.photoUnreadable"));
        if (!draft.content && !draft.source) return;
      }
    } else clearShareContainerFiles();
    const open = () => callbacks.current.openDraft(draft, imageUri);
    if (callbacks.current.hasUnsavedDraft()) {
      Alert.alert(t("share.replaceTitle"), t("share.replaceBody"), [
        { text: t("common.cancel"), style: "cancel", onPress: () => deletePickedImageFromCache(imageUri) },
        { text: t("share.replaceAction"), onPress: open },
      ], { cancelable: false });
    } else open();
  };

  const openSharedContent = useCallback(async () => {
    // The link and the foreground event both fire for one share; a second pass must not sweep the
    // container while the first is still copying the photo out of it.
    if (!enabledRef.current || sharingRef.current) return;
    sharingRef.current = true;
    try { await readSharedContent(); } finally { sharingRef.current = false; }
  // readSharedContent reads only refs, so a stable callback is fine here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (enabled) void openSharedContent();
  }, [enabled, openSharedContent]);

  useEffect(() => {
    const link = Linking.addEventListener("url", ({ url }) => { if (url.includes("expo-sharing")) void openSharedContent(); });
    const foreground = AppState.addEventListener("change", (state) => { if (state === "active") void openSharedContent(); });
    return () => { link.remove(); foreground.remove(); };
  }, [openSharedContent]);
}
