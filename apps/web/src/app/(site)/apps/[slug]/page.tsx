import type { Metadata } from "next";
import { ViewTransition } from "react";
import { AppDetail } from "@/components/pages/app-detail";
import { OFFICIAL_APPS, getOfficialApp } from "@/platform/catalog";
import { getRetiredApp } from "@/platform/retired-apps";

export function generateStaticParams() {
  return OFFICIAL_APPS.map((app) => ({ slug: app.slug }));
}

export async function generateMetadata({ params }: PageProps<"/apps/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const app = getOfficialApp(slug);
  if (!app) {
    const retired = getRetiredApp(slug);
    return { title: retired ? `${retired.name} (retired)` : "App" };
  }
  return {
    title: app.name,
    description: `${app.tagline} Challenge anyone on X.`,
    openGraph: { title: `${app.name} on XApps`, description: app.tagline },
    twitter: { title: `${app.name} on XApps`, description: app.tagline },
  };
}

export default async function AppPage({ params }: PageProps<"/apps/[slug]">) {
  const { slug } = await params;
  return (
    <ViewTransition enter={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "page-fade" }} exit={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }} default="none">
      <div>
        <AppDetail slug={slug} />
      </div>
    </ViewTransition>
  );
}
