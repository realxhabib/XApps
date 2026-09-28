"use client";

import { usePathname } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { XLogo } from "@/components/ui/x-logo";

export function SignInPrompt({ title, children }: { title: string; children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <EmptyState
      emoji="🔐"
      title={title}
      action={
        <Button href={`/login?next=${encodeURIComponent(pathname)}`} variant="primary" size="lg" icon={<XLogo className="size-4" />}>
          Sign in with X
        </Button>
      }
    >
      {children}
    </EmptyState>
  );
}
