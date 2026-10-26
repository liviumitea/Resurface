import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { MAX_SOURCE_LENGTH, isValidInsight, localDay, type Category, type InsightDetail, type InsightStatus, type Reflection, type ResurfaceEvent } from "../domain";
import { formatDate, formatDateTime, t, type MessageKey } from "../i18n";
import type { PhotoSaveStage } from "../media";
import { palette } from "../theme";
import { Action, Body, Eyebrow, Header, IconButton, Screen, Title } from "../ui";
import { CategoryChips, InsightCard, PhotoViewer } from "./components";
import { screenStyles } from "./styles";

export type DetailEdit = {
  editing: boolean; setEditing: (value: boolean) => void;
  content: string; setContent: (value: string) => void;
  context: string; setContext: (value: string) => void;
  source: string; setSource: (value: string) => void;
  categoryIds: string[];
  /** Text read from the photo was just appended to `content`, unsaved. */
  photoTextAdded: boolean;
};

/** Work on the saved photo: an add or replacement being saved, or text being read from it. */
export type DetailPhoto = {
  /** "saving": a removal is being saved. */
  stage: PhotoSaveStage | "saving" | null;
  reading: boolean;
  slowSeconds: number;
  /** Asks camera or library, then saves the photo in place of any current one. */
  onChange: () => void;
  /** Asks for confirmation first. */
  onRemove: () => void;
  /** Reads text from the saved photo into the edit form; nothing is saved until Save changes. */
  onReadText: () => void;
  onStopReading: () => void;
};

