import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { circleSvg, decodeCard } from "@/first-party/perfect-circle/card";
import { accuracyColor, formatAccuracy, verdictFor } from "@/first-party/perfect-circle/logic";
import { svgDataUrl } from "@/lib/svg";

/**
 * Landing page for a shared circle. The link carries the circle itself (see
 * `first-party/perfect-circle/card.ts`), and the sibling `opengraph-image`
 * draws it, so the post on X shows the circle and its score.
 */
export async function generateMetadata({ params }: PageProps<"/embed/perfect-circle/card/[code]">): Promise<Metadata> {
  const { code } = await params;
  const card = decodeCard(code);
  if (!card) return { title: "Perfect Circle" };
  const title = `A ${formatAccuracy(card.accuracy)} perfect circle`;
  const description = "Drawn freehand in one stroke on XApps. Can you draw a rounder one?";
  return {
    title,
    description,
    robots: { index: false },
    openGraph: { title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PerfectCircleCard({ params }: PageProps<"/embed/perfect-circle/card/[code]">) {
  const { code } = await params;
  const card = decodeCard(code);
  if (!card) notFound();
  const color = accuracyColor(card.accuracy);
  const verdict = verdictFor(card.accuracy);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-10 text-center text-ink-50">
      {/* eslint-disable-next-line @next/next/no-img-element -- self-contained SVG data URL */}
      <img
        src={svgDataUrl(circleSvg(card.stroke, null, 400))}
        alt={`A freehand circle scoring ${formatAccuracy(card.accuracy)}`}
        width={320}
        height={320}
        className="size-[min(80vw,20rem)] rounded-[2rem] shadow-[0_30px_80px_-30px_rgb(55_227_155/0.45)] ring-1 ring-white/10"
      />
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-ink-300">Perfect Circle</p>
        <p className="mt-2 font-display text-6xl font-extrabold tracking-tight tabular" style={{ color }}>
          {formatAccuracy(card.accuracy)}
        </p>
        <p className="mt-1 text-lg font-bold">
          {verdict.word} <span aria-hidden>{verdict.emoji}</span>
        </p>
      </div>
      <Link
        href="/apps/perfect-circle"
        className="flex h-14 items-center rounded-full bg-[linear-gradient(120deg,#ffcf3d,#34e89e)] px-8 text-base font-bold text-ink-950"
      >
        Draw yours
      </Link>
    </main>
  );
}
