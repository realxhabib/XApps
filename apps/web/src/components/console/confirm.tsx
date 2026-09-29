"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/** A two-step action: the button opens this sheet, the sheet does the thing. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  tone = "accent",
  icon,
  busy,
  disabled,
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  tone?: "accent" | "danger" | "volt" | "primary";
  icon?: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      {children}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant={tone} icon={icon} loading={busy} disabled={disabled} onClick={onConfirm} data-autofocus>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
