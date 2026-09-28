export interface HotTakePrompt {
  id: string;
  prompt: string;
  emoji: string;
  /** Bot takes for practice matches and demo data. */
  for: string[];
  against: string[];
}

export type Side = "for" | "against";

export const HOT_TAKE_PROMPTS: HotTakePrompt[] = [
  {
    id: "hotdog-sandwich",
    prompt: "A hot dog is a sandwich.",
    emoji: "🌭",
    for: [
      "Protein. Bread. Held in one hand. If it walks like a sandwich and talks like a sandwich, it's a sandwich wearing a trench coat.",
      "The bread is connected at the bottom. So is a sub. Nobody is out here calling a sub a taco.",
    ],
    against: [
      "A sandwich has two independent slices. A hot dog bun is one loyal piece of bread in a committed relationship. Respect it.",
      "If a hot dog is a sandwich then a canoe is a boat sandwich. We have to draw the line somewhere.",
    ],
  },
  {
    id: "cereal-soup",
    prompt: "Cereal is a soup.",
    emoji: "🥣",
    for: [
      "Solids floating in liquid, eaten with a spoon, from a bowl. You've been eating cold sweet soup for breakfast your whole life.",
      "Gazpacho is cold. Fruit soup exists. Cereal is just soup that went to marketing school.",
    ],
    against: [
      "Soup is cooked. Cereal is assembled. By that logic my bath is soup and I'm the crouton.",
      "If cereal is soup then milk is broth and I refuse to live in that world.",
    ],
  },
  {
    id: "pineapple-pizza",
    prompt: "Pineapple belongs on pizza.",
    emoji: "🍍",
    for: [
      "Sweet, salty, acidic, smoky. It's the only topping that brings a whole flavor arc. Your pepperoni could never.",
      "Tomatoes are fruit. You already put fruit on pizza. Pineapple just did it with confidence.",
    ],
    against: [
      "Warm pineapple juice pooling under the cheese is a crime scene, not a topping.",
      "Pizza is a savory contract. Pineapple shows up and renegotiates it without asking anybody.",
    ],
  },
  {
    id: "remote-work",
    prompt: "Remote work beats the office.",
    emoji: "🏠",
    for: [
      "My commute is 11 steps and my coworker is a cat who has never scheduled a meeting that could've been an email.",
      "Zero commute, better coffee, and nobody microwaving fish at 12:01. Productivity was never about the carpet.",
    ],
    against: [
      "Hallway conversations built more products than any Slack thread in history. Some ideas need a whiteboard and a snack.",
      "Working from home means living at work. The office is a boundary with free snacks.",
    ],
  },
  {
    id: "tabs-spaces",
    prompt: "Tabs are better than spaces.",
    emoji: "⌨️",
    for: [
      "One keystroke, one indent, everyone picks their own width. Tabs are literally the accessible, customizable choice.",
      "Spaces are hardcoding. Tabs are configuration. Engineers should know the difference.",
    ],
    against: [
      "Spaces look identical everywhere, forever. Tabs look different on every screen like a mood ring.",
      "Every serious formatter already chose spaces. Tabs are fighting a war that ended in 2014.",
    ],
  },
  {
    id: "reply-k",
    prompt: "Replying 'k' is a declaration of war.",
    emoji: "💬",
    for: [
      "'k' is not a reply, it's a closed door with the lights off. Two letters would have cost you nothing.",
      "'ok' is agreement. 'okay' is warmth. 'k' is a subtweet delivered directly to your phone.",
    ],
    against: [
      "Some of us are busy. 'k' is efficient, honest and carbon neutral. Not every text needs a paragraph and three emoji.",
      "Reading hostility into one letter says more about your group chat than about the letter.",
    ],
  },
  {
    id: "movies-speed",
    prompt: "Every movie is better at 1.25x speed.",
    emoji: "🎬",
    for: [
      "Directors pad movies with 40 seconds of someone staring out a car window. 1.25x is a director's cut, but for my time.",
      "At 1.25x dialogue gets snappier and I finally finish movies before falling asleep.",
    ],
    against: [
      "Timing is the art. Speeding up a joke is like speeding up a hug — technically done, emotionally missed.",
      "If you need 1.25x, you don't want a movie, you want a summary. Go read the plot on your phone.",
    ],
  },
  {
    id: "breakfast-dinner",
    prompt: "Breakfast for dinner beats actual dinner.",
    emoji: "🥞",
    for: [
      "Pancakes at 8pm feel illegal and that's exactly why they taste better. Dinner wishes it had that energy.",
      "Breakfast food is cheap, fast and universally loved. Dinner is just breakfast with anxiety.",
    ],
    against: [
      "Eggs twice in one day is a cry for help. Dinner deserves a main character, not a remix.",
      "Syrup at night is chaos. Your body is expecting lasagna and you hand it a waffle.",
    ],
  },
  {
    id: "dark-mode",
    prompt: "Dark mode is a personality trait.",
    emoji: "🌙",
    for: [
      "You can tell everything about someone by their brightness settings. Light mode users answer emails on vacation.",
      "Dark mode people own at least one mechanical keyboard and have opinions about fonts. That's a personality.",
    ],
    against: [
      "It's a setting, not a star sign. Some of us just have eyes and like being able to read in the sun.",
      "If toggling a switch is a personality, then so is turning on the lights. Relax.",
    ],
  },
  {
    id: "sequels",
    prompt: "Sequels are usually better than the original.",
    emoji: "🎞️",
    for: [
      "Part one sets up the world. Part two gets to have fun in it — bigger budget, no exposition dump.",
      "Sequels are the original with notes applied. The first draft is never the best draft.",
    ],
    against: [
      "For every great sequel there are ten that exist because a spreadsheet said so.",
      "Originals take risks. Sequels take the risk out and call it a franchise.",
    ],
  },
  {
    id: "socks-sandals",
    prompt: "Socks with sandals are peak fashion.",
    emoji: "🧦",
    for: [
      "Breathable. Warm. Supportive. Socks with sandals is the only outfit that respects your feet and your schedule.",
      "Fashion is confidence, and nothing says 'I fear no one' like white socks in slides.",
    ],
    against: [
      "Sandals exist to let your feet breathe. Socks exist to stop that. Pick a lane.",
      "It's not fashion, it's a cry for a closed-toe shoe.",
    ],
  },
  {
    id: "cats-roommates",
    prompt: "Cats are better roommates than humans.",
    emoji: "🐈",
    for: [
      "They never eat your leftovers, never invite friends over and pay rent in pure vibes.",
      "A cat has never once left three dishes 'soaking' for a week.",
    ],
    against: [
      "A human roommate won't knock your glass off the table while holding direct eye contact.",
      "Humans split the bills. Cats split your couch.",
    ],
  },
  {
    id: "middle-armrests",
    prompt: "The middle seat gets both armrests.",
    emoji: "✈️",
    for: [
      "Window gets a view and a wall to nap on. Aisle gets legroom and freedom. Middle gets two armrests and the last shred of dignity. That's the treaty.",
      "It's not a perk, it's compensation. You chose the window. I was assigned the sandwich.",
    ],
    against: [
      "Armrests are first come, first served. The middle seat is a state of mind, not a legal claim.",
      "If the middle seat gets both armrests, the aisle seat gets to charge a toll every time you need to stretch.",
    ],
  },
  {
    id: "cold-pizza",
    prompt: "Cold pizza beats hot pizza.",
    emoji: "🍕",
    for: [
      "Hot pizza is a first date. Cold pizza is a marriage: firmer, more flavorful, and there for you at 7am.",
      "The cheese sets, the sauce deepens, the crust finds its backbone. Cold pizza is pizza after character development.",
    ],
    against: [
      "Cold pizza is just pizza that gave up. Reheat it like you have self-respect.",
      "Nobody has ever ordered a pizza and said 'could you deliver this in about nine hours?'",
    ],
  },
  {
    id: "ketchup-fridge",
    prompt: "Ketchup belongs in the fridge.",
    emoji: "🍅",
    for: [
      "The bottle literally says 'refrigerate after opening.' This isn't a debate, it's reading comprehension.",
      "Cold ketchup on hot fries is the contrast your taste buds have been quietly begging for.",
    ],
    against: [
      "Diners leave ketchup on the table all day and civilization is fine. It's tomato jam with trust issues.",
      "Fridge ketchup comes out like a glacier. I wanted a condiment, not an arm workout.",
    ],
  },
  {
    id: "morning-people",
    prompt: "Morning people are running a scam.",
    emoji: "🌅",
    for: [
      "Nobody is genuinely delighted at 5am. They're recruiting so they have someone to talk to.",
      "They go to bed at 9pm and call it discipline. That's a toddler's schedule with a podcast.",
    ],
    against: [
      "The world is open 9 to 5. Being awake while it's open isn't a scam, it's a cheat code.",
      "Morning people get empty gyms, quiet coffee shops and sunrises. Night owls get 2am cereal and regret.",
    ],
  },
  {
    id: "voice-notes",
    prompt: "Voice notes are podcasts nobody asked for.",
    emoji: "🎙️",
    for: [
      "A four-minute voice note to say 'Thursday works' is an episode with no show notes and no skip button.",
      "I can read a text in two seconds. Your voice note needs headphones, privacy and emotional preparation.",
    ],
    against: [
      "Text says 'fine.' A voice note says 'fine' and you can actually HEAR whether you're in trouble.",
      "Some stories need dramatic pauses. Typing 'and THEN' in caps simply cannot compete.",
    ],
  },
  {
    id: "toilet-paper",
    prompt: "Toilet paper goes over, not under.",
    emoji: "🧻",
    for: [
      "The original patent drawing shows it over. We are honoring the founder's intent here.",
      "Over, you see the end and grab it. Under, you're reaching into the wall like you lost a sock back there.",
    ],
    against: [
      "Under is cat-proof, toddler-proof and tidy. It's the roll's natural resting face.",
      "Over lets the paper flap around like a tiny surrender flag. Under is a roll with dignity.",
    ],
  },
  {
    id: "water-wet",
    prompt: "Water is wet.",
    emoji: "💧",
    for: [
      "Water is surrounded by water all day long. If you're covered in liquid, you're wet. Water never gets a day off.",
      "Put your hand in water. Now it's wet. Water did that. You can't give what you don't have.",
    ],
    against: [
      "Wet is what water does to other things. Fire isn't on fire. Water isn't wet.",
      "Wetness is liquid clinging to a solid. Water isn't a solid. Case closed, towel down.",
    ],
  },
  {
    id: "birthday-week",
    prompt: "Birthdays should last a whole week.",
    emoji: "🎂",
    for: [
      "One day isn't enough to receive all the attention I deserve. A week gives the latecomers a grace period.",
      "Weddings get a weekend. Holidays get a season. Your literal arrival on Earth gets 24 hours? Unacceptable.",
    ],
    against: [
      "A birthday week is a birthday that won't leave the party. Blow out the candles and go home.",
      "If everyone gets a week, someone in your group chat is always mid-birthday. You'd never stop buying cake.",
    ],
  },
  {
    id: "emoji-work",
    prompt: "Emoji belong in work emails.",
    emoji: "👍",
    for: [
      "A well-placed 🙏 has done more for team morale than every all-hands meeting combined.",
      "'Per my last email' with a 🙂 is diplomacy. Without it, it's a threat.",
    ],
    against: [
      "Nothing says 'I am not taking this budget seriously' like a 🚀 in the subject line.",
      "Email is a paper trail. Do you want your performance review quoting the 💀 you sent to finance?",
    ],
  },
  {
    id: "sleep-socks",
    prompt: "Sleeping in socks is elite behavior.",
    emoji: "🛌",
    for: [
      "Warm feet fall asleep faster. Sock sleepers are running a performance optimization the rest of you ignore.",
      "Cold floor at 3am? Sock sleepers don't flinch. We glide to the kitchen like royalty.",
    ],
    against: [
      "Socks in bed is wearing a coat in the shower. Let your feet breathe. Let them live.",
      "Halfway through the night the sock slides off and becomes a tiny foot ghost. That's not elite, that's haunted.",
    ],
  },
  {
    id: "spoilers",
    prompt: "Spoilers make stories better.",
    emoji: "🤫",
    for: [
      "If knowing the ending ruins a story, it wasn't a story. It was a magic trick.",
      "Knowing where it's going lets you notice the craft. A spoiler is a free rewatch on your first watch.",
    ],
    against: [
      "You get exactly one chance to be surprised by a twist. Spoiling it is stealing a memory.",
      "Nobody tells a joke by opening with the punchline. Stories deserve the same courtesy.",
    ],
  },
  {
    id: "hot-sauce",
    prompt: "Hot sauce belongs on everything.",
    emoji: "🌶️",
    for: [
      "Hot sauce isn't a condiment, it's a personality upgrade for bland food. Scrambled eggs have been waiting for this.",
      "Chili honey on vanilla ice cream exists and it is incredible. Everything is a canvas if you're brave.",
    ],
    against: [
      "Put hot sauce on everything and everything tastes like one flavor: ouch.",
      "Some foods are delicate. Drowning sushi in hot sauce is an air horn at a string quartet.",
    ],
  },
  {
    id: "group-projects",
    prompt: "Group projects build character.",
    emoji: "🧑‍🤝‍🧑",
    for: [
      "Nothing teaches leadership like being the one person who read the brief while three others 'reviewed the doc.'",
      "Group projects teach negotiation, delegation and forgiveness, sometimes all in one afternoon.",
    ],
    against: [
      "Group projects build exactly one character: the person who did everything and now trusts no one.",
      "It's not teamwork when one teammate's entire contribution was picking the font.",
    ],
  },
];

