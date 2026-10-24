import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useEffect, useRef, useState } from "react";
import { Alert, BackHandler, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { BACKUP_LIMITS, BACKUP_UTI, BackupError, MIN_BACKUP_PASSWORD_LENGTH, type BackupOmissions } from "../backup";
import type { Settings } from "../domain";
import { formatDateTime, t, type MessageKey } from "../i18n";
import { reconcileNotifications } from "../notifications";
import { createBackupFile, deleteCachedFile, getBackupStatus, getSettings, restoreBackup, verifyBackup, type BackupStatus } from "../storage";
import { palette } from "../theme";
import { Action, Body, Eyebrow, Surface } from "../ui";
import { screenStyles } from "./styles";

/** Itemized, translated description of what a backup leaves (or left) out. */
export function omissionsText(omissions: BackupOmissions, when: "now" | "then"): string {
  const suffix = when === "now" ? "Now" : "Then";
  const parts = [t(`omissions.photos${suffix}` as MessageKey, { count: omissions.missingPhotos })];
  if (omissions.insightsLeftOut) parts.push(t(`omissions.leftOut${suffix}` as MessageKey, { count: omissions.insightsLeftOut }));
  if (omissions.insightsWithoutPhoto) parts.push(t(`omissions.withoutPhoto${suffix}` as MessageKey, { count: omissions.insightsWithoutPhoto }));
  return `${parts.join("; ")}.`;
}

/**
 * Password-protected backup: create and share, verify read-only, or restore (replace). The sheet's
 * state lives here; the app supplies error reporting and what to do after a restore.
 */
export function useBackup({ report, setSettings, goToday }: {
  report: (error: unknown) => void;
  setSettings: (settings: Settings) => void;
  goToday: () => Promise<unknown>;
}) {
  const [backupMode, setBackupMode] = useState<"create" | "restore" | "verify" | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [backupPassword, setBackupPassword] = useState("");
  const [backupConfirm, setBackupConfirm] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupSharing, setBackupSharing] = useState(false);
  const backupSession = useRef(0);
  const [restoreText, setRestoreText] = useState<string | null>(null);

  const openBackupSheet = (mode: "create" | "restore" | "verify") => {
    setBackupPassword("");
    setBackupConfirm("");
    setBackupMode(mode);
  };

  const closeBackupSheet = () => {
    if (backupBusy) return;
    backupSession.current += 1;
    setBackupSharing(false);
    setBackupMode(null);
    setBackupPassword("");
    setBackupConfirm("");
    setRestoreText(null);
  };

  const backupMessage = (error: unknown) =>
    error instanceof BackupError ? t(`backupError.${error.code}` as MessageKey) : t("common.genericErrorUnchanged");

  const shareBackup = async (backup: { uri: string }) => {
    try {
      if (!(await Sharing.isAvailableAsync())) { Alert.alert(t("backup.notShared"), t("backup.shareUnavailable")); return; }
      await Sharing.shareAsync(backup.uri, { mimeType: "application/octet-stream", UTI: BACKUP_UTI, dialogTitle: t("backup.shareTitle") });
    } catch (error) { Alert.alert(t("backup.notShared"), backupMessage(error)); }
    finally {
      deleteCachedFile(backup.uri);
    }
  };

  // The password sheet stays up until sharing finishes, so it closes only after the share
  // sheet has been dismissed.
  // If the share sheet never reports back, Cancel stays available while sharing; a late result
  // from an abandoned session cannot close a newer sheet. A stranded file is cleared at launch.
  // A backup is complete or it is not made: unreadable photos stop it before anything is shared,
  // and the user may then explicitly choose an archive that records what it leaves out.
  const createBackup = async (allowIncomplete = false) => {
    const session = ++backupSession.current;
    setBackupBusy(true);
    let result: Awaited<ReturnType<typeof createBackupFile>>;
    try { result = await createBackupFile(backupPassword, { allowIncomplete }); }
    catch (error) {
      if (error instanceof BackupError && error.code === "incomplete" && error.omissions) {
        Alert.alert(t("backup.incompleteTitle"), t("backup.incompleteBody", { details: omissionsText(error.omissions, "now") }), [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("backup.withoutThem"), style: "destructive", onPress: () => { void createBackup(true); } },
        ]);
      } else Alert.alert(t("backup.notCreated"), backupMessage(error));
      return;
    }
    finally { setBackupBusy(false); }
    setBackupPassword("");
    setBackupConfirm("");
    refreshBackupStatus();
    setBackupSharing(true);
    await shareBackup(result);
    if (session !== backupSession.current) return;
    setBackupSharing(false);
    setBackupMode(null);
  };

  useEffect(() => {
    if (!backupMode) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { closeBackupSheet(); return true; });
    return () => subscription.remove();
  });

  // Reads a chosen backup into memory for restore or verification; the picker's cache copy is
  // deleted at once, and oversized files are refused before reading.
  const pickBackupFile = async (mode: "restore" | "verify") => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
      const asset = picked.canceled ? null : picked.assets[0];
      if (!asset) return;
      if (asset.size !== undefined && asset.size > BACKUP_LIMITS.maxArchiveChars) {
        deleteCachedFile(asset.uri);
        Alert.alert(t("backup.tooLargeTitle"), t("backup.tooLargeBody"));
        return;
      }
      try { setRestoreText(await new File(asset.uri).text()); }
      finally { deleteCachedFile(asset.uri); }
      openBackupSheet(mode);
    } catch { Alert.alert(t("backup.notOpenedTitle"), t("backup.notOpenedBody")); }
  };

  const chooseRestoreFile = () => {
    Alert.alert(t("backup.replaceTitle"), t("backup.replaceBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("backup.chooseFile"), style: "destructive", onPress: () => { void pickBackupFile("restore"); } },
    ]);
  };

  const refreshBackupStatus = () => { void getBackupStatus().then(setBackupStatus).catch(() => setBackupStatus(null)); };

  const verify = async () => {
    if (!restoreText) return;
    setBackupBusy(true);
    try {
      const summary = await verifyBackup(restoreText, backupPassword);
      setBackupMode(null);
      setBackupPassword("");
      setRestoreText(null);
      refreshBackupStatus();
      Alert.alert(summary.omissions ? t("backup.verifiedIncompleteTitle") : t("backup.verifiedTitle"), t("backup.verifiedBody", {
        date: formatDateTime(summary.exportedAt),
        version: summary.version,
        insights: t("backup.count.insights", { count: summary.insights }),
        photos: t("backup.count.photos", { count: summary.photos }),
        events: t("backup.count.events", { count: summary.events }),
        reflections: t("backup.count.reflections", { count: summary.reflections }),
        omissions: summary.omissions ? ` ${omissionsText(summary.omissions, "then")}` : "",
      }));
    } catch (error) { Alert.alert(t("backup.notVerified"), backupMessage(error)); }
    finally { setBackupBusy(false); }
  };

  const restore = async () => {
    if (!restoreText) return;
    setBackupBusy(true);
    try {
      const result = await restoreBackup(restoreText, backupPassword);
      setBackupMode(null);
      setBackupPassword("");
      setRestoreText(null);
      const next = await getSettings();
      setSettings(next);
      refreshBackupStatus();
      try { await reconcileNotifications(next); } catch (error) { report(error); }
      Alert.alert(result.omissions ? t("backup.restoredIncompleteTitle") : t("backup.restoredTitle"), t("backup.restoredBody", {
        count: result.insights,
        omissions: result.omissions ? t("backup.inThisBackup", { details: omissionsText(result.omissions, "then") }) : "",
      }));
      await goToday();
    } catch (error) { Alert.alert(t("backup.notRestored"), backupMessage(error)); }
    finally { setBackupBusy(false); }
  };

  return {
    backupMode, backupStatus, backupPassword, setBackupPassword, backupConfirm, setBackupConfirm, backupBusy, backupSharing,
    openBackupSheet, closeBackupSheet, createBackup, pickBackupFile, chooseRestoreFile, refreshBackupStatus, verify, restore,
  };
}

