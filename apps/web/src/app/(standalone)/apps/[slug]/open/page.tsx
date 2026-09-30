import type { Metadata } from "next";
import { AppRoom } from "@/components/play/app-room";
import { getOfficialApp } from "@/platform/catalog";

export async function generateMetadata({ params }: PageProps<"/apps/[slug]/open">): Promise<Metadata> {
  const { slug } = await params;
  const app = getOfficialApp(slug);
  return {
    title: app?.name ?? "App",
    description: app ? `${app.tagline} Open it on XApps.` : "Open this app on XApps, signed in with X.",
    // The app page is the canonical, shareable URL.
    robots: { index: false },
  };
}

/** Runs a standalone (`kind: "app"`) app. `?version=<id>` opens a test build (owner and testers). */
export default async function OpenAppPage({ params, searchParams }: PageProps<"/apps/[slug]/open">) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const version = typeof query.version === "string" && query.version ? query.version : null;
  return <AppRoom slug={slug} versionId={version} />;
}
