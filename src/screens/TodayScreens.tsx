import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { upcomingTiming, type Settings, type TodayItem } from "../domain";
import { formatDate, formatLongDay, t, weekdayName } from "../i18n";
import type { UpcomingList } from "../store";
import { palette } from "../theme";
import { Action, Body, BottomNav, Eyebrow, Header, IconButton, Screen, Surface, Title } from "../ui";
import { DraftNotice, InsightCard, Thumbnail, TodaySkeleton } from "./components";
import { screenStyles } from "./styles";
import type { TodayStatus } from "./types";

export function TodayScreen({ status, items, index, insightCount, draft, draftNotKept, onResumeDraft, onDiscardDraft, onSettings, onRetry, onCapture, onCaptureChoice, onLibrary, onToday, onReflect, onRevisit, onNext, onOpenDetail, onUpcoming }: {
  status: TodayStatus;
  /** A kept capture draft, shown above the cards so it isn't forgotten after a restart. */
  draft: { savedAt: string } | "unreadable" | null;
  /** The last write of that draft failed, so it exists only in memory. */
  draftNotKept: boolean;
  onResumeDraft: () => void;
  /** Asks for confirmation first. */
  onDiscardDraft: () => void;
  items: TodayItem[];
  index: number;
  insightCount: number;
  onSettings: () => void;
  onRetry: () => void;
  /** Opens a new text capture from an empty or finished Today. */
  onCapture: () => void;
  onCaptureChoice: () => void;
  onLibrary: () => void;
  onToday: () => void;
  onReflect: () => void;
  /** Goes back to a card seen earlier today that has no reflection yet. */
  onRevisit: (eventId: string) => void;
  onNext: () => void;
  onOpenDetail: (insightId: string) => void;
  onUpcoming: () => void;
}) {
  const current = items[index];
  // Cards already shown today (except the one on screen), so the user can go back and reflect.
  const seenToday = items.filter((item) => !!item.event.shownAt && item.event.id !== current?.event.id);
  return <Screen scroll={false}>
    <Header title="resurface." right={<IconButton icon="settings-outline" label={t("today.settings")} onPress={onSettings} />} />
    <ScrollView contentContainerStyle={screenStyles.todayContent}>
      <Eyebrow>{formatLongDay(new Date())}</Eyebrow>
      <Title>{t("today.title")}</Title>
      {draft && <DraftNotice draft={draft} notKept={draftNotKept} onResume={onResumeDraft} onDiscard={onDiscardDraft} />}
      {status === "loading" ? <TodaySkeleton />
        : status === "error" ? <Surface style={screenStyles.emptyCard}><Ionicons name="cloud-offline-outline" size={36} color={palette.accentDark} /><Text maxFontSizeMultiplier={1.8} style={screenStyles.emptyTitle}>{t("today.errorTitle")}</Text><Body muted>{t("today.errorBody")}</Body><View style={screenStyles.gap24}><Action label={t("common.tryAgain")} icon="refresh" onPress={onRetry} /></View><View style={screenStyles.gap12}><Action kind="ghost" label={t("today.openLibrary")} onPress={onLibrary} /></View></Surface>
        : items.length === 0 ? <Surface style={screenStyles.emptyCard}><Ionicons name={insightCount === 0 ? "bookmark-outline" : "sunny-outline"} size={36} color={palette.accentDark} /><Text maxFontSizeMultiplier={1.8} style={screenStyles.emptyTitle}>{insightCount === 0 ? t("today.emptyNewTitle") : t("today.emptyTitle")}</Text><Body muted>{insightCount === 0 ? t("today.emptyNewBody") : t("today.emptyBody")}</Body><View style={screenStyles.gap24}><Action label={insightCount === 0 ? t("today.saveFirst") : t("today.saveSomething")} onPress={onCapture} /></View></Surface>
        : index >= items.length ? <Surface style={screenStyles.emptyCard}><Ionicons name="checkmark-circle-outline" size={38} color={palette.accentDark} /><Text maxFontSizeMultiplier={1.8} style={screenStyles.emptyTitle}>{t("today.doneTitle")}</Text><Body muted>{t("today.doneBody")}</Body><View style={screenStyles.gap24}><Action kind="secondary" label={t("today.saveSomething")} onPress={onCapture} /></View></Surface>
        : current && <>
          <Text style={screenStyles.subtitle}>{t("today.count", { count: items.length })}</Text>
          <Text style={screenStyles.counter}>{t("today.position", { index: index + 1, total: items.length })}</Text>
          <InsightCard insight={current.insight} />
          <View style={screenStyles.gap24}><Action label={t("today.reflect")} icon="chatbubble-ellipses-outline" onPress={onReflect} /></View>
          <View style={screenStyles.gap12}><Action kind="secondary" label={t("today.next")} icon="arrow-forward" onPress={onNext} /></View>
          <Pressable accessibilityRole="button" onPress={() => onOpenDetail(current.insight.id)}><Text style={screenStyles.textLink}>{t("today.viewHistory")}</Text></Pressable>
        </>}
      {status === "ready" && seenToday.length > 0 && <View style={screenStyles.gap24}>
        <Text maxFontSizeMultiplier={1.8} accessibilityRole="header" style={screenStyles.sectionTitle}>{t("today.seen")}</Text>
        {seenToday.map((item) => {
          const answer = item.event.response === "yes" ? t("today.reflectedYes") : item.event.response === "not_now" ? t("today.reflectedPaused") : item.event.response === "not_anymore" ? t("today.reflectedArchived") : null;
          return <Pressable key={item.event.id} accessibilityRole="button" accessibilityLabel={`${item.insight.content || t("common.savedPhoto")}. ${answer ?? t("today.notReflectedLabel")}`}
            onPress={() => {
              if (answer) { onOpenDetail(item.insight.id); return; }
              onRevisit(item.event.id);
            }} style={screenStyles.libraryRow}>
            <View style={screenStyles.libraryIcon}><Ionicons name={answer ? "checkmark-circle-outline" : "chatbubble-ellipses-outline"} size={19} color={palette.accentDark} /></View>
            <View style={screenStyles.flex}><Text numberOfLines={2} style={screenStyles.libraryText}>{item.insight.content || t("common.savedPhoto")}</Text><Text style={screenStyles.libraryDate}>{answer ?? t("today.notReflected")}</Text></View>
            <Ionicons name="chevron-forward" size={17} color={palette.muted} />
          </Pressable>;
        })}
      </View>}
      {status === "ready" && insightCount > 0 && <Pressable accessibilityRole="button" onPress={onUpcoming}><Text style={screenStyles.textLink}>{t("today.upcoming")}</Text></Pressable>}
    </ScrollView>
    <BottomNav active="today" onToday={onToday} onCapture={onCaptureChoice} onLibrary={onLibrary} />
  </Screen>;
}

