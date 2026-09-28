export default function EmbedLayout({ children }: LayoutProps<"/embed">) {
  // First-party apps run inside the host's iframe: no site chrome, no scroll bounce.
  return <div className="min-h-dvh touch-manipulation overscroll-none bg-ink-950">{children}</div>;
}
