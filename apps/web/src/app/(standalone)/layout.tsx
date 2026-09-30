import { Toaster } from "@/components/chrome/toasts";
import { ConfettiLayer } from "@/components/motion/confetti";
import { AchievementLayer } from "@/components/play/achievement-moment";
import { PlatformProvider } from "@/platform/client";

/**
 * Full-screen host pages that run a standalone app (`/apps/[slug]/open`):
 * no site chrome, just the host's toasts, confetti and achievement moments.
 */
export default function StandaloneLayout({ children }: LayoutProps<"/">) {
  return (
    <PlatformProvider>
      {children}
      <Toaster />
      <ConfettiLayer />
      <AchievementLayer />
    </PlatformProvider>
  );
}
