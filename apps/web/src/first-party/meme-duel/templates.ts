/**
 * Original meme templates, drawn entirely with gradients, shapes and emoji so
 * every entry renders as a small, self-contained SVG. The same renderer runs
 * in the editor, in the Arena and in share previews.
 *
 * Real photo templates (Drake, Distracted Boyfriend…) live in
 * `photo-templates.ts` and share these types: a photo template is a
 * `MemeTemplate` with a `photo` and its own `canvas` size.
 */
import { PHOTO_TEMPLATES } from "./photo-templates";

export type CaptionStyle = "impact" | "label" | "post";

export interface CaptionSlot {
  id: string;
  placeholder: string;
  /** Short name shown next to the editor input, e.g. "Top text". */
  label?: string;
  /** Fixed text shown before the caption, e.g. "POV:" */
  prefix?: string;
  x: number;
  y: number;
  width: number;
  maxLines: number;
  size: number;
  align: "start" | "middle";
  /**
   * How the text block hangs off `y`: its top edge, its middle or its bottom
   * edge. Defaults to "top" for "post" captions and "middle" otherwise.
   */
  valign?: "top" | "middle" | "bottom";
  style: CaptionStyle;
  maxLength: number;
  /** Text color for "post" and "label" captions. */
  color?: string;
  /** Font weight for "post" captions (default 600). */
  weight?: number;
  /** Impact captions are uppercased unless this is set (mOcKiNg SpOnGeBoB). */
  keepCase?: boolean;
}

export type SceneElement =
  | { kind: "emoji"; char: string; x: number; y: number; size: number; rotate?: number; opacity?: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number; r?: number; fill: string; stroke?: string; opacity?: number }
  | { kind: "circle"; cx: number; cy: number; r: number; fill: string; stroke?: string; opacity?: number }
  | {
      kind: "text";
      text: string;
      x: number;
      y: number;
      size: number;
      fill: string;
      weight?: number;
      anchor?: "start" | "middle";
      font?: "sans" | "impact";
      /** Meme-style outline around the glyphs. */
      stroke?: string;
    };

/** A real image under the captions: a photo template or a dropped image. */
export interface MemePhoto {
  /** Original URL (https, or a data:image URL for demo drops). Always load it through `memeImageUrl()`. */
  src: string;
  width: number;
  height: number;
  /** Where a drop came from (shown in the editor). */
  credit?: { handle: string; url: string } | null;
}

export interface MemeTemplate {
  id: string;
  name: string;
  background: [string, string];
  scene: SceneElement[];
  slots: CaptionSlot[];
  /** Canvas size in SVG units. Originals are 600×600; photos follow their aspect ratio. */
  canvas?: { width: number; height: number };
  /** Photo templates and drops: the image filling the canvas. Their captions can be dragged around. */
  photo?: MemePhoto;
}

/** The canvas of the original templates. Use `canvasOf(template)` for anything that may be a photo. */
export const CANVAS = { width: 600, height: 600 } as const;

export function canvasOf(template: Pick<MemeTemplate, "canvas">): { width: number; height: number } {
  return template.canvas ?? CANVAS;
}

/** Classic white-with-black-outline caption spanning the canvas. */
const impact = (id: string, placeholder: string, y: number, extra: Partial<CaptionSlot> = {}): CaptionSlot => ({
  id,
  placeholder,
  x: 300,
  y,
  width: 556,
  maxLines: 2,
  size: 50,
  align: "middle",
  style: "impact",
  maxLength: 70,
  ...extra,
});

