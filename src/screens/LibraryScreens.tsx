import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { MAX_CATEGORY_NAME_LENGTH, type CategoryWithCount, type LibraryItem, type LibrarySort, type LibraryStatus } from "../domain";
import { formatDate, t, type MessageKey } from "../i18n";
import { listInsights } from "../storage";
import { palette } from "../theme";
import { Action, Body, BottomNav, Eyebrow, Header, IconButton, Screen, Surface, Title } from "../ui";
import { CategoryChips, Thumbnail } from "./components";
import { screenStyles } from "./styles";

/**
 * Library filters and results. The state lives in the app (not the screen) so filters survive a
 * visit to an insight's detail. The previous list stays visible while a search refines it; a
 * failure replaces it with a retryable message rather than an alert over stale results.
 */
export function useLibrary(visible: boolean) {
  const [status, setStatus] = useState<LibraryStatus>("active");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [sort, setSort] = useState<LibrarySort>("newest");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    listInsights(status, search, categoryId, favoritesOnly, sort)
      .then((next) => { if (active) { setItems(next); setError(false); } })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [visible, status, search, categoryId, favoritesOnly, sort, attempt]);

  return {
    status, setStatus, search, setSearch, items, sort, setSort, categoryId, setCategoryId, favoritesOnly, setFavoritesOnly, error,
    retry: () => setAttempt((value) => value + 1),
  };
}

export type LibraryState = ReturnType<typeof useLibrary>;

export function LibraryScreen({ library, categories, onOpenDetail, onManageCategories, onToday, onCaptureChoice, onLibrary }: {
  library: LibraryState;
  categories: CategoryWithCount[];
  onOpenDetail: (insightId: string) => void;
  onManageCategories: () => void;
  onToday: () => void;
  onCaptureChoice: () => void;
  onLibrary: () => void;
}) {
  const { status: libraryStatus, setStatus: setLibraryStatus, search: librarySearch, setSearch: setLibrarySearch, items: libraryItems, sort: librarySort, setSort: setLibrarySort,
    categoryId: libraryCategory, setCategoryId: setLibraryCategory, favoritesOnly, setFavoritesOnly, error: libraryError } = library;
  return <Screen scroll={false}>
    <Header title={t("library.header")} />
    <ScrollView contentContainerStyle={screenStyles.libraryList} keyboardShouldPersistTaps="handled">
    <View><Eyebrow>{t("library.eyebrow")}</Eyebrow><Title>{t("library.title")}</Title><TextInput placeholder={t("library.search")} placeholderTextColor={palette.muted} value={librarySearch} onChangeText={setLibrarySearch} style={screenStyles.search} accessibilityLabel={t("library.searchLabel")} /></View>
    <View style={screenStyles.filters}>{(["all", "active", "paused", "archived"] as LibraryStatus[]).map((status) => <Pressable key={status} accessibilityRole="tab" accessibilityState={{ selected: libraryStatus === status }} onPress={() => setLibraryStatus(status)} style={[screenStyles.filter, libraryStatus === status && screenStyles.selectedFilter]}><Text style={[screenStyles.filterText, libraryStatus === status && screenStyles.selectedFilterText]}>{t(`library.status.${status}` as MessageKey)}</Text></Pressable>)}</View>
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
    <Pressable accessibilityRole="button" onPress={onManageCategories} style={screenStyles.manageLink}><Text style={screenStyles.textLinkInline}>{t("category.manage")}</Text></Pressable>
    <View style={[screenStyles.chipWrap, screenStyles.favoritesRow]}>{(["newest", "oldest", "resurfaced"] as const).map((sort) => {
      const on = librarySort === sort;
      return <Pressable key={sort} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={t("library.sortLabel", { name: t(`library.sort.${sort}` as MessageKey) })} onPress={() => setLibrarySort(sort)} style={[screenStyles.filter, on && screenStyles.selectedFilter]}>
        <Text style={[screenStyles.filterText, on && screenStyles.selectedFilterText]}>{t(`library.sort.${sort}` as MessageKey)}</Text>
      </Pressable>;
    })}</View>
    {!libraryError && libraryItems.length > 0 && <Text style={screenStyles.resultCount} accessibilityRole="summary">{t("library.resultCount", { count: libraryItems.length })}</Text>}
      {libraryError ? <Surface style={screenStyles.emptyCard}><Ionicons name="cloud-offline-outline" size={36} color={palette.accentDark} /><Text maxFontSizeMultiplier={1.8} style={screenStyles.emptyTitle}>{t("library.errorTitle")}</Text><Body muted>{t("library.errorBody")}</Body><View style={screenStyles.gap24}><Action label={t("common.tryAgain")} icon="refresh" onPress={library.retry} /></View></Surface>
        : libraryItems.length === 0 ? <Surface style={screenStyles.emptyCard}><Ionicons name="albums-outline" size={36} color={palette.accentDark} /><Text maxFontSizeMultiplier={1.8} style={screenStyles.emptyTitle}>{librarySearch ? t("library.noMatches") : favoritesOnly ? t("library.emptyFavorites") : libraryCategory ? t(`library.emptyInCategory.${libraryStatus}` as MessageKey) : t(`library.empty.${libraryStatus}` as MessageKey)}</Text><Body muted>{t("library.emptyBody")}</Body></Surface>
        : libraryItems.map((insight) => <Pressable key={insight.id} accessibilityRole="button" onPress={() => onOpenDetail(insight.id)} style={screenStyles.libraryRow}>{insight.imagePath ? <Thumbnail path={insight.imagePath} /> : <View style={screenStyles.libraryIcon}><Ionicons name="bookmark-outline" size={19} color={palette.accentDark} /></View>}<View style={screenStyles.flex}><Text numberOfLines={2} style={screenStyles.libraryText}>{insight.content || t("common.savedPhoto")}</Text><Text style={screenStyles.libraryDate}>{libraryStatus === "all" ? `${t(`detail.status.${insight.status}` as MessageKey)} · ` : ""}{formatDate(insight.createdAt)}{insight.source ? ` · ${insight.source}` : ""}</Text><Text style={screenStyles.libraryDate}>{insight.lastShownAt ? t("library.seenTimes", { count: insight.timesShown, date: formatDate(insight.lastShownAt) }) : insight.status === "paused" ? t("library.notScheduled") : t("library.notSeenYet")}</Text></View>{!!insight.favorite && <Ionicons name="star" size={16} color={palette.accentDark} accessibilityLabel={t("library.favoriteMark")} />}<Ionicons name="chevron-forward" size={17} color={palette.muted} /></Pressable>)}
    </ScrollView>
    <BottomNav active="library" onToday={onToday} onCapture={onCaptureChoice} onLibrary={onLibrary} />
  </Screen>;
}

