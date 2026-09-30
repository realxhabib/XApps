import type { Metadata } from "next";
import { ViewTransition } from "react";
import { AppsBrowser } from "@/components/pages/apps-browser";

export const metadata: Metadata = {
  title: "Marketplace",
  description: "Browse head-to-head games, meme contests and apps on XApps.",
};

export default function AppsPage() {
  return (
    <ViewTransition enter={{ "nav-back": "nav-back", default: "page-fade" }} exit={{ "nav-forward": "nav-forward", default: "none" }} default="none">
      <div>
        <AppsBrowser />
      </div>
    </ViewTransition>
  );
}
