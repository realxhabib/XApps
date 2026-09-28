import { Toaster } from "@/components/chrome/toasts";
import { ConfettiLayer } from "@/components/motion/confetti";
import { PlatformProvider } from "@/platform/client";

export default function PlayLayout({ children }: LayoutProps<"/play">) {
  return (
    <PlatformProvider>
      {children}
      <Toaster />
      <ConfettiLayer />
    </PlatformProvider>
  );
}
