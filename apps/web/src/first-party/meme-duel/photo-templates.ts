/**
 * Real meme templates (from imgflip's most-captioned list) with caption slots
 * placed by hand where people actually write on them. Coordinates are canvas
 * units: 600 wide, height = 600 × image aspect (see `fitCanvas`).
 *
 * Images are never loaded directly: always through `memeImageUrl()` (a
 * same-origin proxy), so the canvas can read them when an entry is submitted.
 */
import { fitCanvas } from "./canvas";
import type { CaptionSlot, MemePhoto, MemeTemplate } from "./templates";

type Extra = Partial<CaptionSlot>;

/** Classic white Impact with a black outline across the top… */
const topText = (placeholder: string, extra: Extra = {}): CaptionSlot => ({
  id: "top",
  label: "Top text",
  placeholder,
  x: 300,
  y: 14,
  width: 568,
  maxLines: 2,
  size: 46,
  align: "middle",
  valign: "top",
  style: "impact",
  maxLength: 70,
  ...extra,
});

/** …and along the bottom (`h` is the canvas height). */
const bottomText = (h: number, placeholder: string, extra: Extra = {}): CaptionSlot => ({
  ...topText(placeholder),
  id: "bottom",
  label: "Bottom text",
  y: h - 14,
  valign: "bottom",
  ...extra,
});

/** Outlined Impact for a spot inside the picture (subtitles, labels on dark areas). */
const shout = (id: string, label: string, placeholder: string, x: number, y: number, width: number, extra: Extra = {}): CaptionSlot => ({
  id,
  label,
  placeholder,
  x,
  y,
  width,
  maxLines: 2,
  size: 30,
  align: "middle",
  valign: "middle",
  style: "impact",
  maxLength: 60,
  ...extra,
});

/** A white tag with dark text: labels on people and things. */
const tag = (id: string, label: string, placeholder: string, x: number, y: number, width: number, extra: Extra = {}): CaptionSlot => ({
  id,
  label,
  placeholder,
  x,
  y,
  width,
  maxLines: 3,
  size: 26,
  align: "middle",
  valign: "middle",
  style: "label",
  maxLength: 48,
  ...extra,
});

/** Plain dark text for templates with white panels, boards, signs and speech bubbles. */
const note = (id: string, label: string, placeholder: string, x: number, y: number, width: number, extra: Extra = {}): CaptionSlot => ({
  id,
  label,
  placeholder,
  x,
  y,
  width,
  maxLines: 4,
  size: 30,
  align: "middle",
  valign: "middle",
  style: "post",
  weight: 800,
  color: "#111111",
  maxLength: 70,
  ...extra,
});

interface PhotoDef {
  /** imgflip template id. */
  imgflip: number;
  name: string;
  /** i.imgflip.com image URL. */
  src: string;
  width: number;
  height: number;
  /** Given the canvas height, the slots in canvas units. */
  slots: (h: number) => CaptionSlot[];
}