export const MEME_TEMPLATES: MemeTemplate[] = [
  {
    id: "stone-face",
    name: "Stone Face",
    background: ["#1b2a4a", "#0b1020"],
    scene: [
      { kind: "circle", cx: 300, cy: 318, r: 178, fill: "#2c3f6b", opacity: 0.5 },
      { kind: "circle", cx: 300, cy: 318, r: 128, fill: "#3b5288", opacity: 0.35 },
      { kind: "emoji", char: "🗿", x: 300, y: 322, size: 230 },
    ],
    slots: [
      impact("top", "top text", 22, { label: "Top text", valign: "top" }),
      impact("bottom", "bottom text", 580, { label: "Bottom text", valign: "bottom" }),
    ],
  },
  {
    id: "expectation-reality",
    name: "Expectation vs Reality",
    background: ["#0f172a", "#111827"],
    scene: [
      { kind: "rect", x: 16, y: 16, w: 278, h: 568, r: 22, fill: "#1e3a8a" },
      { kind: "rect", x: 306, y: 16, w: 278, h: 568, r: 22, fill: "#7c2d12" },
      { kind: "text", text: "EXPECTATION", x: 155, y: 64, size: 26, fill: "#bfdbfe", weight: 900, anchor: "middle" },
      { kind: "text", text: "REALITY", x: 445, y: 64, size: 26, fill: "#fed7aa", weight: 900, anchor: "middle" },
      { kind: "emoji", char: "🏋️", x: 155, y: 250, size: 150 },
      { kind: "emoji", char: "🛋️", x: 445, y: 250, size: 150 },
    ],
    slots: [
      { id: "left", label: "Expectation", placeholder: "the plan", x: 155, y: 462, width: 238, maxLines: 4, size: 30, align: "middle", style: "label", maxLength: 60 },
      { id: "right", label: "Reality", placeholder: "what happened", x: 445, y: 462, width: 238, maxLines: 4, size: 30, align: "middle", style: "label", maxLength: 60 },
    ],
  },
  {
    id: "nobody-me",
    name: "Nobody: / Me:",
    background: ["#f8fafc", "#e2e8f0"],
    scene: [
      { kind: "text", text: "Nobody:", x: 40, y: 72, size: 34, fill: "#0f172a", weight: 600, anchor: "start", font: "sans" },
      { kind: "text", text: "Absolutely no one:", x: 40, y: 122, size: 34, fill: "#0f172a", weight: 600, anchor: "start", font: "sans" },
      { kind: "rect", x: 40, y: 250, w: 520, h: 320, r: 26, fill: "#0f172a" },
      { kind: "circle", cx: 300, cy: 410, r: 120, fill: "#1e293b" },
      { kind: "emoji", char: "🕺", x: 300, y: 412, size: 210 },
    ],
    slots: [
      { id: "me", label: "Me", placeholder: "narrating my life like a nature documentary", prefix: "Me:", x: 40, y: 146, width: 520, maxLines: 2, size: 34, align: "start", style: "post", maxLength: 70 },
    ],
  },
  {
    id: "pov",
    name: "POV",
    background: ["#2e1065", "#020617"],
    scene: [
      { kind: "circle", cx: 300, cy: 410, r: 230, fill: "none", stroke: "#a78bfa", opacity: 0.35 },
      { kind: "circle", cx: 300, cy: 410, r: 160, fill: "#4c1d95", opacity: 0.35 },
      { kind: "emoji", char: "👀", x: 300, y: 410, size: 250 },
    ],
    slots: [
      { id: "pov", label: "POV", placeholder: "you just…", prefix: "POV:", x: 40, y: 44, width: 520, maxLines: 3, size: 38, align: "start", style: "post", maxLength: 90, color: "#f5f3ff" },
    ],
  },
  {
    id: "two-buttons",
    name: "Two Buttons",
    background: ["#fde68a", "#f59e0b"],
    scene: [
      { kind: "rect", x: 40, y: 40, w: 520, h: 250, r: 28, fill: "#fff7ed" },
      { kind: "circle", cx: 170, cy: 165, r: 94, fill: "#b91c1c" },
      { kind: "circle", cx: 430, cy: 165, r: 94, fill: "#b91c1c" },
      { kind: "circle", cx: 170, cy: 155, r: 92, fill: "#ef4444", stroke: "#7f1d1d" },
      { kind: "circle", cx: 430, cy: 155, r: 92, fill: "#ef4444", stroke: "#7f1d1d" },
      { kind: "emoji", char: "😰", x: 300, y: 452, size: 200 },
      { kind: "emoji", char: "👆", x: 150, y: 372, size: 80, rotate: -18 },
    ],
    slots: [
      { id: "a", label: "Button A", placeholder: "option A", x: 170, y: 155, width: 148, maxLines: 4, size: 28, align: "middle", style: "impact", maxLength: 40 },
      { id: "b", label: "Button B", placeholder: "option B", x: 430, y: 155, width: 148, maxLines: 4, size: 28, align: "middle", style: "impact", maxLength: 40 },
    ],
  },
  {
    id: "brain-levels",
    name: "Brain Levels",
    background: ["#0b1026", "#000000"],
    scene: [
      { kind: "rect", x: 360, y: 20, w: 220, h: 180, r: 18, fill: "#1e293b" },
      { kind: "rect", x: 360, y: 210, w: 220, h: 180, r: 18, fill: "#312e81" },
      { kind: "rect", x: 360, y: 400, w: 220, h: 180, r: 18, fill: "#6d28d9" },
      { kind: "circle", cx: 470, cy: 490, r: 80, fill: "#c4b5fd", opacity: 0.25 },
      { kind: "emoji", char: "🧠", x: 470, y: 112, size: 70, opacity: 0.55 },
      { kind: "emoji", char: "🧠", x: 470, y: 302, size: 104, opacity: 0.85 },
      { kind: "emoji", char: "🌌", x: 470, y: 492, size: 132 },
    ],
    slots: [
      { id: "one", label: "Small brain", placeholder: "normal idea", x: 180, y: 110, width: 316, maxLines: 3, size: 30, align: "middle", style: "label", maxLength: 50 },
      { id: "two", label: "Big brain", placeholder: "smarter idea", x: 180, y: 300, width: 316, maxLines: 3, size: 30, align: "middle", style: "label", maxLength: 50 },
      { id: "three", label: "Galaxy brain", placeholder: "galaxy idea", x: 180, y: 490, width: 316, maxLines: 3, size: 30, align: "middle", style: "label", maxLength: 50 },
    ],
  },
  {
    id: "villain-origin",
    name: "Villain Origin Story",
    background: ["#450a0a", "#0c0a09"],
    scene: [
      { kind: "circle", cx: 300, cy: 330, r: 170, fill: "#991b1b", opacity: 0.55 },
      { kind: "circle", cx: 300, cy: 330, r: 110, fill: "#dc2626", opacity: 0.25 },
      { kind: "emoji", char: "😈", x: 300, y: 336, size: 210 },
      { kind: "text", text: "MY VILLAIN ORIGIN STORY:", x: 300, y: 76, size: 38, fill: "#ffffff", weight: 900, anchor: "middle", font: "impact", stroke: "#000000" },
    ],
    slots: [impact("origin", "what started it", 580, { label: "What started it", valign: "bottom", size: 46 })],
  },
  {
    id: "bar-chart",
    name: "The Chart",
    background: ["#ecfeff", "#cffafe"],
    scene: [
      { kind: "text", text: "a completely scientific chart", x: 300, y: 62, size: 28, fill: "#0f172a", weight: 700, anchor: "middle", font: "sans" },
      { kind: "rect", x: 110, y: 104, w: 150, h: 336, r: 12, fill: "#0891b2" },
      { kind: "rect", x: 340, y: 412, w: 150, h: 28, r: 8, fill: "#f97316" },
      { kind: "rect", x: 60, y: 438, w: 480, h: 5, r: 2, fill: "#0f172a" },
    ],
    slots: [
      { id: "big", label: "Big bar", placeholder: "time spent on…", x: 185, y: 466, width: 214, maxLines: 3, size: 26, align: "middle", valign: "top", style: "label", maxLength: 40 },
      { id: "small", label: "Tiny bar", placeholder: "time spent on…", x: 415, y: 466, width: 214, maxLines: 3, size: 26, align: "middle", valign: "top", style: "label", maxLength: 40 },
    ],
  },
  {
    id: "nah-yeah",
    name: "Nah / Yeah",
    background: ["#fff7ed", "#fed7aa"],
    scene: [
      { kind: "rect", x: 16, y: 16, w: 260, h: 278, r: 22, fill: "#fdba74" },
      { kind: "rect", x: 16, y: 306, w: 260, h: 278, r: 22, fill: "#86efac" },
      { kind: "rect", x: 288, y: 16, w: 296, h: 278, r: 22, fill: "#ffffff" },
      { kind: "rect", x: 288, y: 306, w: 296, h: 278, r: 22, fill: "#ffffff" },
      { kind: "emoji", char: "🙅", x: 146, y: 136, size: 148 },
      { kind: "emoji", char: "😎", x: 128, y: 430, size: 148 },
      { kind: "emoji", char: "👉", x: 226, y: 462, size: 70 },
      { kind: "text", text: "NAH", x: 146, y: 276, size: 24, fill: "#7c2d12", weight: 900, anchor: "middle" },
      { kind: "text", text: "YEAH", x: 146, y: 564, size: 24, fill: "#14532d", weight: 900, anchor: "middle" },
    ],
    slots: [
      { id: "nah", label: "Nah", placeholder: "the sensible thing", x: 436, y: 155, width: 256, maxLines: 4, size: 32, align: "middle", valign: "middle", style: "post", weight: 800, maxLength: 60 },
      { id: "yeah", label: "Yeah", placeholder: "the chaotic thing", x: 436, y: 445, width: 256, maxLines: 4, size: 32, align: "middle", valign: "middle", style: "post", weight: 800, maxLength: 60 },
    ],
  },
  {
    id: "this-is-fine",
    name: "This Is Fine",
    background: ["#c2410c", "#1c0a05"],
    scene: [
      { kind: "rect", x: 0, y: 440, w: 600, h: 160, fill: "#431407", opacity: 0.7 },
      { kind: "emoji", char: "🔥", x: 54, y: 300, size: 90, rotate: -12 },
      { kind: "emoji", char: "🔥", x: 552, y: 286, size: 96, rotate: 10 },
      { kind: "emoji", char: "🔥", x: 70, y: 478, size: 124, rotate: -6 },
      { kind: "emoji", char: "🔥", x: 536, y: 470, size: 132, rotate: 6 },
      { kind: "emoji", char: "🔥", x: 196, y: 548, size: 84 },
      { kind: "emoji", char: "🔥", x: 408, y: 552, size: 90 },
      { kind: "rect", x: 338, y: 404, w: 170, h: 16, r: 6, fill: "#78350f" },
      { kind: "rect", x: 356, y: 418, w: 12, h: 90, fill: "#78350f" },
      { kind: "rect", x: 478, y: 418, w: 12, h: 90, fill: "#78350f" },
      { kind: "emoji", char: "🐶", x: 250, y: 392, size: 170 },
      { kind: "emoji", char: "☕", x: 440, y: 376, size: 60 },
      { kind: "rect", x: 322, y: 206, w: 212, h: 78, r: 39, fill: "#ffffff" },
      { kind: "circle", cx: 336, cy: 294, r: 11, fill: "#ffffff" },
      { kind: "circle", cx: 318, cy: 312, r: 6, fill: "#ffffff" },
      { kind: "text", text: "this is fine.", x: 428, y: 255, size: 30, fill: "#1c1917", weight: 800, anchor: "middle", font: "sans" },
    ],
    slots: [impact("top", "when the deadline is today", 24, { label: "What's on fire", valign: "top", size: 46 })],
  },
  {
    id: "change-my-mind",
    name: "Change My Mind",
    background: ["#7dd3fc", "#e0f2fe"],
    scene: [
      { kind: "rect", x: 0, y: 440, w: 600, h: 160, fill: "#65a30d" },
      { kind: "rect", x: 0, y: 440, w: 600, h: 10, fill: "#4d7c0f" },
      { kind: "rect", x: 176, y: 420, w: 14, h: 130, fill: "#78350f" },
      { kind: "rect", x: 516, y: 420, w: 14, h: 130, fill: "#78350f" },
      { kind: "rect", x: 150, y: 402, w: 404, h: 22, r: 6, fill: "#92400e" },
      { kind: "rect", x: 186, y: 120, w: 320, h: 268, r: 14, fill: "#fffbeb", stroke: "#1f2937" },
      { kind: "text", text: "CHANGE MY MIND", x: 346, y: 364, size: 30, fill: "#0f172a", weight: 900, anchor: "middle", font: "impact" },
      { kind: "emoji", char: "🧑", x: 92, y: 360, size: 150 },
      { kind: "emoji", char: "☕", x: 532, y: 378, size: 48 },
    ],
    slots: [
      { id: "sign", label: "The sign", placeholder: "cereal is a soup", x: 346, y: 226, width: 280, maxLines: 4, size: 34, align: "middle", valign: "middle", style: "post", weight: 800, maxLength: 70 },
    ],
  },
  {
    id: "tempted",
    name: "Tempted",
    background: ["#bae6fd", "#fef9c3"],
    scene: [
      { kind: "rect", x: 0, y: 470, w: 600, h: 130, fill: "#cbd5e1", opacity: 0.6 },
      { kind: "circle", cx: 122, cy: 340, r: 92, fill: "#fde047", opacity: 0.45 },
      { kind: "emoji", char: "🍩", x: 122, y: 340, size: 140 },
      { kind: "emoji", char: "✨", x: 50, y: 262, size: 50 },
      { kind: "emoji", char: "✨", x: 198, y: 420, size: 40 },
      { kind: "emoji", char: "😍", x: 300, y: 350, size: 140, rotate: -14 },
      { kind: "emoji", char: "📚", x: 484, y: 356, size: 124, opacity: 0.9 },
    ],
    slots: [
      { id: "shiny", label: "The shiny thing", placeholder: "the new thing", x: 124, y: 160, width: 206, maxLines: 3, size: 28, align: "middle", style: "label", maxLength: 40 },
      { id: "me", label: "Me", placeholder: "me", x: 300, y: 530, width: 260, maxLines: 2, size: 28, align: "middle", style: "label", maxLength: 40 },
      { id: "duty", label: "What I should do", placeholder: "what I should be doing", x: 478, y: 160, width: 206, maxLines: 3, size: 28, align: "middle", style: "label", maxLength: 40 },
    ],
  },
];

