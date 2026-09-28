/**
 * Emoji Decode puzzle bank.
 *
 * Every puzzle is an original emoji "rebus" for a well-known movie title,
 * idiom, everyday phrase or song. Distractors stay in the same category and
 * share a vibe with the emoji (a snow puzzle gets snowy wrong answers), so a
 * glance is never enough — you have to actually decode it.
 *
 * Rules the tests enforce: unique ids, 1–5 emoji per puzzle, three distinct
 * distractors that never repeat the answer.
 */

export type PuzzleCategory = "Movie" | "Idiom" | "Phrase" | "Song";

export interface Puzzle {
  id: string;
  /** The rebus. Rendered one grapheme per tile. */
  emoji: string;
  answer: string;
  distractors: [string, string, string];
  category: PuzzleCategory;
}

export const CATEGORY_META: Record<PuzzleCategory, { label: string; icon: string }> = {
  Movie: { label: "Movie", icon: "🎬" },
  Idiom: { label: "Idiom", icon: "💬" },
  Phrase: { label: "Phrase", icon: "🗣️" },
  Song: { label: "Song", icon: "🎵" },
};

export const PUZZLES: readonly Puzzle[] = [
  /* ------------------------------------------------------------------ */
  /* Movies                                                             */
  /* ------------------------------------------------------------------ */
  { id: "mv-lion-king", category: "Movie", emoji: "🦁👑", answer: "The Lion King", distractors: ["The Jungle Book", "Madagascar", "King Kong"] },
  { id: "mv-finding-nemo", category: "Movie", emoji: "🔍🐠", answer: "Finding Nemo", distractors: ["Shark Tale", "The Little Mermaid", "Moana"] },
  { id: "mv-titanic", category: "Movie", emoji: "🚢🧊💔", answer: "Titanic", distractors: ["Frozen", "Cast Away", "Pirates of the Caribbean"] },
  { id: "mv-jurassic-park", category: "Movie", emoji: "🦖🏝️🚙", answer: "Jurassic Park", distractors: ["Godzilla", "King Kong", "The Land Before Time"] },
  { id: "mv-spider-man", category: "Movie", emoji: "🕷️👨", answer: "Spider-Man", distractors: ["Ant-Man", "Batman", "Iron Man"] },
  { id: "mv-ghostbusters", category: "Movie", emoji: "👻🚫", answer: "Ghostbusters", distractors: ["Casper", "Beetlejuice", "The Sixth Sense"] },
  { id: "mv-frozen", category: "Movie", emoji: "⛄❄️👭", answer: "Frozen", distractors: ["Snow White", "Happy Feet", "Ice Age"] },
  { id: "mv-home-alone", category: "Movie", emoji: "🏠👦🎄", answer: "Home Alone", distractors: ["Elf", "The Polar Express", "The Santa Clause"] },
  { id: "mv-et", category: "Movie", emoji: "👽📞🏠", answer: "E.T. the Extra-Terrestrial", distractors: ["Men in Black", "Independence Day", "Signs"] },
  { id: "mv-lotr", category: "Movie", emoji: "🧙‍♂️💍🌋", answer: "The Lord of the Rings", distractors: ["Harry Potter", "The Wizard of Oz", "Doctor Strange"] },
  { id: "mv-star-wars", category: "Movie", emoji: "⭐⚔️🌌", answer: "Star Wars", distractors: ["Star Trek", "Guardians of the Galaxy", "Dune"] },
  { id: "mv-chocolate-factory", category: "Movie", emoji: "🍫🏭🎫", answer: "Charlie and the Chocolate Factory", distractors: ["Chocolat", "Ratatouille", "Matilda"] },
  { id: "mv-ratatouille", category: "Movie", emoji: "🐀👨‍🍳🍲", answer: "Ratatouille", distractors: ["Chef", "Stuart Little", "Julie & Julia"] },
  { id: "mv-up", category: "Movie", emoji: "🎈🎈🏠👴", answer: "Up", distractors: ["Coco", "Home", "The Wizard of Oz"] },
  { id: "mv-jaws", category: "Movie", emoji: "🦈🏖️😱", answer: "Jaws", distractors: ["The Meg", "Finding Nemo", "Baywatch"] },
  { id: "mv-wall-e", category: "Movie", emoji: "🤖❤️🌱", answer: "WALL·E", distractors: ["Big Hero 6", "The Iron Giant", "I, Robot"] },
  { id: "mv-kung-fu-panda", category: "Movie", emoji: "🐼🥋", answer: "Kung Fu Panda", distractors: ["The Karate Kid", "Mulan", "Big Hero 6"] },
  { id: "mv-wizard-of-oz", category: "Movie", emoji: "🌪️👠🦁", answer: "The Wizard of Oz", distractors: ["Twister", "The Lion King", "Cinderella"] },
  { id: "mv-aladdin", category: "Movie", emoji: "🧞‍♂️🪔", answer: "Aladdin", distractors: ["Hercules", "Mulan", "Pocahontas"] },
  { id: "mv-toy-story", category: "Movie", emoji: "🧸🤠🚀", answer: "Toy Story", distractors: ["Cars", "Night at the Museum", "Home on the Range"] },
  { id: "mv-interstellar", category: "Movie", emoji: "🚀🕳️⏳", answer: "Interstellar", distractors: ["Gravity", "The Martian", "Apollo 13"] },
  { id: "mv-ice-age", category: "Movie", emoji: "🧊⏳🐿️🌰", answer: "Ice Age", distractors: ["Happy Feet", "Frozen", "Madagascar"] },
  { id: "mv-coco", category: "Movie", emoji: "💀🎸🌼", answer: "Coco", distractors: ["Encanto", "Soul", "Corpse Bride"] },
  { id: "mv-beauty-beast", category: "Movie", emoji: "👸🌹👹", answer: "Beauty and the Beast", distractors: ["Sleeping Beauty", "Shrek", "Cinderella"] },
  { id: "mv-matrix", category: "Movie", emoji: "💊🔴🔵🕶️", answer: "The Matrix", distractors: ["Inception", "Tron", "Men in Black"] },
  { id: "mv-back-to-future", category: "Movie", emoji: "🔙🚗⚡⏰", answer: "Back to the Future", distractors: ["The Time Machine", "Groundhog Day", "Cars"] },

  /* ------------------------------------------------------------------ */
  /* Idioms                                                             */
  /* ------------------------------------------------------------------ */
  { id: "id-cats-dogs", category: "Idiom", emoji: "🌧️🐱🐶", answer: "Raining cats and dogs", distractors: ["Fighting like cats and dogs", "Every dog has its day", "Let sleeping dogs lie"] },
  { id: "id-cat-bag", category: "Idiom", emoji: "🐱👜", answer: "Let the cat out of the bag", distractors: ["Cat got your tongue", "It's in the bag", "Look what the cat dragged in"] },
  { id: "id-piece-cake", category: "Idiom", emoji: "🧩🍰", answer: "Piece of cake", distractors: ["Icing on the cake", "Have your cake and eat it too", "Easy as pie"] },
  { id: "id-elephant-room", category: "Idiom", emoji: "🐘🛋️🚪", answer: "The elephant in the room", distractors: ["A bull in a china shop", "A white elephant", "An elephant never forgets"] },
  { id: "id-break-ice", category: "Idiom", emoji: "🔨🧊", answer: "Break the ice", distractors: ["Cold feet", "Tip of the iceberg", "Skating on thin ice"] },
  { id: "id-blue-moon", category: "Idiom", emoji: "1️⃣🔵🌙", answer: "Once in a blue moon", distractors: ["Over the moon", "Out of the blue", "Feeling blue"] },
  { id: "id-cold-feet", category: "Idiom", emoji: "🥶🦶🦶", answer: "Cold feet", distractors: ["Cold shoulder", "Put your foot down", "Get off on the wrong foot"] },
  { id: "id-hold-horses", category: "Idiom", emoji: "✋🐎🐎", answer: "Hold your horses", distractors: ["Straight from the horse's mouth", "Get off your high horse", "Don't look a gift horse in the mouth"] },
  { id: "id-time-flies", category: "Idiom", emoji: "⏰✈️", answer: "Time flies", distractors: ["Time is money", "Only time will tell", "In the nick of time"] },
  { id: "id-time-money", category: "Idiom", emoji: "⏰💰", answer: "Time is money", distractors: ["Money talks", "Time flies", "Money doesn't grow on trees"] },
  { id: "id-ants-pants", category: "Idiom", emoji: "🐜🐜👖", answer: "Ants in your pants", distractors: ["Butterflies in your stomach", "A bee in your bonnet", "A bug in the system"] },
  { id: "id-cup-tea", category: "Idiom", emoji: "🙅🍵", answer: "Not my cup of tea", distractors: ["Spill the tea", "A storm in a teacup", "Wake up and smell the coffee"] },
  { id: "id-fish-water", category: "Idiom", emoji: "🐟🏜️", answer: "A fish out of water", distractors: ["Plenty of fish in the sea", "Something smells fishy", "A big fish in a small pond"] },
  { id: "id-cool-cucumber", category: "Idiom", emoji: "😎🥒", answer: "Cool as a cucumber", distractors: ["In a pickle", "Couch potato", "Cool your jets"] },
  { id: "id-couch-potato", category: "Idiom", emoji: "🛋️🥔", answer: "Couch potato", distractors: ["Hot potato", "Lazy bones", "Bump on a log"] },
  { id: "id-china-shop", category: "Idiom", emoji: "🐂🍽️🏪", answer: "A bull in a china shop", distractors: ["The elephant in the room", "Take the bull by the horns", "A kid in a candy store"] },
  { id: "id-under-weather", category: "Idiom", emoji: "🤒🌦️", answer: "Under the weather", distractors: ["Weather the storm", "Right as rain", "Head in the clouds"] },
  { id: "id-cloud-nine", category: "Idiom", emoji: "☁️9️⃣😊", answer: "On cloud nine", distractors: ["Head in the clouds", "Over the moon", "In seventh heaven"] },
  { id: "id-foot-mouth", category: "Idiom", emoji: "🦶👄", answer: "Put your foot in your mouth", distractors: ["Bite your tongue", "Put your best foot forward", "Get off on the wrong foot"] },
  { id: "id-money-trees", category: "Idiom", emoji: "💸🚫🌳", answer: "Money doesn't grow on trees", distractors: ["Money talks", "Time is money", "Barking up the wrong tree"] },
  { id: "id-apple-eye", category: "Idiom", emoji: "🍎👁️", answer: "The apple of my eye", distractors: ["A bad apple", "An eye for an eye", "Apples and oranges"] },
  { id: "id-over-moon", category: "Idiom", emoji: "🐄⤴️🌙", answer: "Over the moon", distractors: ["Once in a blue moon", "Over the hill", "Reach for the stars"] },

  /* ------------------------------------------------------------------ */
  /* Phrases                                                            */
  /* ------------------------------------------------------------------ */
  { id: "ph-see-no-evil", category: "Phrase", emoji: "🙈🙉🙊", answer: "See no evil, hear no evil, speak no evil", distractors: ["Monkey see, monkey do", "Out of sight, out of mind", "Speak of the devil"] },
  { id: "ph-lemonade", category: "Phrase", emoji: "🍋➡️🍹", answer: "When life gives you lemons, make lemonade", distractors: ["Easy peasy lemon squeezy", "An apple a day keeps the doctor away", "Life's a beach"] },
  { id: "ph-chicken-egg", category: "Phrase", emoji: "🐔❓🥚", answer: "Which came first, the chicken or the egg?", distractors: ["Don't count your chickens before they hatch", "Walking on eggshells", "Don't put all your eggs in one basket"] },
  { id: "ph-apple-day", category: "Phrase", emoji: "🍎📅🚫👨‍⚕️", answer: "An apple a day keeps the doctor away", distractors: ["The apple doesn't fall far from the tree", "Laughter is the best medicine", "Early to bed, early to rise"] },
  { id: "ph-early-bird", category: "Phrase", emoji: "⏰🐦🐛", answer: "The early bird catches the worm", distractors: ["Rise and shine", "Birds of a feather flock together", "A bird in the hand is worth two in the bush"] },
  { id: "ph-bedbugs", category: "Phrase", emoji: "🛏️🐛🚫", answer: "Don't let the bedbugs bite", distractors: ["Sleep like a log", "Rise and shine", "Sweet dreams"] },
  { id: "ph-slow-steady", category: "Phrase", emoji: "🐢🏁🏆", answer: "Slow and steady wins the race", distractors: ["Better late than never", "Haste makes waste", "You win some, you lose some"] },
  { id: "ph-home-sweet", category: "Phrase", emoji: "🏠🍬🏠", answer: "Home sweet home", distractors: ["Home is where the heart is", "Sweet dreams", "Make yourself at home"] },
  { id: "ph-break-leg", category: "Phrase", emoji: "💔🦵🎭", answer: "Break a leg", distractors: ["Fingers crossed", "Cost an arm and a leg", "Steal the show"] },
  { id: "ph-pants-fire", category: "Phrase", emoji: "🤥👖🔥", answer: "Liar, liar, pants on fire", distractors: ["Cross my heart", "Hot under the collar", "Keep your shirt on"] },
  { id: "ph-small-world", category: "Phrase", emoji: "🤏🌍", answer: "It's a small world", distractors: ["The world is your oyster", "Out of this world", "Small talk"] },
  { id: "ph-counting-sheep", category: "Phrase", emoji: "🔢🐑💤", answer: "Counting sheep", distractors: ["Sleep like a log", "The black sheep", "Sweet dreams"] },
  { id: "ph-fingers-crossed", category: "Phrase", emoji: "🤞🍀", answer: "Fingers crossed", distractors: ["Break a leg", "Knock on wood", "Luck of the draw"] },
  { id: "ph-world-oyster", category: "Phrase", emoji: "🌍🦪", answer: "The world is your oyster", distractors: ["It's a small world", "Out of this world", "Pearls of wisdom"] },

  /* ------------------------------------------------------------------ */
  /* Songs & rhymes                                                     */
  /* ------------------------------------------------------------------ */
  { id: "sg-twinkle", category: "Song", emoji: "✨⭐✨", answer: "Twinkle, Twinkle, Little Star", distractors: ["Rock-a-Bye Baby", "You Are My Sunshine", "Hey Diddle Diddle"] },
  { id: "sg-itsy-bitsy", category: "Song", emoji: "🕷️🌧️☀️", answer: "The Itsy Bitsy Spider", distractors: ["Little Miss Muffet", "Hickory Dickory Dock", "Rain, Rain, Go Away"] },
  { id: "sg-row-boat", category: "Song", emoji: "🚣🚣🚣🌊", answer: "Row, Row, Row Your Boat", distractors: ["Michael, Row the Boat Ashore", "Rock the Boat", "London Bridge Is Falling Down"] },
  { id: "sg-humpty", category: "Song", emoji: "🥚🧱💥", answer: "Humpty Dumpty", distractors: ["Jack and Jill", "London Bridge Is Falling Down", "Hickory Dickory Dock"] },
  { id: "sg-old-macdonald", category: "Song", emoji: "👨‍🌾🐄🐖🐑", answer: "Old MacDonald Had a Farm", distractors: ["The Farmer in the Dell", "Mary Had a Little Lamb", "Baa, Baa, Black Sheep"] },
  { id: "sg-hickory", category: "Song", emoji: "🐭🕐⬆️", answer: "Hickory Dickory Dock", distractors: ["Three Blind Mice", "Rock Around the Clock", "Humpty Dumpty"] },
  { id: "sg-london-bridge", category: "Song", emoji: "💂🌉⬇️", answer: "London Bridge Is Falling Down", distractors: ["Bridge over Troubled Water", "Ring Around the Rosie", "Humpty Dumpty"] },
  { id: "sg-walking-sunshine", category: "Song", emoji: "🚶☀️😄", answer: "Walking on Sunshine", distractors: ["Here Comes the Sun", "Mr. Blue Sky", "You Are My Sunshine"] },
  { id: "sg-singin-rain", category: "Song", emoji: "💃☔🎤", answer: "Singin' in the Rain", distractors: ["Umbrella", "Purple Rain", "Raindrops Keep Fallin' on My Head"] },
  { id: "sg-ice-ice-baby", category: "Song", emoji: "🧊🧊👶", answer: "Ice Ice Baby", distractors: ["Cold as Ice", "Baby Shark", "Let It Go"] },
  { id: "sg-yellow-sub", category: "Song", emoji: "🟡🚢🌊", answer: "Yellow Submarine", distractors: ["Rock the Boat", "Octopus's Garden", "Sail Away"] },
  { id: "sg-jingle-bells", category: "Song", emoji: "🔔🔔🛷🎅", answer: "Jingle Bells", distractors: ["Deck the Halls", "Let It Snow", "Frosty the Snowman"] },
  { id: "sg-rudolph", category: "Song", emoji: "🦌🔴👃", answer: "Rudolph the Red-Nosed Reindeer", distractors: ["Frosty the Snowman", "Jingle Bells", "Here Comes Santa Claus"] },
  { id: "sg-mary-lamb", category: "Song", emoji: "👧🐑🎶", answer: "Mary Had a Little Lamb", distractors: ["Baa, Baa, Black Sheep", "Little Bo-Peep", "Old MacDonald Had a Farm"] },
  { id: "sg-under-sea", category: "Song", emoji: "🦀🌊🎶", answer: "Under the Sea", distractors: ["Octopus's Garden", "Beyond the Sea", "Yellow Submarine"] },
  { id: "sg-purple-rain", category: "Song", emoji: "💜🌧️", answer: "Purple Rain", distractors: ["Singin' in the Rain", "November Rain", "Umbrella"] },
];
