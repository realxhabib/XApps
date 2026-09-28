import { containRect } from "./canvas";
import {
  canvasOf,
  getTemplate,
  type CaptionPosition,
  type CaptionSlot,
  type MemeEntry,
  type MemeTemplate,
  type SceneElement,
} from "./templates";

/**
 * Renders a meme entry to a self-contained SVG string. The host shows it
 * through `<img>` in the Arena, so everything (fonts, emoji, filters) must be
 * inline and every piece of user text must be XML-escaped.
 */

const FONT_EMOJI = "'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
const FONT_IMPACT = `Impact,Haettenschweiler,'Anton','Oswald','Arial Black','Helvetica Neue',Arial,sans-serif,${FONT_EMOJI}`;
const FONT_SANS = `'Helvetica Neue',Arial,'Segoe UI',system-ui,sans-serif,${FONT_EMOJI}`;

/** Base sticker glyph size in canvas units (scaled by `StickerPlacement.scale`). */
export const STICKER_SIZE = 72;

/* ---------------------------------------------------------------------- */
/* Escaping                                                               */
/* ---------------------------------------------------------------------- */

/** Drops characters XML 1.0 forbids (control chars, lone surrogates) so the SVG stays well-formed. */
function stripInvalidXml(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value[i]! + value[i + 1]!;
        i++;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    if (code === 0xfffe || code === 0xffff) continue;
    out += value[i]!;
  }
  return out;
}

export function escapeXml(value: string): string {
  return stripInvalidXml(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/* ---------------------------------------------------------------------- */
/* Text measurement                                                       */
/* ---------------------------------------------------------------------- */

/**
 * Advance widths (1/1000 em) of a bold grotesque (Helvetica/Arial Bold). It
 * is a deliberately conservative model: Impact is narrower, so text measured
 * this way fits on every platform, whichever fallback font actually renders.
 */
const WIDTH_GROUPS: [number, string][] = [
  [238, "'"],
  [278, " ,./\\Iijl‘’"],
  [280, "|"],
  [333, "!()-:;[]`ft¡"],
  [389, "*r{}"],
  [474, '"'],
  [500, "z“”"],
  [556, "#$0123456789_acekJsvxy–€£"],
  [584, "+<=>^~×÷"],
  [611, "?FLTZbdghnopqu¿"],
  [667, "EPSVXY"],
  [722, "&ABCDHKNRU"],
  [778, "GOQw"],
  [833, "M"],
  [889, "%m"],
  [944, "W"],
  [975, "@"],
  [1000, "—…"],
];
const GLYPH_WIDTHS = new Map<string, number>();
for (const [width, chars] of WIDTH_GROUPS) for (const ch of chars) GLYPH_WIDTHS.set(ch, width / 1000);

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

type Segmenter = { segment(input: string): Iterable<{ segment: string }> };
let segmenter: Segmenter | null | undefined;

/** User-perceived characters, so emoji sequences (👨‍👩‍👧, 🏳️‍🌈) are never split. */
export function graphemes(text: string): string[] {
  if (segmenter === undefined) {
    segmenter =
      typeof Intl !== "undefined" && "Segmenter" in Intl
        ? (new Intl.Segmenter(undefined, { granularity: "grapheme" }) as Segmenter)
        : null;
  }
  if (!segmenter) return Array.from(text);
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    code >= 0x20000
  );
}

/** Width of one grapheme in em. */
function glyphWidth(g: string): number {
  const direct = GLYPH_WIDTHS.get(g);
  if (direct !== undefined) return direct;
  if (EMOJI.test(g)) return 1.25;
  const base = g.normalize("NFD").charAt(0);
  const fromBase = GLYPH_WIDTHS.get(base);
  if (fromBase !== undefined) return fromBase;
  return isWide(g.codePointAt(0) ?? 0) ? 1 : 0.66;
}

function measure(text: string, size: number, spacing: number): number {
  let em = 0;
  let count = 0;
  for (const g of graphemes(text)) {
    em += glyphWidth(g);
    count++;
  }
  return em * size + spacing * count;
}

interface Wrapped {
  lines: string[];
  /** True when a word was wider than a line and had to be broken apart. */
  split: boolean;
}

/** Greedy wrap at `maxWidth`; words wider than a line are split between graphemes. */
function wrap(text: string, maxWidth: number, size: number, spacing: number): Wrapped {
  const lines: string[] = [];
  const spaceWidth = measure(" ", size, spacing);
  let split = false;
  let current = "";
  let currentWidth = 0;
  for (const word of text.split(" ")) {
    const wordWidth = measure(word, size, spacing);
    if (wordWidth > maxWidth) {
      split = true;
      if (current) lines.push(current);
      current = "";
      currentWidth = 0;
      for (const g of graphemes(word)) {
        const w = measure(g, size, spacing);
        if (current && currentWidth + w > maxWidth) {
          lines.push(current);
          current = "";
          currentWidth = 0;
        }
        current += g;
        currentWidth += w;
      }
      continue;
    }
    if (!current) {
      current = word;
      currentWidth = wordWidth;
    } else if (currentWidth + spaceWidth + wordWidth <= maxWidth) {
      current += ` ${word}`;
      currentWidth += spaceWidth + wordWidth;
    } else {
      lines.push(current);
      current = word;
      currentWidth = wordWidth;
    }
  }
  if (current) lines.push(current);
  return { lines, split };
}

/** Narrowest wrap width that keeps the same number of lines (like CSS `text-wrap: balance`). */
function balance(text: string, maxWidth: number, size: number, spacing: number, count: number): string[] {
  // Never go narrower than the widest word, or balancing would break words apart.
  const widestWord = Math.max(...text.split(" ").map((word) => measure(word, size, spacing)));
  if (widestWord >= maxWidth) return wrap(text, maxWidth, size, spacing).lines;
  let lo = Math.max(maxWidth * 0.35, widestWord);
  let hi = maxWidth;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (wrap(text, mid, size, spacing).lines.length <= count) hi = mid;
    else lo = mid;
  }
  return wrap(text, hi, size, spacing).lines;
}