export type BackupFlow = ReturnType<typeof useBackup>;

export function BackupSheet({ backup }: { backup: BackupFlow }) {
  const {
    backupMode, backupPassword, setBackupPassword, backupConfirm, setBackupConfirm, backupBusy, backupSharing,
    closeBackupSheet, createBackup, verify, restore,
  } = backup;
  return <>
    {/* An in-screen overlay rather than a native Modal, so the share sheet is the only view
      controller iOS presents and nothing competes with it. */}
  {!!backupMode && <View style={StyleSheet.absoluteFill}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={screenStyles.modalBackdrop}>
      <Surface style={screenStyles.feedbackBox}>
        <Eyebrow>{t(`backup.eyebrow.${backupMode}` as MessageKey)}</Eyebrow>
        <Text maxFontSizeMultiplier={1.8} style={screenStyles.feedbackTitle}>{backupMode === "create" ? t("backup.title.create") : t("backup.title.enter")}</Text>
        <Body muted>{t(`backup.body.${backupMode}` as MessageKey)}</Body>
        <TextInput secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType={backupMode === "create" ? "newPassword" : "password"} placeholder={t("backup.password")} placeholderTextColor={palette.muted} value={backupPassword} onChangeText={setBackupPassword} editable={!backupBusy} style={screenStyles.search} accessibilityLabel={t("backup.passwordLabel")} />
        {backupMode === "create" && <TextInput secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" placeholder={t("backup.repeat")} placeholderTextColor={palette.muted} value={backupConfirm} onChangeText={setBackupConfirm} editable={!backupBusy} style={screenStyles.search} accessibilityLabel={t("backup.repeatLabel")} />}
        {backupMode === "create" && backupPassword.length > 0 && backupPassword.length < MIN_BACKUP_PASSWORD_LENGTH && <Text style={screenStyles.backupHint}>{t("backup.tooShort", { min: MIN_BACKUP_PASSWORD_LENGTH })}</Text>}
        {backupMode === "create" && backupConfirm.length > 0 && backupConfirm !== backupPassword && <Text style={screenStyles.backupHint}>{t("backup.mismatch")}</Text>}
        <View style={screenStyles.gap24}>
          {backupMode === "create"
            ? <Action label={backupBusy ? t("backup.encrypting") : backupSharing ? t("backup.waitingShare") : t("backup.create")} disabled={backupBusy || backupSharing || backupPassword.length < MIN_BACKUP_PASSWORD_LENGTH || backupPassword !== backupConfirm} onPress={() => { void createBackup(); }} />
            : backupMode === "verify"
              ? <Action label={backupBusy ? t("backup.verifying") : t("backup.verify")} disabled={backupBusy || backupPassword.length === 0} onPress={() => { void verify(); }} />
              : <Action kind="danger" label={backupBusy ? t("backup.restoring") : t("backup.restore")} disabled={backupBusy || backupPassword.length === 0} onPress={() => { void restore(); }} />}
        </View>
        <View style={screenStyles.gap12}><Action kind="ghost" label={t("common.cancel")} disabled={backupBusy} onPress={closeBackupSheet} /></View>
      </Surface>
    </KeyboardAvoidingView>
  </View>}
  </>;
}