const DEFS: PhotoDef[] = [
  {
    imgflip: 181913649,
    name: "Drake Hotline Bling",
    src: "https://i.imgflip.com/30b1gx.jpg",
    width: 1200,
    height: 1200,
    slots: () => [
      note("no", "Nah", "paying for streaming", 450, 150, 270, { maxLines: 5, size: 34 }),
      note("yes", "Yeah", "sharing one password with 9 cousins", 450, 450, 270, { maxLines: 5, size: 34 }),
    ],
  },
  {
    imgflip: 87743020,
    name: "Two Buttons",
    src: "https://i.imgflip.com/1g8my4.jpg",
    width: 600,
    height: 908,
    slots: () => [
      tag("a", "Button A", "option A", 165, 140, 210),
      tag("b", "Button B", "option B", 435, 105, 200),
      shout("me", "Sweating guy", "me", 300, 880, 540, { valign: "bottom", size: 40 }),
    ],
  },
  {
    imgflip: 112126428,
    name: "Distracted Boyfriend",
    src: "https://i.imgflip.com/1ur9b0.jpg",
    width: 1200,
    height: 800,
    slots: () => [
      tag("new", "The other woman", "one more episode", 160, 300, 220, { size: 24 }),
      tag("me", "Boyfriend", "me", 365, 230, 140, { size: 24 }),
      tag("ex", "Girlfriend", "my sleep schedule", 515, 265, 150, { size: 24 }),
    ],
  },
  {
    imgflip: 222403160,
    name: "Bernie Once Again Asking",
    src: "https://i.imgflip.com/3oevdk.jpg",
    width: 750,
    height: 750,
    slots: () => [shout("ask", "…asking for", "for your financial support", 300, 586, 560, { valign: "bottom", size: 36 })],
  },
  {
    imgflip: 217743513,
    name: "UNO Draw 25 Cards",
    src: "https://i.imgflip.com/3lmzyx.jpg",
    width: 500,
    height: 494,
    slots: () => [
      note("card", "The card", "stop scrolling", 150, 225, 210, { size: 28, maxLength: 50 }),
      shout("guy", "The guy", "me", 450, 580, 280, { valign: "bottom", size: 34 }),
    ],
  },
  {
    imgflip: 124822590,
    name: "Left Exit 12 Off Ramp",
    src: "https://i.imgflip.com/22bdq6.jpg",
    width: 804,
    height: 767,
    slots: () => [
      tag("straight", "Straight on", "go to bed", 205, 120, 150, { size: 22, maxLength: 40 }),
      tag("exit", "Exit 12", "one more video", 370, 120, 150, { size: 22, maxLength: 40 }),
      tag("car", "The car", "me at 2am", 310, 445, 240, { size: 24, maxLines: 2, maxLength: 40 }),
    ],
  },
  {
    imgflip: 252600902,
    name: "Always Has Been",
    src: "https://i.imgflip.com/46e43q.png",
    width: 960,
    height: 540,
    slots: () => [
      shout("wait", "Astronaut 1", "wait, it's all Mondays?", 165, 300, 300, { size: 28 }),
      shout("always", "Astronaut 2", "always has been", 470, 24, 240, { valign: "top", size: 28, maxLength: 40 }),
    ],
  },
  {
    imgflip: 322841258,
    name: "Anakin Padme 4 Panel",
    src: "https://i.imgflip.com/5c7lwq.png",
    width: 768,
    height: 768,
    slots: () => [
      shout("anakin", "Anakin", "I'm going to change things", 150, 288, 280, { valign: "bottom", size: 24, maxLines: 3 }),
      shout("padme", "Padmé", "for the better, right?", 450, 288, 280, { valign: "bottom", size: 24, maxLines: 3 }),
      shout("padme2", "Padmé again", "for the better, right?", 450, 588, 280, { valign: "bottom", size: 24, maxLines: 3 }),
    ],
  },
  {
    imgflip: 135256802,
    name: "Epic Handshake",
    src: "https://i.imgflip.com/28j0te.jpg",
    width: 900,
    height: 645,
    slots: () => [
      tag("left", "Left arm", "cats", 95, 330, 170),
      tag("right", "Right arm", "toddlers", 505, 330, 170),
      tag("both", "The handshake", "knocking stuff off tables", 300, 60, 220, { size: 24, maxLines: 2 }),
    ],
  },
  {
    imgflip: 131940431,
    name: "Gru's Plan",
    src: "https://i.imgflip.com/26jxvz.jpg",
    width: 700,
    height: 449,
    slots: () => {
      const board = { size: 20, maxLines: 6, weight: 700, maxLength: 50 };
      return [
        note("one", "Step 1", "make a plan", 228, 108, 112, board),
        note("two", "Step 2", "follow the plan", 528, 108, 112, board),
        note("three", "Step 3", "plan backfires", 232, 305, 112, board),
        note("four", "Step 4 (look again)", "plan backfires", 530, 305, 112, board),
      ];
    },
  },
  {
    imgflip: 4087833,
    name: "Waiting Skeleton",
    src: "https://i.imgflip.com/2fm6x.jpg",
    width: 298,
    height: 403,
    slots: (h) => [topText("me waiting for"), bottomText(h, "the group chat to pick a place")],
  },
  {
    imgflip: 97984,
    name: "Disaster Girl",
    src: "https://i.imgflip.com/23ls.jpg",
    width: 500,
    height: 375,
    slots: (h) => [topText("they said to follow"), bottomText(h, "my gut feeling")],
  },
  {
    imgflip: 80707627,
    name: "Sad Pablo Escobar",
    src: "https://i.imgflip.com/1c1uej.jpg",
    width: 720,
    height: 709,
    slots: () => [
      shout("one", "Top panel", "me after the weekend", 300, 285, 560, { valign: "bottom" }),
      shout("two", "Bottom left", "waiting for a reply", 150, 583, 280, { valign: "bottom", size: 24, maxLines: 3 }),
      shout("three", "Bottom right", "still waiting", 450, 583, 280, { valign: "bottom", size: 24, maxLines: 3 }),
    ],
  },
  {
    imgflip: 309868304,
    name: "Trade Offer",
    src: "https://i.imgflip.com/54hjww.jpg",
    width: 607,
    height: 794,
    slots: () => [
      shout("i", "i receive:", "your fries", 150, 190, 270, { valign: "top", maxLines: 3, maxLength: 50 }),
      shout("you", "you receive:", "my undying gratitude", 445, 190, 270, { valign: "top", maxLines: 3, maxLength: 50 }),
    ],
  },
  {
    imgflip: 129242436,
    name: "Change My Mind",
    src: "https://i.imgflip.com/24y43o.jpg",
    width: 482,
    height: 361,
    slots: () => [note("sign", "The sign", "cereal is a soup", 388, 310, 250, { size: 28, maxLines: 3, maxLength: 60 })],
  },
  {
    imgflip: 438680,
    name: "Batman Slapping Robin",
    src: "https://i.imgflip.com/9ehk.jpg",
    width: 400,
    height: 387,
    slots: () => [
      note("robin", "Robin", "but what if we", 145, 58, 250, { size: 24, maxLines: 3, maxLength: 55 }),
      note("batman", "Batman", "NO", 455, 56, 260, { size: 24, maxLines: 3, maxLength: 55 }),
    ],
  },
  {
    imgflip: 188390779,
    name: "Woman Yelling At Cat",
    src: "https://i.imgflip.com/345v97.jpg",
    width: 680,
    height: 438,
    slots: () => [
      note("woman", "Woman", "YOU SAID ONE EPISODE", 150, 43, 280, { size: 22, maxLines: 3 }),
      note("cat", "Cat", "it was a cliffhanger", 450, 43, 280, { size: 22, maxLines: 3 }),
    ],
  },
  {
    imgflip: 102156234,
    name: "Mocking Spongebob",
    src: "https://i.imgflip.com/1otk96.jpg",
    width: 502,
    height: 353,
    slots: (h) => [
      topText("\"please be on time\"", { keepCase: true, size: 42 }),
      bottomText(h, "pLeAsE bE oN tImE", { keepCase: true, size: 42 }),
    ],
  },
  {
    imgflip: 61579,
    name: "One Does Not Simply",
    src: "https://i.imgflip.com/1bij.jpg",
    width: 568,
    height: 335,
    slots: (h) => [topText("one does not simply", { size: 42 }), bottomText(h, "eat just one chip", { size: 42 })],
  },
  {
    imgflip: 100777631,
    name: "Is This A Pigeon",
    src: "https://i.imgflip.com/1o00in.jpg",
    width: 1587,
    height: 1425,
    slots: () => [
      tag("guy", "The guy", "me", 130, 390, 230, { maxLines: 2 }),
      tag("thing", "The butterfly", "a free sample", 500, 210, 170, { size: 24 }),
      shout("question", "The question", "is this a meal?", 300, 527, 560, { valign: "bottom", size: 34 }),
    ],
  },
  {
    imgflip: 247375501,
    name: "Buff Doge vs. Cheems",
    src: "https://i.imgflip.com/43a45p.png",
    width: 937,
    height: 720,
    slots: () => [
      note("buff", "Buff Doge", "me at 9pm with a plan", 135, 395, 250, { size: 24 }),
      note("cheems", "Cheems", "me at 9am doing the plan", 475, 395, 230, { size: 24 }),
    ],
  },
  {
    imgflip: 93895088,
    name: "Expanding Brain",
    src: "https://i.imgflip.com/1jwhww.jpg",
    width: 857,
    height: 1202,
    slots: () => {
      const panel = { size: 28, maxLines: 5, weight: 700, maxLength: 60 };
      return [
        note("one", "Small brain", "texting back", 148, 103, 260, panel),
        note("two", "Glowing brain", "voice memo back", 148, 315, 260, panel),
        note("three", "Radiant brain", "calling back", 148, 520, 260, panel),
        note("four", "Galaxy brain", "replying 3 months later", 148, 731, 260, panel),
      ];
    },
  },
  {
    imgflip: 55311130,
    name: "This Is Fine",
    src: "https://i.imgflip.com/wxica.jpg",
    width: 580,
    height: 282,
    slots: () => [
      shout("fire", "What's on fire", "my inbox", 150, 14, 280, { valign: "top", size: 26, maxLines: 3 }),
      shout("me", "The dog", "me", 450, 280, 280, { valign: "bottom", size: 26, maxLength: 40 }),
    ],
  },
  {
    imgflip: 148909805,
    name: "Monkey Puppet",
    src: "https://i.imgflip.com/2gnnjh.jpg",
    width: 923,
    height: 768,
    slots: () => [
      note("text", "Caption", "when someone asks who ate the last slice", 24, 20, 552, {
        align: "start",
        valign: "top",
        size: 32,
        weight: 600,
        maxLength: 90,
      }),
    ],
  },
  {
    imgflip: 89370399,
    name: "Roll Safe Think About It",
    src: "https://i.imgflip.com/1h7in3.jpg",
    width: 702,
    height: 395,
    slots: (h) => [topText("can't be late for work", { size: 40 }), bottomText(h, "if you quit", { size: 40 })],
  },
  {
    imgflip: 27813981,
    name: "Hide the Pain Harold",
    src: "https://i.imgflip.com/gk5el.jpg",
    width: 480,
    height: 601,
    slots: (h) => [topText("when the dentist asks"), bottomText(h, "if you've been flossing")],
  },
  {
    imgflip: 84341851,
    name: "Evil Kermit",
    src: "https://i.imgflip.com/1e7ql7.jpg",
    width: 700,
    height: 325,
    slots: () => [
      shout("me", "Me", "me: go to bed", 140, 266, 260, { valign: "bottom", size: 24, maxLines: 3 }),
      shout("evil", "Also me", "also me: one more episode", 440, 266, 280, { valign: "bottom", size: 24, maxLines: 3 }),
    ],
  },
  {
    imgflip: 155067746,
    name: "Surprised Pikachu",
    src: "https://i.imgflip.com/2kbn1e.jpg",
    width: 1893,
    height: 1892,
    slots: () => [
      note("text", "Caption", "me: stays up until 4am. me when the alarm goes off:", 24, 22, 552, {
        align: "start",
        valign: "top",
        size: 32,
        maxLines: 5,
        weight: 600,
        maxLength: 110,
      }),
    ],
  },
  {
    imgflip: 61544,
    name: "Success Kid",
    src: "https://i.imgflip.com/1bhk.jpg",
    width: 500,
    height: 500,
    slots: (h) => [topText("found a fry"), bottomText(h, "at the bottom of the bag")],
  },
  {
    imgflip: 61585,
    name: "Bad Luck Brian",
    src: "https://i.imgflip.com/1bip.jpg",
    width: 475,
    height: 562,
    slots: (h) => [topText("finally gets a day off"), bottomText(h, "it rains")],
  },
  {
    imgflip: 61520,
    name: "Futurama Fry",
    src: "https://i.imgflip.com/1bgw.jpg",
    width: 552,
    height: 414,
    slots: (h) => [topText("not sure if hungry", { size: 42 }), bottomText(h, "or just bored", { size: 42 })],
  },
  {
    imgflip: 5496396,
    name: "Leonardo DiCaprio Cheers",
    src: "https://i.imgflip.com/39t1o.jpg",
    width: 600,
    height: 400,
    slots: (h) => [topText("here's to the people who", { size: 42 }), bottomText(h, "put the cart back", { size: 42 })],
  },
  {
    imgflip: 110133729,
    name: "Spider-Man Pointing",
    src: "https://i.imgflip.com/1tkjq9.jpg",
    width: 800,
    height: 450,
    slots: () => [
      shout("left", "Left Spider-Man", "me", 150, 326, 280, { valign: "bottom", size: 28 }),
      shout("right", "Right Spider-Man", "also me", 450, 326, 280, { valign: "bottom", size: 28 }),
    ],
  },
  {
    imgflip: 178591752,
    name: "Tuxedo Winnie the Pooh",
    src: "https://i.imgflip.com/2ybua0.png",
    width: 800,
    height: 582,
    slots: () => [
      note("plain", "Regular Pooh", "cereal", 430, 109, 300, { weight: 600, maxLength: 60 }),
      note("fancy", "Fancy Pooh", "cold crunchy milk soup", 430, 329, 300, { weight: 600, maxLength: 60 }),
    ],
  },
  {
    imgflip: 195515965,
    name: "Clown Applying Makeup",
    src: "https://i.imgflip.com/38el31.jpg",
    width: 750,
    height: 798,
    slots: () => {
      const row = { size: 26, weight: 700, maxLength: 60 };
      return [
        note("one", "Step 1", "I'll just check my phone", 185, 79, 330, row),
        note("two", "Step 2", "one more video", 185, 240, 330, row),
        note("three", "Step 3", "ok, last one", 185, 401, 330, row),
        note("four", "Full clown", "it's 3am", 185, 561, 330, row),
      ];
    },
  },
  {
    imgflip: 226297822,
    name: "Panik Kalm Panik",
    src: "https://i.imgflip.com/3qqcim.png",
    width: 640,
    height: 881,
    slots: () => {
      const panel = { size: 28, maxLines: 5, weight: 700, maxLength: 60 };
      return [
        note("one", "Panik", "a noise downstairs", 148, 140, 250, panel),
        note("two", "Kalm", "it's just the cat", 148, 418, 250, panel),
        note("three", "Panik again", "you don't have a cat", 148, 690, 250, panel),
      ];
    },
  },
  {
    imgflip: 354700819,
    name: "Two Guys on a Bus",
    src: "https://i.imgflip.com/5v6gwj.jpg",
    width: 762,
    height: 675,
    slots: () => [
      tag("rocks", "Left window", "monday", 115, 150, 190, { size: 24 }),
      tag("view", "Right window", "friday", 480, 120, 200, { size: 24 }),
    ],
  },
  {
    imgflip: 104893621,
    name: "Grim Reaper Knocking Door",
    src: "https://i.imgflip.com/1qg8fp.jpg",
    width: 500,
    height: 312,
    slots: () => {
      const small = { size: 20, maxLength: 36 };
      return [
        tag("door1", "Door 1", "my sleep", 72, 150, 120, small),
        tag("door2", "Door 2", "my free time", 243, 150, 130, small),
        tag("reaper", "The reaper", "a new puppy", 365, 70, 130, small),
        tag("door3", "Door 3", "my shoes", 480, 250, 140, small),
      ];
    },
  },
  {
    imgflip: 124055727,
    name: "Y'all Got Any More Of That",
    src: "https://i.imgflip.com/21uy0f.jpg",
    width: 600,
    height: 471,
    slots: (h) => [topText("y'all got any more of that"), bottomText(h, "free pizza from the meeting")],
  },
  {
    imgflip: 101470,
    name: "Ancient Aliens",
    src: "https://i.imgflip.com/26am.jpg",
    width: 500,
    height: 436,
    slots: (h) => [topText("socks vanishing in the dryer"), bottomText(h, "aliens")],
  },
  {
    imgflip: 91538330,
    name: "X, X Everywhere",
    src: "https://i.imgflip.com/1ihzfe.jpg",
    width: 2118,
    height: 1440,
    slots: (h) => [topText("meetings", { size: 42 }), bottomText(h, "meetings everywhere", { size: 42 })],
  },
  {
    imgflip: 180190441,
    name: "They're The Same Picture",
    src: "https://i.imgflip.com/2za3u1.jpg",
    width: 1363,
    height: 1524,
    slots: () => [
      note("left", "Left picture", "a 5 minute nap", 175, 130, 200, { size: 26, maxLength: 50 }),
      note("right", "Right picture", "a 3 hour nap", 445, 165, 210, { size: 26, maxLength: 50 }),
    ],
  },
];