function letterSpacing(slot: CaptionSlot): number {
  return slot.style === "impact" ? 0.5 : 0;
}

/** The text a slot actually draws: impact captions are uppercase (unless `keepCase`), whitespace is collapsed. */
export function normalizeCaptionText(slot: CaptionSlot, raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  return slot.style === "impact" && !slot.keepCase ? text.toUpperCase() : text;
}

/**
 * Wraps a caption into the slot, shrinking the font until it fits
 * `slot.maxLines` lines of `slot.width`. Centered captions are balanced so
 * lines come out roughly even.
 */
export function layoutCaption(slot: CaptionSlot, raw: string): { lines: string[]; size: number; widths: number[] } {
  const text = normalizeCaptionText(slot, raw);
  if (!text) return { lines: [], size: slot.size, widths: [] };
  const spacing = letterSpacing(slot);
  // A little breathing room: glyph outlines (impact stroke) extend past the advance widths.
  const maxWidth = slot.width * 0.97;
  const floor = Math.max(12, Math.round(slot.size * 0.42));
  let size = slot.size;
  let wrapped = wrap(text, maxWidth, size, spacing);
  // Shrink until it fits, preferring a smaller font over breaking a word in two.
  while ((wrapped.lines.length > slot.maxLines || (wrapped.split && size > floor)) && size > 10) {
    // Below the comfortable floor only pathological input (walls of "W") keeps shrinking.
    size = size > floor ? Math.max(floor, Math.floor(size * 0.93)) : size - 1;
    wrapped = wrap(text, maxWidth, size, spacing);
  }
  let lines = wrapped.lines;
  if (lines.length > 1 && slot.align === "middle") lines = balance(text, maxWidth, size, spacing, lines.length);
  return { lines, size, widths: lines.map((line) => measure(line, size, spacing)) };
}

function lineHeightFor(slot: CaptionSlot, size: number): number {
  return size * (slot.style === "impact" ? 1.08 : 1.22);
}

function valignFor(slot: CaptionSlot): "top" | "middle" | "bottom" {
  return slot.valign ?? (slot.style === "post" ? "top" : "middle");
}