export function getPrompt(id: string): HotTakePrompt {
  return HOT_TAKE_PROMPTS.find((p) => p.id === id) ?? (HOT_TAKE_PROMPTS[0] as HotTakePrompt);
}

export const SPICE_LEVELS = [
  { level: 1, label: "Mild", emoji: "🌶️" },
  { level: 2, label: "Spicy", emoji: "🌶️🌶️" },
  { level: 3, label: "Nuclear", emoji: "🌶️🌶️🌶️" },
] as const;

export interface HotTakeEntry {
  promptId: string;
  side: Side;
  take: string;
  spice: 1 | 2 | 3;
}

/** Spice level of an entry (1 = mild … 3 = nuclear). */
export type Spice = HotTakeEntry["spice"];

/**
 * "Need a spark?" openers. Deliberately side-agnostic so they fit either
 * argument; the composer swaps the current opener rather than stacking them.
 */
export const SPARK_OPENERS = [
  "Hear me out:",
  "Objectively speaking,",
  "Unpopular opinion:",
  "Let's be honest,",
  "Respectfully,",
  "I will die on this hill:",
  "Counterpoint:",
  "Plot twist:",
  "Real talk:",
  "Ask yourself this:",
  "Historians will agree:",
  "Science hasn't caught up yet, but",
  "My therapist agrees:",
  "Read this slowly:",
  "Not to be dramatic, but",
  "Let the record show:",
] as const;

export function hotTakeDisplay(entry: HotTakeEntry) {
  const prompt = getPrompt(entry.promptId);
  return {
    kind: "text" as const,
    title: `${prompt.emoji} ${prompt.prompt}`,
    body: entry.take,
    tone: `${entry.side}:${entry.spice}`,
  };
}
