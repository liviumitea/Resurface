export type Route = "onboarding" | "capture-choice" | "capture" | "photo" | "saved" | "permission" | "today" | "reflect" | "library" | "detail" | "settings" | "categories" | "upcoming";
export type CaptureOrigin = "onboarding" | "today" | "library";
/** Where Detail returns to. */
export type DetailOrigin = "today" | "library" | "upcoming";
export type TodayStatus = "loading" | "ready" | "error";
