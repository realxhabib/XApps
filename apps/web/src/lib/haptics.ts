export type Haptic = "light" | "medium" | "heavy" | "success" | "error";

const patterns: Record<Haptic, number | number[]> = {
  light: 8,
  medium: 16,
  heavy: 30,
  success: [10, 40, 18],
  error: [30, 50, 30],
};

export function haptic(style: Haptic = "light"): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(patterns[style]);
  } catch {
    // Some browsers throw without a user gesture.
  }
}
