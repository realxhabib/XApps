import type { Metadata } from "next";
import { Suspense } from "react";
import { Login } from "@/components/pages/login";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to XApps with your X account.",
};

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
