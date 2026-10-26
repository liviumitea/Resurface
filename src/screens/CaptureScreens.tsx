import { Ionicons } from "@expo/vector-icons";
import { Image, Switch, Text, TextInput, View } from "react-native";
import { MAX_SOURCE_LENGTH, isValidInsight, type Category } from "../domain";
import { t } from "../i18n";
import type { PhotoSaveStage } from "../media";
import { palette } from "../theme";
import { Action, Body, Eyebrow, Header, IconButton, Screen, Title } from "../ui";
import { CategoryChips } from "./components";
import { screenStyles } from "./styles";

type PhotoSource = "camera" | "library";

export function CaptureChoiceScreen({ onChoose, onCancel }: {
  onChoose: (source: "write" | PhotoSource) => void;
  onCancel: () => void;
}) {
  return <Screen>
    <Header title={t("choice.header")} back={onCancel} />
    <Eyebrow>{t("choice.eyebrow")}</Eyebrow><Title>{t("choice.title")}</Title>
    <Body muted>{t("choice.body")}</Body>
    <View style={screenStyles.gap24}><Action label={t("choice.write")} icon="create-outline" onPress={() => onChoose("write")} /></View>
    <View style={screenStyles.gap12}><Action kind="secondary" label={t("choice.takePhoto")} icon="camera-outline" onPress={() => onChoose("camera")} /></View>
    <View style={screenStyles.gap12}><Action kind="secondary" label={t("choice.choosePhoto")} icon="images-outline" onPress={() => onChoose("library")} /></View>
    <View style={screenStyles.gap12}><Action kind="ghost" label={t("common.cancel")} onPress={onCancel} /></View>
  </Screen>;
}

export type CaptureDraft = {
  content: string; setContent: (value: string) => void;
  context: string; setContext: (value: string) => void;
  source: string; setSource: (value: string) => void;
  imageUri: string | null;
  categoryIds: string[];
  /** Off saves to Library only, without Today appearances or reminders. */
  resurface: boolean; setResurface: (value: boolean) => void;
};

export function CaptureScreen({ draft, categories, onToggleCategory, onCreateCategory, onRemovePhoto, onPickImage, onSave, onBack, busy, saveStage, slowSeconds }: {
  draft: CaptureDraft;
  categories: Category[];
  onToggleCategory: (categoryId: string) => void;
  onCreateCategory: (name: string) => Promise<boolean>;
  onRemovePhoto: () => void;
  onPickImage: (source: PhotoSource) => void;
  onSave: () => void;
  onBack: () => void;
  busy: boolean;
  saveStage: PhotoSaveStage | "saving" | null;
  slowSeconds: number;
}) {
  return <Screen>
    <Header title={t("capture.header")} back={onBack} />
    <Eyebrow>{t("capture.eyebrow")}</Eyebrow><Title>{t("capture.title")}</Title>
    <TextInput autoFocus multiline textAlignVertical="top" placeholder={t("capture.placeholder")} placeholderTextColor={palette.muted} value={draft.content} onChangeText={draft.setContent} style={screenStyles.captureInput} accessibilityLabel={t("capture.textLabel")} />
    {draft.imageUri && <View style={screenStyles.attached}><Ionicons name="image-outline" size={18} color={palette.accentDark} /><Text style={screenStyles.attachedText}>{t("capture.photoAttached")}</Text><IconButton icon="close" label={t("capture.removePhoto")} onPress={onRemovePhoto} /></View>}
    <Text style={screenStyles.fieldLabel}>{t("capture.contextLabel")} <Text style={screenStyles.optional}>{t("common.optional")}</Text></Text>
    <TextInput multiline textAlignVertical="top" placeholder={t("capture.contextPlaceholder")} placeholderTextColor={palette.muted} value={draft.context} onChangeText={draft.setContext} style={screenStyles.contextInput} accessibilityLabel={t("capture.contextA11y")} />
    <Text style={screenStyles.fieldLabel}>{t("capture.sourceLabel")} <Text style={screenStyles.optional}>{t("common.optional")}</Text></Text>
    <TextInput value={draft.source} onChangeText={draft.setSource} maxLength={MAX_SOURCE_LENGTH} placeholder={t("capture.sourcePlaceholder")} placeholderTextColor={palette.muted} style={screenStyles.search} accessibilityLabel={t("capture.sourceA11y")} />
    <Text style={screenStyles.fieldLabel}>{t("category.field")} <Text style={screenStyles.optional}>{t("common.optional")}</Text></Text>
    <CategoryChips categories={categories} selected={draft.categoryIds} onToggle={onToggleCategory} onCreate={onCreateCategory} />
    <View style={screenStyles.switchRow}>
      <View style={screenStyles.flex}><Text style={screenStyles.switchTitle}>{t("capture.resurface")}</Text><Text style={screenStyles.switchDescription}>{t(draft.resurface ? "capture.resurfaceOn" : "capture.resurfaceOff")}</Text></View>
      <Switch accessibilityLabel={t("capture.resurfaceLabel")} value={draft.resurface} onValueChange={draft.setResurface} trackColor={{ true: palette.accentDark }} />
    </View>
    <View style={[screenStyles.row, screenStyles.gap24]}><View style={screenStyles.flex}><Action kind="secondary" icon="camera-outline" label={t("choice.takePhoto")} onPress={() => onPickImage("camera")} /></View><View style={screenStyles.flex}><Action kind="secondary" icon="images-outline" label={t("choice.choosePhoto")} onPress={() => onPickImage("library")} /></View></View>
    <View style={screenStyles.gap24}><Action label={saveStage === "preparing" ? t("capture.preparingPhoto") : saveStage === "encrypting" ? t("capture.encryptingPhoto") : busy ? t("capture.saving") : t("capture.save")} icon="bookmark-outline" disabled={busy || !isValidInsight(draft.content, !!draft.imageUri)} onPress={onSave} /></View>
    {saveStage && saveStage !== "saving" && slowSeconds >= 3 && <Text accessibilityLiveRegion="polite" style={screenStyles.slowNote}>{t("capture.photoSlow", { seconds: slowSeconds })}</Text>}
    <Text style={screenStyles.privacyNote}>{t("capture.privacy")}</Text>
  </Screen>;
}

