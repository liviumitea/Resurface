import { Alert, Pressable, Switch, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { Settings } from "../domain";
import { formatDate, formatDateTime, t, weekdayName, type MessageKey } from "../i18n";
import type { BackupStatus, BetaMetrics } from "../storage";
import { palette } from "../theme";
import { Action, Body, Eyebrow, Header, Screen, Surface, Title } from "../ui";
import { TIME_PRESETS, WEEK_FROM_MONDAY, screenStyles } from "./styles";

const VALID_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function SettingsScreen({ settings, setSettings, reloadSettings, updateSettings, notificationGranted, onEnableNotifications, metrics, backupStatus, onCreateBackup, onRestoreBackup, onVerifyBackup, onBack }: {
  settings: Settings;
  /** Local edit of the time field before it is validated and saved. */
  setSettings: (settings: Settings) => void;
  reloadSettings: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  notificationGranted: boolean | null;
  onEnableNotifications: () => void;
  metrics: BetaMetrics | null;
  backupStatus: BackupStatus | null;
  onCreateBackup: () => void;
  onRestoreBackup: () => void;
  onVerifyBackup: () => void;
  onBack: () => void;
}) {
  // Side-by-side cards break words at large accessibility text sizes, so they stack instead.
  const stackChoices = useWindowDimensions().fontScale > 1.3;
  return <Screen>
    <Header title={t("settings.header")} back={onBack} />
    <Eyebrow>{t("settings.eyebrow")}</Eyebrow><Title>{t("settings.title")}</Title>
    <Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>{t("settings.frequency")}</Text><Body muted>{t("settings.frequencyBody")}</Body>
    <View style={[screenStyles.frequency, stackChoices && screenStyles.frequencyStacked]}>{([1, 3, 5] as const).map((cap) => <Pressable key={cap} accessibilityRole="radio" accessibilityState={{ checked: settings.dailyCap === cap }} accessibilityLabel={t("settings.capLabel", { name: t(`settings.cap.${cap}` as MessageKey), cap })} onPress={() => updateSettings({ dailyCap: cap })} style={[screenStyles.frequencyOption, stackChoices && screenStyles.frequencyOptionStacked, settings.dailyCap === cap && screenStyles.frequencySelected]}><Text style={screenStyles.frequencyName}>{t(`settings.cap.${cap}` as MessageKey)}</Text><Text style={screenStyles.frequencyDetail}>{t("settings.capDetail", { cap })}</Text></Pressable>)}</View>
    <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>{t("settings.notifications")}</Text><Body muted>{t("settings.notificationsBody")}</Body></View>
    {notificationGranted === false && <View style={screenStyles.gap12}><Action kind="secondary" label={t("settings.enableNotifications")} onPress={onEnableNotifications} /></View>}
    <Text style={screenStyles.fieldLabel}>{t("settings.time")}</Text>
    <TextInput value={settings.notificationTime} onChangeText={(value) => { setSettings({ ...settings, notificationTime: value }); }} onBlur={() => { if (VALID_TIME.test(settings.notificationTime)) updateSettings({ notificationTime: settings.notificationTime }); else { Alert.alert(t("settings.timeInvalidTitle"), t("settings.timeInvalidBody")); reloadSettings(); } }} keyboardType="numbers-and-punctuation" maxLength={5} style={screenStyles.search} accessibilityLabel={t("settings.timeLabel")} />
    <View style={[screenStyles.chipWrap, screenStyles.gap12]} accessibilityLabel={t("settings.timePresets")}>{TIME_PRESETS.map((time) => {
      const on = settings.notificationTime === time;
      return <Pressable key={time} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${t("settings.timeLabel")} ${time}`} onPress={() => updateSettings({ notificationTime: time })} style={[screenStyles.filter, on && screenStyles.selectedFilter]}>
        <Text style={[screenStyles.filterText, on && screenStyles.selectedFilterText]}>{time}</Text>
      </Pressable>;
    })}</View>
    <Text style={screenStyles.fieldLabel}>{t("settings.quietDays")}</Text>
    <Body muted>{t("settings.quietDaysBody")}</Body>
    <View style={[screenStyles.chipWrap, screenStyles.gap12]}>{WEEK_FROM_MONDAY.map((day) => {
      const quiet = settings.quietDays.includes(day);
      const toggle = () => {
        const next = quiet ? settings.quietDays.filter((other) => other !== day) : [...settings.quietDays, day];
        if (next.length >= 7) { Alert.alert(t("settings.quietAllTitle"), t("settings.quietAllBody")); return; }
        updateSettings({ quietDays: next });
      };
      return <Pressable key={day} accessibilityRole="checkbox" accessibilityState={{ checked: quiet }} accessibilityLabel={t("settings.quietDayLabel", { day: weekdayName(day, "long") })} onPress={toggle} style={[screenStyles.filter, quiet && screenStyles.selectedFilter]}>
        <Text style={[screenStyles.filterText, quiet && screenStyles.selectedFilterText]}>{weekdayName(day)}</Text>
      </Pressable>;
    })}</View>
    <Surface style={screenStyles.switchRow}><View style={screenStyles.flex}><Text style={screenStyles.switchTitle}>{t("settings.showText")}</Text><Text style={screenStyles.switchDescription}>{t("settings.showTextBody")}</Text></View><Switch accessibilityLabel={t("settings.showTextLabel")} value={settings.showInsightText} onValueChange={(value) => updateSettings({ showInsightText: value })} trackColor={{ true: palette.accentDark }} /></Surface>
    <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>{t("settings.language")}</Text><Body muted>{t("settings.languageBody")}</Body></View>
    <View style={[screenStyles.chipWrap, screenStyles.gap12]}>{(["system", "en", "ro"] as const).map((language) => {
      const on = settings.language === language;
      return <Pressable key={language} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => updateSettings({ language })} style={[screenStyles.filter, on && screenStyles.selectedFilter]}>
        <Text style={[screenStyles.filterText, on && screenStyles.selectedFilterText]}>{t(`settings.language.${language}` as MessageKey)}</Text>
      </Pressable>;
    })}</View>
    <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>{t("settings.privacy")}</Text><Body muted>{t("settings.privacyBody")}</Body></View>
    <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>{t("settings.backup")}</Text><Body muted>{t("settings.backupBody")}</Body></View>
    <View style={screenStyles.gap12}><Action kind="secondary" label={t("settings.createBackup")} icon="lock-closed-outline" onPress={onCreateBackup} /></View>
    <View style={screenStyles.gap12}><Action kind="ghost" label={t("settings.restoreBackup")} icon="download-outline" onPress={onRestoreBackup} /></View>
    <View style={screenStyles.gap12}><Action kind="ghost" label={t("settings.verifyBackup")} icon="shield-checkmark-outline" onPress={onVerifyBackup} /></View>
    <View style={screenStyles.gap12}>
      <Body muted>{backupStatus?.lastCreatedAt ? t(backupStatus.lastCreatedComplete ? "settings.lastCreated" : "settings.lastCreatedIncomplete", { date: formatDateTime(backupStatus.lastCreatedAt) }) : t("settings.noneCreated")}</Body>
      <Body muted>{backupStatus?.lastVerified ? t(backupStatus.lastVerified.omissions ? "settings.lastVerifiedIncomplete" : "settings.lastVerified", { verified: formatDateTime(backupStatus.lastVerified.verifiedAt), made: formatDateTime(backupStatus.lastVerified.exportedAt), count: backupStatus.lastVerified.insights }) : t("settings.noneVerified")}</Body>
    </View>
    <View style={screenStyles.gap24}><Text maxFontSizeMultiplier={1.8} style={screenStyles.sectionTitle}>{t("settings.signals")}</Text><Body muted>{metrics ? (metrics.firstSaveAt ? t("settings.firstSave", { date: formatDate(metrics.firstSaveAt) }) : t("settings.noFirstSave")) : ""}</Body><Body muted>{metrics?.firstSaveAt ? (metrics.coreLoopAt ? t("settings.coreLoop", { date: formatDate(metrics.coreLoopAt), count: Math.max(0, Math.round((Date.parse(metrics.coreLoopAt) - Date.parse(metrics.firstSaveAt)) / 86_400_000)) }) : t("settings.noCoreLoop")) : ""}</Body><Body muted>{metrics ? t("settings.counts", { saved: metrics.saved, shown: metrics.shown, asked: metrics.asked, answered: metrics.answered, valuable: metrics.valuable }) : t("common.loading")}</Body><Body muted>{metrics?.shown ? t("settings.answerRate", { percent: Math.round((metrics.answered / metrics.shown) * 100) }) : t("settings.answerRateLater")}</Body><Body muted>{metrics?.answered ? t("settings.valueRate", { percent: Math.round((metrics.valuable / metrics.answered) * 100) }) : t("settings.valueRateLater")}</Body></View>
    <View style={screenStyles.gap24}><Body muted>{t("settings.version", { version: "0.1.0" })}</Body></View>
  </Screen>;
}
