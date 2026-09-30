import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { appMediaPublicUrl, isShareableImageKey } from "@/lib/media";
import { getOfficialApp } from "@/platform/catalog";

/**
 * Share page for an image an app uploaded (`social.share` with a `media.upload`
 * URL is rewritten here by the host): X only shows a picture for pages with
 * card metadata, never for a bare storage URL.
 */

interface SharedApp {
  slug: string;
  name: string;
  icon: string;
  tagline: string;
}

function keyOf(segments: string[]): string {
  return segments.map((s) => decodeURIComponent(s)).join("/");
}

async function appFor(slug: string): Promise<SharedApp> {
  const official = getOfficialApp(slug);
  if (official) return { slug, name: official.name, icon: official.icon, tagline: official.tagline };
  if (env.supabaseUrl && env.supabaseKey) {
    try {
      const res = await fetch(`${env.supabaseUrl}/rest/v1/apps?slug=eq.${encodeURIComponent(slug)}&select=name,icon,tagline&limit=1`, {
        headers: { apikey: env.supabaseKey, authorization: `Bearer ${env.supabaseKey}` },
        next: { revalidate: 3600 },
      });
      const [row] = (await res.json()) as { name?: string; icon?: string; tagline?: string }[];
      if (row?.name) return { slug, name: row.name, icon: row.icon ?? "✨", tagline: row.tagline ?? "" };
    } catch {
      // Fall through to a plain label: the image is what matters here.
    }
  }
  return { slug, name: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), icon: "✨", tagline: "" };
}

export async function generateMetadata({ params }: PageProps<"/s/[...key]">): Promise<Metadata> {
  const key = keyOf((await params).key);
  const image = isShareableImageKey(key) ? appMediaPublicUrl(key) : null;
  if (!image) return { title: "Shared on XApps" };
  const app = await appFor(key.split("/")[0]!);
  const title = `${app.name} on XApps`;
  const description = app.tagline || `Play ${app.name} on XApps.`;
  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function SharedImagePage({ params }: PageProps<"/s/[...key]">) {
  const key = keyOf((await params).key);
  const image = isShareableImageKey(key) ? appMediaPublicUrl(key) : null;
  if (!image) notFound();
  const app = await appFor(key.split("/")[0]!);
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 py-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- a user upload in our storage bucket */}
      <img src={image} alt={`Shared from ${app.name}`} className="w-full rounded-[2rem] border border-white/10 shadow-2xl" />
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          {app.icon} {app.name}
        </h1>
        {app.tagline && <p className="mt-2 text-ink-300">{app.tagline}</p>}
      </div>
      <Button size="xl" variant="accent" magnetic href={`/apps/${app.slug}`}>
        Play {app.name}
      </Button>
    </div>
  );
}
