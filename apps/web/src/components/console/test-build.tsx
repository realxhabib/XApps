"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Check, Link2, Swords } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/chrome/toasts";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { haptic } from "@/lib/haptics";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { useBackend } from "@/platform/client";
import { useAppTesters, useCreateChallenge } from "@/platform/queries";
import type { AppVersion, Profile } from "@/platform/types";
import { goToHost } from "@/lib/host-nav";

/** Practice a (possibly unpublished) version against bots, then open the play room. */
export function usePlayTestBuild(slug: string) {
  const backend = useBackend();
  const router = useRouter();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (version: AppVersion) =>
      backend.startPractice(slug, undefined, version.status === "published" ? null : version.id),
    onSuccess: (match) => {
      queryClient.setQueryData(["match", match.id], match);
      void queryClient.invalidateQueries({ queryKey: ["my-matches"] });
      play("whoosh");
      goToHost(router, `/play/${match.id}`);
    },
    onError: (error) => toast(error instanceof Error ? error.message : "Couldn't start the test build", { tone: "danger" }),
  });
  return mutation;
}

/**
 * Challenge testers (or anyone, with an open link) to a test build. Test
 * matches never touch rank or XP.
 */
export function ChallengeTesterSheet({ version, open, onClose }: { version: AppVersion | null; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open && !!version} onClose={onClose} title={version ? `Challenge on v${version.version}` : "Challenge"} description="A test build: only you and your testers can join, and it never counts for rank or XP.">
      {version && <ChallengeBody key={version.id} version={version} onDone={onClose} />}
    </Dialog>
  );
}

function ChallengeBody({ version, onDone }: { version: AppVersion; onDone: () => void }) {
  const router = useRouter();
  const { data: testers, isPending } = useAppTesters(version.appSlug);
  const create = useCreateChallenge();
  const modes = version.manifest.modes.filter((m): m is "live" | "async" => m !== "practice");
  const [mode, setMode] = useState<"live" | "async">(modes[0] ?? "live");
  const [picked, setPicked] = useState<Profile[]>([]);
  const max = version.manifest.players?.max ?? 2;
  const multi = max > 2;

  const toggle = (p: Profile) => {
    play("tick");
    haptic("light");
    setPicked((list) => {
      if (list.some((x) => x.id === p.id)) return list.filter((x) => x.id !== p.id);
      if (!multi) return [p];
      if (list.length + 2 > max) {
        toast(`The table seats ${max} at most`, { tone: "info" });
        return list;
      }
      return [...list, p];
    });
  };

  const send = async () => {
    try {
      const min = version.manifest.players?.min ?? 2;
      const size = Math.min(max, Math.max(min, picked.length + 1));
      const match = await create.mutateAsync({
        appSlug: version.appSlug,
        mode,
        versionId: version.status === "published" ? null : version.id,
        opponentHandle: !multi ? (picked[0]?.handle ?? null) : null,
        opponentHandles: multi && picked.length ? picked.map((p) => p.handle) : undefined,
        maxPlayers: multi ? size : undefined,
      });
      play("whoosh");
      toast(picked.length ? `Test build sent to ${picked.map((p) => `@${p.handle}`).join(", ")}` : "Open test challenge created", { tone: "success" });
      onDone();
      goToHost(router, `/play/${match.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't create the challenge", { tone: "danger" });
    }
  };

  if (modes.length === 0) {
    return <p className="text-sm text-ink-300">This version only has practice mode — use “Play test build” instead.</p>;
  }

  return (
    <div>
      {modes.length > 1 && (
        <Segmented
          layoutId="tester-mode"
          size="sm"
          value={mode}
          onChange={setMode}
          items={modes.map((m) => ({ id: m, label: m === "live" ? "Live" : "Play anytime" }))}
        />
      )}
      <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-ink-400">Testers</p>
      {isPending ? (
        <p className="mt-2 text-sm text-ink-400">Loading…</p>
      ) : !testers?.length ? (
        <p className="mt-2 rounded-2xl border border-dashed border-white/15 px-4 py-3 text-sm text-ink-300">
          No testers yet — add some on the Versions tab, or send an open link below.
        </p>
      ) : (
        <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {testers.map((p) => {
            const on = picked.some((x) => x.id === p.id);
            return (
              <li key={p.id}>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  onClick={() => toggle(p)}
                  aria-pressed={on}
                  className={cn("flex w-full items-center gap-2.5 rounded-2xl border px-3 py-2 text-left transition", on ? "border-white/30 bg-white/[0.08]" : "border-white/10 hover:border-white/20")}
                >
                  <Avatar person={p} size={28} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">@{p.handle}</span>
                  <motion.span initial={false} animate={{ scale: on ? 1 : 0, opacity: on ? 1 : 0 }} transition={spring.bouncy}>
                    <Check className="size-4 text-volt" />
                  </motion.span>
                </motion.button>
              </li>
            );
          })}
        </ul>
      )}
      <Button variant="accent" size="lg" className="mt-6 w-full" loading={create.isPending} icon={picked.length ? <Swords className="size-4" /> : <Link2 className="size-4" />} onClick={send}>
        {picked.length ? `Challenge ${picked.map((p) => `@${p.handle}`).join(", ")}` : "Create an open test link"}
      </Button>
    </div>
  );
}
