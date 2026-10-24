import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import type { Settings } from "../domain";
import { t } from "../i18n";
import { palette } from "../theme";
import { Action, Body, Eyebrow, Screen, Title } from "../ui";
import { screenStyles } from "./styles";

export function OnboardingScreen({ settings, onNext, onRestore }: {
  settings: Settings;
  /** Advances a slide, or on the last one starts the first capture. */
  onNext: () => void;
  onRestore: () => void;
}) {
  const onboarding = [
    { icon: "book-outline" as const, title: t("onboarding.title1"), body: t("onboarding.body1") },
    { icon: "time-outline" as const, title: t("onboarding.title2"), body: t("onboarding.body2") },
    { icon: "leaf-outline" as const, title: t("onboarding.title3"), body: t("onboarding.body3") },
  ];
  const slide = onboarding[Math.min(settings.onboardingStep, 2)] ?? onboarding[0]!;
  return <Screen scroll={false}>
    <View style={screenStyles.onboarding}>
      <View><Text style={screenStyles.brand}>resurface<Text style={screenStyles.brandDot}>.</Text></Text><Text accessibilityLabel={t("onboarding.step", { step: Math.min(settings.onboardingStep + 1, 3) })} style={screenStyles.step}>0{Math.min(settings.onboardingStep + 1, 3)} / 03</Text></View>
      <View style={screenStyles.onboardingHero}>
        <View style={screenStyles.heroCircle}><Ionicons name={slide.icon} size={72} color={palette.accentDark} /></View>
        <Eyebrow>{t("onboarding.eyebrow")}</Eyebrow><Title>{slide.title}</Title><Body muted>{slide.body}</Body>
      </View>
      <View style={screenStyles.onboardingFooter}>
        <View style={screenStyles.dots}>{onboarding.map((_, index) => <View key={index} style={[screenStyles.dot, settings.onboardingStep === index && screenStyles.activeDot]} />)}</View>
        <Action label={settings.onboardingStep === 2 ? t("onboarding.saveFirst") : t("common.continue")} icon="arrow-forward" onPress={onNext} />
        <Action kind="ghost" label={t("onboarding.restore")} icon="download-outline" onPress={onRestore} />
      </View>
    </View>
  </Screen>;
}