/** Dark backdrop behind letterboxed images. */
const PHOTO_BACKGROUND: [string, string] = ["#0b0b10", "#0b0b10"];

function photoTemplate(id: string, name: string, photo: MemePhoto, slots: (h: number) => CaptionSlot[]): MemeTemplate {
  const canvas = fitCanvas(photo.width, photo.height);
  return { id, name, background: PHOTO_BACKGROUND, scene: [], slots: slots(canvas.height), canvas, photo };
}

export const PHOTO_TEMPLATES: MemeTemplate[] = DEFS.map((def) =>
  photoTemplate(`imgflip-${def.imgflip}`, def.name, { src: def.src, width: def.width, height: def.height }, def.slots),
);

export function isPhotoTemplateId(id: unknown): id is string {
  return typeof id === "string" && PHOTO_TEMPLATES.some((t) => t.id === id);
}

export function getPhotoTemplate(id: string): MemeTemplate | undefined {
  return PHOTO_TEMPLATES.find((t) => t.id === id);
}

/* ---------------------------------------------------------------------- */
/* Drops                                                                  */
/* ---------------------------------------------------------------------- */

export const DROP_TEMPLATE_ID = "drop";

/** A template made on the fly from an image the challenger dropped: classic top + bottom text. */
export function dropTemplate(drop: MemePhoto): MemeTemplate {
  const name = drop.credit?.handle ? `@${drop.credit.handle.replace(/^@/, "")}'s drop` : "The drop";
  return photoTemplate(DROP_TEMPLATE_ID, name, drop, (h) => [
    topText("top text", { size: h < 400 ? 38 : 46 }),
    bottomText(h, "bottom text", { size: h < 400 ? 38 : 46 }),
  ]);
}

