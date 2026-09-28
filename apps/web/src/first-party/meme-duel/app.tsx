"use client";

import { useMatch, useMatchResult, useMatchStarted, useRoomEvent, useXApps } from "@xapps/sdk/react";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBot, useLiveOpponent } from "@/first-party/shared/hooks";
import { play } from "@/lib/sfx";
import { Editor } from "./editor";
import { LockedScreen } from "./locked";
import {
  LIVE_TIME_MS,
  SOFT_TIME_MS,
  TYPING_IDLE_MS,
  TYPING_THROTTLE_MS,
  botFollowUpDelayMs,
  botSubmitDelayMs,
  entryAlt,
  entryToJson,
  makeBotEntry,
  outcomeFor,
  pickTemplate,
  sanitizeEntry,
} from "./logic";
import { Countdown, OpponentPill, useBuzz, type OpponentState } from "./pieces";
import { Pregame } from "./pregame";
import { renderMemeSvg } from "./render";
import type { EditorSticker } from "./stickers";
import type { MemeEntry } from "./templates";

/** Color emoji fonts ahead of the system fallbacks (some ship monochrome emoji glyphs). */
const APP_FONT =
  "var(--font-geist-sans), 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', ui-sans-serif, system-ui, sans-serif";

/**
 * Meme Duel: both players caption the same seeded template, add up to three
 * stickers and submit an SVG for the Arena crowd to vote on.
 *
 * Live sync (vs a human): `typing` (throttled, while editing) and `submitted`
 * room events drive the opponent pill. Bots are played locally and submit
 * with `submitFor` shortly after the human (or 15–40 s in).
 */
