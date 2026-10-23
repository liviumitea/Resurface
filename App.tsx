import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import { extractTextFromImage, isSupported as isOcrSupported } from "expo-text-extractor";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, AppState, BackHandler, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Switch, Text, TextInput, View, useWindowDimensions,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BACKUP_UTI, BackupError, MIN_BACKUP_PASSWORD_LENGTH } from "./src/backup";
import { addCalendarDays, isValidInsight, shouldAskValueFeedback, type Insight, type InsightDetail, type InsightStatus, type Settings, type TodayItem } from "./src/domain";
import { clearTransientCaches, deletePickedImageFromCache, imageDataUri } from "./src/media";
import { notificationEventId, reconcileNotifications, requestNotificationPermission } from "./src/notifications";
import {
  countInsights, createBackupFile, createInsight, deleteCachedFile, deleteInsight, editInsight, getBetaMetrics, getDetail,
  getEvent, getInsight, getSettings, getShownCount, listInsights, markCompleted, markValueFeedbackAsked, markOpened, markShown,
  openStorage, respondToEvent, restoreBackup, setAsideUnreadableData, snoozeInsight, StorageError, type StorageFailure, saveSettings, saveValueFeedback, selectToday, setInsightStatus, track,
} from "./src/storage";
import { palette } from "./src/theme";
import { Action, Body, BottomNav, Eyebrow, Header, IconButton, Screen, Surface, Title } from "./src/ui";

type Route = "onboarding" | "capture-choice" | "capture" | "photo" | "saved" | "permission" | "today" | "reflect" | "library" | "detail" | "settings";
type CaptureOrigin = "onboarding" | "today" | "library";
type TodayStatus = "loading" | "ready" | "error";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function InsightImage({ path, height = 260 }: { path: string | null; height?: number }) {
  const [uri, setUri] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setUri(null);
    setState("loading");
    imageDataUri(path)
      .then((next) => { if (active) { setUri(next); setState(next ? "ready" : "missing"); } })
      .catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [path, attempt]);
  if (!path) return null;
  if (state === "missing") return <View style={[screenStyles.imagePlaceholder, { height }]}><Ionicons name="image-outline" size={28} color={palette.muted} /><Text style={screenStyles.imageMessage}>The original photo isn't on this device.</Text></View>;
  if (state === "error") return <View style={[screenStyles.imagePlaceholder, { height }]}><Ionicons name="alert-circle-outline" size={28} color={palette.muted} /><Text style={screenStyles.imageMessage}>This photo couldn't be opened. It hasn't been changed.</Text><Pressable accessibilityRole="button" accessibilityLabel="Try opening the photo again" onPress={() => setAttempt((value) => value + 1)} style={screenStyles.imageRetryTarget}><Text style={screenStyles.imageRetry}>Try again</Text></Pressable></View>;
  if (!uri) return <View accessibilityLabel="Loading photo" style={[screenStyles.imagePlaceholder, { height }]}><Ionicons name="image-outline" size={28} color={palette.muted} /></View>;
  return <Image source={{ uri }} resizeMode="contain" style={[screenStyles.image, { height }]} accessibilityLabel="Original saved image" />;
}

function InsightCard({ insight, compact = false }: { insight: Insight; compact?: boolean }) {
  return (
    <Surface style={compact ? screenStyles.compactCard : screenStyles.insightCard}>
      <View style={screenStyles.cardMark}><Ionicons name="sparkles-outline" size={17} color={palette.accentDark} /></View>
      {!!insight.content && <Text style={compact ? screenStyles.cardTextCompact : screenStyles.cardText}>{insight.content}</Text>}
      <InsightImage path={insight.imagePath} height={compact ? 100 : 250} />
      {!!insight.context && !compact && <Text style={screenStyles.context}>{insight.context}</Text>}
      <Text style={screenStyles.savedDate}>Saved {formatDate(insight.createdAt)}</Text>
    </Surface>
  );
}

function Loading({ message = "Making space for what matters…" }: { message?: string }) {
  return <Screen scroll={false}><View style={screenStyles.center}><View style={screenStyles.loadingMark}><Ionicons name="sparkles" size={34} color={palette.accentDark} /></View><Text style={screenStyles.loadingText}>{message}</Text></View></Screen>;
}

function TodaySkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading today's insights">
      <View style={[screenStyles.skeletonLine, { width: "55%" }]} />
      <Surface style={screenStyles.insightCard}>
        <View style={screenStyles.cardMark} />
        <View style={[screenStyles.skeletonLine, screenStyles.skeletonLarge]} />
        <View style={[screenStyles.skeletonLine, screenStyles.skeletonLarge, { width: "70%" }]} />
        <View style={[screenStyles.skeletonLine, { width: "35%", marginTop: 22 }]} />
      </Surface>
      <View style={[screenStyles.skeletonButton, screenStyles.gap24]} />
    </View>
  );
}