export function ReflectScreen({ target, revisit, note, setNote, onAnswer, onBack }: {
  target: TodayItem;
  revisit: boolean;
  note: string;
  setNote: (value: string) => void;
  onAnswer: (response: "yes" | "not_now" | "not_anymore") => void;
  onBack: () => void;
}) {
  return <Screen>
    <Header title={t("reflect.title")} back={onBack} />
    <Eyebrow>{revisit ? t("reflect.eyebrowRevisit") : t("reflect.eyebrow")}</Eyebrow><InsightCard insight={target.insight} compact />
    <View style={screenStyles.gap24}><Title>{t("reflect.question")}</Title></View>
    <TextInput multiline textAlignVertical="top" placeholder={t("reflect.notePlaceholder")} placeholderTextColor={palette.muted} value={note} onChangeText={setNote} style={screenStyles.contextInput} accessibilityLabel={t("reflect.noteLabel")} />
    <View style={screenStyles.gap24}><Action label={t("reflect.yes")} onPress={() => onAnswer("yes")} /></View>
    <View style={screenStyles.gap12}><Action kind="secondary" label={t("reflect.notNow")} onPress={() => onAnswer("not_now")} /></View>
    <View style={screenStyles.gap12}><Action kind="ghost" label={t("reflect.notAnymore")} onPress={() => onAnswer("not_anymore")} /></View>
  </Screen>;
}

