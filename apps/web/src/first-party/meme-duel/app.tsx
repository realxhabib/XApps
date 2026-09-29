"use client";

import { useMatch, useMatchResult, useMatchStarted, useRoomEvent, useXApps } from "@xapps/sdk/react";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBot, useLiveOpponent } from "@/first-party/shared/hooks";
import { play } from "@/lib/sfx";
import { Editor } from "./editor";
import { LockedScreen, type LockedMeme } from "./locked";
import {
  LIVE_TIME_MS,
  SOFT_TIME_MS,
  TYPING_IDLE_MS,
  TYPING_THROTTLE_MS,
  botFollowUpDelayMs,
  botSubmitDelayMs,
  makeBotEntry,
  outcomeFor,
  resolveTemplate,
  sanitizeEntry,
} from "./logic";
import { DROP_TEMPLATE_ID } from "./photo-templates";
import { Countdown, OpponentPill, useBuzz, type OpponentState } from "./pieces";
import { Pregame } from "./pregame";
import { remixTemplate, type RemixImage } from "./remix";
import { parseRound } from "./round";
import { MemeSetup } from "./setup";
import type { EditorSticker } from "./stickers";
import { buildSubmission } from "./submission";
import { canvasOf, type CaptionPosition } from "./templates";

/** Color emoji fonts ahead of the system fallbacks (some ship monochrome emoji glyphs). */
const APP_FONT =
  "var(--font-geist-sans), 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', ui-sans-serif, system-ui, sans-serif";

/**
 * Meme Duel. In setup purpose (the challenge sheet) it renders the round
 * setup screen; otherwise the match.
 */
export function MemeDuelApp() {
  const xapps = useXApps();
  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden" style={{ fontFamily: APP_FONT }}>
      {xapps.purpose === "setup" ? <MemeSetup /> : <MemeDuelMatch />}
    </div>
  );
}

/**
 * The match: both players caption the same image (a real template picked by
 * the match seed, the challenger's pick, or an image they dropped), add up to
 * three stickers and submit a self-contained SVG for the Arena crowd to vote on.
 *
 * Live sync (vs a human): `typing` (throttled, while editing) and `submitted`
 * room events drive the opponent pill. Bots are played locally and submit
 * with `submitFor` shortly after the human (or 15–40 s in).
 */
function MemeDuelMatch() {
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

  // Same image on both screens: a drop or explicit template wins, otherwise the match seed decides.
  const round = useMemo(() => parseRound(xapps.match.settings), [xapps]);
  const template = useMemo(() => resolveTemplate(xapps.random.fork("meme-duel:template"), round), [xapps, round]);
  // The player's own upload replaces the template for their entry only (the bot and opponent keep `template`).
  const [remix, setRemix] = useState<RemixImage | null>(null);
  const entryTemplate = useMemo(() => (remix ? remixTemplate(template, remix) : template), [remix, template]);

  const [phase, setPhase] = useState<"editing" | "locked">(() => (xapps.me.submitted ? "locked" : "editing"));
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [positions, setPositions] = useState<Record<string, CaptionPosition>>({});
  const [stickers, setStickers] = useState<EditorSticker[]>([]);
  const [finalMeme, setFinalMeme] = useState<LockedMeme | null>(null);
  const [locking, setLocking] = useState(false);
  const [botRetry, setBotRetry] = useState(0);
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
    // Photo entries reuse the image the player's editor already encoded.
    buildSubmission(entry, template, round)
      .then((built) => xapps.submitFor(botId, built.submission))
      .catch(() => {
        botDone.current = false;
        setBotLocked(false);
        setBotRetry((n) => n + 1);
      });
  }, [botId, round, template, xapps]);

  // On its own schedule: 15–40 s into the match (or a few seconds after a failed try)…
  useEffect(() => {
    if (!started || !botId) return;
    const timer = setTimeout(submitBot, botRetry > 0 ? 4_000 : botSubmitDelayMs(Math.random));
    return () => clearTimeout(timer);
  }, [started, botId, submitBot, botRetry]);

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
    const entry = sanitizeEntry({ templateId: entryTemplate.id, captions, stickers, positions }, entryTemplate);
    const fail = (message: string) => {
      submitted.current = false;
      setLocking(false);
      setPhase("editing");
      play("error");
      buzz("error");
      xapps.ui.toast(message, "danger").catch(() => {});
    };
    // Packing the photo into the entry is usually instant (pre-encoded while editing).
    setLocking(true);
    let built: Awaited<ReturnType<typeof buildSubmission>>;
    try {
      built = await buildSubmission(entry, entryTemplate, round, xapps.me.handle);
    } catch {
      fail("Couldn't attach the image — check your connection and try again");
      return;
    }
    const canvas = canvasOf(entryTemplate);
    setFinalMeme({ svg: built.svg, alt: built.alt, aspect: canvas.height / canvas.width });
    setLocking(false);
    setPhase("locked");
    buzz("medium");
    try {
      await xapps.submit(built.submission);
      if (liveOpponentId) xapps.room.send("submitted", {}).catch(() => {});
    } catch {
      fail("Couldn't lock in your meme — try again");
    }
  }, [buzz, captions, entryTemplate, liveOpponentId, positions, round, stickers, xapps]);

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
    <>
      <AnimatePresence mode="wait" initial={false}>
        {!started ? (
          <Pregame key="pregame" topic={round.topic} drop={template.id === DROP_TEMPLATE_ID} />
        ) : phase === "editing" ? (
          <Editor
            key="editor"
            template={entryTemplate}
            baseTemplate={template}
            remix={remix}
            onRemix={setRemix}
            round={round}
            captions={captions}
            setCaptions={setCaptions}
            positions={positions}
            setPositions={setPositions}
            locking={locking}
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
            meme={finalMeme}
            opponent={opponent}
            opponentLocked={opponentLocked}
            opponentTyping={opponentTyping}
            voting={voting}
            outcome={outcome}
            mode={match.mode}
          />
        )}
      </AnimatePresence>
    </>
  );
}
