"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Search, UserMinus, UserPlus } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { toast } from "@/components/chrome/toasts";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { useViewer } from "@/platform/client";
import { useAddTester, useAppTesters, useRemoveTester, useSearchProfiles } from "@/platform/queries";
import type { AppManifest, Profile } from "@/platform/types";
import { Panel, PanelTitle, fieldClass } from "./ui";

/** Testers can play versions that aren't published yet. */
export function TestersPanel({ app }: { app: AppManifest }) {
  const reduced = useReducedMotion();
  const { viewer } = useViewer();
  const { data: testers, isPending } = useAppTesters(app.slug);
  const add = useAddTester(app.slug);
  const remove = useRemoveTester(app.slug);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim().replace(/^@/, ""));
  const search = useSearchProfiles(deferred, deferred.length > 0);
  const testerIds = new Set((testers ?? []).map((t) => t.id));
  const suggestions = (search.data ?? []).filter((p) => !testerIds.has(p.id) && p.id !== viewer?.id).slice(0, 5);

  const addHandle = async (handle: string) => {
    const clean = handle.trim().replace(/^@/, "");
    if (!clean) return;
    try {
      await add.mutateAsync(clean);
      play("pop");
      setQuery("");
      toast(`@${clean} can play test builds`, { tone: "success" });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't add that tester", { tone: "danger" });
    }
  };

  const removeTester = async (p: Profile) => {
    try {
      await remove.mutateAsync(p.id);
      play("tick");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't remove that tester", { tone: "danger" });
    }
  };

  return (
    <Panel className="h-fit">
      <PanelTitle sub="They can play unpublished versions. Test matches never count for rank or XP.">Testers</PanelTitle>
      <form
        className="relative mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void addHandle(suggestions[0]?.handle ?? query);
        }}
      >
        <Search className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-ink-400" aria-hidden />
        <input
          className={cn(fieldClass, "pl-10 pr-24")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Add by @handle"
          aria-label="Add a tester by handle"
          autoComplete="off"
        />
        <Button type="submit" size="sm" variant="primary" className="absolute right-1.5 top-1.5" loading={add.isPending} disabled={!query.trim()} icon={<UserPlus className="size-3.5" />}>
          Add
        </Button>
        <AnimatePresence>
          {deferred && suggestions.length > 0 && (
            <motion.ul
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={spring.snappy}
              className="glass-strong absolute inset-x-0 top-12 z-20 overflow-hidden rounded-2xl p-1 shadow-2xl"
            >
              {suggestions.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => addHandle(p.handle)} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-white/[0.07]">
                    <Avatar person={p} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{p.name}</span>
                      <span className="block truncate text-xs text-ink-400">@{p.handle}</span>
                    </span>
                    <UserPlus className="size-4 text-ink-400" />
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </form>

      {isPending ? (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-12 rounded-2xl" />
          <Skeleton className="h-12 rounded-2xl" />
        </div>
      ) : (
        <ul className="mt-4 space-y-1.5">
          <AnimatePresence initial={false}>
            {(testers ?? []).map((p) => (
              <motion.li
                key={p.id}
                layout={!reduced}
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, x: 16, transition: { duration: 0.15 } }}
                transition={spring.soft}
                className="flex items-center gap-2.5 rounded-2xl border border-white/[0.08] px-3 py-2"
              >
                <Avatar person={p} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.name}</span>
                  <span className="block truncate text-xs text-ink-400">@{p.handle}</span>
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove @${p.handle}`}
                  loading={remove.isPending && remove.variables === p.id}
                  onClick={() => removeTester(p)}
                  icon={<UserMinus className="size-4" />}
                />
              </motion.li>
            ))}
          </AnimatePresence>
          {testers?.length === 0 && <li className="rounded-2xl border border-dashed border-white/15 px-4 py-5 text-center text-sm text-ink-400">No testers yet. You can always play your own builds.</li>}
        </ul>
      )}
    </Panel>
  );
}
