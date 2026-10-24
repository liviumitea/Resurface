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
import { BACKUP_LIMITS, BACKUP_UTI, BackupError, MIN_BACKUP_PASSWORD_LENGTH, type BackupOmissions } from "./src/backup";
import { formatDate, formatDateTime, formatLongDay, resolveLanguage, setLanguage, t, type MessageKey } from "./src/i18n";
import { MAX_CATEGORY_NAME_LENGTH, MAX_SOURCE_LENGTH, addCalendarDays, type LibraryItem, type LibrarySort, isValidInsight, type Category, type CategoryWithCount, shouldAskValueFeedback, type Insight, type InsightDetail, type InsightStatus, type Settings, type TodayItem } from "./src/domain";
import { clearTransientCaches, deletePickedImageFromCache, imageDataUri } from "./src/media";
import { notificationEventId, reconcileNotifications, requestNotificationPermission } from "./src/notifications";
import {
  countInsights, createBackupFile, createInsight, deleteCachedFile, deleteInsight, editInsight, getBetaMetrics, getDetail,
  getEvent, getInsight, getSettings, getShownCount, listInsights, markCompleted, markValueFeedbackAsked, markOpened, markShown,
  openStorage, respondToEvent, restoreBackup, setAsideUnreadableData, snoozeInsight, StorageError, verifyBackup,
  CategoryError, createCategory, deleteCategory, listCategories, renameCategory, setFavorite, setInsightCategories,
  getBackupStatus, type BackupStatus, type BetaMetrics, type StorageFailure, saveSettings, saveValueFeedback, selectToday, setInsightStatus, track,
} from "./src/storage";
import { palette } from "./src/theme";
import { Action, Body, BottomNav, Eyebrow, Header, IconButton, Screen, Surface, Title } from "./src/ui";

type Route = "onboarding" | "capture-choice" | "capture" | "photo" | "saved" | "permission" | "today" | "reflect" | "library" | "detail" | "settings" | "categories";
type CaptureOrigin = "onboarding" | "today" | "library";
type TodayStatus = "loading" | "ready" | "error";

/** Itemized, translated description of what a backup leaves (or left) out. */
function omissionsText(omissions: BackupOmissions, when: "now" | "then"): string {
  const suffix = when === "now" ? "Now" : "Then";
  const parts = [t(`omissions.photos${suffix}` as MessageKey, { count: omissions.missingPhotos })];
  if (omissions.insightsLeftOut) parts.push(t(`omissions.leftOut${suffix}` as MessageKey, { count: omissions.insightsLeftOut }));
  if (omissions.insightsWithoutPhoto) parts.push(t(`omissions.withoutPhoto${suffix}` as MessageKey, { count: omissions.insightsWithoutPhoto }));
  return `${parts.join("; ")}.`;
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
  if (state === "missing") return <View style={[screenStyles.imagePlaceholder, { height }]}><Ionicons name="image-outline" size={28} color={palette.muted} /><Text style={screenStyles.imageMessage}>{t("image.missing")}</Text></View>;
  if (state === "error") return <View style={[screenStyles.imagePlaceholder, { height }]}><Ionicons name="alert-circle-outline" size={28} color={palette.muted} /><Text style={screenStyles.imageMessage}>{t("image.error")}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("image.retryLabel")} onPress={() => setAttempt((value) => value + 1)} style={screenStyles.imageRetryTarget}><Text style={screenStyles.imageRetry}>{t("common.tryAgain")}</Text></Pressable></View>;
  if (!uri) return <View accessibilityLabel={t("image.loading")} style={[screenStyles.imagePlaceholder, { height }]}><Ionicons name="image-outline" size={28} color={palette.muted} /></View>;
  return <Image source={{ uri }} resizeMode="contain" style={[screenStyles.image, { height }]} accessibilityLabel={t("image.label")} />;
}

// Decrypted previews live only in memory, capped so a long Library can't hold every photo.
const thumbnailCache = new Map<string, string>();
const THUMBNAIL_CACHE_SIZE = 24;