/**
 * The area a slot's text can occupy at full size, in canvas units. Used by the
 * editor to highlight the slot being typed into and to keep stickers off it.
 */
export function slotFrame(slot: CaptionSlot): { x: number; y: number; width: number; height: number } {
  const height = lineHeightFor(slot, slot.size) * slot.maxLines;
  const valign = valignFor(slot);
  const y = valign === "top" ? slot.y : valign === "bottom" ? slot.y - height : slot.y - height / 2;
  const x = slot.align === "middle" ? slot.x - slot.width / 2 : slot.x;
  return { x, y, width: slot.width, height };
}

/** Center of a slot's frame in canvas units: where a caption sits before anyone drags it. */
export function slotCenter(slot: CaptionSlot): { x: number; y: number } {
  const f = slotFrame(slot);
  return { x: f.x + f.width / 2, y: f.y + f.height / 2 };
}

/**
 * The slot moved so its frame is centered on `position` (0..1 of the canvas).
 * No position (or junk) leaves the slot where the template put it.
 */
export function positionedSlot(slot: CaptionSlot, canvas: { width: number; height: number }, position?: CaptionPosition): CaptionSlot {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return slot;
  const center = slotCenter(slot);
  const dx = position.x * canvas.width - center.x;
  const dy = position.y * canvas.height - center.y;
  if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return slot;
  const r = (v: number) => Math.round(v * 10) / 10;
  return { ...slot, x: r(slot.x + dx), y: r(slot.y + dy) };
}

/* ---------------------------------------------------------------------- */
/* SVG                                                                    */
/* ---------------------------------------------------------------------- */

const num = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

function renderScene(el: SceneElement): string {
  switch (el.kind) {
    case "emoji":
      return `<text x="${el.x}" y="${el.y}" font-size="${el.size}" text-anchor="middle" dominant-baseline="central" font-family="${FONT_EMOJI}"${
        el.rotate ? ` transform="rotate(${el.rotate} ${el.x} ${el.y})"` : ""
      }${el.opacity !== undefined ? ` opacity="${el.opacity}"` : ""}>${escapeXml(el.char)}</text>`;
    case "rect":
      return `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="${el.r ?? 0}" fill="${el.fill}"${
        el.stroke ? ` stroke="${el.stroke}" stroke-width="6"` : ""
      }${el.opacity !== undefined ? ` opacity="${el.opacity}"` : ""}/>`;
    case "circle":
      return `<circle cx="${el.cx}" cy="${el.cy}" r="${el.r}" fill="${el.fill}"${
        el.stroke ? ` stroke="${el.stroke}" stroke-width="8"` : ""
      }${el.opacity !== undefined ? ` opacity="${el.opacity}"` : ""}/>`;
    case "text":
      return `<text x="${el.x}" y="${el.y}" font-size="${el.size}" fill="${el.fill}" font-weight="${el.weight ?? 700}" text-anchor="${
        el.anchor ?? "middle"
      }" font-family="${el.font === "impact" ? FONT_IMPACT : FONT_SANS}"${
        el.stroke
          ? ` stroke="${el.stroke}" stroke-width="${num(el.size / 8)}" stroke-linejoin="round" paint-order="stroke"`
          : ""
      }>${escapeXml(el.text)}</text>`;
  }
}

