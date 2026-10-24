import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, PropsWithChildren, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t } from "./i18n";
import { palette } from "./theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

export function Screen({ children, scroll = true }: PropsWithChildren<{ scroll?: boolean }>) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {scroll ? <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={styles.fill}>{children}</View>}
    </SafeAreaView>
  );
}

export function Eyebrow({ children }: PropsWithChildren) {
  return <Text maxFontSizeMultiplier={1.6} style={styles.eyebrow}>{children}</Text>;
}

export function Title({ children }: PropsWithChildren) {
  // Display sizes are capped so large accessibility text stays readable without breaking words;
  // body text keeps scaling fully.
  return <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={styles.title}>{children}</Text>;
}

export function Body({ children, muted = false }: PropsWithChildren<{ muted?: boolean }>) {
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}

export function Surface({ children, style }: PropsWithChildren<{ style?: object }>) {
  return <View style={[styles.surface, style]}>{children}</View>;
}

export function Action({ label, onPress, icon, kind = "primary", disabled = false }: { label: string; onPress: () => void; icon?: IconName; kind?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, styles[kind], disabled && styles.disabled, pressed && styles.pressed]}
    >
      {icon && <Ionicons name={icon} size={18} color={kind === "primary" ? palette.paper : kind === "danger" ? palette.danger : palette.ink} />}
      <Text style={[styles.actionText, kind === "primary" && styles.primaryText, kind === "danger" && styles.dangerText]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.iconButton}>
      <Ionicons name={icon} size={21} color={palette.ink} />
    </Pressable>
  );
}

export function Header({ title, back, right }: { title: string; back?: () => void; right?: ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerSide}>{back && <IconButton icon="arrow-back" label={t("common.back")} onPress={back} />}</View>
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.6} style={styles.headerTitle}>{title}</Text>
      <View style={[styles.headerSide, styles.headerRight]}>{right}</View>
    </View>
  );
}

export function BottomNav({ active, onToday, onCapture, onLibrary }: { active: "today" | "library"; onToday: () => void; onCapture: () => void; onLibrary: () => void }) {
  return (
    <SafeAreaView style={styles.navSafe} edges={["bottom"]}>
      <View style={styles.nav}>
        <Pressable accessibilityRole="tab" accessibilityLabel={t("nav.today")} accessibilityState={{ selected: active === "today" }} onPress={onToday} style={styles.navItem}>
          <Ionicons name={active === "today" ? "sunny" : "sunny-outline"} size={23} color={active === "today" ? palette.accentDark : palette.muted} />
          <Text maxFontSizeMultiplier={1.4} style={[styles.navLabel, active === "today" && styles.navActive]}>{t("nav.today")}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("nav.capture")} onPress={onCapture} style={styles.addButton}>
          <Ionicons name="add" size={28} color={palette.paper} />
        </Pressable>
        <Pressable accessibilityRole="tab" accessibilityLabel={t("nav.library")} accessibilityState={{ selected: active === "library" }} onPress={onLibrary} style={styles.navItem}>
          <Ionicons name={active === "library" ? "albums" : "albums-outline"} size={23} color={active === "library" ? palette.accentDark : palette.muted} />
          <Text maxFontSizeMultiplier={1.4} style={[styles.navLabel, active === "library" && styles.navActive]}>{t("nav.library")}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  scroll: { flex: 1 },
  fill: { flex: 1 },
  content: { paddingHorizontal: 24, paddingBottom: 36 },
  eyebrow: { color: palette.accentDark, fontSize: 12, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase", marginTop: 24, marginBottom: 12 },
  title: { color: palette.ink, fontSize: 35, lineHeight: 42, fontWeight: "700", letterSpacing: -1.4, marginBottom: 14 },
  body: { color: palette.ink, fontSize: 16, lineHeight: 24 },
  muted: { color: palette.muted },
  surface: { backgroundColor: palette.paper, borderRadius: 24, padding: 22, borderWidth: 1, borderColor: palette.border },
  action: { minHeight: 52, borderRadius: 15, flexDirection: "row", gap: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, paddingVertical: 12 },
  primary: { backgroundColor: palette.dark },
  secondary: { backgroundColor: palette.soft },
  ghost: { backgroundColor: "transparent", borderWidth: 1, borderColor: palette.border },
  danger: { backgroundColor: "#F9EBE8" },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
  actionText: { color: palette.ink, fontSize: 15, fontWeight: "700" },
  primaryText: { color: palette.paper },
  dangerText: { color: palette.danger },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: palette.soft },
  header: { minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 20 },
  headerSide: { width: 80, alignItems: "flex-start" },
  headerRight: { alignItems: "flex-end" },
  headerTitle: { color: palette.ink, fontSize: 17, fontWeight: "700" },
  navSafe: { backgroundColor: palette.paper, borderTopWidth: 1, borderTopColor: palette.border },
  nav: { minHeight: 68, paddingVertical: 6, flexDirection: "row", justifyContent: "space-around", alignItems: "center" },
  navItem: { minWidth: 76, alignItems: "center", gap: 3 },
  navLabel: { color: palette.muted, fontSize: 11, fontWeight: "600" },
  navActive: { color: palette.accentDark },
  addButton: { width: 54, height: 54, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: palette.dark, marginTop: -18 },
});