export function CategoriesScreen({ categories, onCreate, onRename, onDelete, onBack }: {
  categories: CategoryWithCount[];
  onCreate: (name: string) => Promise<boolean>;
  /** Resolves true when renamed; reports problems itself. */
  onRename: (categoryId: string, name: string) => Promise<boolean>;
  onDelete: (category: CategoryWithCount) => void;
  onBack: () => void;
}) {
  const [renamingCategory, setRenamingCategory] = useState<{ id: string; name: string } | null>(null);
  return <Screen>
    <Header title={t("category.screenTitle")} back={onBack} />
    <Eyebrow>{t("category.eyebrow")}</Eyebrow><Title>{t("category.screenTitle")}</Title>
    <Body muted>{t("category.intro")}</Body>
    <View style={screenStyles.gap24}><CategoryChips categories={[]} selected={[]} onToggle={() => undefined} onCreate={onCreate} /></View>
    <View style={screenStyles.gap24}>
      {categories.length === 0 ? <Body muted>{t("category.none")}</Body> : categories.map((category) => renamingCategory?.id === category.id
        ? <View key={category.id} style={screenStyles.libraryRow}>
            <TextInput autoFocus clearButtonMode="while-editing" value={renamingCategory.name} onChangeText={(name) => setRenamingCategory({ id: category.id, name })} maxLength={MAX_CATEGORY_NAME_LENGTH} style={[screenStyles.search, screenStyles.flex]} accessibilityLabel={t("category.newNameFor", { name: category.name })} />
            <Action kind="secondary" label={t("common.save")} onPress={() => { void onRename(category.id, renamingCategory.name).then((renamed) => { if (renamed) setRenamingCategory(null); }); }} />
            <IconButton icon="close" label={t("category.cancelRename")} onPress={() => setRenamingCategory(null)} />
          </View>
        : <View key={category.id} style={screenStyles.libraryRow}>
            <View style={screenStyles.flex}><Text style={screenStyles.libraryText}>{category.name}</Text><Text style={screenStyles.libraryDate}>{t("category.count", { count: category.insights })}</Text></View>
            <IconButton icon="create-outline" label={t("category.renameLabel", { name: category.name })} onPress={() => setRenamingCategory({ id: category.id, name: category.name })} />
            <IconButton icon="trash-outline" label={t("category.deleteLabel", { name: category.name })} onPress={() => onDelete(category)} />
          </View>)}
    </View>
  </Screen>;
}
