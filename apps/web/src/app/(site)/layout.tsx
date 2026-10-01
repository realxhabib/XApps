import { Background } from "@/components/chrome/background";
import { CommandPalette } from "@/components/chrome/command-palette";
import { DemoBanner } from "@/components/chrome/demo-banner";
import { Dock } from "@/components/chrome/dock";
import { InboxWatcher } from "@/components/chrome/inbox-watcher";
import { OutageBanner } from "@/components/chrome/outage-banner";
import { SetupNotice } from "@/components/chrome/setup-notice";
import { Toaster } from "@/components/chrome/toasts";
import { TopBar } from "@/components/chrome/top-bar";
import { ConfettiLayer } from "@/components/motion/confetti";
import { AchievementLayer } from "@/components/play/achievement-moment";
import { PlatformProvider } from "@/platform/client";

export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <PlatformProvider>
      <Background />
      <TopBar />
      <main className="relative z-10 mx-auto w-full max-w-6xl page-x pb-36 pt-28 lg:pb-24">
        <SetupNotice />
        {children}
      </main>
      <Dock />
      <CommandPalette />
      <InboxWatcher />
      <DemoBanner />
      <OutageBanner />
      <Toaster />
      <ConfettiLayer />
      <AchievementLayer />
    </PlatformProvider>
  );
}
