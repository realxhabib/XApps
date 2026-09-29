import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminReview } from "@/components/console/admin-review";

export const metadata: Metadata = {
  title: "Review queue",
  robots: { index: false },
};

export default function AdminReviewPage() {
  return (
    <Suspense>
      <AdminReview />
    </Suspense>
  );
}
