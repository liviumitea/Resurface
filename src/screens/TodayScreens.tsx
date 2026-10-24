import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { TodayItem } from "../domain";
import { formatLongDay, t } from "../i18n";
import { palette } from "../theme";
import { Action, Body, BottomNav, Eyebrow, Header, IconButton, Screen, Surface, Title } from "../ui";
import { InsightCard, TodaySkeleton } from "./components";
import { screenStyles } from "./styles";
import type { TodayStatus } from "./types";

export function TodayScreen({ status, items, index, insightCount, onSettings, onRetry, onCapture, onCaptureChoice, onLibrary, onToday, onReflect, onRevisit, onNext, onOpenDetail }: {
  status: TodayStatus;
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
}) {
  const current = items[index];
  // Cards already shown today (except the one on screen), so the user can go back and reflect.
  const seenToday = items.filter((item) => !!item.event.shownAt && item.event.id !== current?.event.id);
  return <Screen scroll={false}>
    <Header title="resurface." right={<IconButton icon="settings-outline" label={t("today.settings")} onPress={onSettings} />} />
    <ScrollView contentContainerStyle={screenStyles.todayContent}>
      <Eyebrow>{formatLongDay(new Date())}</Eyebrow>
      <Title>{t("today.title")}</Title>
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
