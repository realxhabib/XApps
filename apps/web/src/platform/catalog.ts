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
export const FEATURED_FALLBACK = ["meme-duel", "trivia-royale", "four-in-a-row"];

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
    slug: "hot-takes",
    name: "Hot Takes",
    tagline: "Pick a side. Make your case. Get ratioed or crowned.",
    description:
      "A spicy prompt drops and each player is handed a side. You get 280 characters to make the most convincing — or most unhinged — argument. The crowd votes on who argued it better, not who they agree with.",
    category: "debates",
    icon: "🔥",
    accent: ["#ff9a3d", "#ff3d6e"],
    url: "/embed/hot-takes",
    modes: ["async", "live", "practice"],
    players: { min: 2, max: 2 },
    teams: 0,
    spectators: true,
    setup: false,
    turnBased: false,
    scoring: "votes",
    votesToWin: 5,
    durationLabel: "90 sec + voting",
    howTo: [
      "A prompt appears and you're assigned FOR or AGAINST.",
      "Write your take in 280 characters and set its spice level.",
      "The Arena votes on the better argument. First to 5 votes wins.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: LAUNCH,
    tags: ["debate", "writing", "crowd-judged"],
    stats: [
      { key: "takes", label: "Takes written", aggregate: "sum", format: "number" },
      { key: "wins", label: "Debates won", aggregate: "sum", format: "number" },
      { key: "votes", label: "Crowd votes", aggregate: "sum", format: "number" },
    ],
    achievements: [
      { id: "first_take", name: "Fresh take", description: "Lock in your first take.", icon: "🗞️", xp: 10 },
      { id: "ghost_pepper", name: "Ghost pepper", description: "Lock in a take at maximum spice.", icon: "🌶️", xp: 15 },
      { id: "every_char", name: "Maxed out", description: "Use all 280 characters. Exactly.", icon: "📏", xp: 30 },
      { id: "crowd_pleaser", name: "Crowd pleaser", description: "Win a debate in the Arena.", icon: "👑", xp: 30 },
      { id: "too_hot", name: "Scorcher", description: "Win with a maximum-spice take.", icon: "🔥", xp: 40 },
      {
        id: "short_sweet",
        name: "Short and sweet",
        description: "Win with a take of 50 characters or fewer.",
        icon: "✂️",
        xp: 50,
      },
      {
        id: "shutout",
        name: "Shutout",
        description: "Win a debate without the other side getting a vote.",
        icon: "🧹",
        xp: 50,
      },
      {
        id: "buzzer_beater",
        name: "Buzzer beater",
        description: "Lock in with 5 seconds or less on the clock.",
        icon: "⏱️",
        xp: 30,
        secret: true,
      },
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
    slug: "emoji-decode",
    name: "Emoji Decode",
    tagline: "🧠 + ⚡ = you, probably. Race to decode.",
    description:
      "Eight emoji puzzles, eight seconds of panic each. Decode movies, idioms and phrases faster than your opponent — speed and accuracy both score. Play live to watch their progress, or async and chase their score.",
    category: "trivia",
    icon: "🧩",
    accent: ["#b6ff3d", "#1fd1b2"],
    url: "/embed/emoji-decode",
    modes: ["live", "async", "practice"],
    players: { min: 2, max: 2 },
    teams: 0,
    spectators: true,
    setup: false,
    turnBased: false,
    scoring: "high",
    durationLabel: "~90 sec",
    howTo: [
      "Each round shows a string of emoji and four answers.",
      "Pick the right one — faster answers earn bonus points.",
      "Highest score after eight puzzles wins.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: LAUNCH,
    tags: ["trivia", "speed", "emoji"],
    stats: [
      { key: "best_score", label: "Best score", aggregate: "max", format: "number" },
      { key: "puzzles_decoded", label: "Puzzles decoded", aggregate: "sum", format: "number" },
      { key: "fastest_decode", label: "Fastest decode", aggregate: "min", format: "ms" },
      { key: "wins", label: "Wins", aggregate: "sum", format: "number" },
    ],
    achievements: [
      { id: "first_win", name: "Cracked it", description: "Win an Emoji Decode match.", icon: "🔓", xp: 20 },
      { id: "fluent", name: "Fluent in emoji", description: "Decode all eight puzzles in one match.", icon: "💯", xp: 70 },
      {
        id: "lightning",
        name: "Lightning read",
        description: "Decode a puzzle within 2 seconds.",
        icon: "⚡",
        xp: 40,
      },
      { id: "on_a_roll", name: "On a roll", description: "Decode five puzzles in a row.", icon: "🔥", xp: 30 },
      { id: "score_1500", name: "1,500 club", description: "Score 1,500 points or more in a match.", icon: "🎖️", xp: 60 },
      {
        id: "speed_reader",
        name: "Speed reader",
        description: "Decode 6+ puzzles in a match, under 4 s on average.",
        icon: "📖",
        xp: 50,
      },
      { id: "photo_finish", name: "Photo finish", description: "Win a match by 25 points or fewer.", icon: "📸", xp: 40 },
      {
        id: "lost_in_translation",
        name: "Lost for words",
        description: "Miss all eight puzzles in a match.",
        icon: "🙈",
        xp: 25,
        secret: true,
      },
    ],
  },
  {
    slug: "trivia-royale",
    name: "Trivia Royale",
    tagline: "Up to 8 players. 8 rounds. One crown.",
    description:
      "A live trivia battle royale for 2–8 players. Everyone gets the same question at the same moment: lock in fast for more points, chain correct answers for streak bonuses, and watch the leaderboard reshuffle after every round. The final round scores double. Friends can drop in to spectate with live answer counts.",
    category: "trivia",
    icon: "👑",
    accent: ["#ffd84d", "#ff5c7a"],
    url: "/embed/trivia-royale",
    modes: ["live", "practice"],
    players: { min: 2, max: 8 },
    teams: 0,
    spectators: true,
    setup: false,
    turnBased: false,
    scoring: "high",
    durationLabel: "~2 min",
    howTo: [
      "Everyone sees the same question with four answers and 12 seconds on the clock.",
      "Lock in fast: correct answers score up to 1,000, and streaks add up to +300.",
      "Eight rounds across science, geography, arts and more. The last one counts double.",
      "Highest total takes the crown.",
    ],
    official: true,
    developer: OFFICIAL_DEV,
    status: "published",
    playCount: 0,
    createdAt: "2026-09-30T00:00:00.000Z",
    tags: ["trivia", "multiplayer", "party", "live"],
    stats: [
      { key: "best_score", label: "Best score", aggregate: "max", format: "number" },
      { key: "correct_answers", label: "Correct answers", aggregate: "sum", format: "number" },
      { key: "best_streak", label: "Best streak", aggregate: "max", format: "number" },
      { key: "crowns", label: "Crowns", aggregate: "sum", format: "number" },
    ],
    achievements: [
      { id: "crowned", name: "Crowned", description: "Win a Trivia Royale table.", icon: "👑", xp: 20 },
      {
        id: "perfect_game",
        name: "8 for 8",
        description: "A perfect game: all eight questions right.",
        icon: "🎯",
        xp: 80,
      },
      {
        id: "speed_demon",
        name: "Speed demon",
        description: "A right answer within 2 seconds.",
        icon: "⚡",
        xp: 30,
      },
      { id: "on_fire", name: "On fire", description: "Answer five questions in a row correctly.", icon: "🔥", xp: 40 },
      { id: "podium", name: "Podium", description: "Finish top three at a table of four or more.", icon: "🥉", xp: 30 },
      {
        id: "lone_genius",
        name: "Lone genius",
        description: "The only right answer at a table of three or more.",
        icon: "🧠",
        xp: 40,
      },
      {
        id: "clutch",
        name: "Double down",
        description: "Snatch the win on the double-points final round.",
        icon: "🎲",
        xp: 50,
      },
      { id: "host_with_most", name: "Host with the most", description: "Win a full eight-player table.", icon: "🎉", xp: 80 },
      {
        id: "gloriously_wrong",
        name: "Gloriously wrong",
        description: "Answer all eight questions. Miss all eight.",
        icon: "🙃",
        xp: 30,
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
