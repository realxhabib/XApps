import { Toaster } from "@/components/chrome/toasts";
import { ConfettiLayer } from "@/components/motion/confetti";
import { AchievementLayer } from "@/components/play/achievement-moment";
import { PlatformProvider } from "@/platform/client";

export default function PlayLayout({ children }: LayoutProps<"/play">) {
  return (
    <PlatformProvider>
      <div data-app-host className="contents">
        {children}
      </div>
      <Toaster />
      <ConfettiLayer />
      <AchievementLayer />
    </PlatformProvider>
  );
}