export function MemeDuelApp() {
  const xapps = useXApps();
  const started = useMatchStarted();
  const result = useMatchResult();
  const match = useMatch();
  const bot = useBot();
  const liveOpponent = useLiveOpponent();
  const buzz = useBuzz();
  const opponent = xapps.opponent;
  const botId = bot?.id;
  const liveOpponentId = liveOpponent?.id;
  const opponentId = opponent?.id;
  const meId = xapps.me.id;
  const hardClock = match.mode === "live";

  // Same template on both screens: an explicit setting wins, otherwise the match seed decides.
  const template = useMemo(() => pickTemplate(xapps.random.fork("meme-duel:template"), xapps.match.settings), [xapps]);

  const [phase, setPhase] = useState<"editing" | "locked">(() => (xapps.me.submitted ? "locked" : "editing"));
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [stickers, setStickers] = useState<EditorSticker[]>([]);
  const [finalEntry, setFinalEntry] = useState<MemeEntry | null>(null);
  const [humanTyping, setHumanTyping] = useState(false);
  const [lockedSignal, setLockedSignal] = useState(false);
  const [botTyping, setBotTyping] = useState(false);
  const [botLocked, setBotLocked] = useState(false);

  const submitted = useRef(xapps.me.submitted);
  const botDone = useRef(bot?.submitted ?? false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTypingSent = useRef(0);
  const readied = useRef(false);

  const opponentLocked = Boolean(opponent?.submitted) || lockedSignal || botLocked;
  const opponentTyping = !opponentLocked && (liveOpponentId ? humanTyping : botId ? botTyping : false);
  const opponentState: OpponentState = opponentLocked ? "locked" : opponentTyping ? "typing" : "idle";
  const voting = match.status === "voting";
  const outcome = result ? outcomeFor(result, meId) : null;

  useEffect(() => {
    if (readied.current) return;
    readied.current = true;
    xapps.ready().catch(() => {});
  }, [xapps]);

  /* ------------------------------ live room ----------------------------- */

  useRoomEvent("typing", (_payload, from) => {
    if (!liveOpponentId || from !== liveOpponentId) return;
    setHumanTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setHumanTyping(false), TYPING_IDLE_MS);
  });

  useRoomEvent("submitted", (_payload, from) => {
    if (from !== opponentId) return;
    clearTimeout(typingTimer.current);
    setHumanTyping(false);
    setLockedSignal(true);
  });

  useEffect(() => () => clearTimeout(typingTimer.current), []);

  /** Any edit: tell a live human opponent we're cooking (at most every ~1.2 s). */
  const onActivity = useCallback(() => {
    if (!liveOpponentId) return;
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_THROTTLE_MS) return;
    lastTypingSent.current = now;
    xapps.room.send("typing", {}).catch(() => {});
  }, [liveOpponentId, xapps]);

  // A little ping when the other side locks in.
  const announced = useRef(false);
  useEffect(() => {
    if (!started || !opponentLocked || announced.current) return;
    announced.current = true;
    play("notify");
    buzz("light");
  }, [started, opponentLocked, buzz]);

  /* --------------------------------- bot -------------------------------- */

  const submitBot = useCallback(() => {
    if (!botId || botDone.current) return;
    botDone.current = true;
    const entry = makeBotEntry(template, Math.random);
    setBotTyping(false);
    setBotLocked(true);
    xapps
      .submitFor(botId, {
        data: entryToJson(entry),
        display: { kind: "svg", svg: renderMemeSvg(entry), alt: entryAlt(entry) },
      })
      .catch(() => {
        botDone.current = false;
        setBotLocked(false);
      });
  }, [botId, template, xapps]);

  // On its own schedule: 15–40 s into the match…
  useEffect(() => {
    if (!started || !botId) return;
    const timer = setTimeout(submitBot, botSubmitDelayMs(Math.random));
    return () => clearTimeout(timer);
  }, [started, botId, submitBot]);

  // …or a few seconds after the human, whichever comes first.
  useEffect(() => {
    if (phase !== "locked" || !botId) return;
    const timer = setTimeout(submitBot, botFollowUpDelayMs(Math.random));
    return () => clearTimeout(timer);
  }, [phase, botId, submitBot]);

  // Cosmetic: the bot "cooks" in bursts until it submits.
  useEffect(() => {
    if (!started || !botId) return;
    let typing = false;
    let timer: ReturnType<typeof setTimeout>;
    const flip = () => {
      if (botDone.current) {
        setBotTyping(false);
        return;
      }
      typing = !typing;
      setBotTyping(typing);
      timer = setTimeout(flip, typing ? 2_200 + Math.random() * 3_800 : 1_200 + Math.random() * 3_000);
    };
    timer = setTimeout(flip, 900 + Math.random() * 1_400);
    return () => clearTimeout(timer);
  }, [started, botId]);

  /* ------------------------------- submit ------------------------------- */

  const submit = useCallback(async () => {
    if (submitted.current) return;
    submitted.current = true;
    const entry = sanitizeEntry({ templateId: template.id, captions, stickers }, template.id);
    setFinalEntry(entry);
    setPhase("locked");
    buzz("medium");
    try {
      await xapps.submit({
        data: entryToJson(entry),
        display: { kind: "svg", svg: renderMemeSvg(entry), alt: entryAlt(entry) },
      });
      if (liveOpponentId) xapps.room.send("submitted", {}).catch(() => {});
    } catch {
      submitted.current = false;
      setPhase("editing");
      play("error");
      buzz("error");
      xapps.ui.toast("Couldn't lock in your meme — try again", "danger").catch(() => {});
    }
  }, [buzz, captions, liveOpponentId, stickers, template.id, xapps]);

  /* --------------------------------- HUD -------------------------------- */

  const opponentHandle = opponent?.handle ?? "opponent";
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!started) return;
    const text =
      phase === "editing"
        ? "Caption the meme"
        : voting
          ? "Crowd is voting"
          : opponentLocked
            ? "Both memes are in"
            : `Waiting for @${opponentHandle}`;
    if (text === lastStatus.current) return;
    lastStatus.current = text;
    xapps.ui.setStatus(text).catch(() => {});
  }, [started, phase, voting, opponentLocked, opponentHandle, xapps]);

  useEffect(() => {
    if (!outcome) return;
    play(outcome === "win" ? "win" : outcome === "lose" ? "lose" : "draw");
  }, [outcome]);

  /* ------------------------------- render ------------------------------- */

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden" style={{ fontFamily: APP_FONT }}>
      <AnimatePresence mode="wait" initial={false}>
        {!started ? (
          <Pregame key="pregame" />
        ) : phase === "editing" ? (
          <Editor
            key="editor"
            template={template}
            captions={captions}
            setCaptions={setCaptions}
            stickers={stickers}
            setStickers={setStickers}
            onActivity={onActivity}
            onSubmit={submit}
            modeHint={
              hardClock
                ? "Live duel · auto-submits at 0:00"
                : match.mode === "async"
                  ? "Async · they play on their own time"
                  : "Practice vs bot · no pressure"
            }
            opponent={<OpponentPill player={opponent} state={opponentState} />}
            timer={
              <Countdown
                durationMs={hardClock ? LIVE_TIME_MS : SOFT_TIME_MS}
                running={started && phase === "editing"}
                hard={hardClock}
                onExpire={() => {
                  if (hardClock) void submit();
                }}
              />
            }
          />
        ) : (
          <LockedScreen
            key="locked"
            entry={finalEntry}
            opponent={opponent}
            opponentLocked={opponentLocked}
            opponentTyping={opponentTyping}
            voting={voting}
            outcome={outcome}
            mode={match.mode}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