function renderCaption(slot: CaptionSlot, value: string, placeholder: boolean): string {
  const typed = value.trim().length > 0;
  const source = typed ? value : placeholder ? slot.placeholder : "";
  if (!source) return "";
  const dim = !typed;
  const prefix = slot.prefix ? normalizeCaptionText(slot, slot.prefix) : "";
  const { lines, size, widths } = layoutCaption(slot, prefix ? `${prefix} ${source}` : source);
  if (lines.length === 0) return "";

  const lineHeight = lineHeightFor(slot, size);
  const blockHeight = lineHeight * lines.length;
  const valign = valignFor(slot);
  const top = valign === "top" ? slot.y : valign === "bottom" ? slot.y - blockHeight : slot.y - blockHeight / 2;
  // Center cap-height glyphs inside each line box.
  const baselineOffset = (lineHeight + size * 0.72) / 2;

  const tspans = lines
    .map((line, i) => {
      const y = num(top + i * lineHeight + baselineOffset);
      // Keep a fixed prefix ("POV:") bold and fully opaque even on a placeholder.
      if (i === 0 && prefix && line.startsWith(prefix)) {
        const rest = line.slice(prefix.length);
        return `<tspan x="${slot.x}" y="${y}"><tspan font-weight="800">${escapeXml(prefix)}</tspan>${
          rest ? (dim ? `<tspan fill-opacity="0.4">${escapeXml(rest)}</tspan>` : escapeXml(rest)) : ""
        }</tspan>`;
      }
      return `<tspan x="${slot.x}" y="${y}"${dim && prefix ? ` fill-opacity="0.4"` : ""}>${escapeXml(line)}</tspan>`;
    })
    .join("");
  const groupOpacity = dim && !prefix ? ` opacity="${slot.style === "label" ? 0.55 : 0.4}"` : "";
  const open = `<g data-slot="${escapeXml(slot.id)}"${groupOpacity}>`;

  if (slot.style === "impact") {
    return `${open}<text font-family="${FONT_IMPACT}" font-size="${num(size)}" font-weight="900" fill="#fff" stroke="#000" stroke-width="${num(
      Math.max(3, size / 8),
    )}" stroke-linejoin="round" paint-order="stroke" text-anchor="${slot.align}" letter-spacing="${letterSpacing(slot)}">${tspans}</text></g>`;
  }
  if (slot.style === "label") {
    // A sticker-like tag hugging the text, with a crisp offset shadow.
    const padX = size * 0.5;
    const padY = size * 0.28;
    const width = Math.min(slot.width, Math.max(...widths, size * 2)) + padX * 2;
    const height = blockHeight + padY * 2;
    const left = slot.align === "middle" ? slot.x - width / 2 : slot.x - padX;
    const radius = Math.min(16, height / 2);
    return `${open}<rect x="${num(left)}" y="${num(top - padY + 4)}" width="${num(width)}" height="${num(
      height,
    )}" rx="${num(radius)}" fill="#000" opacity="0.2"/><rect x="${num(left)}" y="${num(top - padY)}" width="${num(width)}" height="${num(
      height,
    )}" rx="${num(radius)}" fill="#ffffff"/><text font-family="${FONT_SANS}" font-size="${num(size)}" font-weight="800" fill="${
      slot.color ?? "#0f172a"
    }" text-anchor="${slot.align}">${tspans}</text></g>`;
  }
  // "post": plain text like a post on the timeline
  return `${open}<text font-family="${FONT_SANS}" font-size="${num(size)}" font-weight="${slot.weight ?? 600}" fill="${
    slot.color ?? "#0f172a"
  }" text-anchor="${slot.align}">${tspans}</text></g>`;
}

/**
 * Die-cut sticker look: a white outline plus a soft drop shadow. One filter
 * per sticker so the outline grows with the sticker, exactly like the editor's
 * CSS version (which scales the whole element).
 */