export const STICKERS = [
  "😂", "💀", "🔥", "😭", "🤡", "👀", "💯", "🫠", "🥲", "🙃",
  "😎", "🤯", "🫡", "🧢", "👑", "🍿", "🚀", "💸", "🐐", "✨",
  "📈", "📉", "🧠", "💅", "🤌", "🙏", "😤", "🥹", "🎯", "⚰️",
];

export interface StickerPlacement {
  emoji: string;
  /** 0..1 relative to canvas */
  x: number;
  y: number;
  scale: number;
  rotate: number;
}

/** Where a dragged caption sits: the center of its slot frame, 0..1 of the canvas. */
export interface CaptionPosition {
  x: number;
  y: number;
}

export interface MemeEntry {
  templateId: string;
  captions: Record<string, string>;
  stickers: StickerPlacement[];
  /** Photo templates/drops only: captions the player dragged away from their default spot. */
  positions?: Record<string, CaptionPosition>;
}

/** Any known template (original or photo) by id; unknown ids fall back to the first original. */
export function getTemplate(id: string): MemeTemplate {
  return (
    MEME_TEMPLATES.find((t) => t.id === id) ?? PHOTO_TEMPLATES.find((t) => t.id === id) ?? (MEME_TEMPLATES[0] as MemeTemplate)
  );
}