export function PhotoScreen({ imageUri, ocrBusy, slowSeconds, onKeep, onExtract, onStopExtracting, onChooseAnother, onBack }: {
  imageUri: string | null;
  ocrBusy: boolean;
  slowSeconds: number;
  onKeep: () => void;
  onExtract: () => void;
  onStopExtracting: () => void;
  onChooseAnother: () => void;
  onBack: () => void;
}) {
  return <Screen>
    <Header title={t("photo.header")} back={onBack} />
    <Eyebrow>{t("photo.eyebrow")}</Eyebrow><Title>{t("photo.title")}</Title>
    {imageUri && <Image source={{ uri: imageUri }} resizeMode="contain" style={screenStyles.photoPreview} />}
    <Body muted>{t("photo.body")}</Body>
    <View style={screenStyles.gap24}><Action label={t("photo.keep")} icon="image-outline" disabled={ocrBusy} onPress={onKeep} /></View>
    <View style={screenStyles.gap12}><Action kind="secondary" label={ocrBusy ? t("photo.extracting") : t("photo.extract")} icon="text-outline" disabled={ocrBusy} onPress={onExtract} /></View>
    {ocrBusy && slowSeconds >= 3 && <Text accessibilityLiveRegion="polite" style={screenStyles.slowNote}>{t("photo.extractSlow", { seconds: slowSeconds })}</Text>}
    <View style={screenStyles.gap12}>{ocrBusy
      ? <Action kind="ghost" label={t("photo.stopExtracting")} onPress={onStopExtracting} />
      : <Action kind="ghost" label={t("photo.another")} onPress={onChooseAnother} />}</View>
  </Screen>;
}

/** `resurface` false: saved to Library only, so nothing promises a return. */
export function SavedScreen({ firstSave, resurface, onContinue, onView }: { firstSave: boolean; resurface: boolean; onContinue: () => void; onView: () => void }) {
  return <Screen scroll={false}>
    <View style={screenStyles.centerPanel}><View style={screenStyles.successIcon}><Ionicons name="checkmark" size={38} color={palette.accentDark} /></View><Eyebrow>{t("saved.eyebrow")}</Eyebrow><Title>{firstSave ? t("saved.firstTitle") : t("saved.title")}</Title><Body muted>{t(resurface ? "saved.body" : "saved.libraryOnlyBody")}</Body></View>
    <View style={screenStyles.bottomActions}><Action label={t("common.continue")} onPress={onContinue} /><View style={screenStyles.gap12}><Action kind="ghost" label={t("saved.view")} onPress={onView} /></View></View>
  </Screen>;
}

export function PermissionScreen({ onAnswer }: { onAnswer: (ask: boolean) => void }) {
  return <Screen scroll={false}>
    <View style={screenStyles.centerPanel}><View style={screenStyles.successIcon}><Ionicons name="notifications-outline" size={38} color={palette.accentDark} /></View><Eyebrow>{t("permission.eyebrow")}</Eyebrow><Title>{t("permission.title")}</Title><Body muted>{t("permission.body")}</Body></View>
    <View style={screenStyles.bottomActions}><Action label={t("permission.enable")} onPress={() => onAnswer(true)} /><View style={screenStyles.gap12}><Action kind="ghost" label={t("permission.notNow")} onPress={() => onAnswer(false)} /></View></View>
  </Screen>;
}
