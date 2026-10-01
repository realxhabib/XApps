import { LIMITS } from "@xapps/sdk";
import type { AchievementDef, AppManifest, StatDef } from "./types";

const OFFICIAL_DEV = { id: null, handle: "xapps", name: "XApps Studio" };
const LAUNCH = "2026-09-01T00:00:00.000Z";

/**
 * First-party apps. They are built with the public @xapps/sdk exactly like
 * community apps — the only difference is that they are served from /embed.
 */
/**
 * The two big cards on the home page, in order. A slug that isn't listed
 * (a community app not yet published on this deployment) is skipped and the
 * next of FEATURED_FALLBACK takes its place.
 */
export const FEATURED_APPS = ["starship-league", "wedge-wars"];
export const FEATURED_FALLBACK = ["meme-duel", "four-in-a-row"];

export const OFFICIAL_APPS: AppManifest[] = [
  {
    slug: "meme-duel",
    name: "Meme Duel",
    tagline: "Same template. Two captions. The crowd decides.",
    description:
      "Both players get the same template and a stack of stickers. Write the funniest caption, drag stickers into place, and submit. Your entry goes to the Arena where the crowd votes — first to the vote target wins.",
    category: "contests",
    icon: "🖼️",
    accent: ["#ff5ca8", "#8b5cff"],
    url: "/embed/meme-duel",
    modes: ["async", "live", "practice"],
    players: { min: 2, max: 2 },
    teams: 0,
    spectators: true,
    // The app renders its own challenge setup (template, trending, drop, topic) in setup purpose.
    setup: true,
    turnBased: false,
    scoring: "votes",
    votesToWin: 5,
    durationLabel: "2 min + voting",
    howTo: [
      "You and your opponent get the same meme template.",
      "Write captions and drag up to three stickers onto the canvas.",
      "Submit — the Arena crowd votes until someone hits 5 votes.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: LAUNCH,
    tags: ["memes", "creative", "crowd-judged"],
  },
  {
    slug: "quick-draw",
    name: "Reflexes",
    tagline: "Wait for it… wait for it… GO.",
    description:
      "A best-of-five reflex duel. Hold steady while the tension builds, then tap the instant the signal fires. Tap early and you lose the round. Reaction times are measured on each device, so lag never decides a duel.",
    category: "games",
    icon: "⚡",
    accent: ["#ffe14d", "#ff7a1a"],
    url: "/embed/quick-draw",
    modes: ["live", "practice"],
    players: { min: 2, max: 2 },
    teams: 0,
    spectators: true,
    setup: false,
    turnBased: false,
    scoring: "high",
    durationLabel: "~45 sec",
    howTo: [
      "Watch the screen. Don't touch anything while it says STEADY.",
      "The moment it flashes GO, tap as fast as you can.",
      "Faster reaction wins the round. First to three rounds takes the duel.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: LAUNCH,
    tags: ["reflex", "realtime", "1v1"],
    stats: [
      { key: "best_reaction", label: "Best reaction", aggregate: "min", format: "ms" },
      { key: "rounds_won", label: "Rounds won", aggregate: "sum", format: "number" },
      { key: "duels_won", label: "Duels won", aggregate: "sum", format: "number" },
      { key: "perfect_duels", label: "Perfect duels", aggregate: "sum", format: "number" },
    ],
    achievements: [
      { id: "duel_won", name: "Fastest gun", description: "Win a Reflexes duel.", icon: "🤠", xp: 20 },
      { id: "under_200", name: "Under 200 ms", description: "React to GO in under 200 milliseconds.", icon: "⚡", xp: 40 },
      {
        id: "under_150",
        name: "Superhuman",
        description: "React to GO in under 150 ms. Are you even human?",
        icon: "🦾",
        xp: 70,
      },
      { id: "flawless", name: "Flawless 3–0", description: "Win a duel without dropping a round.", icon: "💎", xp: 40 },
      { id: "comeback", name: "Comeback", description: "Win a duel after falling 0–2 behind.", icon: "🔄", xp: 60 },
      { id: "photo_finish", name: "Photo finish", description: "Win a round by 5 milliseconds or less.", icon: "📸", xp: 40 },
      {
        id: "metronome",
        name: "Metronome",
        description: "Three clean taps in a duel, all within 30 ms.",
        icon: "⏱️",
        xp: 40,
      },
      { id: "twitchy", name: "Twitchy", description: "Jump the gun three times in one duel.", icon: "🫨", xp: 25, secret: true },
    ],
  },
  {
    slug: "four-in-a-row",
    name: "Four in a Row",
    tagline: "Drop, stack, connect. Live or over days.",
    description:
      "The timeless connect-four duel with buttery physics. Take turns dropping discs into a seven-column grid; connect four horizontally, vertically or diagonally to win. Play live on a 30-second clock, or play anytime and take your move whenever it suits you. Practice against a bot that actually thinks ahead.",
    category: "games",
    icon: "🔴",
    accent: ["#3d7bff", "#35e0ff"],
    url: "/embed/four-in-a-row",
    modes: ["live", "async", "practice"],
    players: { min: 2, max: 2 },
    teams: 0,
    spectators: true,
    setup: false,
    turnBased: true,
    scoring: "high",
    durationLabel: "~3 min",
    howTo: [
      "Players alternate dropping discs into any column.",
      "Line up four of your discs in any direction to win.",
      "Live: 30 seconds per move. Play anytime: up to 3 days per move, and we'll tell you when it's your turn.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: LAUNCH,
    tags: ["strategy", "turn-based", "classic"],
    stats: [
      { key: "wins", label: "Wins", aggregate: "sum", format: "number" },
      { key: "fastest_win", label: "Fastest win (discs)", aggregate: "min", format: "number" },
      { key: "longest_line", label: "Longest winning line", aggregate: "max", format: "number" },
    ],
    achievements: [
      { id: "first_win", name: "Connected", description: "Win a game of Four in a Row.", icon: "🔴", xp: 20 },
      { id: "diagonal", name: "Diagonal", description: "Win with a diagonal line.", icon: "📐", xp: 30 },
      {
        id: "quick_four",
        name: "Four in 7 moves",
        description: "Win using seven or fewer of your own discs.",
        icon: "⏩",
        xp: 40,
      },
      {
        id: "blocker",
        name: "Blocker",
        description: "Drop a disc where your opponent would have won.",
        icon: "🛡️",
        xp: 20,
      },
      { id: "the_wall", name: "The Wall", description: "Block three would-be fours in a single game.", icon: "🧱", xp: 50 },
      { id: "marathon", name: "Marathon", description: "Play a game until all 42 cells are full.", icon: "🏃", xp: 50 },
      { id: "pen_pal", name: "Turn-based win", description: "Win a play-anytime game.", icon: "✉️", xp: 30 },
      { id: "long_line", name: "Five alive", description: "Win with a line of five or more discs.", icon: "🖐️", xp: 50 },
      {
        id: "double_trouble",
        name: "Double trouble",
        description: "Complete two lines of four with a single disc.",
        icon: "✨",
        xp: 60,
        secret: true,
      },
    ],
  },
  {
    slug: "wedge-wars",
    name: "Wedge Wars",
    tagline: "Armored wedge trucks. Spinners, flippers, fire. Last truck standing.",
    description:
      "A real-time 3D robot-combat arena for 2–4 players. Build your wedge truck in the garage — bar spinner, flipper, axe hammer or flamethrower, plus armor and paint — then brawl in a steel arena with a KO pit, pop-up saws, flame vents and a pulverizer. Ram, flip and torch your way to last truck standing before the 2:30 bell.",
    category: "games",
    icon: "🛻",
    coverImage: "/showcase/wedge-wars-cover.webp",
    accent: ["#c6ff3d", "#ff5a1f"],
    url: "/embed/wedge-wars",
    modes: ["live", "practice"],
    players: { min: 2, max: 4 },
    teams: 0,
    spectators: true,
    setup: false,
    turnBased: false,
    scoring: "high",
    durationLabel: "2:30",
    howTo: [
      "Pick a weapon, an armor kit and a paint job in the garage, then lock in.",
      "Drive with WASD or the stick, Space fires your weapon, Shift boosts, R rights a flipped truck.",
      "Ram nose-first, land weapon hits, and shove rivals into the pit or the hazards.",
      "Last truck standing wins; at the bell, the healthiest truck takes it. Damage dealt adds to your score.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: "2026-10-04T00:00:00.000Z",
    tags: ["3d", "combat", "multiplayer", "live", "physics"],
    stats: [
      { key: "damage_dealt", label: "Damage dealt", aggregate: "sum", format: "number" },
      { key: "kos", label: "KOs", aggregate: "sum", format: "number" },
      { key: "wins", label: "Wins", aggregate: "sum", format: "number" },
      { key: "best_flip", label: "Best flip (cm)", aggregate: "max", format: "number" },
    ],
    achievements: [
      { id: "first_win", name: "Scrap king", description: "Win a Wedge Wars match.", icon: "🏆", xp: 20 },
      { id: "first_blood", name: "First blood", description: "Land the first KO of a match.", icon: "🩸", xp: 25 },
      { id: "flipped", name: "Flipped!", description: "Launch an opponent 2 m into the air with your flipper.", icon: "🤸", xp: 40 },
      { id: "pit_boss", name: "Pit boss", description: "Knock an opponent into the KO pit.", icon: "🕳️", xp: 40 },
      { id: "untouchable", name: "Untouchable", description: "Win with more than 75% of your hull left.", icon: "🛡️", xp: 60 },
      { id: "flamed_out", name: "Flamed out", description: "Finish off an opponent with the flamethrower.", icon: "🔥", xp: 40 },
      { id: "hammer_time", name: "Hammer time", description: "Land five axe-hammer blows in one match.", icon: "🔨", xp: 40 },
      { id: "last_standing", name: "Last truck standing", description: "Win a full four-truck free-for-all.", icon: "👑", xp: 60 },
      {
        id: "pulverized",
        name: "Pancaked",
        description: "Get flattened by the pulverizer.",
        icon: "🥞",
        xp: 25,
        secret: true,
      },
    ],
  },
  {
    slug: "rps-showdown",
    name: "RPS Showdown",
    tagline: "Rock, paper, scissors — best of three, no mercy.",
    description:
      "A community-style example app built with nothing but one HTML file and the public SDK bundle. Open its source to see how little code a head-to-head app needs.",
    category: "games",
    icon: "✊",
    accent: ["#9aa4ff", "#5b6bff"],
    url: "/examples/rps/index.html",
    modes: ["live", "practice"],
    players: { min: 2, max: 2 },
    teams: 0,
    spectators: true,
    setup: false,
    turnBased: false,
    scoring: "high",
    durationLabel: "~30 sec",
    howTo: [
      "Both players secretly pick rock, paper or scissors.",
      "Picks are revealed at the same time.",
      "First to two round wins takes it.",
    ],
    official: false,
    developer: { id: null, handle: "xapps_examples", name: "SDK Examples" },
    status: "published",
    playCount: 0,
    createdAt: "2026-09-10T00:00:00.000Z",
    tags: ["example", "open-source", "vanilla-js"],
  },
  {
    slug: "gregs-face",
    kind: "app",
    name: "Greg's Face",
    tagline: "Eyes, nose, mouth. Drop them where they belong.",
    description:
      "Greg has lost his face. His eyes, then his nose, then his mouth whizz back and forth across it, faster and faster, and you tap to drop each one into place. It's pure timing, and every face is fresh. Build him as many times as you like: your best face goes on the global leaderboard, so you always know exactly where you stand.",
    category: "games",
    icon: "🤪",
    iconImage: "/showcase/gregs-face-icon.webp",
    coverImage: "/showcase/gregs-face-cover.webp",
    accent: ["#ff8a3d", "#6f9bd1"],
    url: "/embed/gregs-face",
    // A standalone app: no matches. These are the harmless defaults the manifest still carries.
    modes: ["live"],
    players: { min: 2, max: 2 },
    teams: 0,
    spectators: false,
    setup: false,
    turnBased: false,
    scoring: "high",
    durationLabel: "~30 sec",
    howTo: [
      "A feature slides left and right across Greg's blank face, speeding up. Tap anywhere (or press Space) to drop it.",
      "Eyes, nose, then mouth. Only the horizontal miss counts: 100% is pixel perfect.",
      "Go again as often as you like. Your best face is ranked on the global leaderboard.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: "2026-10-06T00:00:00.000Z",
    tags: ["timing", "solo", "silly", "leaderboard"],
    stats: [
      { key: "best_face", label: "Best face", aggregate: "max", format: "percent" },
      { key: "perfect_parts", label: "Perfect parts", aggregate: "sum", format: "number" },
      { key: "faces_built", label: "Faces built", aggregate: "sum", format: "number" },
    ],
    achievements: [
      { id: "first_face", name: "Face maker", description: "Put Greg's face back together.", icon: "🧩", xp: 10 },
      { id: "spitting_image", name: "Spitting image", description: "Build a face 90% right or better.", icon: "🪞", xp: 40 },
      { id: "pixel_perfect", name: "Pixel perfect", description: "Drop a feature dead on target.", icon: "🎯", xp: 40 },
      { id: "steady_hands", name: "Steady hands", description: "Land all three features 85% right or better.", icon: "🤲", xp: 30 },
      { id: "face_factory", name: "Face factory", description: "Build 10 faces.", icon: "🏭", xp: 20 },
      { id: "on_a_roll", name: "On a roll", description: "Build three faces in a row, each 90% right or better.", icon: "🔥", xp: 50 },
      { id: "real_greg", name: "The real Greg", description: "Build a face 97% right or better.", icon: "🤩", xp: 70 },
      { id: "show_and_tell", name: "Show and tell", description: "Share the face you built.", icon: "📣", xp: 10 },
      {
        id: "hat_trick",
        name: "Hat trick",
        description: "Three pixel-perfect features in one face.",
        icon: "💎",
        xp: 80,
        secret: true,
      },
      { id: "picasso", name: "Picasso", description: "Build a face less than 40% right.", icon: "🎨", xp: 25, secret: true },
    ],
  },
  {
    slug: "perfect-circle",
    kind: "app",
    name: "Perfect Circle",
    tagline: "One stroke. Around the dot. How perfect is your circle?",
    description:
      "Draw a circle freehand around the dot in one continuous stroke and get a live accuracy score as you go: the ink glows green where you're spot on and red where you wobble. Draw as many as you like. Your best circle goes on the worldwide leaderboard, so after every one you see exactly where you stand. 98% is a perfect circle. Good luck.",
    category: "games",
    icon: "⭕",
    accent: ["#ffcf3d", "#34e89e"],
    url: "/embed/perfect-circle",
    // A standalone app: no matches. These are the harmless defaults the manifest still carries.
    modes: ["live"],
    players: { min: 2, max: 2 },
    teams: 0,
    spectators: false,
    setup: false,
    turnBased: false,
    scoring: "high",
    durationLabel: "~10 sec",
    howTo: [
      "Put your finger (or mouse, or pen) down and draw one circle around the dot, all the way round. Too small, too slow (over 8 s) or not a full circle doesn't count.",
      "Accuracy is how round it is around the dot. 98% or better is a perfect circle.",
      "Go again as often as you like. Your best circle is ranked on the worldwide leaderboard.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: "2026-10-06T00:00:00.000Z",
    tags: ["drawing", "skill", "solo", "leaderboard"],
    stats: [
      { key: "best_circle", label: "Best circle", aggregate: "max", format: "percent" },
      { key: "perfect_circles", label: "Perfect circles", aggregate: "sum", format: "number" },
      { key: "circles_drawn", label: "Circles drawn", aggregate: "sum", format: "number" },
    ],
    achievements: [
      { id: "first_circle", name: "Round one", description: "Draw your first full circle.", icon: "⭕", xp: 10 },
      { id: "well_rounded", name: "Well rounded", description: "Draw a circle 90% perfect or better.", icon: "✨", xp: 20 },
      { id: "steady_hand", name: "Steady hand", description: "Draw a circle 95% perfect or better.", icon: "🎯", xp: 40 },
      { id: "perfect_circle", name: "Perfect circle", description: "Draw a circle 98% perfect or better.", icon: "💎", xp: 70 },
      { id: "hat_trick", name: "Hat trick", description: "Draw three circles in a row, all 90% or better.", icon: "🎩", xp: 40 },
      { id: "in_the_groove", name: "In the groove", description: "Draw 10 circles in one go.", icon: "🔁", xp: 20 },
      { id: "century", name: "Going round in circles", description: "Draw 100 circles.", icon: "💯", xp: 40 },
      { id: "show_off", name: "Show off", description: "Share one of your circles on X.", icon: "📣", xp: 10 },
      { id: "its_an_egg", name: "It's an egg", description: "Score a full circle under 50%.", icon: "🥚", xp: 25, secret: true },
    ],
  },
  {
    slug: "cup-pong",
    name: "Cup Pong",
    tagline: "Flick. Arc. Plop. Clear their cups first.",
    description:
      "The party classic on a real 3D table. Flick up to throw: the swipe's speed sets the distance and its lean sets the aim. Two balls a turn, sink both for balls back, bounce one off the table to take a bonus cup, and hit three in a row to catch fire. Every player gets one re-rack. Rims rattle, cups splash, and the first to clear the other rack wins. Play live, play anytime over days, or practice against a bot on easy, medium or hard.",
    category: "games",
    icon: "🥤",
    accent: ["#ff3b4f", "#ffb23d"],
    url: "/embed/cup-pong",
    modes: ["live", "async", "practice"],
    players: { min: 2, max: 2 },
    teams: 0,
    spectators: true,
    setup: false,
    turnBased: true,
    scoring: "high",
    durationLabel: "~4 min",
    howTo: [
      "Flick the ball up the screen: faster flicks throw further, leaning left or right aims.",
      "Two balls a turn. Sink both and you get balls back. A bounce shot also takes a cup of your choice.",
      "Three makes in a row sets you on fire. Once a game you can re-rack the cups you're shooting at.",
      "Clear all ten of your opponent's cups to win.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: "2026-10-07T00:00:00.000Z",
    tags: ["3d", "turn-based", "party", "physics"],
    stats: [
      { key: "cups_sunk", label: "Cups sunk", aggregate: "sum", format: "number" },
      { key: "wins", label: "Wins", aggregate: "sum", format: "number" },
      { key: "bounce_shots", label: "Bounce shots", aggregate: "sum", format: "number" },
      { key: "fire_streaks", label: "On-fire streaks", aggregate: "sum", format: "number" },
    ],
    achievements: [
      { id: "first_win", name: "Table champ", description: "Win a game of Cup Pong.", icon: "🏆", xp: 20 },
      { id: "bounce_shot", name: "Bounce shot", description: "Sink a ball off a table bounce.", icon: "🏓", xp: 30 },
      { id: "on_fire", name: "On fire", description: "Sink three in a row.", icon: "🔥", xp: 40 },
      { id: "balls_back", name: "Balls back", description: "Sink both balls in one turn.", icon: "🔁", xp: 30 },
      { id: "rerack_make", name: "Re-rack and roll", description: "Sink the first throw after calling a re-rack.", icon: "🔺", xp: 30 },
      { id: "clutch", name: "Clutch", description: "Win with just one of your own cups left.", icon: "😅", xp: 50 },
      { id: "clean_sweep", name: "Clean sweep", description: "Win without losing a single cup.", icon: "🧹", xp: 70 },
      { id: "comeback", name: "Comeback", description: "Win after trailing by five cups or more.", icon: "📈", xp: 50 },
      {
        id: "rim_rattler",
        name: "Rim rattler",
        description: "Sink a ball that bounced off a rim first.",
        icon: "🌀",
        xp: 40,
        secret: true,
      },
      { id: "heat_check", name: "Heat check", description: "Sink six in a row.", icon: "☄️", xp: 60, secret: true },
    ],
  },
  {
    slug: "darts",
    name: "Darts",
    tagline: "Steady hand. Hold your breath. Flick for the treble 20.",
    description:
      "Pub darts on a regulation board, for 2–4 players. Hold to raise a dart and your hand starts to sway: steer against it, tap Breathe to steady it for a moment, then flick up to throw. Flick too soft and it drops, too hard and it sails. Everyone throws nine darts (three rounds of three) at the same time and the highest total wins. Watch rivals' darts land live, chase tons, bullseyes and the magic 180, or play anytime against friends and practice bots.",
    category: "games",
    icon: "🎯",
    accent: ["#42f5b0", "#23a6ff"],
    url: "/embed/darts",
    modes: ["live", "async", "practice"],
    players: { min: 2, max: 4 },
    teams: 0,
    spectators: true,
    setup: false,
    turnBased: false,
    scoring: "high",
    durationLabel: "~1 min",
    howTo: [
      "Hold anywhere to raise a dart. Your aim sways: move your finger to fight it.",
      "Flick up to throw. A clean flick lands where you aimed; too soft drops low, too hard sails high.",
      "Tap Breathe (or press B) once per dart to steady your hand for a moment.",
      "Nine darts each, three rounds of three. Highest total wins. Three treble 20s is the maximum: 180!",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: "2026-10-08T00:00:00.000Z",
    tags: ["skill", "multiplayer", "async", "pub"],
    stats: [
      { key: "best_total", label: "Best 9-dart total", aggregate: "max", format: "number" },
      { key: "bullseyes", label: "Bullseyes", aggregate: "sum", format: "number" },
      { key: "ton_80s", label: "180s", aggregate: "sum", format: "number" },
      { key: "games", label: "Games played", aggregate: "sum", format: "number" },
    ],
    achievements: [
      { id: "first_game", name: "Oche debut", description: "Throw all nine darts in a game.", icon: "🎯", xp: 10 },
      { id: "winner", name: "Top of the board", description: "Win a table of Darts outright.", icon: "🏆", xp: 20 },
      { id: "bullseye", name: "Bullseye!", description: "Hit the inner bull.", icon: "🐂", xp: 30 },
      { id: "ton_up", name: "Ton up", description: "Score 100 or more with three darts.", icon: "💯", xp: 30 },
      {
        id: "shanghai",
        name: "Shanghai",
        description: "Hit the single, double and treble of one number in the same round.",
        icon: "🏮",
        xp: 50,
      },
      { id: "treble_century", name: "Treble century", description: "Score 300 or more with nine darts.", icon: "🔥", xp: 50 },
      { id: "hat_trick", name: "Hat trick", description: "Three bulls in one round.", icon: "🎩", xp: 60 },
      { id: "one_eighty", name: "One hundred and eighty!", description: "Three treble 20s in one round.", icon: "💥", xp: 100 },
      {
        id: "robin_hood",
        name: "Robin Hood",
        description: "Land a dart right on top of another in the same round.",
        icon: "🏹",
        xp: 25,
        secret: true,
      },
      {
        id: "bed_and_breakfast",
        name: "Bed & breakfast",
        description: "Score 26 the classic way: a single 20, 5 and 1.",
        icon: "🍳",
        xp: 25,
        secret: true,
      },
    ],
  },
  {
    slug: "eight-ball",
    name: "8-Ball Pool",
    tagline: "Rack 'em. Call your pocket. Sink the 8.",
    description:
      "Real 8-ball on a table with real physics: balls that roll, spin and click, cushions that grip your english, and pockets that rattle. Aim with a ghost ball and deflection lines, pull the cue back for power, and dial in follow, draw or side spin. Pot your group, then call your pocket for the 8. Play live with the cue moving in real time, play anytime over days, or practice against a bot that plays position and safeties.",
    category: "games",
    icon: "🎱",
    accent: ["#2fd67b", "#ffd65a"],
    url: "/embed/eight-ball",
    modes: ["live", "async", "practice"],
    players: { min: 2, max: 2 },
    teams: 0,
    spectators: true,
    setup: false,
    turnBased: true,
    scoring: "high",
    durationLabel: "~6 min",
    howTo: [
      "Drag on the table to aim (tap a ball to aim straight at it), and slide the fine-aim ruler for tiny adjustments.",
      "Pull the cue down on the power bar and let go to shoot. Tap the cue ball button to add follow, draw or side spin.",
      "Break, then the first ball you pot makes you solids or stripes. Keep shooting while you pot your own balls.",
      "Fouls (scratch, wrong ball first, no cushion after contact) give your opponent ball in hand.",
      "Clear your group, then tap a pocket to call the 8. Sinking it early, in another pocket or with a scratch loses.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: "2026-10-09T00:00:00.000Z",
    tags: ["turn-based", "physics", "classic", "async"],
    stats: [
      { key: "wins", label: "Wins", aggregate: "sum", format: "number" },
      { key: "balls_potted", label: "Balls potted", aggregate: "sum", format: "number" },
      { key: "best_run", label: "Best run (balls)", aggregate: "max", format: "number" },
      { key: "break_and_runs", label: "Break and runs", aggregate: "sum", format: "number" },
    ],
    achievements: [
      { id: "first_win", name: "Rack 'em up", description: "Win a game of 8-Ball.", icon: "🎱", xp: 20 },
      { id: "hat_trick", name: "Hat trick", description: "Pot three balls in one visit.", icon: "🎩", xp: 30 },
      { id: "double_down", name: "Double down", description: "Pot two of your balls with one shot.", icon: "✌️", xp: 30 },
      { id: "bank_shot", name: "Off the rail", description: "Pot one of your balls after it hit a cushion.", icon: "↩️", xp: 40 },
      {
        id: "break_and_run",
        name: "Break and run",
        description: "Pot on the break and clear the table without your opponent taking a shot.",
        icon: "🏃",
        xp: 100,
      },
      { id: "whitewash", name: "Whitewash", description: "Win before your opponent pots a single ball of theirs.", icon: "🧹", xp: 60 },
      { id: "comeback", name: "Comeback", description: "Win after your opponent had cleared their group.", icon: "📈", xp: 50 },
      { id: "golden_break", name: "Golden break", description: "Sink the 8 on the break.", icon: "✨", xp: 80, secret: true },
      { id: "self_destruct", name: "Self-destruct", description: "Lose by sinking the 8 at the wrong moment.", icon: "💣", xp: 20, secret: true },
    ],
  },
  {
    slug: "mini-golf",
    name: "Mini Golf",
    tagline: "Nine holes. Windmills, tubes, a jump over water. Fewest strokes wins.",
    description:
      "A 3D mini golf round for 2–4 players. Drag back from your ball to putt and watch it roll on real slopes: bank it off the rails, thread the windmill sails, ride the tubes, blast out of the sand and launch off the ramp on Big Air. Everyone plays the same nine handcrafted holes at their own pace, with rivals' balls rolling beside yours as ghosts and a scorecard after every hole. Play live, anytime over days, or practice against bots.",
    category: "games",
    icon: "⛳",
    accent: ["#7ee07a", "#2fb3ff"],
    url: "/embed/mini-golf",
    modes: ["live", "async", "practice"],
    players: { min: 2, max: 4 },
    teams: 0,
    spectators: true,
    setup: false,
    turnBased: false,
    scoring: "low",
    durationLabel: "~6 min",
    howTo: [
      "Drag back from your ball and let go to putt: the further you pull, the harder you hit. Drag anywhere else to look around, or hold to see the whole hole.",
      "Everyone plays the same nine holes with their own ball. Other players' balls roll alongside as ghosts.",
      "Water costs a stroke and puts you back where you were. After six strokes you pick up and score seven.",
      "Fewest total strokes after nine holes wins.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: "2026-10-10T00:00:00.000Z",
    tags: ["3d", "physics", "multiplayer", "async", "classic"],
    stats: [
      { key: "holes_in_one", label: "Holes in one", aggregate: "sum", format: "number" },
      { key: "best_round", label: "Best round", aggregate: "min", format: "number" },
      { key: "rounds_played", label: "Rounds played", aggregate: "sum", format: "number" },
      { key: "wins", label: "Wins", aggregate: "sum", format: "number" },
    ],
    achievements: [
      { id: "first_round", name: "Card signed", description: "Finish a round of Mini Golf.", icon: "📝", xp: 10 },
      { id: "ace", name: "Ace!", description: "Get a hole in one.", icon: "⛳", xp: 50 },
      { id: "under_par", name: "Under par", description: "Finish a round under par.", icon: "📉", xp: 50 },
      { id: "hot_streak", name: "Hot streak", description: "Three birdies or better in a row.", icon: "🔥", xp: 50 },
      { id: "clean_card", name: "Clean card", description: "Finish a round without a bogey or worse.", icon: "🧼", xp: 60 },
      { id: "trick_shot", name: "Trick shot", description: "Hole out after bouncing off three or more rails or bumpers in one stroke.", icon: "🎯", xp: 40 },
      { id: "airmail", name: "Airmail", description: "Hole out on a stroke that took off.", icon: "🛫", xp: 40 },
      { id: "first_win", name: "Clubhouse champ", description: "Win a Mini Golf match.", icon: "🏆", xp: 30 },
      { id: "fish_food", name: "Fish food", description: "Find the water three times in one round.", icon: "🐟", xp: 25, secret: true },
      { id: "double_ace", name: "Double ace", description: "Two holes in one in the same round.", icon: "💎", xp: 80, secret: true },
    ],
  },
  {
    slug: "nova-rally",
    name: "Nova Rally",
    tagline: "Kart racing with rocket ships across Mars, the asteroid belt and beyond.",
    description:
      "A full 3D kart racer in space for up to 8 racers (CPU pilots fill the grid). Pick one of eight rocket ships and a paint job, then race a three-track Grand Prix: the red canyons of Mars, a floating ribbon through a tumbling asteroid belt, Saturn's rings with a full loop and a corkscrew, an upside-down space station in a nebula, and big low-gravity jumps on the Moon. Drift for blue, orange and purple mini-turbos, nail rocket starts, trick off ramps, slipstream rivals and grab stardust for top speed. Eleven items: seeker missiles, pulse bolts, plasma mines, ion shields, EMP storms, warp drives, cloaks and a singularity that hunts down the leader. Dodge asteroids, dust devils, meteor strikes and plasma arcs. Challengers pick the cup, speed class (100cc to 200cc) and laps. Play live, anytime, or practice against CPU pilots.",
    category: "games",
    icon: "🚀",
    accent: ["#ff8a4c", "#8f7bff"],
    url: "/embed/nova-rally",
    coverImage: "/showcase/nova-rally-cover.webp",
    iconImage: "/showcase/nova-rally-icon.webp",
    modes: ["live", "async", "practice"],
    players: { min: 2, max: 8 },
    teams: 0,
    spectators: true,
    setup: true,
    turnBased: false,
    scoring: "high",
    durationLabel: "~6 min",
    howTo: [
      "Hold ↑/W to thrust and steer with ←/→ (on phones the ship accelerates by itself: steer with the left pad).",
      "Hold drift (Space / DRIFT) while turning to charge mini-turbos: blue, orange, then purple. Let go to boost.",
      "Fly through item capsules and fire with E / ITEM. Hold ↓ to fire bolts and mines behind you.",
      "Hold throttle as the last red light goes out for a rocket start, and press drift in the air for a trick boost.",
      "Each race awards 15-12-10-8-6-4-2-1 points. Most points after the Grand Prix wins.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: "2026-10-12T00:00:00.000Z",
    tags: ["3d", "racing", "multiplayer", "async", "space"],
    stats: [
      { key: "wins", label: "Grand Prix wins", aggregate: "sum", format: "number" },
      { key: "races_won", label: "Races won", aggregate: "sum", format: "number" },
      { key: "podiums", label: "Podiums", aggregate: "sum", format: "number" },
      { key: "hits_landed", label: "Items landed", aggregate: "sum", format: "number" },
      { key: "mini_turbos", label: "Mini-turbos", aggregate: "sum", format: "number" },
      { key: "cups_played", label: "Cups raced", aggregate: "sum", format: "number" },
    ],
    achievements: [
      { id: "liftoff", name: "Liftoff", description: "Finish a Nova Rally Grand Prix.", icon: "🚀", xp: 10 },
      { id: "checkered", name: "Checkered flag", description: "Win a race.", icon: "🏁", xp: 25 },
      { id: "champion", name: "Galactic champion", description: "Win a Grand Prix.", icon: "🏆", xp: 60 },
      { id: "rocket_start", name: "Rocket start", description: "Nail a rocket start off the line.", icon: "🔥", xp: 20 },
      { id: "ultra_turbo", name: "Ultra turbo", description: "Charge a purple mini-turbo.", icon: "💜", xp: 25 },
      { id: "sharpshooter", name: "Sharpshooter", description: "Land three item hits in one race.", icon: "🎯", xp: 40 },
      { id: "stardust", name: "Stardust hoarder", description: "Hold 10 stardust at once.", icon: "⭐", xp: 25 },
      { id: "showboat", name: "Showboat", description: "Land five trick boosts in one race.", icon: "🤸", xp: 30 },
      { id: "untouchable", name: "Untouchable", description: "Win a race without being hit once.", icon: "🛡️", xp: 60 },
      { id: "comeback", name: "Comeback kid", description: "Win a race after dropping to 7th or worse.", icon: "📈", xp: 50 },
      { id: "first_win", name: "Podium finish", description: "Win a Nova Rally match.", icon: "🥇", xp: 30 },
      { id: "event_horizon", name: "Event horizon", description: "Hit the leader with a Singularity.", icon: "🕳️", xp: 40, secret: true },
      { id: "flawless", name: "Flawless", description: "Win every race of a Grand Prix.", icon: "💎", xp: 85, secret: true },
    ],
  },
  {
    slug: "frontline",
    name: "Frontline",
    tagline: "Fast first-person firefights in a sun-bleached container port.",
    description:
      "A real-time first-person shooter for 2–8 players. Pick a primary (assault rifle, SMG, sniper or shotgun), a sidearm and a perk, then fight through Saltyard: a covered warehouse, a stack of containers with perches up the stairs, and three tight container lanes. Aim down sights, learn each gun's recoil, land headshots, and chain three kills for a radar sweep. First to 20 kills or the most when the clock runs out wins. Team up when the table plays in teams, or practice against bots.",
    category: "games",
    icon: "🪖",
    coverImage: "/showcase/frontline-cover.webp",
    accent: ["#f2b544", "#e2553a"],
    url: "/embed/frontline",
    modes: ["live", "practice"],
    players: { min: 2, max: 8 },
    teams: 0,
    spectators: true,
    setup: false,
    turnBased: false,
    scoring: "high",
    durationLabel: "~7 min",
    howTo: [
      "Pick a primary weapon and a perk, then deploy. Everyone carries a Warden P9 sidearm and one frag grenade per life.",
      "Desktop: click to lock the mouse. WASD moves, Shift sprints, C or Ctrl crouches, Space jumps, right mouse aims, R reloads, 1/2 or the wheel swaps, hold G to aim a frag grenade and release to throw it. Esc opens settings.",
      "Phone: the left stick moves (push to the edge to sprint), drag on the right to look, and use the fire, aim, reload, jump, crouch and grenade buttons (hold the grenade to see its arc, let go to throw).",
      "Headshots hurt more, bullets lose power with distance, and you heal when you stay out of fire. Three kills without dying calls in a radar sweep.",
      "First to 20 kills wins (team play: the team total), or the most kills when the 7-minute clock runs out. Your score is your kills.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: "2026-10-11T00:00:00.000Z",
    tags: ["3d", "shooter", "multiplayer", "live", "fps"],
    stats: [
      { key: "kills", label: "Kills", aggregate: "sum", format: "number" },
      { key: "best_streak", label: "Best kill streak", aggregate: "max", format: "number" },
      { key: "headshots", label: "Headshots", aggregate: "sum", format: "number" },
      { key: "wins", label: "Wins", aggregate: "sum", format: "number" },
    ],
    achievements: [
      { id: "first_blood", name: "First blood", description: "Get the first kill of a Frontline match.", icon: "🩸", xp: 25 },
      { id: "first_win", name: "Top of the board", description: "Win a Frontline match.", icon: "🏆", xp: 30 },
      { id: "radar_sweep", name: "Eyes on the yard", description: "Chain three kills without dying to call in a radar sweep.", icon: "📡", xp: 30 },
      { id: "unstoppable", name: "Unstoppable", description: "Seven kills in a row without dying.", icon: "🔥", xp: 60 },
      { id: "headhunter", name: "Headhunter", description: "Five headshot kills in one match.", icon: "🎯", xp: 50 },
      { id: "long_shot", name: "Long shot", description: "A sniper-rifle kill from 45 m or more.", icon: "🔭", xp: 50 },
      { id: "sidearm", name: "Backup plan", description: "Get a kill with your sidearm.", icon: "🔫", xp: 25 },
      { id: "flawless", name: "Flawless", description: "Win a match with five or more kills without dying once.", icon: "💎", xp: 80, secret: true },
      { id: "airborne", name: "Airborne", description: "Get a kill while in the air.", icon: "🪂", xp: 40, secret: true },
    ],
  },
];

/** Manifest defaults for the v2 fields (a game, players 2–2, free for all, watchable, no setup, no turns, client-settled). */
export const MANIFEST_DEFAULTS = {
  kind: "game",
  players: { min: 2, max: 2 },
  teams: 0,
  spectators: true,
  setup: false,
  turnBased: false,
  authority: "client",
} as const;

/** Fills in any v2 manifest fields an older row or registration left out. */
export function withManifestDefaults(app: AppManifest): AppManifest {
  return {
    ...app,
    kind: app.kind ?? MANIFEST_DEFAULTS.kind,
    players: app.players ?? { ...MANIFEST_DEFAULTS.players },
    teams: app.teams ?? MANIFEST_DEFAULTS.teams,
    spectators: app.spectators ?? MANIFEST_DEFAULTS.spectators,
    setup: app.setup ?? MANIFEST_DEFAULTS.setup,
    turnBased: app.turnBased ?? MANIFEST_DEFAULTS.turnBased,
    authority: app.authority ?? MANIFEST_DEFAULTS.authority,
    stats: app.stats ?? [],
    achievements: app.achievements ?? [],
  };
}

export interface ManifestShape {
  players?: { min: number; max: number };
  teams?: number;
  spectators?: boolean;
  setup?: boolean;
  turnBased?: boolean;
  stats?: StatDef[];
  achievements?: AchievementDef[];
}

/**
 * Validates the multiplayer part of a manifest: 2 ≤ min ≤ max ≤ 8, teams 0 or
 * 2–4 with `max` a multiple of `teams`. Returns an error message, or null.
 */
export function manifestShapeError(shape: ManifestShape): string | null {
  const players = shape.players ?? MANIFEST_DEFAULTS.players;
  const { min, max } = players;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 2 || max > 8 || min > max) {
    return "Players must be a range within 2–8";
  }
  const teams = shape.teams ?? 0;
  if (teams !== 0 && (!Number.isInteger(teams) || teams < 2 || teams > 4)) return "Teams must be 0 or 2–4";
  if (teams && max % teams !== 0) return "Max players must be a multiple of the team count";
  return statDefsError(shape.stats) ?? achievementDefsError(shape.achievements);
}

/* ---------------------------------------------------------------------- */
/* Stats & achievements (Stage 3)                                         */
/* ---------------------------------------------------------------------- */

/** Stat keys and achievement ids. */
export const DEF_ID_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
export const STAT_AGGREGATES = ["max", "min", "sum", "last"] as const;
export const STAT_FORMATS = ["number", "ms", "percent"] as const;
export const DEF_LABEL_MAX = 40;
export const ACHIEVEMENT_DESCRIPTION_MAX = 140;
export const ACHIEVEMENT_XP_MAX = 100;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One emoji (a single grapheme with an emoji in it), e.g. "🏆", "👍🏽", "🇫🇷", "1️⃣". */
export function isSingleEmoji(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || text !== value || text.length > 16) return false;
  if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(text)) return false;
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const graphemes = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)];
    return graphemes.length === 1;
  }
  return true;
}

/** Validates manifest `stats` (≤ 8; unique keys like `best_time`). Returns an error message, or null. */
export function statDefsError(stats: unknown): string | null {
  if (stats === undefined || stats === null) return null;
  if (!Array.isArray(stats)) return "Stats must be a list";
  if (stats.length > LIMITS.maxStats) return `Up to ${LIMITS.maxStats} stats`;
  const keys = new Set<string>();
  for (const [i, stat] of stats.entries()) {
    const name = `Stat ${i + 1}`;
    if (!isPlainObject(stat)) return `${name} is malformed`;
    if (typeof stat.key !== "string" || !DEF_ID_PATTERN.test(stat.key)) {
      return `${name}: the key must start with a letter and use a–z, 0–9 or _ (max 32)`;
    }
    if (keys.has(stat.key)) return `${name}: the key "${stat.key}" is used twice`;
    keys.add(stat.key);
    if (typeof stat.label !== "string" || !stat.label.trim() || stat.label.length > DEF_LABEL_MAX) {
      return `${name}: the label must be 1–${DEF_LABEL_MAX} characters`;
    }
    if (!STAT_AGGREGATES.includes(stat.aggregate as never)) return `${name}: aggregate is max, min, sum or last`;
    if (stat.format !== undefined && !STAT_FORMATS.includes(stat.format as never)) {
      return `${name}: format is number, ms or percent`;
    }
  }
  return null;
}

/**
 * Validates manifest `achievements` (≤ 30, unique ids, one emoji, 0–100 XP,
 * ≤ 500 XP in total). `strictIcon: false` only checks the icon's length like
 * the database does (1–16 characters).
 */
export function achievementDefsError(achievements: unknown, { strictIcon = true } = {}): string | null {
  if (achievements === undefined || achievements === null) return null;
  if (!Array.isArray(achievements)) return "Achievements must be a list";
  if (achievements.length > LIMITS.maxAchievements) return `Up to ${LIMITS.maxAchievements} achievements`;
  const ids = new Set<string>();
  let total = 0;
  for (const [i, a] of achievements.entries()) {
    const name = `Achievement ${i + 1}`;
    if (!isPlainObject(a)) return `${name} is malformed`;
    if (typeof a.id !== "string" || !DEF_ID_PATTERN.test(a.id)) {
      return `${name}: the id must start with a letter and use a–z, 0–9 or _ (max 32)`;
    }
    if (ids.has(a.id)) return `${name}: the id "${a.id}" is used twice`;
    ids.add(a.id);
    if (typeof a.name !== "string" || !a.name.trim() || a.name.length > DEF_LABEL_MAX) {
      return `${name}: the name must be 1–${DEF_LABEL_MAX} characters`;
    }
    if (
      a.description !== undefined &&
      a.description !== null &&
      (typeof a.description !== "string" || a.description.length > ACHIEVEMENT_DESCRIPTION_MAX)
    ) {
      return `${name}: the description must be at most ${ACHIEVEMENT_DESCRIPTION_MAX} characters`;
    }
    const iconOk = strictIcon
      ? isSingleEmoji(a.icon)
      : typeof a.icon === "string" && a.icon.trim().length > 0 && a.icon.length <= 16;
    if (!iconOk) return `${name}: the icon must be one emoji`;
    if (!Number.isInteger(a.xp) || (a.xp as number) < 0 || (a.xp as number) > ACHIEVEMENT_XP_MAX) {
      return `${name}: XP must be a whole number from 0 to ${ACHIEVEMENT_XP_MAX}`;
    }
    if (a.secret !== undefined && typeof a.secret !== "boolean") return `${name}: secret must be true or false`;
    total += a.xp as number;
  }
  if (total > LIMITS.maxAchievementXpPerApp) {
    return `Achievements can award at most ${LIMITS.maxAchievementXpPerApp} XP in total (these add up to ${total})`;
  }
  return null;
}

/** Keeps the well-formed stat definitions of an untrusted list (e.g. an `apps.stats` row). */
export function toStatDefs(raw: unknown): StatDef[] {
  if (!Array.isArray(raw)) return [];
  const out: StatDef[] = [];
  for (const item of raw) {
    if (!isPlainObject(item) || statDefsError([item])) continue;
    if (out.some((s) => s.key === item.key)) continue;
    const def: StatDef = { key: item.key as string, label: item.label as string, aggregate: item.aggregate as StatDef["aggregate"] };
    if (item.format !== undefined) def.format = item.format as StatDef["format"];
    out.push(def);
  }
  return out.slice(0, LIMITS.maxStats);
}

/** Keeps the well-formed achievement definitions of an untrusted list (e.g. an `apps.achievements` row). */
export function toAchievementDefs(raw: unknown): AchievementDef[] {
  if (!Array.isArray(raw)) return [];
  const out: AchievementDef[] = [];
  for (const item of raw) {
    if (!isPlainObject(item) || achievementDefsError([item], { strictIcon: false })) continue;
    if (out.some((a) => a.id === item.id)) continue;
    const def: AchievementDef = {
      id: item.id as string,
      name: item.name as string,
      description: typeof item.description === "string" ? item.description : "",
      icon: item.icon as string,
      xp: item.xp as number,
    };
    if (item.secret === true) def.secret = true;
    out.push(def);
  }
  return out.slice(0, LIMITS.maxAchievements);
}

export function getOfficialApp(slug: string): AppManifest | undefined {
  return OFFICIAL_APPS.find((app) => app.slug === slug);
}

/** Resolves an app URL to an absolute URL and its origin. */
export function resolveAppUrl(url: string, base: string): { href: string; origin: string } {
  const resolved = new URL(url, base);
  return { href: resolved.toString(), origin: resolved.origin };
}
