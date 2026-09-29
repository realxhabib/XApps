import type { Metadata } from "next";
import { Suspense } from "react";
import { AppConsole, ConsoleSkeleton } from "@/components/console/app-console";

export const metadata: Metadata = {
  title: "Console",
  description: "Versions, testers, analytics, logs and server settings for your app.",
  robots: { index: false },
};

export default async function AppConsolePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense fallback={<ConsoleSkeleton />}>
      <AppConsole slug={slug} />
    </Suspense>
  );
}