export function DetailScreen({ detail, edit, photo, categories, onToggleCategory, onCreateCategory, onSaveEdit, onToggleFavorite, onSnooze, onStatus, onArchive, onDelete, onSaveNote, onRemoveNote, onBack }: {
  detail: InsightDetail;
  edit: DetailEdit;
  photo: DetailPhoto;
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
  /** Resolves true once saved, so the editor can close. */
  onSaveNote: (eventId: string, text: string) => Promise<boolean>;
  /** Asks for confirmation; resolves true once removed. */
  onRemoveNote: (eventId: string) => Promise<boolean>;
  onBack: () => void;
}) {
  const shown = detail.events.filter((event) => !!event.shownAt);
  // The exposure whose note is open for editing, if any.
  const [noteEventId, setNoteEventId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [viewingPhoto, setViewingPhoto] = useState(false);
  const imagePath = detail.insight.imagePath;
  const photoBusy = !!photo.stage || photo.reading;
  const photoStageLabel = photo.stage === "preparing" ? t("capture.preparingPhoto") : photo.stage === "encrypting" ? t("capture.encryptingPhoto") : null;
  return <Screen>
    <PhotoViewer path={viewingPhoto ? imagePath : null} onClose={() => setViewingPhoto(false)} />
    <Header title={t("detail.header")} back={onBack}
      right={<IconButton icon={detail.insight.favorite ? "star" : "star-outline"} label={detail.insight.favorite ? t("detail.unfavorite") : t("detail.favorite")} onPress={onToggleFavorite} />} />
    <Eyebrow>{t("detail.eyebrow", { status: t(`detail.status.${detail.insight.status}` as MessageKey), date: formatDate(detail.insight.createdAt) })}</Eyebrow>
    {edit.editing ? <>
      <Title>{t("detail.editTitle")}</Title>
      {edit.photoTextAdded && <Text accessibilityLiveRegion="polite" style={[screenStyles.photoNote, screenStyles.gapBottom12]}>{t("detailPhoto.textAdded")}</Text>}
      <TextInput multiline textAlignVertical="top" value={edit.content} onChangeText={edit.setContent} placeholder={t("capture.title")} style={screenStyles.captureInput} accessibilityLabel={t("detail.editTextLabel")} />
      <Text style={screenStyles.fieldLabel}>{t("detail.context")}</Text><TextInput multiline textAlignVertical="top" value={edit.context} onChangeText={edit.setContext} style={screenStyles.contextInput} accessibilityLabel={t("detail.editContextLabel")} />
      <Text style={screenStyles.fieldLabel}>{t("capture.sourceLabel")} <Text style={screenStyles.optional}>{t("common.optional")}</Text></Text>
      <TextInput value={edit.source} onChangeText={edit.setSource} maxLength={MAX_SOURCE_LENGTH} placeholder={t("capture.sourcePlaceholder")} placeholderTextColor={palette.muted} style={screenStyles.search} accessibilityLabel={t("capture.sourceA11y")} />
      <Text style={screenStyles.fieldLabel}>{t("category.field")} <Text style={screenStyles.optional}>{t("common.optional")}</Text></Text>
      <CategoryChips categories={categories} selected={edit.categoryIds} onToggle={onToggleCategory} onCreate={onCreateCategory} />
      <View style={screenStyles.gap24}><Action label={t("detail.saveChanges")} disabled={!isValidInsight(edit.content, !!detail.insight.imagePath)} onPress={onSaveEdit} /></View>
      <View style={screenStyles.gap12}><Action kind="ghost" label={t("common.cancel")} onPress={() => edit.setEditing(false)} /></View>
    </> : <>
      <InsightCard insight={detail.insight} onOpenImage={() => setViewingPhoto(true)} />
      {!!detail.insight.source && <View style={screenStyles.gap12}><Body muted>{t("detail.source", { source: detail.insight.source })}</Body></View>}
      {detail.categories.length > 0 && <View style={[screenStyles.chipWrap, screenStyles.gap12]} accessibilityLabel={t("category.tags", { names: detail.categories.map((category) => category.name).join(", ") })}>
        {detail.categories.map((category) => <View key={category.id} style={[screenStyles.filter, screenStyles.categoryTag]}><Text style={screenStyles.filterText}>{category.name}</Text></View>)}
      </View>}
      <View style={screenStyles.gap24}><Action kind="secondary" label={t("detail.edit")} icon="create-outline" disabled={photoBusy} onPress={() => edit.setEditing(true)} /></View>
      <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>{t("detailPhoto.section")}</Text></View>
      {imagePath ? <>
        <Action kind="ghost" label={t("detailPhoto.view")} icon="expand-outline" onPress={() => setViewingPhoto(true)} />
        <View style={screenStyles.gap12}><Action kind="ghost" label={photoStageLabel ?? t("detailPhoto.replace")} icon="images-outline" disabled={photoBusy} onPress={photo.onChange} /></View>
        <View style={screenStyles.gap12}>{photo.reading
          ? <Action kind="ghost" label={t("photo.stopExtracting")} onPress={photo.onStopReading} />
          : <Action kind="ghost" label={t("detailPhoto.readText")} icon="text-outline" disabled={photoBusy} onPress={photo.onReadText} />}</View>
        {photo.reading && photo.slowSeconds >= 3 && <Text accessibilityLiveRegion="polite" style={screenStyles.slowNote}>{t("detailPhoto.readSlow", { seconds: photo.slowSeconds })}</Text>}
        <View style={screenStyles.gap12}><Action kind="danger" label={t("detailPhoto.remove")} disabled={photoBusy || !detail.insight.content?.trim()} onPress={photo.onRemove} /></View>
        {!detail.insight.content?.trim() && <Text style={screenStyles.photoNote}>{t("detailPhoto.removeNeedsText")}</Text>}
      </> : <Action kind="ghost" label={photoStageLabel ?? t("detailPhoto.add")} icon="image-outline" disabled={photoBusy} onPress={photo.onChange} />}
      {!!photo.stage && photo.slowSeconds >= 3 && <Text accessibilityLiveRegion="polite" style={screenStyles.slowNote}>{t("capture.photoSlow", { seconds: photo.slowSeconds })}</Text>}
      {detail.insight.status === "active" && (() => {
        const next = detail.events.find((event) => !event.shownAt && !event.cancelledAt);
        return <>
          {next && <View style={screenStyles.gap24}><Body muted>{t("detail.nextResurface", { date: formatDate(next.scheduledAt) })}</Body></View>}
          <View style={screenStyles.gap12}><Action kind="ghost" label={t("detail.snooze")} icon="time-outline" onPress={onSnooze} /></View>
        </>;
      })()}
      {detail.insight.status === "paused" && <View style={screenStyles.gap24}><Body muted>{t("detail.resurfacingOffBody")}</Body></View>}
      <View style={screenStyles.gap12}>{detail.insight.status === "active" ? <Action kind="ghost" label={t("detail.pause")} onPress={() => onStatus("paused")} /> : <Action kind="secondary" label={detail.insight.status === "paused" ? t("detail.resume") : t("detail.restore")} onPress={() => onStatus("active")} />}</View>
      {detail.insight.status !== "archived" && <View style={screenStyles.gap12}><Action kind="ghost" label={t("common.archive")} onPress={onArchive} /></View>}
      <View style={screenStyles.gap12}><Action kind="danger" label={t("detail.deletePermanently")} onPress={onDelete} /></View>
      <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>{t("detail.history")}</Text>{shown.length > 0 && <Body muted>{t("detail.historySummary", { count: shown.length })}</Body>}</View>
      {shown.length === 0 ? <Body muted>{t("detail.historyEmpty")}</Body> : shown.map((event) => {
        const notes = detail.reflections.filter((reflection) => reflection.eventId === event.id);
        const when = formatDateTime(event.shownAt!);
        return <View key={event.id} style={screenStyles.historyRow}><View style={screenStyles.historyDot} /><View style={screenStyles.flex}>
          <Text style={screenStyles.historyDate}>{when}</Text>
          <Text style={screenStyles.historyMeta}>{t(`detail.response.${event.response ?? "seen"}` as MessageKey)}</Text>
          {noteEventId === event.id ? <>
            <TextInput autoFocus multiline textAlignVertical="top" value={noteText} onChangeText={setNoteText} placeholder={t("reflect.notePlaceholder")} placeholderTextColor={palette.muted}
              style={[screenStyles.contextInput, screenStyles.gap12]} accessibilityLabel={t("detail.noteInputLabel", { date: when })} />
            <View style={screenStyles.gap12}><Action label={t("detail.saveNote")} disabled={!noteText.trim() || noteText.trim() === notes[0]?.content}
              onPress={() => { void onSaveNote(event.id, noteText).then((saved) => { if (saved) setNoteEventId(null); }); }} /></View>
            {notes.length > 0 && <View style={screenStyles.gap12}><Action kind="danger" label={t("detail.removeNote")}
              onPress={() => { void onRemoveNote(event.id).then((removed) => { if (removed) setNoteEventId(null); }); }} /></View>}
            <View style={screenStyles.gap12}><Action kind="ghost" label={t("common.cancel")} onPress={() => setNoteEventId(null)} /></View>
          </> : <>
            {notes.map((reflection) => <View key={reflection.id}><Text style={screenStyles.reflectionText}>{reflection.content}</Text>{noteMeta(reflection, event) && <Text style={screenStyles.historyMeta}>{noteMeta(reflection, event)}</Text>}</View>)}
            <Pressable accessibilityRole="button" accessibilityLabel={t(notes.length ? "detail.editNoteLabel" : "detail.addNoteLabel", { date: when })}
              onPress={() => { setNoteText(notes[0]?.content ?? ""); setNoteEventId(event.id); }} style={screenStyles.manageLink}>
              <Text style={screenStyles.textLinkInline}>{notes.length ? t("detail.editNote") : t("detail.addNote")}</Text>
            </Pressable>
          </>}
        </View></View>;
      })}
    </>}
  </Screen>;
}

/** When a note was edited, or added on a later day than the exposure; nothing for a note written at the time. */
function noteMeta(reflection: Reflection, event: ResurfaceEvent): string | null {
  if (reflection.updatedAt) return t("detail.noteEdited", { date: formatDate(reflection.updatedAt) });
  if (event.shownAt && localDay(new Date(reflection.createdAt)) !== localDay(new Date(event.shownAt))) return t("detail.noteAdded", { date: formatDate(reflection.createdAt) });
  return null;
}
