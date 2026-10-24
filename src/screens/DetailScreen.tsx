import { Text, TextInput, View } from "react-native";
import { MAX_SOURCE_LENGTH, isValidInsight, type Category, type InsightDetail, type InsightStatus } from "../domain";
import { formatDate, formatDateTime, t, type MessageKey } from "../i18n";
import { palette } from "../theme";
import { Action, Body, Eyebrow, Header, IconButton, Screen, Title } from "../ui";
import { CategoryChips, InsightCard } from "./components";
import { screenStyles } from "./styles";

export type DetailEdit = {
  editing: boolean; setEditing: (value: boolean) => void;
  content: string; setContent: (value: string) => void;
  context: string; setContext: (value: string) => void;
  source: string; setSource: (value: string) => void;
  categoryIds: string[];
};

export function DetailScreen({ detail, edit, categories, onToggleCategory, onCreateCategory, onSaveEdit, onToggleFavorite, onSnooze, onStatus, onArchive, onDelete, onBack }: {
  detail: InsightDetail;
  edit: DetailEdit;
  categories: Category[];
  onToggleCategory: (categoryId: string) => void;
  onCreateCategory: (name: string) => Promise<boolean>;
  onSaveEdit: () => void;
  onToggleFavorite: () => void;
  onSnooze: () => void;
  onStatus: (status: InsightStatus) => void;
  /** Asks for confirmation before archiving. */
  onArchive: () => void;
  onDelete: () => void;
  onBack: () => void;
}) {
  const shown = detail.events.filter((event) => !!event.shownAt);
  return <Screen>
    <Header title={t("detail.header")} back={onBack}
      right={<IconButton icon={detail.insight.favorite ? "star" : "star-outline"} label={detail.insight.favorite ? t("detail.unfavorite") : t("detail.favorite")} onPress={onToggleFavorite} />} />
    <Eyebrow>{t("detail.eyebrow", { status: t(`detail.status.${detail.insight.status}` as MessageKey), date: formatDate(detail.insight.createdAt) })}</Eyebrow>
    {edit.editing ? <>
      <Title>{t("detail.editTitle")}</Title>
      <TextInput multiline textAlignVertical="top" value={edit.content} onChangeText={edit.setContent} placeholder={t("capture.title")} style={screenStyles.captureInput} accessibilityLabel={t("detail.editTextLabel")} />
      <Text style={screenStyles.fieldLabel}>{t("detail.context")}</Text><TextInput multiline textAlignVertical="top" value={edit.context} onChangeText={edit.setContext} style={screenStyles.contextInput} accessibilityLabel={t("detail.editContextLabel")} />
      <Text style={screenStyles.fieldLabel}>{t("capture.sourceLabel")} <Text style={screenStyles.optional}>{t("common.optional")}</Text></Text>
      <TextInput value={edit.source} onChangeText={edit.setSource} maxLength={MAX_SOURCE_LENGTH} placeholder={t("capture.sourcePlaceholder")} placeholderTextColor={palette.muted} style={screenStyles.search} accessibilityLabel={t("capture.sourceA11y")} />
      <Text style={screenStyles.fieldLabel}>{t("category.field")} <Text style={screenStyles.optional}>{t("common.optional")}</Text></Text>
      <CategoryChips categories={categories} selected={edit.categoryIds} onToggle={onToggleCategory} onCreate={onCreateCategory} />
      <View style={screenStyles.gap24}><Action label={t("detail.saveChanges")} disabled={!isValidInsight(edit.content, !!detail.insight.imagePath)} onPress={onSaveEdit} /></View>
      <View style={screenStyles.gap12}><Action kind="ghost" label={t("common.cancel")} onPress={() => edit.setEditing(false)} /></View>
    </> : <>
      <InsightCard insight={detail.insight} />
      {!!detail.insight.source && <View style={screenStyles.gap12}><Body muted>{t("detail.source", { source: detail.insight.source })}</Body></View>}
      {detail.categories.length > 0 && <View style={[screenStyles.chipWrap, screenStyles.gap12]} accessibilityLabel={t("category.tags", { names: detail.categories.map((category) => category.name).join(", ") })}>
        {detail.categories.map((category) => <View key={category.id} style={[screenStyles.filter, screenStyles.categoryTag]}><Text style={screenStyles.filterText}>{category.name}</Text></View>)}
      </View>}
      <View style={screenStyles.gap24}><Action kind="secondary" label={t("detail.edit")} icon="create-outline" onPress={() => edit.setEditing(true)} /></View>
      {detail.insight.status === "active" && (() => {
        const next = detail.events.find((event) => !event.shownAt && !event.cancelledAt);
        return <>
          {next && <View style={screenStyles.gap24}><Body muted>{t("detail.nextResurface", { date: formatDate(next.scheduledAt) })}</Body></View>}
          <View style={screenStyles.gap12}><Action kind="ghost" label={t("detail.snooze")} icon="time-outline" onPress={onSnooze} /></View>
        </>;
      })()}
      <View style={screenStyles.gap12}>{detail.insight.status === "active" ? <Action kind="ghost" label={t("detail.pause")} onPress={() => onStatus("paused")} /> : <Action kind="secondary" label={detail.insight.status === "paused" ? t("detail.resume") : t("detail.restore")} onPress={() => onStatus("active")} />}</View>
      {detail.insight.status !== "archived" && <View style={screenStyles.gap12}><Action kind="ghost" label={t("common.archive")} onPress={onArchive} /></View>}
      <View style={screenStyles.gap12}><Action kind="danger" label={t("detail.deletePermanently")} onPress={onDelete} /></View>
      <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>{t("detail.history")}</Text>{shown.length > 0 && <Body muted>{t("detail.historySummary", { count: shown.length })}</Body>}</View>
      {shown.length === 0 ? <Body muted>{t("detail.historyEmpty")}</Body> : shown.map((event) => <View key={event.id} style={screenStyles.historyRow}><View style={screenStyles.historyDot} /><View style={screenStyles.flex}><Text style={screenStyles.historyDate}>{formatDateTime(event.shownAt!)}</Text><Text style={screenStyles.historyMeta}>{t(`detail.response.${event.response ?? "seen"}` as MessageKey)}</Text>{detail.reflections.filter((reflection) => reflection.eventId === event.id).map((reflection) => <Text key={reflection.id} style={screenStyles.reflectionText}>{reflection.content}</Text>)}</View></View>)}
    </>}
  </Screen>;
}