/** Small encrypted-photo preview for Library rows; falls back to an icon if it can't be opened. */
function Thumbnail({ path }: { path: string }) {
  const [uri, setUri] = useState<string | null>(thumbnailCache.get(path) ?? null);
  useEffect(() => {
    if (thumbnailCache.has(path)) return;
    let active = true;
    imageDataUri(path).then((next) => {
      if (!next) return;
      thumbnailCache.set(path, next);
      while (thumbnailCache.size > THUMBNAIL_CACHE_SIZE) thumbnailCache.delete(thumbnailCache.keys().next().value!);
      if (active) setUri(next);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [path]);
  if (!uri) return <View style={screenStyles.libraryIcon}><Ionicons name="image-outline" size={19} color={palette.accentDark} /></View>;
  return <Image source={{ uri }} resizeMode="cover" style={screenStyles.thumbnail} accessibilityLabel={t("image.thumbLabel")} />;
}

function InsightCard({ insight, compact = false }: { insight: Insight; compact?: boolean }) {
  return (
    <Surface style={compact ? screenStyles.compactCard : screenStyles.insightCard}>
      <View style={screenStyles.cardMark}><Ionicons name="sparkles-outline" size={17} color={palette.accentDark} /></View>
      {!!insight.content && <Text style={compact ? screenStyles.cardTextCompact : screenStyles.cardText}>{insight.content}</Text>}
      <InsightImage path={insight.imagePath} height={compact ? 100 : 250} />
      {!!insight.context && !compact && <Text style={screenStyles.context}>{insight.context}</Text>}
      <Text style={screenStyles.savedDate}>{t("common.savedOn", { date: formatDate(insight.createdAt) })}</Text>
    </Surface>
  );
}

/** Toggleable category chips with an inline "new category" field; categories are always optional. */
function CategoryChips({ categories, selected, onToggle, onCreate }: {
  categories: Category[];
  selected: string[];
  onToggle: (categoryId: string) => void;
  onCreate: (name: string) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const add = async () => { if (await onCreate(name)) { setName(""); setAdding(false); } };
  return <View style={screenStyles.chipWrap}>
    {categories.map((category) => {
      const on = selected.includes(category.id);
      return <Pressable key={category.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={t("category.label", { name: category.name })} onPress={() => onToggle(category.id)} style={[screenStyles.filter, on && screenStyles.selectedFilter]}>
        <Text style={[screenStyles.filterText, on && screenStyles.selectedFilterText]}>{category.name}</Text>
      </Pressable>;
    })}
    {adding
      ? <View style={screenStyles.newCategory}>
          <TextInput autoFocus clearButtonMode="while-editing" value={name} onChangeText={setName} maxLength={MAX_CATEGORY_NAME_LENGTH} placeholder={t("category.new")} placeholderTextColor={palette.muted} returnKeyType="done" onSubmitEditing={() => { void add(); }} style={[screenStyles.search, screenStyles.flex]} accessibilityLabel={t("category.newName")} />
          <Action kind="secondary" label={t("common.add")} disabled={!name.trim()} onPress={() => { void add(); }} />
        </View>
      : <Pressable accessibilityRole="button" onPress={() => setAdding(true)} style={[screenStyles.filter, screenStyles.addChip]}><Text style={screenStyles.filterText}>{t("category.newChip")}</Text></Pressable>}
  </View>;
}

function Loading({ message }: { message?: string }) {
  return <Screen scroll={false}><View style={screenStyles.center}><View style={screenStyles.loadingMark}><Ionicons name="sparkles" size={34} color={palette.accentDark} /></View><Text style={screenStyles.loadingText}>{message ?? t("common.loadingApp")}</Text></View></Screen>;
}

function TodaySkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={t("today.skeleton")}>
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

// Until settings load (or if they can't), follow the device language.
setLanguage(resolveLanguage("system"));

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
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [librarySort, setLibrarySort] = useState<LibrarySort>("newest");
  const [categories, setCategories] = useState<CategoryWithCount[]>([]);
  const [libraryCategory, setLibraryCategory] = useState<string | null>(null);
  const [captureCategoryIds, setCaptureCategoryIds] = useState<string[]>([]);
  const [captureSource, setCaptureSource] = useState("");
  const [editSource, setEditSource] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [editCategoryIds, setEditCategoryIds] = useState<string[]>([]);
  const [renamingCategory, setRenamingCategory] = useState<{ id: string; name: string } | null>(null);
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
  // A card seen earlier today that the user went back to; null means the current card.
  const [revisitEventId, setRevisitEventId] = useState<string | null>(null);
  const reflecting = useRef(false);
  const [feedbackEventId, setFeedbackEventId] = useState<string | null>(null);
  const [pendingNextIndex, setPendingNextIndex] = useState(0);
  const [metrics, setMetrics] = useState<BetaMetrics | null>(null);
  const [notificationGranted, setNotificationGranted] = useState<boolean | null>(null);
  const [backupMode, setBackupMode] = useState<"create" | "restore" | "verify" | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [backupPassword, setBackupPassword] = useState("");
  const [backupConfirm, setBackupConfirm] = useState("");
  // Side-by-side cards break words at large accessibility text sizes, so they stack instead.
  const stackChoices = useWindowDimensions().fontScale > 1.3;
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupSharing, setBackupSharing] = useState(false);
  const backupSession = useRef(0);
  const [restoreText, setRestoreText] = useState<string | null>(null);

  const report = (error: unknown) => {
    // Raw error messages are developer-facing and English; users get a translated, generic one.
    void error;
    Alert.alert("Resurface", t("common.genericError"));
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
    setEditCategoryIds(found.categories.map((category) => category.id));
    setEditSource(found.insight.source ?? "");
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
        setLanguage(resolveLanguage(nextSettings.language));
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
          setFatalError(error instanceof StorageError ? t(`storageError.${error.reason}` as MessageKey) : t("fatal.generic"));
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
  const reflectTarget = (revisitEventId ? todayItems.find((item) => item.event.id === revisitEventId) : undefined) ?? current;
  // Cards already shown today (except the one on screen), so the user can go back and reflect.
  const seenToday = todayItems.filter((item) => !!item.event.shownAt && item.event.id !== current?.event.id);
  useEffect(() => {
    if (route !== "today" || todayStatus !== "ready" || !current || current.event.shownAt) return;
    void markShown(current.event.id).then(async () => {
      setTodayItems((items) => items.map((item) => item.event.id === current.event.id ? { ...item, event: { ...item.event, shownAt: new Date().toISOString() } } : item));
      if (settings) await reconcileNotifications(settings);
    }).catch(report);
  }, [route, todayStatus, current?.event.id, current?.event.shownAt, settings]);

  // The previous list stays visible while a search refines it; a failure replaces it
  // with a retryable message rather than an alert over stale results.
  const refreshCategories = useCallback(async () => {
    try {
      const next = await listCategories();
      setCategories(next);
      setLibraryCategory((current) => (current && next.some((category) => category.id === current) ? current : null));
    } catch { /* The category list is optional; the screens work without it. */ }
  }, []);

  useEffect(() => {
    if (route === "library" || route === "capture" || route === "detail" || route === "categories") void refreshCategories();
  }, [route, refreshCategories]);

  const categoryMessage = (error: unknown) =>
    error instanceof CategoryError ? t(`category.problem.${error.problem}` as MessageKey, { max: MAX_CATEGORY_NAME_LENGTH }) : t("common.genericError");

  const toggle = (ids: string[], categoryId: string) => (ids.includes(categoryId) ? ids.filter((value) => value !== categoryId) : [...ids, categoryId]);

  /** Creates a category from a chip field and selects it; reports name problems without losing input. */
  const addCategory = async (name: string, select?: (categoryId: string) => void): Promise<boolean> => {
    try {
      const category = await createCategory(name);
      await refreshCategories();
      select?.(category.id);
      return true;
    } catch (error) {
      Alert.alert(t("category.notAdded"), categoryMessage(error));
      return false;
    }
  };

  useEffect(() => {
    if (route !== "library") return;
    let active = true;
    listInsights(libraryStatus, librarySearch, libraryCategory, favoritesOnly, librarySort)
      .then((items) => { if (active) { setLibraryItems(items); setLibraryError(false); } })
      .catch(() => { if (active) setLibraryError(true); });
    return () => { active = false; };
  }, [route, libraryStatus, librarySearch, libraryCategory, favoritesOnly, librarySort, libraryAttempt]);

  const beginCapture = (origin: CaptureOrigin) => {
    deletePickedImageFromCache(captureImageUri);
    setCaptureOrigin(origin);
    setCaptureContent("");
    setCaptureContext("");
    setCaptureImageUri(null);
    setCaptureCategoryIds([]);
    setCaptureSource("");
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
      Alert.alert(t("capture.photoUnavailableTitle"), t("capture.photoUnavailableBody"));
    }
  };

  const chooseCapture = (source: "write" | "camera" | "library") => {
    beginCapture(captureOrigin);
    if (source !== "write") void pickImage(source);
  };

  const extractPhotoText = async () => {
    if (!captureImageUri) return;
    if (!isOcrSupported) { Alert.alert(t("ocr.unavailableTitle"), t("ocr.unavailableBody")); return; }
    setOcrBusy(true);
    try {
      const parts = await extractTextFromImage(captureImageUri);
      const text = parts.join("\n").trim();
      if (!text) { Alert.alert(t("ocr.failedTitle"), t("ocr.emptyBody")); return; }
      setCaptureContent(text);
      setRoute("capture");
    } catch {
      Alert.alert(t("ocr.failedTitle"), t("ocr.errorBody"));
    } finally { setOcrBusy(false); }
  };

  const saveCapture = async () => {
    if (!isValidInsight(captureContent, !!captureImageUri) || busy) return;
    setBusy(true);
    try {
      const wasFirst = (await countInsights()) === 0;
      const insight = await createInsight(captureContent, captureContext, captureImageUri, captureCategoryIds, captureSource);
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
    const target = reflectTarget;
    if (!target) return;
    const commit = async () => {
      if (reflecting.current) return;
      reflecting.current = true;
      try {
        await markShown(target.event.id);
        await respondToEvent(target.event.id, response, reflectionText);
        if (settings) await reconcileNotifications(settings);
        setReflectionText("");
        setTodayItems((items) => items.map((item) => item.event.id === target.event.id ? { ...item, event: { ...item.event, response } } : item));
        setRoute("today");
        // A revisit is the same exposure: return to where the user was instead of advancing.
        if (revisitEventId) { setRevisitEventId(null); await goToday(); }
        else await advanceToday();
      } catch (error) { report(error); }
      finally { reflecting.current = false; }
    };
    if (response === "not_anymore") {
      Alert.alert(t("reflect.archiveTitle"), t("reflect.archiveBody"), [
        { text: t("common.cancel"), style: "cancel" }, { text: t("common.archive"), onPress: () => { void commit(); } },
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
    Alert.alert(t("snooze.title"), t("snooze.body"), [
      { text: t("snooze.week"), onPress: choose(7) },
      { text: t("snooze.month"), onPress: choose(30) },
      { text: t("snooze.months3"), onPress: choose(90) },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };

  const saveEdit = async () => {
    if (!detail || !isValidInsight(editContent, !!detail.insight.imagePath)) return;
    try {
      await editInsight(detail.insight.id, editContent, editContext, editSource);
      await setInsightCategories(detail.insight.id, editCategoryIds);
      setEditing(false);
      await openDetail(detail.insight.id, detailOrigin);
      if (settings) await reconcileNotifications(settings);
    } catch (error) { report(error); }
  };

  const toggleFavorite = async () => {
    if (!detail) return;
    try {
      await setFavorite(detail.insight.id, !detail.insight.favorite);
      setDetail({ ...detail, insight: { ...detail.insight, favorite: detail.insight.favorite ? 0 : 1 } });
    } catch (error) { report(error); }
  };

  const confirmDelete = () => {
    if (!detail) return;
    const insightId = detail.insight.id;
    Alert.alert(t("detail.deleteTitle"), t("detail.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: () => {
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
      setLanguage(resolveLanguage(next.language));
      setSettings(next);
      await reconcileNotifications(next);
    } catch (error) { report(error); }
  };

  const enableNotifications = async () => {
    try {
      const granted = await requestNotificationPermission();
      setNotificationGranted(granted);
      if (granted) await reconcileNotifications(await getSettings());
      else Alert.alert(t("settings.notificationsOffTitle"), t("settings.notificationsOffBody"));
    } catch (error) { report(error); }
  };

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

  if (!ready) return <Loading />;
  const confirmStartFresh = () => {
    Alert.alert(t("fatal.startFreshTitle"), t("fatal.startFreshBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("fatal.startFreshAction"), style: "destructive", onPress: () => {
        void setAsideUnreadableData().then(retryStart).catch((error: unknown) => {
          Alert.alert(t("fatal.startFreshFailed"), error instanceof StorageError ? t(`storageError.${error.reason}` as MessageKey) : t("fatal.startFreshFailedBody"));
        });
      } },
    ]);
  };

  if (fatalError) return <Screen><Eyebrow>{t("fatal.eyebrow")}</Eyebrow><Title>{t("fatal.title")}</Title><Body>{fatalError}</Body><View style={screenStyles.gap24}><Body muted>{t("fatal.body")}</Body></View><View style={screenStyles.gap24}><Action label={t("common.tryAgain")} icon="refresh" onPress={retryStart} /></View>{(fatalReason === "key_unavailable" || fatalReason === "cannot_open") && <View style={screenStyles.gap12}><Action kind="ghost" label={t("fatal.startFresh")} onPress={confirmStartFresh} /></View>}</Screen>;
  if (!settings) return <Loading />;

  const onboarding = [
    { icon: "book-outline" as const, title: t("onboarding.title1"), body: t("onboarding.body1") },
    { icon: "time-outline" as const, title: t("onboarding.title2"), body: t("onboarding.body2") },
    { icon: "leaf-outline" as const, title: t("onboarding.title3"), body: t("onboarding.body3") },
  ];
  const slide = onboarding[Math.min(settings.onboardingStep, 2)] ?? onboarding[0]!;

  return <>
    <StatusBar style="dark" />
    {route === "onboarding" && <Screen scroll={false}>
      <View style={screenStyles.onboarding}>
        <View><Text style={screenStyles.brand}>resurface<Text style={screenStyles.brandDot}>.</Text></Text><Text accessibilityLabel={t("onboarding.step", { step: Math.min(settings.onboardingStep + 1, 3) })} style={screenStyles.step}>0{Math.min(settings.onboardingStep + 1, 3)} / 03</Text></View>
        <View style={screenStyles.onboardingHero}>
          <View style={screenStyles.heroCircle}><Ionicons name={slide.icon} size={72} color={palette.accentDark} /></View>
          <Eyebrow>{t("onboarding.eyebrow")}</Eyebrow><Title>{slide.title}</Title><Body muted>{slide.body}</Body>
        </View>
        <View style={screenStyles.onboardingFooter}>
          <View style={screenStyles.dots}>{onboarding.map((_, index) => <View key={index} style={[screenStyles.dot, settings.onboardingStep === index && screenStyles.activeDot]} />)}</View>
          <Action label={settings.onboardingStep === 2 ? t("onboarding.saveFirst") : t("common.continue")} icon="arrow-forward" onPress={() => {
            if (settings.onboardingStep === 2) beginCapture("onboarding");
            else void updateSettings({ onboardingStep: settings.onboardingStep + 1 });
          }} />
          <Action kind="ghost" label={t("onboarding.restore")} icon="download-outline" onPress={chooseRestoreFile} />
        </View>
      </View>
    </Screen>}

    {route === "capture-choice" && <Screen>
      <Header title={t("choice.header")} back={cancelCaptureChoice} />
      <Eyebrow>{t("choice.eyebrow")}</Eyebrow><Title>{t("choice.title")}</Title>
      <Body muted>{t("choice.body")}</Body>
      <View style={screenStyles.gap24}><Action label={t("choice.write")} icon="create-outline" onPress={() => chooseCapture("write")} /></View>
      <View style={screenStyles.gap12}><Action kind="secondary" label={t("choice.takePhoto")} icon="camera-outline" onPress={() => chooseCapture("camera")} /></View>
      <View style={screenStyles.gap12}><Action kind="secondary" label={t("choice.choosePhoto")} icon="images-outline" onPress={() => chooseCapture("library")} /></View>
      <View style={screenStyles.gap12}><Action kind="ghost" label={t("common.cancel")} onPress={cancelCaptureChoice} /></View>
    </Screen>}

    {route === "capture" && <Screen>
      <Header title={t("capture.header")} back={() => { deletePickedImageFromCache(captureImageUri); setCaptureImageUri(null); if (captureOrigin === "onboarding") setRoute("onboarding"); else if (captureOrigin === "library") goLibrary(); else void goToday(); }} />
      <Eyebrow>{t("capture.eyebrow")}</Eyebrow><Title>{t("capture.title")}</Title>
      <TextInput autoFocus multiline textAlignVertical="top" placeholder={t("capture.placeholder")} placeholderTextColor={palette.muted} value={captureContent} onChangeText={setCaptureContent} style={screenStyles.captureInput} accessibilityLabel={t("capture.textLabel")} />
      {captureImageUri && <View style={screenStyles.attached}><Ionicons name="image-outline" size={18} color={palette.accentDark} /><Text style={screenStyles.attachedText}>{t("capture.photoAttached")}</Text><IconButton icon="close" label={t("capture.removePhoto")} onPress={() => { deletePickedImageFromCache(captureImageUri); setCaptureImageUri(null); }} /></View>}
      <Text style={screenStyles.fieldLabel}>{t("capture.contextLabel")} <Text style={screenStyles.optional}>{t("common.optional")}</Text></Text>
      <TextInput multiline textAlignVertical="top" placeholder={t("capture.contextPlaceholder")} placeholderTextColor={palette.muted} value={captureContext} onChangeText={setCaptureContext} style={screenStyles.contextInput} accessibilityLabel={t("capture.contextA11y")} />
      <Text style={screenStyles.fieldLabel}>{t("capture.sourceLabel")} <Text style={screenStyles.optional}>{t("common.optional")}</Text></Text>
      <TextInput value={captureSource} onChangeText={setCaptureSource} maxLength={MAX_SOURCE_LENGTH} placeholder={t("capture.sourcePlaceholder")} placeholderTextColor={palette.muted} style={screenStyles.search} accessibilityLabel={t("capture.sourceA11y")} />
      <Text style={screenStyles.fieldLabel}>{t("category.field")} <Text style={screenStyles.optional}>{t("common.optional")}</Text></Text>
      <CategoryChips categories={categories} selected={captureCategoryIds} onToggle={(categoryId) => setCaptureCategoryIds((ids) => toggle(ids, categoryId))} onCreate={(name) => addCategory(name, (categoryId) => setCaptureCategoryIds((ids) => [...ids, categoryId]))} />
      <View style={screenStyles.row}><View style={screenStyles.flex}><Action kind="secondary" icon="camera-outline" label={t("choice.takePhoto")} onPress={() => { void pickImage("camera"); }} /></View><View style={screenStyles.flex}><Action kind="secondary" icon="images-outline" label={t("choice.choosePhoto")} onPress={() => { void pickImage("library"); }} /></View></View>
      <View style={screenStyles.gap24}><Action label={busy ? t("capture.saving") : t("capture.save")} icon="bookmark-outline" disabled={busy || !isValidInsight(captureContent, !!captureImageUri)} onPress={() => { void saveCapture(); }} /></View>
      <Text style={screenStyles.privacyNote}>{t("capture.privacy")}</Text>
    </Screen>}

    {route === "photo" && <Screen>
      <Header title={t("photo.header")} back={() => setRoute("capture")} />
      <Eyebrow>{t("photo.eyebrow")}</Eyebrow><Title>{t("photo.title")}</Title>
      {captureImageUri && <Image source={{ uri: captureImageUri }} resizeMode="contain" style={screenStyles.photoPreview} />}
      <Body muted>{t("photo.body")}</Body>
      <View style={screenStyles.gap24}><Action label={t("photo.keep")} icon="image-outline" onPress={() => { setCaptureContent(""); setRoute("capture"); }} /></View>
      <View style={screenStyles.gap12}><Action kind="secondary" label={ocrBusy ? t("photo.extracting") : t("photo.extract")} icon="text-outline" disabled={ocrBusy} onPress={() => { void extractPhotoText(); }} /></View>
      <View style={screenStyles.gap12}><Action kind="ghost" label={t("photo.another")} onPress={() => { void pickImage("library"); }} /></View>
    </Screen>}

    {route === "saved" && <Screen scroll={false}>
      <View style={screenStyles.centerPanel}><View style={screenStyles.successIcon}><Ionicons name="checkmark" size={38} color={palette.accentDark} /></View><Eyebrow>{t("saved.eyebrow")}</Eyebrow><Title>{firstSave ? t("saved.firstTitle") : t("saved.title")}</Title><Body muted>{t("saved.body")}</Body></View>
      <View style={screenStyles.bottomActions}><Action label={t("common.continue")} onPress={() => { void finishSave(); }} /><View style={screenStyles.gap12}><Action kind="ghost" label={t("saved.view")} onPress={() => { if (savedInsightId) void openDetail(savedInsightId, "today"); }} /></View></View>
    </Screen>}

    {route === "permission" && <Screen scroll={false}>
      <View style={screenStyles.centerPanel}><View style={screenStyles.successIcon}><Ionicons name="notifications-outline" size={38} color={palette.accentDark} /></View><Eyebrow>{t("permission.eyebrow")}</Eyebrow><Title>{t("permission.title")}</Title><Body muted>{t("permission.body")}</Body></View>
      <View style={screenStyles.bottomActions}><Action label={t("permission.enable")} onPress={() => { void finishPermission(true); }} /><View style={screenStyles.gap12}><Action kind="ghost" label={t("permission.notNow")} onPress={() => { void finishPermission(false); }} /></View></View>
    </Screen>}

    {route === "today" && <Screen scroll={false}>
      <Header title="resurface." right={<IconButton icon="settings-outline" label={t("today.settings")} onPress={() => { void getBetaMetrics().then(setMetrics).catch(report); refreshBackupStatus(); void Notifications.getPermissionsAsync().then((permission) => setNotificationGranted(permission.granted)).catch(report); setRoute("settings"); }} />} />
      <ScrollView contentContainerStyle={screenStyles.todayContent}>
        <Eyebrow>{formatLongDay(new Date())}</Eyebrow>
        <Title>{t("today.title")}</Title>
        {todayStatus === "loading" ? <TodaySkeleton />
          : todayStatus === "error" ? <Surface style={screenStyles.emptyCard}><Ionicons name="cloud-offline-outline" size={36} color={palette.accentDark} /><Text maxFontSizeMultiplier={1.8} style={screenStyles.emptyTitle}>{t("today.errorTitle")}</Text><Body muted>{t("today.errorBody")}</Body><View style={screenStyles.gap24}><Action label={t("common.tryAgain")} icon="refresh" onPress={() => { void goToday(); }} /></View><View style={screenStyles.gap12}><Action kind="ghost" label={t("today.openLibrary")} onPress={goLibrary} /></View></Surface>
          : todayItems.length === 0 ? <Surface style={screenStyles.emptyCard}><Ionicons name={insightCount === 0 ? "bookmark-outline" : "sunny-outline"} size={36} color={palette.accentDark} /><Text maxFontSizeMultiplier={1.8} style={screenStyles.emptyTitle}>{insightCount === 0 ? t("today.emptyNewTitle") : t("today.emptyTitle")}</Text><Body muted>{insightCount === 0 ? t("today.emptyNewBody") : t("today.emptyBody")}</Body><View style={screenStyles.gap24}><Action label={insightCount === 0 ? t("today.saveFirst") : t("today.saveSomething")} onPress={() => beginCapture("today")} /></View></Surface>
          : todayIndex >= todayItems.length ? <Surface style={screenStyles.emptyCard}><Ionicons name="checkmark-circle-outline" size={38} color={palette.accentDark} /><Text maxFontSizeMultiplier={1.8} style={screenStyles.emptyTitle}>{t("today.doneTitle")}</Text><Body muted>{t("today.doneBody")}</Body><View style={screenStyles.gap24}><Action kind="secondary" label={t("today.saveSomething")} onPress={() => beginCapture("today")} /></View></Surface>
          : current && <>
            <Text style={screenStyles.subtitle}>{t("today.count", { count: todayItems.length })}</Text>
            <Text style={screenStyles.counter}>{t("today.position", { index: todayIndex + 1, total: todayItems.length })}</Text>
            <InsightCard insight={current.insight} />
            <View style={screenStyles.gap24}><Action label={t("today.reflect")} icon="chatbubble-ellipses-outline" onPress={() => { setRevisitEventId(null); setReflectionText(""); setRoute("reflect"); }} /></View>
            <View style={screenStyles.gap12}><Action kind="secondary" label={t("today.next")} icon="arrow-forward" onPress={() => { void advanceToday(); }} /></View>
            <Pressable accessibilityRole="button" onPress={() => { void openDetail(current.insight.id, "today"); }}><Text style={screenStyles.textLink}>{t("today.viewHistory")}</Text></Pressable>
          </>}
        {todayStatus === "ready" && seenToday.length > 0 && <View style={screenStyles.gap24}>
          <Text maxFontSizeMultiplier={1.8} accessibilityRole="header" style={screenStyles.sectionTitle}>{t("today.seen")}</Text>
          {seenToday.map((item) => {
            const answer = item.event.response === "yes" ? t("today.reflectedYes") : item.event.response === "not_now" ? t("today.reflectedPaused") : item.event.response === "not_anymore" ? t("today.reflectedArchived") : null;
            return <Pressable key={item.event.id} accessibilityRole="button" accessibilityLabel={`${item.insight.content || t("common.savedPhoto")}. ${answer ?? t("today.notReflectedLabel")}`}
              onPress={() => {
                if (answer) { void openDetail(item.insight.id, "today"); return; }
                setRevisitEventId(item.event.id); setReflectionText(""); setRoute("reflect");
              }} style={screenStyles.libraryRow}>
              <View style={screenStyles.libraryIcon}><Ionicons name={answer ? "checkmark-circle-outline" : "chatbubble-ellipses-outline"} size={19} color={palette.accentDark} /></View>
              <View style={screenStyles.flex}><Text numberOfLines={2} style={screenStyles.libraryText}>{item.insight.content || t("common.savedPhoto")}</Text><Text style={screenStyles.libraryDate}>{answer ?? t("today.notReflected")}</Text></View>
              <Ionicons name="chevron-forward" size={17} color={palette.muted} />
            </Pressable>;
          })}
        </View>}
      </ScrollView>
      <BottomNav active="today" onToday={() => { void goToday(); }} onCapture={() => openCaptureChoice("today")} onLibrary={goLibrary} />
    </Screen>}

    {route === "reflect" && reflectTarget && <Screen>
      <Header title={t("reflect.title")} back={() => { setRevisitEventId(null); setRoute("today"); }} />
      <Eyebrow>{revisitEventId ? t("reflect.eyebrowRevisit") : t("reflect.eyebrow")}</Eyebrow><InsightCard insight={reflectTarget.insight} compact />
      <View style={screenStyles.gap24}><Title>{t("reflect.question")}</Title></View>
      <TextInput multiline textAlignVertical="top" placeholder={t("reflect.notePlaceholder")} placeholderTextColor={palette.muted} value={reflectionText} onChangeText={setReflectionText} style={screenStyles.contextInput} accessibilityLabel={t("reflect.noteLabel")} />
      <View style={screenStyles.gap24}><Action label={t("reflect.yes")} onPress={() => { void finishReflection("yes"); }} /></View>
      <View style={screenStyles.gap12}><Action kind="secondary" label={t("reflect.notNow")} onPress={() => { void finishReflection("not_now"); }} /></View>
      <View style={screenStyles.gap12}><Action kind="ghost" label={t("reflect.notAnymore")} onPress={() => { void finishReflection("not_anymore"); }} /></View>
    </Screen>}

    {route === "library" && <Screen scroll={false}>
      <Header title={t("library.header")} />
      <ScrollView contentContainerStyle={screenStyles.libraryList} keyboardShouldPersistTaps="handled">
      <View><Eyebrow>{t("library.eyebrow")}</Eyebrow><Title>{t("library.title")}</Title><TextInput placeholder={t("library.search")} placeholderTextColor={palette.muted} value={librarySearch} onChangeText={setLibrarySearch} style={screenStyles.search} accessibilityLabel={t("library.searchLabel")} /></View>
      <View style={screenStyles.filters}>{(["active", "paused", "archived"] as InsightStatus[]).map((status) => <Pressable key={status} accessibilityRole="tab" accessibilityState={{ selected: libraryStatus === status }} onPress={() => setLibraryStatus(status)} style={[screenStyles.filter, libraryStatus === status && screenStyles.selectedFilter]}><Text style={[screenStyles.filterText, libraryStatus === status && screenStyles.selectedFilterText]}>{t(`library.status.${status}` as MessageKey)}</Text></Pressable>)}</View>
      <View style={[screenStyles.chipWrap, screenStyles.favoritesRow]}>
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: favoritesOnly }} accessibilityLabel={t("library.favoritesLabel")} onPress={() => setFavoritesOnly((value) => !value)} style={[screenStyles.filter, favoritesOnly && screenStyles.selectedFilter]}>
          <Text style={[screenStyles.filterText, favoritesOnly && screenStyles.selectedFilterText]}>{t("library.favorites")}</Text>
        </Pressable>
      </View>
      {categories.length > 0 && <View style={screenStyles.chipWrap}>
        {[{ id: null, name: t("category.all") }, ...categories].map((category) => {
          const on = libraryCategory === category.id;
          return <Pressable key={category.id ?? "all"} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={category.id ? t("category.show", { name: category.name }) : t("category.showAll")} onPress={() => setLibraryCategory(category.id)} style={[screenStyles.filter, on && screenStyles.selectedFilter]}>
            <Text style={[screenStyles.filterText, on && screenStyles.selectedFilterText]}>{category.name}</Text>
          </Pressable>;
        })}
      </View>}
      <Pressable accessibilityRole="button" onPress={() => setRoute("categories")} style={screenStyles.manageLink}><Text style={screenStyles.textLinkInline}>{t("category.manage")}</Text></Pressable>
      <View style={[screenStyles.chipWrap, screenStyles.favoritesRow]}>{(["newest", "oldest", "resurfaced"] as const).map((sort) => {
        const on = librarySort === sort;
        return <Pressable key={sort} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={t("library.sortLabel", { name: t(`library.sort.${sort}` as MessageKey) })} onPress={() => setLibrarySort(sort)} style={[screenStyles.filter, on && screenStyles.selectedFilter]}>
          <Text style={[screenStyles.filterText, on && screenStyles.selectedFilterText]}>{t(`library.sort.${sort}` as MessageKey)}</Text>
        </Pressable>;
      })}</View>
      {!libraryError && libraryItems.length > 0 && <Text style={screenStyles.resultCount} accessibilityRole="summary">{t("library.resultCount", { count: libraryItems.length })}</Text>}
        {libraryError ? <Surface style={screenStyles.emptyCard}><Ionicons name="cloud-offline-outline" size={36} color={palette.accentDark} /><Text maxFontSizeMultiplier={1.8} style={screenStyles.emptyTitle}>{t("library.errorTitle")}</Text><Body muted>{t("library.errorBody")}</Body><View style={screenStyles.gap24}><Action label={t("common.tryAgain")} icon="refresh" onPress={() => setLibraryAttempt((attempt) => attempt + 1)} /></View></Surface>
          : libraryItems.length === 0 ? <Surface style={screenStyles.emptyCard}><Ionicons name="albums-outline" size={36} color={palette.accentDark} /><Text maxFontSizeMultiplier={1.8} style={screenStyles.emptyTitle}>{librarySearch ? t("library.noMatches") : favoritesOnly ? t("library.emptyFavorites") : libraryCategory ? t(`library.emptyInCategory.${libraryStatus}` as MessageKey) : t(`library.empty.${libraryStatus}` as MessageKey)}</Text><Body muted>{t("library.emptyBody")}</Body></Surface>
          : libraryItems.map((insight) => <Pressable key={insight.id} accessibilityRole="button" onPress={() => { void openDetail(insight.id); }} style={screenStyles.libraryRow}>{insight.imagePath ? <Thumbnail path={insight.imagePath} /> : <View style={screenStyles.libraryIcon}><Ionicons name="bookmark-outline" size={19} color={palette.accentDark} /></View>}<View style={screenStyles.flex}><Text numberOfLines={2} style={screenStyles.libraryText}>{insight.content || t("common.savedPhoto")}</Text><Text style={screenStyles.libraryDate}>{formatDate(insight.createdAt)}{insight.source ? ` · ${insight.source}` : ""}</Text><Text style={screenStyles.libraryDate}>{insight.lastShownAt ? t("library.seenTimes", { count: insight.timesShown, date: formatDate(insight.lastShownAt) }) : t("library.notSeenYet")}</Text></View>{!!insight.favorite && <Ionicons name="star" size={16} color={palette.accentDark} accessibilityLabel={t("library.favoriteMark")} />}<Ionicons name="chevron-forward" size={17} color={palette.muted} /></Pressable>)}
      </ScrollView>
      <BottomNav active="library" onToday={() => { void goToday(); }} onCapture={() => openCaptureChoice("library")} onLibrary={goLibrary} />
    </Screen>}

    {route === "detail" && detail && <Screen>
      <Header title={t("detail.header")} back={() => { if (detailOrigin === "library") goLibrary(); else if (firstSave && !settings.permissionAsked) setRoute("permission"); else void goToday(); }}
        right={<IconButton icon={detail.insight.favorite ? "star" : "star-outline"} label={detail.insight.favorite ? t("detail.unfavorite") : t("detail.favorite")} onPress={() => { void toggleFavorite(); }} />} />
      <Eyebrow>{t("detail.eyebrow", { status: t(`detail.status.${detail.insight.status}` as MessageKey), date: formatDate(detail.insight.createdAt) })}</Eyebrow>
      {editing ? <>
        <Title>{t("detail.editTitle")}</Title>
        <TextInput multiline textAlignVertical="top" value={editContent} onChangeText={setEditContent} placeholder={t("capture.title")} style={screenStyles.captureInput} accessibilityLabel={t("detail.editTextLabel")} />
        <Text style={screenStyles.fieldLabel}>{t("detail.context")}</Text><TextInput multiline textAlignVertical="top" value={editContext} onChangeText={setEditContext} style={screenStyles.contextInput} accessibilityLabel={t("detail.editContextLabel")} />
        <Text style={screenStyles.fieldLabel}>{t("capture.sourceLabel")} <Text style={screenStyles.optional}>{t("common.optional")}</Text></Text>
        <TextInput value={editSource} onChangeText={setEditSource} maxLength={MAX_SOURCE_LENGTH} placeholder={t("capture.sourcePlaceholder")} placeholderTextColor={palette.muted} style={screenStyles.search} accessibilityLabel={t("capture.sourceA11y")} />
        <Text style={screenStyles.fieldLabel}>{t("category.field")} <Text style={screenStyles.optional}>{t("common.optional")}</Text></Text>
        <CategoryChips categories={categories} selected={editCategoryIds} onToggle={(categoryId) => setEditCategoryIds((ids) => toggle(ids, categoryId))} onCreate={(name) => addCategory(name, (categoryId) => setEditCategoryIds((ids) => [...ids, categoryId]))} />
        <View style={screenStyles.gap24}><Action label={t("detail.saveChanges")} disabled={!isValidInsight(editContent, !!detail.insight.imagePath)} onPress={() => { void saveEdit(); }} /></View>
        <View style={screenStyles.gap12}><Action kind="ghost" label={t("common.cancel")} onPress={() => setEditing(false)} /></View>
      </> : <>
        <InsightCard insight={detail.insight} />
        {!!detail.insight.source && <View style={screenStyles.gap12}><Body muted>{t("detail.source", { source: detail.insight.source })}</Body></View>}
        {detail.categories.length > 0 && <View style={[screenStyles.chipWrap, screenStyles.gap12]} accessibilityLabel={t("category.tags", { names: detail.categories.map((category) => category.name).join(", ") })}>
          {detail.categories.map((category) => <View key={category.id} style={[screenStyles.filter, screenStyles.categoryTag]}><Text style={screenStyles.filterText}>{category.name}</Text></View>)}
        </View>}
        <View style={screenStyles.gap24}><Action kind="secondary" label={t("detail.edit")} icon="create-outline" onPress={() => setEditing(true)} /></View>
        {detail.insight.status === "active" && (() => {
          const next = detail.events.find((event) => !event.shownAt && !event.cancelledAt);
          return <>
            {next && <View style={screenStyles.gap24}><Body muted>{t("detail.nextResurface", { date: formatDate(next.scheduledAt) })}</Body></View>}
            <View style={screenStyles.gap12}><Action kind="ghost" label={t("detail.snooze")} icon="time-outline" onPress={snooze} /></View>
          </>;
        })()}
        <View style={screenStyles.gap12}>{detail.insight.status === "active" ? <Action kind="ghost" label={t("detail.pause")} onPress={() => { void updateStatus("paused"); }} /> : <Action kind="secondary" label={detail.insight.status === "paused" ? t("detail.resume") : t("detail.restore")} onPress={() => { void updateStatus("active"); }} />}</View>
        {detail.insight.status !== "archived" && <View style={screenStyles.gap12}><Action kind="ghost" label={t("common.archive")} onPress={() => { Alert.alert(t("reflect.archiveTitle"), t("detail.archiveBody"), [{ text: t("common.cancel"), style: "cancel" }, { text: t("common.archive"), onPress: () => { void updateStatus("archived"); } }]); }} /></View>}
        <View style={screenStyles.gap12}><Action kind="danger" label={t("detail.deletePermanently")} onPress={confirmDelete} /></View>
        <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>{t("detail.history")}</Text>{detail.events.some((event) => !!event.shownAt) && <Body muted>{t("detail.historySummary", { count: detail.events.filter((event) => !!event.shownAt).length })}</Body>}</View>
        {detail.events.filter((event) => !!event.shownAt).length === 0 ? <Body muted>{t("detail.historyEmpty")}</Body> : detail.events.filter((event) => !!event.shownAt).map((event) => <View key={event.id} style={screenStyles.historyRow}><View style={screenStyles.historyDot} /><View style={screenStyles.flex}><Text style={screenStyles.historyDate}>{formatDateTime(event.shownAt!)}</Text><Text style={screenStyles.historyMeta}>{t(`detail.response.${event.response ?? "seen"}` as MessageKey)}</Text>{detail.reflections.filter((reflection) => reflection.eventId === event.id).map((reflection) => <Text key={reflection.id} style={screenStyles.reflectionText}>{reflection.content}</Text>)}</View></View>)}
      </>}
    </Screen>}

    {route === "categories" && <Screen>
      <Header title={t("category.screenTitle")} back={goLibrary} />
      <Eyebrow>{t("category.eyebrow")}</Eyebrow><Title>{t("category.screenTitle")}</Title>
      <Body muted>{t("category.intro")}</Body>
      <View style={screenStyles.gap24}><CategoryChips categories={[]} selected={[]} onToggle={() => undefined} onCreate={(name) => addCategory(name)} /></View>
      <View style={screenStyles.gap24}>
        {categories.length === 0 ? <Body muted>{t("category.none")}</Body> : categories.map((category) => renamingCategory?.id === category.id
          ? <View key={category.id} style={screenStyles.libraryRow}>
              <TextInput autoFocus clearButtonMode="while-editing" value={renamingCategory.name} onChangeText={(name) => setRenamingCategory({ id: category.id, name })} maxLength={MAX_CATEGORY_NAME_LENGTH} style={[screenStyles.search, screenStyles.flex]} accessibilityLabel={t("category.newNameFor", { name: category.name })} />
              <Action kind="secondary" label={t("common.save")} onPress={() => {
                void renameCategory(category.id, renamingCategory.name).then(() => { setRenamingCategory(null); void refreshCategories(); })
                  .catch((error: unknown) => Alert.alert(t("category.notRenamed"), categoryMessage(error)));
              }} />
              <IconButton icon="close" label={t("category.cancelRename")} onPress={() => setRenamingCategory(null)} />
            </View>
          : <View key={category.id} style={screenStyles.libraryRow}>
              <View style={screenStyles.flex}><Text style={screenStyles.libraryText}>{category.name}</Text><Text style={screenStyles.libraryDate}>{t("category.count", { count: category.insights })}</Text></View>
              <IconButton icon="create-outline" label={t("category.renameLabel", { name: category.name })} onPress={() => setRenamingCategory({ id: category.id, name: category.name })} />
              <IconButton icon="trash-outline" label={t("category.deleteLabel", { name: category.name })} onPress={() => {
                Alert.alert(t("category.deleteTitle", { name: category.name }), t("category.deleteBody", { count: category.insights }), [
                  { text: t("common.cancel"), style: "cancel" },
                  { text: t("category.deleteAction"), style: "destructive", onPress: () => { void deleteCategory(category.id).then(refreshCategories).catch(report); } },
                ]);
              }} />
            </View>)}
      </View>
    </Screen>}

    {route === "settings" && <Screen>
      <Header title={t("settings.header")} back={() => { void goToday(); }} />
      <Eyebrow>{t("settings.eyebrow")}</Eyebrow><Title>{t("settings.title")}</Title>
      <Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>{t("settings.frequency")}</Text><Body muted>{t("settings.frequencyBody")}</Body>
      <View style={[screenStyles.frequency, stackChoices && screenStyles.frequencyStacked]}>{([1, 3, 5] as const).map((cap) => <Pressable key={cap} accessibilityRole="radio" accessibilityState={{ checked: settings.dailyCap === cap }} accessibilityLabel={t("settings.capLabel", { name: t(`settings.cap.${cap}` as MessageKey), cap })} onPress={() => { void updateSettings({ dailyCap: cap }); }} style={[screenStyles.frequencyOption, stackChoices && screenStyles.frequencyOptionStacked, settings.dailyCap === cap && screenStyles.frequencySelected]}><Text style={screenStyles.frequencyName}>{t(`settings.cap.${cap}` as MessageKey)}</Text><Text style={screenStyles.frequencyDetail}>{t("settings.capDetail", { cap })}</Text></Pressable>)}</View>
      <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>{t("settings.notifications")}</Text><Body muted>{t("settings.notificationsBody")}</Body></View>
      {notificationGranted === false && <View style={screenStyles.gap12}><Action kind="secondary" label={t("settings.enableNotifications")} onPress={() => { void enableNotifications(); }} /></View>}
      <Text style={screenStyles.fieldLabel}>{t("settings.time")}</Text>
      <TextInput value={settings.notificationTime} onChangeText={(value) => { setSettings({ ...settings, notificationTime: value }); }} onBlur={() => { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.notificationTime)) void updateSettings({ notificationTime: settings.notificationTime }); else { Alert.alert(t("settings.timeInvalidTitle"), t("settings.timeInvalidBody")); void getSettings().then(setSettings); } }} keyboardType="numbers-and-punctuation" maxLength={5} style={screenStyles.search} accessibilityLabel={t("settings.timeLabel")} />
      <Surface style={screenStyles.switchRow}><View style={screenStyles.flex}><Text style={screenStyles.switchTitle}>{t("settings.showText")}</Text><Text style={screenStyles.switchDescription}>{t("settings.showTextBody")}</Text></View><Switch accessibilityLabel={t("settings.showTextLabel")} value={settings.showInsightText} onValueChange={(value) => { void updateSettings({ showInsightText: value }); }} trackColor={{ true: palette.accentDark }} /></Surface>
      <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>{t("settings.language")}</Text><Body muted>{t("settings.languageBody")}</Body></View>
      <View style={[screenStyles.chipWrap, screenStyles.gap12]}>{(["system", "en", "ro"] as const).map((language) => {
        const on = settings.language === language;
        return <Pressable key={language} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => { void updateSettings({ language }); }} style={[screenStyles.filter, on && screenStyles.selectedFilter]}>
          <Text style={[screenStyles.filterText, on && screenStyles.selectedFilterText]}>{t(`settings.language.${language}` as MessageKey)}</Text>
        </Pressable>;
      })}</View>
      <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>{t("settings.privacy")}</Text><Body muted>{t("settings.privacyBody")}</Body></View>
      <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>{t("settings.backup")}</Text><Body muted>{t("settings.backupBody")}</Body></View>
      <View style={screenStyles.gap12}><Action kind="secondary" label={t("settings.createBackup")} icon="lock-closed-outline" onPress={() => openBackupSheet("create")} /></View>
      <View style={screenStyles.gap12}><Action kind="ghost" label={t("settings.restoreBackup")} icon="download-outline" onPress={chooseRestoreFile} /></View>
      <View style={screenStyles.gap12}><Action kind="ghost" label={t("settings.verifyBackup")} icon="shield-checkmark-outline" onPress={() => { void pickBackupFile("verify"); }} /></View>
      <View style={screenStyles.gap12}>
        <Body muted>{backupStatus?.lastCreatedAt ? t(backupStatus.lastCreatedComplete ? "settings.lastCreated" : "settings.lastCreatedIncomplete", { date: formatDateTime(backupStatus.lastCreatedAt) }) : t("settings.noneCreated")}</Body>
        <Body muted>{backupStatus?.lastVerified ? t(backupStatus.lastVerified.omissions ? "settings.lastVerifiedIncomplete" : "settings.lastVerified", { verified: formatDateTime(backupStatus.lastVerified.verifiedAt), made: formatDateTime(backupStatus.lastVerified.exportedAt), count: backupStatus.lastVerified.insights }) : t("settings.noneVerified")}</Body>
      </View>
      <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>{t("settings.signals")}</Text><Body muted>{metrics ? (metrics.firstSaveAt ? t("settings.firstSave", { date: formatDate(metrics.firstSaveAt) }) : t("settings.noFirstSave")) : ""}</Body><Body muted>{metrics?.firstSaveAt ? (metrics.coreLoopAt ? t("settings.coreLoop", { date: formatDate(metrics.coreLoopAt), count: Math.max(0, Math.round((Date.parse(metrics.coreLoopAt) - Date.parse(metrics.firstSaveAt)) / 86_400_000)) }) : t("settings.noCoreLoop")) : ""}</Body><Body muted>{metrics ? t("settings.counts", { saved: metrics.saved, shown: metrics.shown, asked: metrics.asked, answered: metrics.answered, valuable: metrics.valuable }) : t("common.loading")}</Body><Body muted>{metrics?.shown ? t("settings.answerRate", { percent: Math.round((metrics.answered / metrics.shown) * 100) }) : t("settings.answerRateLater")}</Body><Body muted>{metrics?.answered ? t("settings.valueRate", { percent: Math.round((metrics.valuable / metrics.answered) * 100) }) : t("settings.valueRateLater")}</Body></View>
      <View style={screenStyles.gap24}><Body muted>{t("settings.version", { version: "0.1.0" })}</Body></View>
    </Screen>}

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

    <Modal visible={!!feedbackEventId} transparent animationType="fade" onRequestClose={() => { void finishFeedback(); }}>
      <View style={screenStyles.modalBackdrop}><Surface style={screenStyles.feedbackBox}><Eyebrow>{t("feedback.eyebrow")}</Eyebrow><Text maxFontSizeMultiplier={1.8} style={screenStyles.feedbackTitle}>{t("feedback.question")}</Text><Body muted>{t("feedback.body")}</Body><View style={screenStyles.gap24}><Action label={t("feedback.yes")} onPress={() => { void finishFeedback("yes"); }} /></View><View style={screenStyles.gap12}><Action kind="secondary" label={t("feedback.notReally")} onPress={() => { void finishFeedback("not_really"); }} /></View><View style={screenStyles.gap12}><Action kind="ghost" label={t("feedback.skip")} onPress={() => { void finishFeedback(); }} /></View></Surface></View>
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
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  addChip: { backgroundColor: "transparent", borderWidth: 1, borderColor: palette.border, borderStyle: "dashed" },
  categoryTag: { minHeight: 32, paddingVertical: 6 },
  newCategory: { flexDirection: "row", alignItems: "center", gap: 8, width: "100%" },
  favoritesRow: { marginBottom: 8 },
  thumbnail: { width: 40, height: 40, borderRadius: 13, backgroundColor: palette.soft },
  resultCount: { color: palette.muted, fontSize: 13, fontWeight: "700", marginBottom: 10 },
  manageLink: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start", marginBottom: 8 },
  textLinkInline: { color: palette.accentDark, fontWeight: "700" },
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
