import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { AppState, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { MAX_CATEGORY_NAME_LENGTH, type Category, type Insight } from "../domain";
import { formatDate, t } from "../i18n";
import { imageDataUri } from "../media";
import { palette } from "../theme";
import { Action, Screen, Surface } from "../ui";
import { screenStyles } from "./styles";

export function InsightImage({ path, height = 260 }: { path: string | null; height?: number }) {
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
export function Thumbnail({ path }: { path: string }) {
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

export function InsightCard({ insight, compact = false }: { insight: Insight; compact?: boolean }) {
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
export function CategoryChips({ categories, selected, onToggle, onCreate }: {
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

export function Loading({ message }: { message?: string }) {
  return <Screen scroll={false}><View style={screenStyles.center}><View style={screenStyles.loadingMark}><Ionicons name="sparkles" size={34} color={palette.accentDark} /></View><Text style={screenStyles.loadingText}>{message ?? t("common.loadingApp")}</Text></View></Screen>;
}

export function TodaySkeleton() {
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

/**
 * Covers the app whenever it is not active, so the iOS app switcher snapshot never shows an
 * insight. (Android takes its snapshot too late for this; FLAG_SECURE would be needed there.)
 */
export function PrivacyCover() {
  const [hidden, setHidden] = useState(AppState.currentState !== "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setHidden(state !== "active"));
    return () => subscription.remove();
  }, []);
  if (!hidden) return null;
  return <View style={[StyleSheet.absoluteFill, screenStyles.privacyCover]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Text style={screenStyles.brand}>resurface<Text style={screenStyles.brandDot}>.</Text></Text></View>;
}
