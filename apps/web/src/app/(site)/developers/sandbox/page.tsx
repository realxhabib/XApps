import type { Metadata } from "next";
import { Suspense } from "react";
import { Sandbox } from "@/components/pages/sandbox";

export const metadata: Metadata = {
  title: "Sandbox",
  description: "Test an XApps app with two seats side by side and a live protocol log.",
};

export default function SandboxPage() {
  return (
    <Suspense>
      <Sandbox />
    </Suspense>
  );
}