/* ---------------------------------------------------------------------- */
/* Bot captions                                                           */
/* ---------------------------------------------------------------------- */

const tb = (top: string, bottom: string) => ({ top, bottom });

export const PHOTO_BOT_CAPTIONS: Record<string, Record<string, string>[]> = {
  "imgflip-181913649": [
    { no: "going to bed at a reasonable hour", yes: "watching a video about how bridges are built at 3am" },
    { no: "reading the instructions", yes: "assembling it wrong with total confidence" },
    { no: "fixing the bug", yes: "adding a comment that says TODO" },
    { no: "paying for 6 streaming services", yes: "paying for 6 streaming services and rewatching The Office" },
  ],
  "imgflip-87743020": [
    { a: "eat healthy", b: "eat what's already open", me: "me at the fridge at midnight" },
    { a: "reply to the text", b: "read it and forget for 4 days", me: "me" },
    { a: "save money", b: "but it's on sale", me: "my bank account" },
  ],
  "imgflip-112126428": [
    { new: "reorganizing my entire desk", me: "me", ex: "the project due tomorrow" },
    { new: "opening a 48th tab", me: "me", ex: "my other 47 tabs" },
    { new: "the game on sale today", me: "me", ex: "the game I bought yesterday" },
  ],
  "imgflip-222403160": [{ ask: "for you to stop hitting reply all" }, { ask: "for one weekend with zero plans" }, { ask: "for the wifi password" }],
  "imgflip-217743513": [
    { card: "admit you were wrong", guy: "me in every argument" },
    { card: "text them back", guy: "me with 6 unread messages" },
    { card: "put the cart back", guy: "me in the parking lot" },
  ],
  "imgflip-124822590": [
    { straight: "a healthy breakfast", exit: "cold pizza", car: "me at 7am" },
    { straight: "studying for the exam", exit: "deep cleaning the house", car: "me the night before" },
    { straight: "finish the show", exit: "start a new show", car: "me at 1am" },
  ],
  "imgflip-252600902": [
    { wait: "wait, dinner is just snacks?", always: "always has been" },
    { wait: "wait, it's all meetings that could've been emails?", always: "always has been" },
    { wait: "wait, the 5 minute break was 45 minutes?", always: "always has been" },
  ],
  "imgflip-322841258": [
    { anakin: "I'm starting the gym on Monday", padme: "this Monday, right?", padme2: "this Monday, right?" },
    { anakin: "I'm just having one chip", padme: "one chip, right?", padme2: "not the whole bag, right?" },
    { anakin: "I bought a treadmill", padme: "to run on, right?", padme2: "not to hang clothes on, right?" },
  ],
  "imgflip-135256802": [
    { left: "cats", right: "toddlers", both: "knocking stuff off tables" },
    { left: "me", right: "my dog", both: "pretending we didn't hear our name" },
    { left: "millennials", right: "gen z", both: "never answering the phone" },
  ],
  "imgflip-131940431": [
    { one: "wake up early", two: "go for a run", three: "snooze 6 times", four: "snooze 6 times" },
    { one: "start a diet", two: "buy healthy snacks", three: "eat them all in one night", four: "eat them all in one night" },
    { one: "learn to code", two: "write hello world", three: "4 hours fixing the setup", four: "4 hours fixing the setup" },
  ],
  "imgflip-4087833": [
    tb("me waiting for my code", "to finish compiling"),
    tb("waiting for the group chat", "to pick a restaurant"),
    tb("\"we'll get back to you", "in 2-3 business days\""),
  ],
  "imgflip-97984": [
    tb("they said follow", "your gut feeling"),
    tb("the recipe said 3 minutes", "I did 30 to be safe"),
    tb("mom said clean the kitchen", "it's very clean now"),
  ],
  "imgflip-80707627": [
    { one: "me after finishing a series", two: "waiting for season 2", three: "it got cancelled" },
    { one: "when everyone has plans but you", two: "refreshing the group chat", three: "going outside to check" },
    { one: "me on the first day back", two: "it's still Tuesday", three: "somehow still Tuesday" },
  ],
  "imgflip-309868304": [
    { i: "your fries", you: "my emotional support" },
    { i: "the last slice", you: "a heartfelt thank you" },
    { i: "the window seat", you: "my full commentary" },
  ],
  "imgflip-129242436": [
    { sign: "cereal is a soup" },
    { sign: "naps are self care" },
    { sign: "pineapple on pizza is fine" },
    { sign: "the snooze button is a lifestyle" },
  ],
  "imgflip-438680": [
    { robin: "let's hop on a quick call", batman: "THIS COULD BE AN EMAIL" },
    { robin: "but what if the sequel is good", batman: "IT NEVER IS" },
    { robin: "I'll start the diet after the holi-", batman: "WHICH HOLIDAY" },
  ],
  "imgflip-188390779": [
    { woman: "YOU ATE MY LEFTOVERS", cat: "they didn't have your name on them" },
    { woman: "you said 5 minutes", cat: "I said it takes 5 minutes, not that I'd start" },
    { woman: "why are you awake at 3am", cat: "the fridge was humming" },
  ],
  "imgflip-102156234": [
    tb("boss: please be on time", "pLeAsE bE oN tImE"),
    tb("\"it's not a phase, mom\"", "iT's NoT a PhAsE mOm"),
    tb("\"I'll do it tomorrow\"", "i'Ll Do It ToMoRrOw"),
  ],
  "imgflip-61579": [
    tb("one does not simply", "eat just one chip"),
    tb("one does not simply", "leave a group chat quietly"),
    tb("one does not simply", "close 47 tabs"),
  ],
  "imgflip-100777631": [
    { guy: "me", thing: "any nice view", question: "is this a photo op?" },
    { guy: "me", thing: "a slight inconvenience", question: "is this the end of the world?" },
    { guy: "my cat", thing: "a cardboard box", question: "is this a castle?" },
  ],
  "imgflip-247375501": [
    { buff: "kids in the 90s: walked to school in the snow", cheems: "me: my phone is at 20%" },
    { buff: "medieval peasants: 14 hours in a field", cheems: "me after one zoom call" },
    { buff: "me at 9pm with a to-do list", cheems: "me at 9am with the same list" },
  ],
  "imgflip-93895088": [
    { one: "texting back", two: "voice memo back", three: "calling back", four: "replying 3 months later with a meme" },
    { one: "saying goodbye", two: "goodbye again at the door", three: "goodbye at the car", four: "we live together now" },
    { one: "making coffee", two: "making cold brew", three: "buying a grinder", four: "growing beans in the backyard" },
  ],
  "imgflip-55311130": [
    { fire: "my inbox, my room, my sleep schedule", me: "me" },
    { fire: "the group project due in an hour", me: "the only one who read the brief" },
    { fire: "production at 5pm on a Friday", me: "the on-call dev" },
  ],
  "imgflip-148909805": [
    { text: "when the teacher asks who hasn't turned in their homework yet" },
    { text: "when someone asks who finished the milk and put the carton back" },
    { text: "me when my friend asks who told everyone about the surprise party" },
  ],
  "imgflip-89370399": [
    tb("can't be late for work", "if you quit"),
    tb("you can't lose your keys", "if you never leave the house"),
    tb("no dishes to wash", "if you eat over the sink"),
  ],
  "imgflip-27813981": [
    tb("when the dentist asks", "if you've been flossing"),
    tb("when self checkout says", "unexpected item in bagging area"),
    tb("typing \"lol\"", "with a completely straight face"),
  ],
  "imgflip-84341851": [
    { me: "me: I should go to bed", evil: "also me: one more episode" },
    { me: "me: I'm saving money", evil: "also me: but it's on sale" },
    { me: "me: let's be productive", evil: "also me: reorganize the playlist" },
  ],
  "imgflip-155067746": [
    { text: "me: stays up until 4am. me when the 7am alarm goes off:" },
    { text: "me: leaves one dish in the sink. the sink three days later:" },
    { text: "me: \"I'll remember it, no need to write it down\". me 5 minutes later:" },
  ],
  "imgflip-61544": [
    tb("found a fry", "at the bottom of the bag"),
    tb("meeting got cancelled", "and it's Friday"),
    tb("woke up before the alarm", "felt rested"),
  ],
  "imgflip-61585": [
    tb("finally gets a day off", "it rains"),
    tb("learns to parallel park", "car gets towed"),
    tb("saves the file", "the wrong version"),
  ],
  "imgflip-61520": [
    tb("not sure if they're being nice", "or they want something"),
    tb("not sure if hungry", "or just bored"),
    tb("not sure if the code works", "or the tests are wrong"),
  ],
  "imgflip-5496396": [
    tb("to everyone who replies", "\"sounds good\" to everything"),
    tb("here's to the people who", "put the cart back"),
    tb("cheers to the friend", "who always has a charger"),
  ],
  "imgflip-110133729": [
    { left: "me blaming the wifi", right: "the wifi blaming me" },
    { left: "\"you're late\"", right: "\"no, you're early\"" },
    { left: "me hunting the bug", right: "me who wrote the bug" },
  ],
  "imgflip-178591752": [
    { plain: "eating cereal", fancy: "enjoying a crunchy milk soup" },
    { plain: "napping", fancy: "a midday recharge session" },
    { plain: "being late", fancy: "arriving fashionably" },
  ],
  "imgflip-195515965": [
    { one: "I'll just check my phone for a sec", two: "it's been an hour", three: "ok, after this video", four: "it's 3am" },
    { one: "I'll buy just one thing", two: "free shipping over $50", three: "I'll return what I don't need", four: "I never return anything" },
    { one: "I don't need a jacket", two: "it's a little chilly", three: "I'll just walk faster", four: "I have become the cold" },
  ],
  "imgflip-226297822": [
    { one: "you hear a noise downstairs", two: "it's just the cat", three: "you don't have a cat" },
    { one: "my phone is at 1%", two: "found a charger", three: "it's the wrong cable" },
    { one: "texted the wrong person", two: "they haven't read it yet", three: "\"typing…\"" },
  ],
  "imgflip-354700819": [
    { rocks: "monday", view: "friday" },
    { rocks: "my bank account", view: "my online cart" },
    { rocks: "the actual weather", view: "the weather app" },
  ],
  "imgflip-104893621": [
    { door1: "my sleep", door2: "my free time", reaper: "a new puppy", door3: "my shoes" },
    { door1: "my diet", door2: "my savings", reaper: "weekend brunch", door3: "my plans" },
    { door1: "old memes", door2: "last week's memes", reaper: "the algorithm", door3: "this meme" },
  ],
  "imgflip-124055727": [
    tb("y'all got any more of that", "free pizza from the meeting"),
    tb("y'all got any more of them", "three-day weekends"),
    tb("y'all got any more of that", "motivation from yesterday"),
  ],
  "imgflip-101470": [
    tb("socks vanishing in the dryer", "aliens"),
    tb("I don't know how my code works", "aliens"),
    tb("who ate the last cookie?", "aliens"),
  ],
  "imgflip-91538330": [tb("meetings", "meetings everywhere"), tb("passwords", "passwords everywhere"), tb("crumbs", "crumbs everywhere")],
  "imgflip-180190441": [
    { left: "a 5 minute nap", right: "a 3 hour nap" },
    { left: "\"I'm on my way\"", right: "\"I'm still in bed\"" },
    { left: "\"we'll see\"", right: "\"no\"" },
  ],
};

/** Works on any image: the bot's top/bottom captions for drops. */
export const DROP_BOT_CAPTIONS: { top: string; bottom: string }[] = [
  tb("when the wifi drops", "for half a second"),
  tb("when someone says", "\"quick question\""),
  tb("me pretending", "to understand the assignment"),
  tb("live footage of me", "at 3am"),
  tb("my last brain cell", "during the meeting"),
  tb("when the group chat", "goes suspiciously quiet"),
  tb("this is what", "peak performance looks like"),
  tb("me explaining", "why I need just one more"),
];