function ResurfaceApp() {
  const [ready, setReady] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [fatalReason, setFatalReason] = useState<StorageFailure | null>(null);
  const [startAttempt, setStartAttempt] = useState(0);
  const [todayStatus, setTodayStatus] = useState<TodayStatus>("loading");
  const todayRequest = useRef(0);
  const [busy, setBusy] = useState(false);
  const [route, setRoute] = useState<Route>("onboarding");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [insightCount, setInsightCount] = useState(0);
  const [todayItems, setTodayItems] = useState<TodayItem[]>([]);
  const [todayIndex, setTodayIndex] = useState(0);
  const [libraryStatus, setLibraryStatus] = useState<InsightStatus>("active");
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryItems, setLibraryItems] = useState<Insight[]>([]);
  const [libraryError, setLibraryError] = useState(false);
  const [libraryAttempt, setLibraryAttempt] = useState(0);
  const [detail, setDetail] = useState<InsightDetail | null>(null);
  const [detailOrigin, setDetailOrigin] = useState<"today" | "library">("library");
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editContext, setEditContext] = useState("");
  const [captureOrigin, setCaptureOrigin] = useState<CaptureOrigin>("today");
  const [captureContent, setCaptureContent] = useState("");
  const [captureContext, setCaptureContext] = useState("");
  const [captureImageUri, setCaptureImageUri] = useState<string | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [firstSave, setFirstSave] = useState(false);
  const [savedInsightId, setSavedInsightId] = useState<string | null>(null);
  const [reflectionText, setReflectionText] = useState("");
  const [feedbackEventId, setFeedbackEventId] = useState<string | null>(null);
  const [pendingNextIndex, setPendingNextIndex] = useState(0);
  const [metrics, setMetrics] = useState<{ activated: boolean; saved: number; shown: number; asked: number; answered: number; valuable: number } | null>(null);
  const [notificationGranted, setNotificationGranted] = useState<boolean | null>(null);
  const [backupMode, setBackupMode] = useState<"create" | "restore" | null>(null);
  const [backupPassword, setBackupPassword] = useState("");
  const [backupConfirm, setBackupConfirm] = useState("");
  // Side-by-side cards break words at large accessibility text sizes, so they stack instead.
  const stackChoices = useWindowDimensions().fontScale > 1.3;
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupSharing, setBackupSharing] = useState(false);
  const backupSession = useRef(0);
  const [restoreText, setRestoreText] = useState<string | null>(null);

  const report = (error: unknown) => {
    const message = error instanceof Error ? error.message : "Something went wrong. Please try again.";
    Alert.alert("Resurface", message);
  };

  // Today owns its loading and error states so a failed query is retryable in place
  // instead of an alert over stale cards. Only the latest request may update the screen.
  const goToday = useCallback(async (eventId?: string) => {
    const request = ++todayRequest.current;
    setTodayStatus("loading");
    setRoute("today");
    try {
      const items = await selectToday();
      const count = await countInsights();
      if (request !== todayRequest.current) return true;
      setTodayItems(items);
      const requestedIndex = eventId ? items.findIndex((item) => item.event.id === eventId) : -1;
      const firstIncomplete = items.findIndex((item) => !item.event.completedAt);
      setTodayIndex(requestedIndex >= 0 ? requestedIndex : firstIncomplete >= 0 ? firstIncomplete : items.length);
      setInsightCount(count);
      setTodayStatus("ready");
      return !eventId || requestedIndex >= 0;
    } catch {
      if (request === todayRequest.current) setTodayStatus("error");
      return true;
    }
  }, []);

  const goLibrary = useCallback(() => setRoute("library"), []);

  const openDetail = useCallback(async (insightId: string, origin: "today" | "library" = "library") => {
    const found = await getDetail(insightId);
    if (!found) { await goToday(); return; }
    setDetail(found);
    setDetailOrigin(origin);
    setEditing(false);
    setEditContent(found.insight.content ?? "");
    setEditContext(found.insight.context ?? "");
    setRoute("detail");
  }, [goToday]);

  const handleNotification = useCallback(async (eventId: string) => {
    const event = await getEvent(eventId);
    const insight = event ? await getInsight(event.insightId) : null;
    if (!event || event.cancelledAt || !insight || insight.status !== "active") { await goToday(); return; }
    await markOpened(eventId);
    if (!(await goToday(eventId))) {
      await markShown(eventId);
      await openDetail(insight.id, "today");
    }
  }, [goToday, openDetail]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        clearTransientCaches();
        await openStorage();
        const nextSettings = await getSettings();
        if (!live) return;
        setSettings(nextSettings);
        setInsightCount(await countInsights());
        if (nextSettings.onboardingComplete) await goToday();
        else { setRoute("onboarding"); await track("onboarding_started"); }
        if (live) setReady(true);
        // Notification APIs can be slow or unavailable during simulator startup.
        // They should never keep the local-first app behind its loading screen.
        void (async () => {
          try {
            await reconcileNotifications(nextSettings);
            const last = await Notifications.getLastNotificationResponseAsync();
            const eventId = last ? notificationEventId(last) : null;
            if (eventId && live) {
              await Notifications.clearLastNotificationResponseAsync();
              await handleNotification(eventId);
            }
          } catch (error) {
            if (live) report(error);
          }
        })();
      } catch (error) {
        if (live) {
          setFatalError(error instanceof Error ? error.message : "The app could not start.");
          setFatalReason(error instanceof StorageError ? error.reason : null);
          setReady(true);
        }
      }
    })();
    const listener = Notifications.addNotificationResponseReceivedListener((response) => {
      const eventId = notificationEventId(response);
      if (eventId) void handleNotification(eventId).catch(report);
    });
    return () => { live = false; listener.remove(); };
  }, [goToday, handleNotification, startAttempt]);

  const retryStart = () => {
    setFatalError(null);
    setFatalReason(null);
    setReady(false);
    setStartAttempt((attempt) => attempt + 1);
  };

  const current = todayItems[todayIndex];
  useEffect(() => {
    if (route !== "today" || todayStatus !== "ready" || !current || current.event.shownAt) return;
    void markShown(current.event.id).then(async () => {
      setTodayItems((items) => items.map((item) => item.event.id === current.event.id ? { ...item, event: { ...item.event, shownAt: new Date().toISOString() } } : item));
      if (settings) await reconcileNotifications(settings);
    }).catch(report);
  }, [route, todayStatus, current?.event.id, current?.event.shownAt, settings]);

  // The previous list stays visible while a search refines it; a failure replaces it
  // with a retryable message rather than an alert over stale results.
  useEffect(() => {
    if (route !== "library") return;
    let active = true;
    listInsights(libraryStatus, librarySearch)
      .then((items) => { if (active) { setLibraryItems(items); setLibraryError(false); } })
      .catch(() => { if (active) setLibraryError(true); });
    return () => { active = false; };
  }, [route, libraryStatus, librarySearch, libraryAttempt]);

  const beginCapture = (origin: CaptureOrigin) => {
    deletePickedImageFromCache(captureImageUri);
    setCaptureOrigin(origin);
    setCaptureContent("");
    setCaptureContext("");
    setCaptureImageUri(null);
    setRoute("capture");
  };

  const openCaptureChoice = (origin: CaptureOrigin) => {
    setCaptureOrigin(origin);
    setRoute("capture-choice");
  };

  const cancelCaptureChoice = () => {
    if (captureOrigin === "library") goLibrary();
    else void goToday();
  };

  const pickImage = async (source: "camera" | "library") => {
    try {
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1 };
      const result = source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (!result.canceled && result.assets[0]) {
        deletePickedImageFromCache(captureImageUri);
        setCaptureImageUri(result.assets[0].uri);
        setRoute("photo");
      }
    } catch {
      Alert.alert("Photo unavailable", "Allow camera or photo access in your device settings, then try again.");
    }
  };

  const chooseCapture = (source: "write" | "camera" | "library") => {
    beginCapture(captureOrigin);
    if (source !== "write") void pickImage(source);
  };

  const extractPhotoText = async () => {
    if (!captureImageUri) return;
    if (!isOcrSupported) { Alert.alert("Text extraction unavailable", "You can still save the original photo."); return; }
    setOcrBusy(true);
    try {
      const parts = await extractTextFromImage(captureImageUri);
      const text = parts.join("\n").trim();
      if (!text) { Alert.alert("We couldn't read this image", "Try another photo or keep this one as an image."); return; }
      setCaptureContent(text);
      setRoute("capture");
    } catch {
      Alert.alert("We couldn't read this image", "Your photo is still here. Try again or keep it as an image.");
    } finally { setOcrBusy(false); }
  };

  const saveCapture = async () => {
    if (!isValidInsight(captureContent, !!captureImageUri) || busy) return;
    setBusy(true);
    try {
      const wasFirst = (await countInsights()) === 0;
      const insight = await createInsight(captureContent, captureContext, captureImageUri);
      deletePickedImageFromCache(captureImageUri);
      setCaptureImageUri(null);
      setSavedInsightId(insight.id);
      setFirstSave(wasFirst);
      if (wasFirst) {
        const next = await saveSettings({ onboardingComplete: true });
        setSettings(next);
        await track("onboarding_completed");
      }
      setInsightCount(await countInsights());
      setRoute("saved");
      try { await reconcileNotifications(await getSettings()); }
      catch (error) { report(error); }
    } catch (error) { report(error); }
    finally { setBusy(false); }
  };

  const finishSave = async () => {
    if (firstSave && !settings?.permissionAsked) setRoute("permission");
    else if (captureOrigin === "library") goLibrary();
    else await goToday();
  };

  const finishPermission = async (ask: boolean) => {
    try {
      if (ask) setNotificationGranted(await requestNotificationPermission());
      const next = await saveSettings({ permissionAsked: true });
      setSettings(next);
      await reconcileNotifications(next);
      await goToday();
    } catch (error) { report(error); await goToday(); }
  };

  const advanceToday = async () => {
    if (!current) return;
    await markShown(current.event.id);
    await markCompleted(current.event.id);
    setTodayItems((items) => items.map((item) => item.event.id === current.event.id ? { ...item, event: { ...item.event, completedAt: new Date().toISOString() } } : item));
    const next = todayIndex + 1;
    const shownCount = await getShownCount();
    if (!current.event.valueFeedback && shouldAskValueFeedback(shownCount)) {
      void markValueFeedbackAsked().catch(() => undefined);
      setFeedbackEventId(current.event.id);
      setPendingNextIndex(next);
    } else setTodayIndex(next);
  };

  const finishFeedback = async (value?: "yes" | "not_really") => {
    try { if (value && feedbackEventId) await saveValueFeedback(feedbackEventId, value); }
    catch (error) { report(error); }
    setFeedbackEventId(null);
    setTodayIndex(pendingNextIndex);
  };

  const finishReflection = async (response: "yes" | "not_now" | "not_anymore") => {
    if (!current) return;
    const commit = async () => {
      try {
        await markShown(current.event.id);
        await respondToEvent(current.event.id, response, reflectionText);
        if (settings) await reconcileNotifications(settings);
        setReflectionText("");
        setRoute("today");
        await advanceToday();
      } catch (error) { report(error); }
    };
    if (response === "not_anymore") {
      Alert.alert("Archive this insight?", "It won't resurface again, but you can restore it from Library.", [
        { text: "Cancel", style: "cancel" }, { text: "Archive", onPress: () => { void commit(); } },
      ]);
    } else await commit();
  };

  const updateStatus = async (status: InsightStatus) => {
    if (!detail || !settings) return;
    try {
      await setInsightStatus(detail.insight.id, status);
      await reconcileNotifications(settings);
      await openDetail(detail.insight.id, detailOrigin);
    } catch (error) { report(error); }
  };

  const snooze = () => {
    if (!detail || !settings) return;
    const insightId = detail.insight.id;
    const choose = (days: number) => () => {
      void (async () => {
        try {
          await snoozeInsight(insightId, addCalendarDays(new Date(), days));
          await reconcileNotifications(settings);
          await openDetail(insightId, detailOrigin);
        } catch (error) { report(error); }
      })();
    };
    Alert.alert("Snooze this insight?", "It will come back after the time you choose. This doesn't count as an answer.", [
      { text: "1 week", onPress: choose(7) },
      { text: "1 month", onPress: choose(30) },
      { text: "3 months", onPress: choose(90) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const saveEdit = async () => {
    if (!detail || !isValidInsight(editContent, !!detail.insight.imagePath)) return;
    try {
      await editInsight(detail.insight.id, editContent, editContext);
      setEditing(false);
      await openDetail(detail.insight.id, detailOrigin);
      if (settings) await reconcileNotifications(settings);
    } catch (error) { report(error); }
  };

  const confirmDelete = () => {
    if (!detail) return;
    const insightId = detail.insight.id;
    Alert.alert("Delete this insight permanently?", "The insight, original photo, reflections and resurfacing history will be removed from this device.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => {
        void (async () => {
          try {
            await deleteInsight(insightId);
            if (settings) await reconcileNotifications(settings);
            if (detailOrigin === "library") goLibrary(); else await goToday();
          } catch (error) { report(error); }
        })();
      } },
    ]);
  };

  const updateSettings = async (patch: Partial<Settings>) => {
    try {
      const next = await saveSettings(patch);
      setSettings(next);
      await reconcileNotifications(next);
    } catch (error) { report(error); }
  };

  const enableNotifications = async () => {
    try {
      const granted = await requestNotificationPermission();
      setNotificationGranted(granted);
      if (granted) await reconcileNotifications(await getSettings());
      else Alert.alert("Notifications are off", "You can enable Resurface notifications in your device settings.");
    } catch (error) { report(error); }
  };

  const openBackupSheet = (mode: "create" | "restore") => {
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
    error instanceof BackupError ? error.message : "Something went wrong. Nothing on this device was changed.";

  const shareBackup = async (backup: { uri: string; missingPhotos: number }) => {
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
      await Sharing.shareAsync(backup.uri, { mimeType: "application/octet-stream", UTI: BACKUP_UTI, dialogTitle: "Save your Resurface backup" });
      if (backup.missingPhotos) Alert.alert("Backup created", `${backup.missingPhotos} photo${backup.missingPhotos === 1 ? " was" : "s were"} missing on this device and couldn't be included.`);
    } catch (error) { Alert.alert("Backup not shared", backupMessage(error)); }
    finally {
      deleteCachedFile(backup.uri);
    }
  };

  // The password sheet stays up until sharing finishes, so it closes only after the share
  // sheet has been dismissed.
  // If the share sheet never reports back, Cancel stays available while sharing; a late result
  // from an abandoned session cannot close a newer sheet. A stranded file is cleared at launch.
  const createBackup = async () => {
    const session = ++backupSession.current;
    setBackupBusy(true);
    let result: Awaited<ReturnType<typeof createBackupFile>>;
    try { result = await createBackupFile(backupPassword); }
    catch (error) { Alert.alert("Backup not created", backupMessage(error)); return; }
    finally { setBackupBusy(false); }
    setBackupPassword("");
    setBackupConfirm("");
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

  const chooseRestoreFile = () => {
    Alert.alert("Replace everything on this device?", "Restoring a backup replaces all insights, photos, reflections and history currently in Resurface. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Choose backup", style: "destructive", onPress: () => {
        void (async () => {
          try {
            const picked = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
            const asset = picked.canceled ? null : picked.assets[0];
            if (!asset) return;
            try { setRestoreText(await new File(asset.uri).text()); }
            finally { deleteCachedFile(asset.uri); }
            openBackupSheet("restore");
          } catch { Alert.alert("Backup not opened", "That file couldn't be read. Nothing on this device was changed."); }
        })();
      } },
    ]);
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
      try { await reconcileNotifications(next); } catch (error) { report(error); }
      Alert.alert("Backup restored", `${result.insights} insight${result.insights === 1 ? "" : "s"} restored.`);
      await goToday();
    } catch (error) { Alert.alert("Backup not restored", backupMessage(error)); }
    finally { setBackupBusy(false); }
  };

  if (!ready) return <Loading />;
  const confirmStartFresh = () => {
    Alert.alert("Start fresh on this device?", "Resurface can't open the data saved here. Starting fresh moves it aside — nothing is deleted — and opens an empty app, so you can restore an encrypted backup. Data moved aside can't be opened in the app.", [
      { text: "Cancel", style: "cancel" },
      { text: "Start fresh", style: "destructive", onPress: () => {
        void setAsideUnreadableData().then(retryStart).catch((error: unknown) => {
          Alert.alert("Couldn't start fresh", error instanceof Error ? error.message : "Nothing was changed. Try again.");
        });
      } },
    ]);
  };

  if (fatalError) return <Screen><Eyebrow>Unable to open</Eyebrow><Title>Your insights are still protected.</Title><Body>{fatalError}</Body><View style={screenStyles.gap24}><Body muted>Resurface will not reset an encrypted database when its key is unavailable. If your device was just restarted, unlock it and try again.</Body></View><View style={screenStyles.gap24}><Action label="Try again" icon="refresh" onPress={retryStart} /></View>{(fatalReason === "key_unavailable" || fatalReason === "cannot_open") && <View style={screenStyles.gap12}><Action kind="ghost" label="Start fresh and restore a backup" onPress={confirmStartFresh} /></View>}</Screen>;
  if (!settings) return <Loading />;

  const onboarding = [
    { icon: "book-outline" as const, title: "You already know more than you remember.", body: "Save the insights, lessons and ideas you don't want to lose." },
    { icon: "time-outline" as const, title: "Resurface brings them back.", body: "Instead of disappearing into an archive, the things you save return over time." },
    { icon: "leaf-outline" as const, title: "So they have another chance to matter.", body: "You decide what's worth remembering. Resurface helps keep it accessible." },
  ];
  const slide = onboarding[Math.min(settings.onboardingStep, 2)] ?? onboarding[0]!;

  return <>
    <StatusBar style="dark" />
    {route === "onboarding" && <Screen scroll={false}>
      <View style={screenStyles.onboarding}>
        <View><Text style={screenStyles.brand}>resurface<Text style={screenStyles.brandDot}>.</Text></Text><Text accessibilityLabel={`Step ${Math.min(settings.onboardingStep + 1, 3)} of 3`} style={screenStyles.step}>0{Math.min(settings.onboardingStep + 1, 3)} / 03</Text></View>
        <View style={screenStyles.onboardingHero}>
          <View style={screenStyles.heroCircle}><Ionicons name={slide.icon} size={72} color={palette.accentDark} /></View>
          <Eyebrow>A little more accessible</Eyebrow><Title>{slide.title}</Title><Body muted>{slide.body}</Body>
        </View>
        <View style={screenStyles.onboardingFooter}>
          <View style={screenStyles.dots}>{onboarding.map((_, index) => <View key={index} style={[screenStyles.dot, settings.onboardingStep === index && screenStyles.activeDot]} />)}</View>
          <Action label={settings.onboardingStep === 2 ? "Save my first insight" : "Continue"} icon="arrow-forward" onPress={() => {
            if (settings.onboardingStep === 2) beginCapture("onboarding");
            else void updateSettings({ onboardingStep: settings.onboardingStep + 1 });
          }} />
          <Action kind="ghost" label="Restore from a backup" icon="download-outline" onPress={chooseRestoreFile} />
        </View>
      </View>
    </Screen>}

    {route === "capture-choice" && <Screen>
      <Header title="Capture" back={cancelCaptureChoice} />
      <Eyebrow>Save what matters</Eyebrow><Title>How would you like to capture it?</Title>
      <Body muted>Start with your own words or keep a photo. You can edit before saving.</Body>
      <View style={screenStyles.gap24}><Action label="Write" icon="create-outline" onPress={() => chooseCapture("write")} /></View>
      <View style={screenStyles.gap12}><Action kind="secondary" label="Take photo" icon="camera-outline" onPress={() => chooseCapture("camera")} /></View>
      <View style={screenStyles.gap12}><Action kind="secondary" label="Choose photo" icon="images-outline" onPress={() => chooseCapture("library")} /></View>
      <View style={screenStyles.gap12}><Action kind="ghost" label="Cancel" onPress={cancelCaptureChoice} /></View>
    </Screen>}

    {route === "capture" && <Screen>
      <Header title="Save an insight" back={() => { deletePickedImageFromCache(captureImageUri); setCaptureImageUri(null); if (captureOrigin === "onboarding") setRoute("onboarding"); else if (captureOrigin === "library") goLibrary(); else void goToday(); }} />
      <Eyebrow>Capture</Eyebrow><Title>What do you want to remember?</Title>
      <TextInput autoFocus multiline textAlignVertical="top" placeholder="A thought, lesson, or idea that matters to you…" placeholderTextColor={palette.muted} value={captureContent} onChangeText={setCaptureContent} style={screenStyles.captureInput} accessibilityLabel="Insight text" />
      {captureImageUri && <View style={screenStyles.attached}><Ionicons name="image-outline" size={18} color={palette.accentDark} /><Text style={screenStyles.attachedText}>Original photo attached</Text><IconButton icon="close" label="Remove photo" onPress={() => { deletePickedImageFromCache(captureImageUri); setCaptureImageUri(null); }} /></View>}
      <Text style={screenStyles.fieldLabel}>Why does this matter to you? <Text style={screenStyles.optional}>Optional</Text></Text>
      <TextInput multiline textAlignVertical="top" placeholder="Add a little context, if you'd like…" placeholderTextColor={palette.muted} value={captureContext} onChangeText={setCaptureContext} style={screenStyles.contextInput} accessibilityLabel="Optional context" />
      <View style={screenStyles.row}><View style={screenStyles.flex}><Action kind="secondary" icon="camera-outline" label="Take photo" onPress={() => { void pickImage("camera"); }} /></View><View style={screenStyles.flex}><Action kind="secondary" icon="images-outline" label="Choose photo" onPress={() => { void pickImage("library"); }} /></View></View>
      <View style={screenStyles.gap24}><Action label={busy ? "Saving…" : "Save insight"} icon="bookmark-outline" disabled={busy || !isValidInsight(captureContent, !!captureImageUri)} onPress={() => { void saveCapture(); }} /></View>
      <Text style={screenStyles.privacyNote}>Your words and photos stay on this device.</Text>
    </Screen>}

    {route === "photo" && <Screen>
      <Header title="Your photo" back={() => setRoute("capture")} />
      <Eyebrow>Photo capture</Eyebrow><Title>Keep what matters.</Title>
      {captureImageUri && <Image source={{ uri: captureImageUri }} resizeMode="contain" style={screenStyles.photoPreview} />}
      <Body muted>Save the photo as it is, or turn the visible text into something you can edit. The original stays attached.</Body>
      <View style={screenStyles.gap24}><Action label="Keep as image" icon="image-outline" onPress={() => { setCaptureContent(""); setRoute("capture"); }} /></View>
      <View style={screenStyles.gap12}><Action kind="secondary" label={ocrBusy ? "Extracting text…" : "Extract text"} icon="text-outline" disabled={ocrBusy} onPress={() => { void extractPhotoText(); }} /></View>
      <View style={screenStyles.gap12}><Action kind="ghost" label="Choose another photo" onPress={() => { void pickImage("library"); }} /></View>
    </Screen>}

    {route === "saved" && <Screen scroll={false}>
      <View style={screenStyles.centerPanel}><View style={screenStyles.successIcon}><Ionicons name="checkmark" size={38} color={palette.accentDark} /></View><Eyebrow>Safely saved</Eyebrow><Title>{firstSave ? "Your first insight is saved." : "Saved."}</Title><Body muted>We'll bring it back after some time has passed.</Body></View>
      <View style={screenStyles.bottomActions}><Action label="Continue" onPress={() => { void finishSave(); }} /><View style={screenStyles.gap12}><Action kind="ghost" label="View insight" onPress={() => { if (savedInsightId) void openDetail(savedInsightId, "today"); }} /></View></View>
    </Screen>}

    {route === "permission" && <Screen scroll={false}>
      <View style={screenStyles.centerPanel}><View style={screenStyles.successIcon}><Ionicons name="notifications-outline" size={38} color={palette.accentDark} /></View><Eyebrow>A gentle reminder</Eyebrow><Title>Let Resurface bring it back.</Title><Body muted>Notifications allow the things you've saved to find their way back to you. You can change this later.</Body></View>
      <View style={screenStyles.bottomActions}><Action label="Enable notifications" onPress={() => { void finishPermission(true); }} /><View style={screenStyles.gap12}><Action kind="ghost" label="Not now" onPress={() => { void finishPermission(false); }} /></View></View>
    </Screen>}

    {route === "today" && <Screen scroll={false}>
      <Header title="resurface." right={<IconButton icon="settings-outline" label="Settings" onPress={() => { void getBetaMetrics().then(setMetrics).catch(report); void Notifications.getPermissionsAsync().then((permission) => setNotificationGranted(permission.granted)).catch(report); setRoute("settings"); }} />} />
      <ScrollView contentContainerStyle={screenStyles.todayContent}>
        <Eyebrow>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</Eyebrow>
        <Title>Today</Title>
        {todayStatus === "loading" ? <TodaySkeleton />
          : todayStatus === "error" ? <Surface style={screenStyles.emptyCard}><Ionicons name="cloud-offline-outline" size={36} color={palette.accentDark} /><Text maxFontSizeMultiplier={1.8} style={screenStyles.emptyTitle}>Today couldn't load.</Text><Body muted>Your insights are still saved on this device. Nothing was changed or reset.</Body><View style={screenStyles.gap24}><Action label="Try again" icon="refresh" onPress={() => { void goToday(); }} /></View><View style={screenStyles.gap12}><Action kind="ghost" label="Open Library" onPress={goLibrary} /></View></Surface>
          : todayItems.length === 0 ? <Surface style={screenStyles.emptyCard}><Ionicons name={insightCount === 0 ? "bookmark-outline" : "sunny-outline"} size={36} color={palette.accentDark} /><Text maxFontSizeMultiplier={1.8} style={screenStyles.emptyTitle}>{insightCount === 0 ? "Nothing here yet." : "Nothing to resurface today."}</Text><Body muted>{insightCount === 0 ? "Save something you don't want to lose." : "Some things are better remembered after a little time has passed."}</Body><View style={screenStyles.gap24}><Action label={insightCount === 0 ? "Save your first insight" : "Save something"} onPress={() => beginCapture("today")} /></View></Surface>
          : todayIndex >= todayItems.length ? <Surface style={screenStyles.emptyCard}><Ionicons name="checkmark-circle-outline" size={38} color={palette.accentDark} /><Text maxFontSizeMultiplier={1.8} style={screenStyles.emptyTitle}>That's all for today.</Text><Body muted>We'll bring more back when the time is right.</Body><View style={screenStyles.gap24}><Action kind="secondary" label="Save something" onPress={() => beginCapture("today")} /></View></Surface>
          : current && <>
            <Text style={screenStyles.subtitle}>{todayItems.length} {todayItems.length === 1 ? "thing" : "things"} worth remembering</Text>
            <Text style={screenStyles.counter}>{todayIndex + 1} of {todayItems.length}</Text>
            <InsightCard insight={current.insight} />
            <View style={screenStyles.gap24}><Action label="Reflect" icon="chatbubble-ellipses-outline" onPress={() => { setReflectionText(""); setRoute("reflect"); }} /></View>
            <View style={screenStyles.gap12}><Action kind="secondary" label="Next" icon="arrow-forward" onPress={() => { void advanceToday(); }} /></View>
            <Pressable accessibilityRole="button" onPress={() => { void openDetail(current.insight.id, "today"); }}><Text style={screenStyles.textLink}>View insight and history</Text></Pressable>
          </>}
      </ScrollView>
      <BottomNav active="today" onToday={() => { void goToday(); }} onCapture={() => openCaptureChoice("today")} onLibrary={goLibrary} />
    </Screen>}

    {route === "reflect" && current && <Screen>
      <Header title="Reflect" back={() => setRoute("today")} />
      <Eyebrow>A moment to check in</Eyebrow><InsightCard insight={current.insight} compact />
      <View style={screenStyles.gap24}><Title>Does this still resonate?</Title></View>
      <TextInput multiline textAlignVertical="top" placeholder="Anything you want to add? (optional)" placeholderTextColor={palette.muted} value={reflectionText} onChangeText={setReflectionText} style={screenStyles.contextInput} accessibilityLabel="Optional reflection" />
      <View style={screenStyles.gap24}><Action label="Yes, it does" onPress={() => { void finishReflection("yes"); }} /></View>
      <View style={screenStyles.gap12}><Action kind="secondary" label="Not right now · Pause" onPress={() => { void finishReflection("not_now"); }} /></View>
      <View style={screenStyles.gap12}><Action kind="ghost" label="Not anymore · Archive" onPress={() => { void finishReflection("not_anymore"); }} /></View>
    </Screen>}

    {route === "library" && <Screen scroll={false}>
      <Header title="Library" />
      <ScrollView contentContainerStyle={screenStyles.libraryList} keyboardShouldPersistTaps="handled">
      <View><Eyebrow>What you've saved</Eyebrow><Title>Your insights</Title><TextInput placeholder="Search content or context" placeholderTextColor={palette.muted} value={librarySearch} onChangeText={setLibrarySearch} style={screenStyles.search} accessibilityLabel="Search insights" /></View>
      <View style={screenStyles.filters}>{(["active", "paused", "archived"] as InsightStatus[]).map((status) => <Pressable key={status} accessibilityRole="tab" accessibilityState={{ selected: libraryStatus === status }} onPress={() => setLibraryStatus(status)} style={[screenStyles.filter, libraryStatus === status && screenStyles.selectedFilter]}><Text style={[screenStyles.filterText, libraryStatus === status && screenStyles.selectedFilterText]}>{status[0]!.toUpperCase() + status.slice(1)}</Text></Pressable>)}</View>
        {libraryError ? <Surface style={screenStyles.emptyCard}><Ionicons name="cloud-offline-outline" size={36} color={palette.accentDark} /><Text maxFontSizeMultiplier={1.8} style={screenStyles.emptyTitle}>Your library couldn't load.</Text><Body muted>Your insights are still saved on this device. Nothing was changed or reset.</Body><View style={screenStyles.gap24}><Action label="Try again" icon="refresh" onPress={() => setLibraryAttempt((attempt) => attempt + 1)} /></View></Surface>
          : libraryItems.length === 0 ? <Surface style={screenStyles.emptyCard}><Ionicons name="albums-outline" size={36} color={palette.accentDark} /><Text maxFontSizeMultiplier={1.8} style={screenStyles.emptyTitle}>{librarySearch ? "No matching insights." : `No ${libraryStatus} insights.`}</Text><Body muted>What you save will be here whenever you need it.</Body></Surface>
          : libraryItems.map((insight) => <Pressable key={insight.id} accessibilityRole="button" onPress={() => { void openDetail(insight.id); }} style={screenStyles.libraryRow}><View style={screenStyles.libraryIcon}><Ionicons name={insight.imagePath ? "image-outline" : "bookmark-outline"} size={19} color={palette.accentDark} /></View><View style={screenStyles.flex}><Text numberOfLines={2} style={screenStyles.libraryText}>{insight.content || "Saved photo"}</Text><Text style={screenStyles.libraryDate}>{formatDate(insight.createdAt)}</Text></View><Ionicons name="chevron-forward" size={17} color={palette.muted} /></Pressable>)}
      </ScrollView>
      <BottomNav active="library" onToday={() => { void goToday(); }} onCapture={() => openCaptureChoice("library")} onLibrary={goLibrary} />
    </Screen>}

    {route === "detail" && detail && <Screen>
      <Header title="Insight" back={() => { if (detailOrigin === "library") goLibrary(); else if (firstSave && !settings.permissionAsked) setRoute("permission"); else void goToday(); }} />
      <Eyebrow>{detail.insight.status} · saved {formatDate(detail.insight.createdAt)}</Eyebrow>
      {editing ? <>
        <Title>Edit insight</Title>
        <TextInput multiline textAlignVertical="top" value={editContent} onChangeText={setEditContent} placeholder="What do you want to remember?" style={screenStyles.captureInput} accessibilityLabel="Edit insight text" />
        <Text style={screenStyles.fieldLabel}>Context</Text><TextInput multiline textAlignVertical="top" value={editContext} onChangeText={setEditContext} style={screenStyles.contextInput} accessibilityLabel="Edit context" />
        <View style={screenStyles.gap24}><Action label="Save changes" disabled={!isValidInsight(editContent, !!detail.insight.imagePath)} onPress={() => { void saveEdit(); }} /></View>
        <View style={screenStyles.gap12}><Action kind="ghost" label="Cancel" onPress={() => setEditing(false)} /></View>
      </> : <>
        <InsightCard insight={detail.insight} />
        <View style={screenStyles.gap24}><Action kind="secondary" label="Edit" icon="create-outline" onPress={() => setEditing(true)} /></View>
        {detail.insight.status === "active" && (() => {
          const next = detail.events.find((event) => !event.shownAt && !event.cancelledAt);
          return <>
            {next && <View style={screenStyles.gap24}><Body muted>Resurfaces after {formatDate(next.scheduledAt)}</Body></View>}
            <View style={screenStyles.gap12}><Action kind="ghost" label="Snooze" icon="time-outline" onPress={snooze} /></View>
          </>;
        })()}
        <View style={screenStyles.gap12}>{detail.insight.status === "active" ? <Action kind="ghost" label="Pause resurfacing" onPress={() => { void updateStatus("paused"); }} /> : <Action kind="secondary" label={detail.insight.status === "paused" ? "Resume resurfacing" : "Restore insight"} onPress={() => { void updateStatus("active"); }} />}</View>
        {detail.insight.status !== "archived" && <View style={screenStyles.gap12}><Action kind="ghost" label="Archive" onPress={() => { Alert.alert("Archive this insight?", "You can restore it from Library later.", [{ text: "Cancel", style: "cancel" }, { text: "Archive", onPress: () => { void updateStatus("archived"); } }]); }} /></View>}
        <View style={screenStyles.gap12}><Action kind="danger" label="Delete permanently" onPress={confirmDelete} /></View>
        <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>Resurfacing history</Text></View>
        {detail.events.filter((event) => !!event.shownAt).length === 0 ? <Body muted>We'll bring this back after some time has passed.</Body> : detail.events.filter((event) => !!event.shownAt).map((event) => <View key={event.id} style={screenStyles.historyRow}><View style={screenStyles.historyDot} /><View style={screenStyles.flex}><Text style={screenStyles.historyDate}>{formatDate(event.shownAt!)}</Text><Text style={screenStyles.historyMeta}>{event.response === "yes" ? "Still relevant" : event.response === "not_now" ? "Paused" : event.response === "not_anymore" ? "Archived" : "Seen"}</Text>{detail.reflections.filter((reflection) => reflection.eventId === event.id).map((reflection) => <Text key={reflection.id} style={screenStyles.reflectionText}>{reflection.content}</Text>)}</View></View>)}
      </>}
    </Screen>}

    {route === "settings" && <Screen>
      <Header title="Settings" back={() => { void goToday(); }} />
      <Eyebrow>Make it yours</Eyebrow><Title>A gentler rhythm.</Title>
      <Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>Resurfacing frequency</Text><Body muted>Maximum number of insights Today can show in one day.</Body>
      <View style={[screenStyles.frequency, stackChoices && screenStyles.frequencyStacked]}>{([1, 3, 5] as const).map((cap) => <Pressable key={cap} accessibilityRole="radio" accessibilityState={{ checked: settings.dailyCap === cap }} accessibilityLabel={`${cap === 1 ? "Light" : cap === 3 ? "Standard" : "More"}, up to ${cap} per day`} onPress={() => { void updateSettings({ dailyCap: cap }); }} style={[screenStyles.frequencyOption, stackChoices && screenStyles.frequencyOptionStacked, settings.dailyCap === cap && screenStyles.frequencySelected]}><Text style={screenStyles.frequencyName}>{cap === 1 ? "Light" : cap === 3 ? "Standard" : "More"}</Text><Text style={screenStyles.frequencyDetail}>Up to {cap}/day</Text></Pressable>)}</View>
      <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>Notifications</Text><Body muted>One approximate notification window per day. Today still works if notifications are off.</Body></View>
      {notificationGranted === false && <View style={screenStyles.gap12}><Action kind="secondary" label="Enable notifications" onPress={() => { void enableNotifications(); }} /></View>}
      <Text style={screenStyles.fieldLabel}>Preferred time (24-hour HH:MM)</Text>
      <TextInput value={settings.notificationTime} onChangeText={(value) => { setSettings({ ...settings, notificationTime: value }); }} onBlur={() => { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.notificationTime)) void updateSettings({ notificationTime: settings.notificationTime }); else { Alert.alert("Use HH:MM", "Enter a time such as 09:00 or 18:30."); void getSettings().then(setSettings); } }} keyboardType="numbers-and-punctuation" maxLength={5} style={screenStyles.search} accessibilityLabel="Notification time" />
      <Surface style={screenStyles.switchRow}><View style={screenStyles.flex}><Text style={screenStyles.switchTitle}>Show insight text</Text><Text style={screenStyles.switchDescription}>Personal words may appear on your lock screen.</Text></View><Switch accessibilityLabel="Show insight text in notifications" value={settings.showInsightText} onValueChange={(value) => { void updateSettings({ showInsightText: value }); }} trackColor={{ true: palette.accentDark }} /></Surface>
      <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>Privacy & data</Text><Body muted>Insights, photos, reflections, and history are encrypted and kept on this device. There is no account or cloud sync. Removing the app or losing this device loses your insights unless you keep a backup.</Body></View>
      <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>Backup</Text><Body muted>Create a password-protected file you can save in Files, iCloud Drive, Google Drive or anywhere else, and restore it on this or another device.</Body></View>
      <View style={screenStyles.gap12}><Action kind="secondary" label="Create encrypted backup" icon="lock-closed-outline" onPress={() => openBackupSheet("create")} /></View>
      <View style={screenStyles.gap12}><Action kind="ghost" label="Restore from backup" icon="download-outline" onPress={chooseRestoreFile} /></View>
      <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>Beta signals on this device</Text><Body muted>{metrics ? (metrics.activated ? "Activated: saved an insight and saw one resurface." : "Not yet activated: save an insight and see it resurface.") : ""}</Body><Body muted>{metrics ? `${metrics.saved} saved · ${metrics.shown} shown · asked ${metrics.asked} · ${metrics.answered} answered · ${metrics.valuable} marked worthwhile` : "Loading…"}</Body><Body muted>{metrics?.shown ? `${Math.round((metrics.answered / metrics.shown) * 100)}% of shown insights received a value answer.` : "Answer rate appears after the first resurfacing."}</Body><Body muted>{metrics?.answered ? `${Math.round((metrics.valuable / metrics.answered) * 100)}% of answers said a resurfacing was worthwhile.` : "Value rate appears after you answer a feedback question."}</Body></View>
      <View style={screenStyles.gap24}><Body muted>Resurface 0.1.0 · Device-only beta</Body></View>
    </Screen>}

    {/* An in-screen overlay rather than a native Modal, so the share sheet is the only view
        controller iOS presents and nothing competes with it. */}
    {!!backupMode && <View style={StyleSheet.absoluteFill}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={screenStyles.modalBackdrop}>
        <Surface style={screenStyles.feedbackBox}>
          <Eyebrow>{backupMode === "create" ? "Encrypted backup" : "Restore backup"}</Eyebrow>
          <Text maxFontSizeMultiplier={1.8} style={screenStyles.feedbackTitle}>{backupMode === "create" ? "Choose a backup password." : "Enter the backup password."}</Text>
          <Body muted>{backupMode === "create" ? "If you forget this password, the backup can't be opened. Resurface can't reset or recover it." : "Everything currently in Resurface on this device will be replaced."}</Body>
          <TextInput secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType={backupMode === "create" ? "newPassword" : "password"} placeholder="Password" placeholderTextColor={palette.muted} value={backupPassword} onChangeText={setBackupPassword} editable={!backupBusy} style={screenStyles.search} accessibilityLabel="Backup password" />
          {backupMode === "create" && <TextInput secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" placeholder="Repeat password" placeholderTextColor={palette.muted} value={backupConfirm} onChangeText={setBackupConfirm} editable={!backupBusy} style={screenStyles.search} accessibilityLabel="Repeat backup password" />}
          {backupMode === "create" && backupPassword.length > 0 && backupPassword.length < MIN_BACKUP_PASSWORD_LENGTH && <Text style={screenStyles.backupHint}>Use at least {MIN_BACKUP_PASSWORD_LENGTH} characters.</Text>}
          {backupMode === "create" && backupConfirm.length > 0 && backupConfirm !== backupPassword && <Text style={screenStyles.backupHint}>The passwords don't match.</Text>}
          <View style={screenStyles.gap24}>
            {backupMode === "create"
              ? <Action label={backupBusy ? "Encrypting… about 10 seconds" : backupSharing ? "Waiting for the share sheet…" : "Create backup"} disabled={backupBusy || backupSharing || backupPassword.length < MIN_BACKUP_PASSWORD_LENGTH || backupPassword !== backupConfirm} onPress={() => { void createBackup(); }} />
              : <Action kind="danger" label={backupBusy ? "Restoring… about 10 seconds" : "Replace and restore"} disabled={backupBusy || backupPassword.length === 0} onPress={() => { void restore(); }} />}
          </View>
          <View style={screenStyles.gap12}><Action kind="ghost" label="Cancel" disabled={backupBusy} onPress={closeBackupSheet} /></View>
        </Surface>
      </KeyboardAvoidingView>
    </View>}

    <Modal visible={!!feedbackEventId} transparent animationType="fade" onRequestClose={() => { void finishFeedback(); }}>
      <View style={screenStyles.modalBackdrop}><Surface style={screenStyles.feedbackBox}><Eyebrow>A quick check-in</Eyebrow><Text maxFontSizeMultiplier={1.8} style={screenStyles.feedbackTitle}>Was this worth resurfacing today?</Text><Body muted>Your answer helps us understand whether this is useful. It stays on this device.</Body><View style={screenStyles.gap24}><Action label="Yes" onPress={() => { void finishFeedback("yes"); }} /></View><View style={screenStyles.gap12}><Action kind="secondary" label="Not really" onPress={() => { void finishFeedback("not_really"); }} /></View><View style={screenStyles.gap12}><Action kind="ghost" label="Skip" onPress={() => { void finishFeedback(); }} /></View></Surface></View>
    </Modal>
  </>;
}

/**
 * Covers the app whenever it is not active, so the iOS app switcher snapshot never shows an
 * insight. (Android takes its snapshot too late for this; FLAG_SECURE would be needed there.)
 */
function PrivacyCover() {
  const [hidden, setHidden] = useState(AppState.currentState !== "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setHidden(state !== "active"));
    return () => subscription.remove();
  }, []);
  if (!hidden) return null;
  return <View style={[StyleSheet.absoluteFill, screenStyles.privacyCover]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Text style={screenStyles.brand}>resurface<Text style={screenStyles.brandDot}>.</Text></Text></View>;
}

export default function App() {
  return <SafeAreaProvider><ResurfaceApp /><PrivacyCover /></SafeAreaProvider>;
}

const screenStyles = StyleSheet.create({
  flex: { flex: 1 }, row: { flexDirection: "row", gap: 10 }, gap12: { marginTop: 12 }, gap24: { marginTop: 24 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  loadingMark: { width: 90, height: 90, borderRadius: 30, backgroundColor: palette.accent, alignItems: "center", justifyContent: "center" },
  loadingText: { color: palette.muted, marginTop: 24, fontSize: 16 },
  privacyCover: { backgroundColor: palette.background, alignItems: "center", justifyContent: "center" },
  brand: { fontSize: 25, fontWeight: "800", color: palette.ink, letterSpacing: -1 }, brandDot: { color: palette.accentDark },
  step: { color: palette.muted, marginTop: 8, fontSize: 12, fontWeight: "700", letterSpacing: 2 },
  onboarding: { flex: 1, paddingHorizontal: 26, paddingTop: 22, paddingBottom: 26, justifyContent: "space-between" },
  onboardingHero: { paddingBottom: 16 }, heroCircle: { height: 164, width: 164, borderRadius: 82, backgroundColor: palette.accent, alignItems: "center", justifyContent: "center", marginBottom: 28 },
  onboardingFooter: { gap: 26 }, dots: { flexDirection: "row", gap: 8 }, dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.border }, activeDot: { width: 28, backgroundColor: palette.accentDark },
  captureInput: { minHeight: 170, backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.border, borderRadius: 22, padding: 18, color: palette.ink, fontSize: 18, lineHeight: 26 },
  contextInput: { minHeight: 96, backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.border, borderRadius: 18, padding: 16, color: palette.ink, fontSize: 15, lineHeight: 23 },
  fieldLabel: { color: palette.ink, fontSize: 14, fontWeight: "700", marginTop: 24, marginBottom: 9 }, optional: { color: palette.muted, fontWeight: "400" },
  attached: { marginTop: 12, paddingLeft: 12, borderRadius: 14, backgroundColor: palette.soft, flexDirection: "row", alignItems: "center", gap: 8 }, attachedText: { color: palette.accentDark, fontSize: 13, fontWeight: "700", flex: 1 },
  privacyNote: { color: palette.muted, fontSize: 12, textAlign: "center", marginTop: 18 },
  photoPreview: { width: "100%", height: 300, backgroundColor: palette.soft, borderRadius: 20, marginVertical: 24 },
  centerPanel: { flex: 1, justifyContent: "center", paddingHorizontal: 28 }, bottomActions: { paddingHorizontal: 24, paddingBottom: 32 },
  successIcon: { width: 84, height: 84, borderRadius: 28, backgroundColor: palette.accent, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  todayContent: { paddingHorizontal: 24, paddingBottom: 34 }, subtitle: { color: palette.muted, fontSize: 16, marginBottom: 20 }, counter: { color: palette.accentDark, fontSize: 12, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 },
  insightCard: { minHeight: 260, justifyContent: "space-between" }, compactCard: { minHeight: 0 },
  cardMark: { width: 32, height: 32, borderRadius: 11, backgroundColor: palette.soft, alignItems: "center", justifyContent: "center", marginBottom: 19 },
  cardText: { color: palette.ink, fontSize: 25, lineHeight: 35, fontWeight: "600", letterSpacing: -0.6 }, cardTextCompact: { color: palette.ink, fontSize: 20, lineHeight: 29, fontWeight: "600" },
  savedDate: { color: palette.muted, fontSize: 12, marginTop: 22 }, context: { color: palette.muted, fontSize: 15, lineHeight: 23, marginTop: 18 },
  image: { width: "100%", marginTop: 18, borderRadius: 12 }, imagePlaceholder: { width: "100%", marginTop: 18, backgroundColor: palette.soft, borderRadius: 12, alignItems: "center", justifyContent: "center", padding: 16, gap: 8 },
  imageMessage: { color: palette.muted, fontSize: 13, textAlign: "center" }, imageRetry: { color: palette.accentDark, fontWeight: "700", padding: 8 }, imageRetryTarget: { minHeight: 44, minWidth: 44, justifyContent: "center" },
  skeletonLine: { height: 14, borderRadius: 7, backgroundColor: palette.soft, marginBottom: 12 }, skeletonLarge: { height: 24, borderRadius: 9 },
  skeletonButton: { height: 52, borderRadius: 15, backgroundColor: palette.soft },
  emptyCard: { alignItems: "flex-start", marginTop: 18, gap: 12 }, emptyTitle: { color: palette.ink, fontSize: 22, fontWeight: "700", marginTop: 12 },
  textLink: { color: palette.accentDark, fontWeight: "700", textAlign: "center", padding: 20 },
  search: { backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.border, borderRadius: 15, minHeight: 50, paddingHorizontal: 14, paddingVertical: 12, color: palette.ink, marginTop: 8 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 16 }, filter: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: palette.soft }, selectedFilter: { backgroundColor: palette.dark }, filterText: { color: palette.muted, fontWeight: "700", fontSize: 13 }, selectedFilterText: { color: palette.paper },
  libraryList: { paddingHorizontal: 24, paddingBottom: 40 }, libraryRow: { backgroundColor: palette.paper, borderColor: palette.border, borderWidth: 1, padding: 16, borderRadius: 18, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 14 },
  libraryIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: palette.soft, alignItems: "center", justifyContent: "center" }, libraryText: { color: palette.ink, fontSize: 15, lineHeight: 21, fontWeight: "600" }, libraryDate: { color: palette.muted, fontSize: 12, marginTop: 5 },
  sectionTitle: { color: palette.ink, fontSize: 18, fontWeight: "700", marginBottom: 9 },
  historyRow: { flexDirection: "row", gap: 14, borderLeftWidth: 1, borderLeftColor: palette.border, paddingLeft: 18, paddingBottom: 20, marginLeft: 7 }, historyDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.accentDark, marginLeft: -23 }, historyDate: { color: palette.ink, fontWeight: "700" }, historyMeta: { color: palette.muted, marginTop: 4 }, reflectionText: { color: palette.ink, marginTop: 10, lineHeight: 22 },
  frequency: { flexDirection: "row", gap: 8, marginTop: 16 }, frequencyStacked: { flexDirection: "column" }, frequencyOptionStacked: { flex: 0 }, frequencyOption: { flex: 1, padding: 12, backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.border, borderRadius: 15 }, frequencySelected: { borderColor: palette.accentDark, backgroundColor: palette.soft }, frequencyName: { color: palette.ink, fontWeight: "700", fontSize: 13 }, frequencyDetail: { color: palette.muted, fontSize: 11, marginTop: 5 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 16 }, switchTitle: { color: palette.ink, fontWeight: "700", fontSize: 15 }, switchDescription: { color: palette.muted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  backupHint: { color: palette.danger, fontSize: 13, marginTop: 8 },
  modalBackdrop: { flex: 1, backgroundColor: "#14221ACC", justifyContent: "center", padding: 24 }, feedbackBox: { padding: 24 }, feedbackTitle: { color: palette.ink, fontSize: 26, lineHeight: 33, fontWeight: "700", marginBottom: 10 },
});