export function FeedbackModal({ visible, onAnswer }: { visible: boolean; onAnswer: (value?: "yes" | "not_really") => void }) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onAnswer()}>
    <View style={screenStyles.modalBackdrop}><Surface style={screenStyles.feedbackBox}><Eyebrow>{t("feedback.eyebrow")}</Eyebrow><Text maxFontSizeMultiplier={1.8} style={screenStyles.feedbackTitle}>{t("feedback.question")}</Text><Body muted>{t("feedback.body")}</Body><View style={screenStyles.gap24}><Action label={t("feedback.yes")} onPress={() => onAnswer("yes")} /></View><View style={screenStyles.gap12}><Action kind="secondary" label={t("feedback.notReally")} onPress={() => onAnswer("not_really")} /></View><View style={screenStyles.gap12}><Action kind="ghost" label={t("feedback.skip")} onPress={() => onAnswer()} /></View></Surface></View>
  </Modal>;
}

/**
 * The next insights to come back and the day each becomes due in Today. It is read-only: opening
 * it never counts as a resurfacing. Reminder delivery is described separately because it is
 * approximate, capped at one a day and skips quiet days.
 */
export function UpcomingScreen({ status, list, settings, remindersOn, onOpenDetail, onRetry, onBack }: {
  status: TodayStatus;
  list: UpcomingList | null;
  settings: Pick<Settings, "dailyCap" | "notificationTime" | "quietDays">;
  /** null while the permission is unknown; nothing is said about reminders then. */
  remindersOn: boolean | null;
  onOpenDetail: (insightId: string) => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const clock = new Date();
  const when = (scheduledAt: string) => {
    const timing = upcomingTiming(scheduledAt, clock);
    return timing.kind === "due" ? t("upcoming.due") : timing.kind === "later_today" ? t("upcoming.laterToday")
      : timing.kind === "tomorrow" ? t("upcoming.tomorrow") : t("upcoming.from", { date: formatDate(timing.at) });
  };
  const quiet = settings.quietDays.map((day) => weekdayName(day, "long")).join(", ");
  const items = list?.items ?? [];
  return <Screen>
    <Header title={t("upcoming.header")} back={onBack} />
    <Eyebrow>{t("upcoming.eyebrow")}</Eyebrow><Title>{t("upcoming.title")}</Title>
    <Body muted>{t("upcoming.intro")}</Body>
    <View style={screenStyles.gap24}>
      {status === "loading" ? <TodaySkeleton />
        : status === "error" ? <Surface style={screenStyles.emptyCard}><Ionicons name="cloud-offline-outline" size={36} color={palette.accentDark} /><Text maxFontSizeMultiplier={1.8} style={screenStyles.emptyTitle}>{t("upcoming.errorTitle")}</Text><Body muted>{t("today.errorBody")}</Body><View style={screenStyles.gap24}><Action label={t("common.tryAgain")} icon="refresh" onPress={onRetry} /></View></Surface>
        : items.length === 0 ? <Surface style={screenStyles.emptyCard}><Ionicons name="calendar-outline" size={36} color={palette.accentDark} /><Text maxFontSizeMultiplier={1.8} style={screenStyles.emptyTitle}>{t("upcoming.emptyTitle")}</Text><Body muted>{t("upcoming.emptyBody")}</Body></Surface>
        : items.map(({ insight, event }) => {
          const text = insight.content || t("common.savedPhoto");
          const label = when(event.scheduledAt);
          return <Pressable key={event.id} accessibilityRole="button" accessibilityLabel={`${text}. ${label}`} onPress={() => onOpenDetail(insight.id)} style={screenStyles.libraryRow}>
            {insight.imagePath ? <Thumbnail path={insight.imagePath} /> : <View style={screenStyles.libraryIcon}><Ionicons name="calendar-outline" size={19} color={palette.accentDark} /></View>}
            <View style={screenStyles.flex}><Text numberOfLines={2} style={screenStyles.libraryText}>{text}</Text><Text style={screenStyles.libraryDate}>{label}</Text></View>
            <Ionicons name="chevron-forward" size={17} color={palette.muted} />
          </Pressable>;
        })}
      {status === "ready" && !!list && list.total > items.length && <Body muted>{t("upcoming.more", { count: list.total - items.length })}</Body>}
    </View>
    {status === "ready" && items.length > 0 && <View style={screenStyles.gap24}>
      <Body muted>{t("upcoming.cap", { count: settings.dailyCap })}</Body>
      {remindersOn !== null && <View style={screenStyles.gap12}><Body muted>{!remindersOn ? t("upcoming.remindersOff")
        : `${t("upcoming.remindersOn", { time: settings.notificationTime })}${quiet ? ` ${t("upcoming.quietDays", { days: quiet })}` : ""}`}</Body></View>}
    </View>}
  </Screen>;
}
