import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MAX_CATEGORY_NAME_LENGTH, addCalendarDays, isValidInsight, shouldAskValueFeedback, type CategoryWithCount, type Insight, type InsightDetail, type InsightStatus, type Settings, type TodayItem } from "./src/domain";
import { resolveLanguage, setLanguage, t, type MessageKey } from "./src/i18n";
import { clearTransientCaches, deletePickedImageFromCache, isTextRecognitionSupported, recognizeText, type PhotoSaveStage } from "./src/media";
import { notificationEventId, reconcileNotifications, requestNotificationPermission } from "./src/notifications";
import {
  countInsights, createInsight, deleteInsight, editInsight, getBetaMetrics, getDetail, getEvent, getInsight, getSettings, getShownCount,
  markCompleted, markValueFeedbackAsked, markOpened, markShown, openStorage, respondToEvent, setAsideUnreadableData, snoozeInsight, StorageError,
  CategoryError, createCategory, deleteCategory, listCategories, renameCategory, setFavorite, setInsightCategories,
  type BetaMetrics, type StorageFailure, saveSettings, saveValueFeedback, selectToday, setInsightStatus, track,
} from "./src/storage";
import { Action, Body, Eyebrow, Screen, Title } from "./src/ui";
import { BackupSheet, useBackup } from "./src/screens/backup";
import { CaptureChoiceScreen, CaptureScreen, PermissionScreen, PhotoScreen, SavedScreen } from "./src/screens/CaptureScreens";
import { Loading, PrivacyCover } from "./src/screens/components";
import { DetailScreen } from "./src/screens/DetailScreen";
import { CategoriesScreen, LibraryScreen, useLibrary } from "./src/screens/LibraryScreens";
import { OnboardingScreen } from "./src/screens/OnboardingScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { useSharedContent } from "./src/screens/share";
import { screenStyles } from "./src/screens/styles";
import { FeedbackModal, ReflectScreen, TodayScreen } from "./src/screens/TodayScreens";
import type { CaptureOrigin, Route, TodayStatus } from "./src/screens/types";

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
  const settingsRef = useRef<Settings | null>(null);
  settingsRef.current = settings;
  const [insightCount, setInsightCount] = useState(0);
  const [todayItems, setTodayItems] = useState<TodayItem[]>([]);
  const [todayIndex, setTodayIndex] = useState(0);
  const [categories, setCategories] = useState<CategoryWithCount[]>([]);
  const [captureCategoryIds, setCaptureCategoryIds] = useState<string[]>([]);
  const [captureSource, setCaptureSource] = useState("");
  const [editSource, setEditSource] = useState("");
  const [editCategoryIds, setEditCategoryIds] = useState<string[]>([]);
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
  const ocrAttempt = useRef(0);
  const [saveStage, setSaveStage] = useState<PhotoSaveStage | "saving" | null>(null);
  // Seconds since a photo save or text extraction started, shown once it is noticeably slow.
  const [slowSeconds, setSlowSeconds] = useState(0);
  const slowWork = ocrBusy || saveStage === "preparing" || saveStage === "encrypting";
  useEffect(() => {
    setSlowSeconds(0);
    if (!slowWork) return;
    const started = Date.now();
    const timer = setInterval(() => setSlowSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [slowWork]);
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

  const backup = useBackup({ report, setSettings, goToday });
  const { backupStatus, openBackupSheet, chooseRestoreFile, pickBackupFile, refreshBackupStatus } = backup;

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

  // A share opens a capture draft; refs give the share hook the current route and draft.
  const routeRef = useRef(route);
  routeRef.current = route;
  const draftRef = useRef({ content: "", imageUri: null as string | null });
  draftRef.current = { content: captureContent, imageUri: captureImageUri };
  useSharedContent({
    enabled: ready && !fatalError && !!settings,
    hasUnsavedDraft: () => (routeRef.current === "capture" || routeRef.current === "photo") && (!!draftRef.current.content.trim() || !!draftRef.current.imageUri),
    openDraft: (draft, imageUri) => {
      beginCapture(settingsRef.current?.onboardingComplete ? "today" : "onboarding");
      setCaptureContent(draft.content);
      setCaptureSource(draft.source ?? "");
      setCaptureImageUri(imageUri);
      // A photo on its own goes to the photo step, which offers to read its text.
      if (imageUri && !draft.content) setRoute("photo");
      void track("share_received").catch(() => undefined);
    },
  });

  const retryStart = () => {
    setFatalError(null);
    setFatalReason(null);
    setReady(false);
    setStartAttempt((attempt) => attempt + 1);
  };

  const current = todayItems[todayIndex];
  const reflectTarget = (revisitEventId ? todayItems.find((item) => item.event.id === revisitEventId) : undefined) ?? current;
  useEffect(() => {
    if (route !== "today" || todayStatus !== "ready" || !current || current.event.shownAt) return;
    void markShown(current.event.id).then(async () => {
      setTodayItems((items) => items.map((item) => item.event.id === current.event.id ? { ...item, event: { ...item.event, shownAt: new Date().toISOString() } } : item));
      if (settings) await reconcileNotifications(settings);
    }).catch(report);
  }, [route, todayStatus, current?.event.id, current?.event.shownAt, settings]);

  const library = useLibrary(route === "library");
  const setLibraryCategory = library.setCategoryId;

  const refreshCategories = useCallback(async () => {
    try {
      const next = await listCategories();
      setCategories(next);
      setLibraryCategory((current) => (current && next.some((category) => category.id === current) ? current : null));
    } catch { /* The category list is optional; the screens work without it. */ }
  }, [setLibraryCategory]);

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

  const beginCapture = (origin: CaptureOrigin) => {
    // Through draftRef, so the stable share callback also removes the current photo, not a stale one.
    deletePickedImageFromCache(draftRef.current.imageUri);
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

  const keepPhotoAsImage = () => setRoute("capture");

  // Vision/ML Kit calls can't be cancelled, so Cancel abandons the attempt and its late result.
  // Every outcome leaves the photo and anything already typed in the draft.
  const extractPhotoText = async () => {
    if (!captureImageUri || ocrBusy) return;
    if (!isTextRecognitionSupported) { Alert.alert(t("ocr.unavailableTitle"), t("ocr.unavailableBody")); return; }
    const attempt = ++ocrAttempt.current;
    setOcrBusy(true);
    const retry = { text: t("ocr.retry"), onPress: () => { void extractPhotoText(); } };
    const keep = { text: t("photo.keep"), onPress: keepPhotoAsImage };
    try {
      const text = await recognizeText(captureImageUri);
      if (attempt !== ocrAttempt.current) return;
      if (!text) { Alert.alert(t("ocr.failedTitle"), t("ocr.emptyBody"), [{ text: t("common.cancel"), style: "cancel" }, keep]); return; }
      setCaptureContent((typed) => typed.trim() ? `${typed.trimEnd()}\n\n${text}` : text);
      setRoute("capture");
    } catch {
      if (attempt === ocrAttempt.current) Alert.alert(t("ocr.failedTitle"), t("ocr.errorBody"), [{ text: t("common.cancel"), style: "cancel" }, retry, keep]);
    } finally { if (attempt === ocrAttempt.current) setOcrBusy(false); }
  };

  const cancelPhotoText = () => { ocrAttempt.current += 1; setOcrBusy(false); };

  const saveCapture = async () => {
    if (!isValidInsight(captureContent, !!captureImageUri) || busy) return;
    setBusy(true);
    setSaveStage(captureImageUri ? "preparing" : "saving");
    try {
      const wasFirst = (await countInsights()) === 0;
      let insight: Insight;
      try {
        insight = await createInsight(captureContent, captureContext, captureImageUri, captureCategoryIds, captureSource, setSaveStage);
      } catch {
        // Nothing was stored (a prepared photo is removed), and the draft and original photo stay on screen.
        Alert.alert(t("capture.saveFailedTitle"), t(captureImageUri ? "capture.saveFailedPhoto" : "capture.saveFailedBody"));
        return;
      }
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
    finally { setBusy(false); setSaveStage(null); }
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

  const leaveCapture = () => {
    deletePickedImageFromCache(captureImageUri);
    setCaptureImageUri(null);
    if (captureOrigin === "onboarding") setRoute("onboarding");
    else if (captureOrigin === "library") goLibrary();
    else void goToday();
  };

  const openSettings = () => {
    void getBetaMetrics().then(setMetrics).catch(report);
    refreshBackupStatus();
    void Notifications.getPermissionsAsync().then((permission) => setNotificationGranted(permission.granted)).catch(report);
    setRoute("settings");
  };

  const startReflection = (eventId: string | null) => { setRevisitEventId(eventId); setReflectionText(""); setRoute("reflect"); };

  const leaveDetail = () => {
    if (detailOrigin === "library") goLibrary();
    else if (firstSave && !settings.permissionAsked) setRoute("permission");
    else void goToday();
  };

  const confirmArchive = () => {
    Alert.alert(t("reflect.archiveTitle"), t("detail.archiveBody"), [{ text: t("common.cancel"), style: "cancel" }, { text: t("common.archive"), onPress: () => { void updateStatus("archived"); } }]);
  };

  const renameCategoryFromList = (categoryId: string, name: string) =>
    renameCategory(categoryId, name).then(() => { void refreshCategories(); return true; })
      .catch((error: unknown) => { Alert.alert(t("category.notRenamed"), categoryMessage(error)); return false; });

  const confirmDeleteCategory = (category: CategoryWithCount) => {
    Alert.alert(t("category.deleteTitle", { name: category.name }), t("category.deleteBody", { count: category.insights }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("category.deleteAction"), style: "destructive", onPress: () => { void deleteCategory(category.id).then(refreshCategories).catch(report); } },
    ]);
  };

  return <>
    <StatusBar style="dark" />
    {route === "onboarding" && <OnboardingScreen settings={settings} onRestore={chooseRestoreFile} onNext={() => {
      if (settings.onboardingStep === 2) beginCapture("onboarding");
      else void updateSettings({ onboardingStep: settings.onboardingStep + 1 });
    }} />}

    {route === "capture-choice" && <CaptureChoiceScreen onChoose={chooseCapture} onCancel={cancelCaptureChoice} />}

    {route === "capture" && <CaptureScreen
      draft={{ content: captureContent, setContent: setCaptureContent, context: captureContext, setContext: setCaptureContext, source: captureSource, setSource: setCaptureSource, imageUri: captureImageUri, categoryIds: captureCategoryIds }}
      categories={categories}
      onToggleCategory={(categoryId) => setCaptureCategoryIds((ids) => toggle(ids, categoryId))}
      onCreateCategory={(name) => addCategory(name, (categoryId) => setCaptureCategoryIds((ids) => [...ids, categoryId]))}
      onRemovePhoto={() => { deletePickedImageFromCache(captureImageUri); setCaptureImageUri(null); }}
      onPickImage={(source) => { void pickImage(source); }}
      onSave={() => { void saveCapture(); }}
      onBack={leaveCapture}
      busy={busy} saveStage={saveStage} slowSeconds={slowSeconds} />}

    {route === "photo" && <PhotoScreen imageUri={captureImageUri} ocrBusy={ocrBusy} slowSeconds={slowSeconds}
      onKeep={keepPhotoAsImage} onExtract={() => { void extractPhotoText(); }} onStopExtracting={cancelPhotoText}
      onChooseAnother={() => { void pickImage("library"); }} onBack={() => setRoute("capture")} />}

    {route === "saved" && <SavedScreen firstSave={firstSave} onContinue={() => { void finishSave(); }} onView={() => { if (savedInsightId) void openDetail(savedInsightId, "today"); }} />}

    {route === "permission" && <PermissionScreen onAnswer={(ask) => { void finishPermission(ask); }} />}

    {route === "today" && <TodayScreen status={todayStatus} items={todayItems} index={todayIndex} insightCount={insightCount}
      onSettings={openSettings} onRetry={() => { void goToday(); }} onCapture={() => beginCapture("today")}
      onCaptureChoice={() => openCaptureChoice("today")} onLibrary={goLibrary} onToday={() => { void goToday(); }}
      onReflect={() => startReflection(null)} onRevisit={startReflection} onNext={() => { void advanceToday(); }}
      onOpenDetail={(insightId) => { void openDetail(insightId, "today"); }} />}

    {route === "reflect" && reflectTarget && <ReflectScreen target={reflectTarget} revisit={!!revisitEventId} note={reflectionText} setNote={setReflectionText}
      onAnswer={(response) => { void finishReflection(response); }} onBack={() => { setRevisitEventId(null); setRoute("today"); }} />}

    {route === "library" && <LibraryScreen library={library} categories={categories} onOpenDetail={(insightId) => { void openDetail(insightId); }}
      onManageCategories={() => setRoute("categories")} onToday={() => { void goToday(); }} onCaptureChoice={() => openCaptureChoice("library")} onLibrary={goLibrary} />}

    {route === "detail" && detail && <DetailScreen detail={detail}
      edit={{ editing, setEditing, content: editContent, setContent: setEditContent, context: editContext, setContext: setEditContext, source: editSource, setSource: setEditSource, categoryIds: editCategoryIds }}
      categories={categories}
      onToggleCategory={(categoryId) => setEditCategoryIds((ids) => toggle(ids, categoryId))}
      onCreateCategory={(name) => addCategory(name, (categoryId) => setEditCategoryIds((ids) => [...ids, categoryId]))}
      onSaveEdit={() => { void saveEdit(); }} onToggleFavorite={() => { void toggleFavorite(); }} onSnooze={snooze}
      onStatus={(status) => { void updateStatus(status); }} onArchive={confirmArchive} onDelete={confirmDelete} onBack={leaveDetail} />}

    {route === "categories" && <CategoriesScreen categories={categories} onCreate={(name) => addCategory(name)} onRename={renameCategoryFromList} onDelete={confirmDeleteCategory} onBack={goLibrary} />}

    {route === "settings" && <SettingsScreen settings={settings} setSettings={setSettings} reloadSettings={() => { void getSettings().then(setSettings); }}
      updateSettings={(patch) => { void updateSettings(patch); }} notificationGranted={notificationGranted} onEnableNotifications={() => { void enableNotifications(); }}
      metrics={metrics} backupStatus={backupStatus} onCreateBackup={() => openBackupSheet("create")} onRestoreBackup={chooseRestoreFile}
      onVerifyBackup={() => { void pickBackupFile("verify"); }} onBack={() => { void goToday(); }} />}

    <BackupSheet backup={backup} />
    <FeedbackModal visible={!!feedbackEventId} onAnswer={(value) => { void finishFeedback(value); }} />
  </>;
}


export default function App() {
  return <SafeAreaProvider><ResurfaceApp /><PrivacyCover /></SafeAreaProvider>;
}