function stickerFilter(id: string, scale: number): string {
  const r = num(4 * scale);
  return (
    `<filter id="${id}" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB">` +
    `<feMorphology in="SourceAlpha" operator="dilate" radius="${r}" result="grown"/>` +
    `<feFlood flood-color="#ffffff"/><feComposite in2="grown" operator="in" result="outline"/>` +
    `<feGaussianBlur in="grown" stdDeviation="${num(4 * scale)}" result="blur"/><feOffset in="blur" dy="${num(5 * scale)}" result="drop"/>` +
    `<feFlood flood-color="#000000" flood-opacity="0.35"/><feComposite in2="drop" operator="in" result="shadow"/>` +
    `<feMerge><feMergeNode in="shadow"/><feMergeNode in="outline"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
  );
}

/** Cuts a caption to `max` UTF-16 units without splitting a surrogate pair. */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const code = value.charCodeAt(max - 1);
  return value.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

export interface RenderOptions {
  /** Show slot placeholders for empty captions (editor preview). */
  placeholders?: boolean;
  /** Leave stickers out (the editor draws them as draggable HTML). */
  withoutStickers?: boolean;
  /** Leave captions out (the editor draws photo captions as draggable pieces). */
  withoutCaptions?: boolean;
  /** Transparent background: no gradient/backdrop, no photo (the editor shows the photo as an <img>). */
  withoutBackground?: boolean;
  /**
   * The resolved template, for templates that aren't in the catalog (drops).
   * Defaults to `getTemplate(entry.templateId)`.
   */
  template?: MemeTemplate;
  /**
   * Photo templates: the image as a data URL (`data:image/jpeg;base64,…`).
   * Entries must be self-contained, so a remote URL is never embedded.
   */
  imageHref?: string;
  /** Accessible title embedded in the SVG (e.g. the topic and captions). */
  title?: string;
}

/** Only inline raster data URLs may be embedded (an <img>-rendered SVG can't fetch anything else anyway). */
const EMBEDDABLE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

/** One caption on its own, for the editor's draggable captions: an SVG whose viewBox is the slot's frame. */
export function renderCaptionSvg(slot: CaptionSlot, value: string, placeholder: boolean, pad = 0): string {
  const f = slotFrame(slot);
  const inner = renderCaption(slot, truncate(value, slot.maxLength), placeholder);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(f.x - pad)} ${num(f.y - pad)} ${num(f.width + pad * 2)} ${num(
    f.height + pad * 2,
  )}" overflow="visible">${inner}</svg>`;
}

export function renderMemeSvg(entry: MemeEntry, options: RenderOptions = {}): string {
  const template: MemeTemplate = options.template ?? getTemplate(entry.templateId);
  const canvas = canvasOf(template);
  const [from, to] = template.background;
  const scene = template.scene.map(renderScene).join("");
  let photo = "";
  if (template.photo && !options.withoutBackground && options.imageHref && EMBEDDABLE.test(options.imageHref)) {
    const r = containRect(canvas, template.photo.width, template.photo.height);
    photo = `<image href="${options.imageHref}" x="${num(r.x)}" y="${num(r.y)}" width="${num(r.width)}" height="${num(
      r.height,
    )}" preserveAspectRatio="none"/>`;
  }
  const positions = template.photo ? entry.positions : undefined;
  const captions = options.withoutCaptions
    ? ""
    : template.slots
        .map((base) => {
          const slot = positionedSlot(base, canvas, positions?.[base.id]);
          const raw = entry.captions[slot.id];
          return renderCaption(slot, truncate(typeof raw === "string" ? raw : "", slot.maxLength), !!options.placeholders);
        })
        .join("");
  const stickerList = options.withoutStickers ? [] : entry.stickers.slice(0, 3);
  let filters = "";
  const stickers = stickerList
    .map((s, i) => {
      // Entries can come from anywhere (stored data, other clients): never let NaN reach the markup.
      const scale = finite(s.scale, 1);
      const x = num(finite(s.x, 0.5) * canvas.width);
      const y = num(finite(s.y, 0.5) * canvas.height);
      const rotate = finite(s.rotate, 0).toFixed(1);
      filters += stickerFilter(`sticker${i}`, scale);
      return `<text x="${x}" y="${y}" font-size="${num(STICKER_SIZE * scale)}" text-anchor="middle" dominant-baseline="central" font-family="${FONT_EMOJI}" filter="url(#sticker${i})" transform="rotate(${rotate} ${x} ${y})">${escapeXml(
        String(s.emoji),
      )}</text>`;
    })
    .join("");

  const { width, height } = canvas;
  const title = options.title ? `<title>${escapeXml(options.title)}</title>` : "";
  const background = options.withoutBackground
    ? ""
    : `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;
  const defs = background || filters ? `<defs>${background}${filters}</defs>` : "";
  const backdrop = options.withoutBackground ? "" : `<rect width="${width}" height="${height}" fill="url(#bg)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${title}${defs}${backdrop}${photo}${scene}${captions}${stickers}</svg>`;
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
