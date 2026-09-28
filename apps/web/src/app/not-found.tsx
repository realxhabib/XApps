import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-display text-8xl font-extrabold tracking-tighter text-ink-700">404</p>
      <h1 className="font-display text-3xl font-extrabold">This page got ratioed.</h1>
      <p className="max-w-sm text-ink-300">It doesn&apos;t exist, or it moved. Let&apos;s get you back to the action.</p>
      <Link href="/" className="mt-2 rounded-full bg-ink-50 px-6 py-3 font-semibold text-ink-950 transition hover:bg-white">
        Back to XApps
      </Link>
    </main>
  );
}