/* ---------------------------------------------------------------------- */
/* Bot captions                                                           */
/* ---------------------------------------------------------------------- */

export const BOT_CAPTIONS: Record<string, Record<string, string>[]> = {
  "stone-face": [
    { top: "when the group chat asks who's driving", bottom: "" },
    { top: "me reading the terms and conditions", bottom: "i accept" },
    { top: "my face when the wifi drops", bottom: "mid ranked match" },
    { top: "\"we should hang out more\"", bottom: "proceeds to never text" },
    { top: "when someone says the movie", bottom: "was better than the book" },
  ],
  "expectation-reality": [
    { left: "new year, new me", right: "same me, new excuses" },
    { left: "quick 5 minute nap", right: "wakes up in 2031" },
    { left: "meal prep sunday", right: "cereal for every meal" },
    { left: "learning guitar", right: "owning a guitar" },
  ],
  "nobody-me": [
    { me: "explaining the plot of a movie nobody asked about" },
    { me: "opening the fridge for the 9th time in an hour" },
    { me: "practicing an argument I lost in 2014" },
    { me: "saying 'you too' when the waiter says enjoy your meal" },
  ],
  pov: [
    { pov: "you said 'one more episode' four episodes ago" },
    { pov: "your code works and you don't know why" },
    { pov: "you hear your name in a conversation across the room" },
    { pov: "you wave back at someone who was waving at the person behind you" },
  ],
  "two-buttons": [
    { a: "sleep 8 hours", b: "one more scroll" },
    { a: "reply now", b: "reply in 3–5 business days" },
    { a: "save money", b: "limited edition" },
    { a: "fix the bug", b: "rename it a feature" },
  ],
  "brain-levels": [
    { one: "drinking water", two: "drinking sparkling water", three: "drinking the idea of water" },
    { one: "texting back", two: "voice memo back", three: "responding in person 3 weeks later" },
    { one: "setting an alarm", two: "setting five alarms", three: "becoming the alarm" },
  ],
  "villain-origin": [
    { origin: "someone said 'we need to talk'" },
    { origin: "they put raisins in the cookies" },
    { origin: "my phone at 1% with no charger" },
    { origin: "reply all" },
  ],
  "bar-chart": [
    { big: "planning to be productive", small: "being productive" },
    { big: "picking something to watch", small: "watching it" },
    { big: "watching tutorials", small: "doing the thing" },
    { big: "untangling earbuds", small: "listening to music" },
  ],
  "nah-yeah": [
    { nah: "doing the dishes", yeah: "letting them soak for 3 business days" },
    { nah: "reading the docs", yeah: "guessing until it works" },
    { nah: "paying for shipping", yeah: "adding $40 of stuff to get free shipping" },
    { nah: "going to bed early", yeah: "one more video about a game I'll never play" },
  ],
  "this-is-fine": [
    { top: "me pretending my inbox is under control" },
    { top: "when the group project is due in 1 hour" },
    { top: "my sleep schedule in week 3 of vacation" },
    { top: "checking my bank account after the weekend" },
  ],
  "change-my-mind": [
    { sign: "cereal is a soup" },
    { sign: "naps are a personality trait" },
    { sign: "the snooze button is self care" },
    { sign: "a hot dog is a taco" },
  ],
  tempted: [
    { shiny: "a brand new side project", me: "me", duty: "the 4 side projects I already started" },
    { shiny: "free samples", me: "me on a diet", duty: "the salad I packed" },
    { shiny: "a 3 hour video essay", me: "me at 1am", duty: "sleep" },
  ],
};
