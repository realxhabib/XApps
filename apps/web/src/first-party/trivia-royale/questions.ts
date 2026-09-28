/**
 * Trivia Royale question bank.
 *
 * Evergreen, globally fair general knowledge: no politics, no religion, no
 * records or rankings that are likely to change, nothing that needs a
 * particular country's pop culture. Every question has exactly one right
 * answer and three plausible wrong ones from the same family.
 *
 * Difficulty drives the match curve: rounds 1–3 draw from 1 (warm-up),
 * 4–6 from 2, and 7–8 from 3. Rules the tests enforce: unique ids, four
 * distinct choices, every category has questions at every difficulty.
 */

export type Category =
  | "science"
  | "space"
  | "geography"
  | "history"
  | "nature"
  | "food"
  | "sport"
  | "arts"
  | "numbers"
  | "tech";

export type Difficulty = 1 | 2 | 3;

export interface TriviaQuestion {
  id: string;
  category: Category;
  difficulty: Difficulty;
  text: string;
  answer: string;
  wrong: [string, string, string];
}

export const CATEGORY_META: Record<Category, { label: string; icon: string; color: string }> = {
  science: { label: "Science", icon: "🧪", color: "#35e0ff" },
  space: { label: "Space", icon: "🚀", color: "#a35cff" },
  geography: { label: "Geography", icon: "🌍", color: "#37e39b" },
  history: { label: "History", icon: "🏛️", color: "#ffc93d" },
  nature: { label: "Nature", icon: "🦁", color: "#c6ff3d" },
  food: { label: "Food & Drink", icon: "🍜", color: "#ff8a3d" },
  sport: { label: "Sport & Games", icon: "⚽", color: "#5b74ff" },
  arts: { label: "Arts & Culture", icon: "🎨", color: "#ff5ca8" },
  numbers: { label: "Words & Numbers", icon: "🔢", color: "#9aa4ff" },
  tech: { label: "Tech & Inventions", icon: "💡", color: "#ffe14d" },
};

type Row = [difficulty: Difficulty, text: string, answer: string, wrong: [string, string, string]];

function group(category: Category, prefix: string, rows: Row[]): TriviaQuestion[] {
  return rows.map(([difficulty, text, answer, wrong], i) => ({
    id: `${prefix}${String(i + 1).padStart(2, "0")}`,
    category,
    difficulty,
    text,
    answer,
    wrong,
  }));
}

export const QUESTIONS: TriviaQuestion[] = [
  ...group("science", "sci", [
    [1, "What is the chemical symbol for gold?", "Au", ["Ag", "Gd", "Go"]],
    [1, "Which gas do plants take in from the air to make their food?", "Carbon dioxide", ["Oxygen", "Nitrogen", "Hydrogen"]],
    [1, "At sea level, water boils at what temperature?", "100 °C", ["90 °C", "110 °C", "120 °C"]],
    [1, "What is the largest organ of the human body?", "The skin", ["The liver", "The brain", "The lungs"]],
    [1, "What do we call water in its solid form?", "Ice", ["Steam", "Dew", "Vapour"]],
    [2, "Which gas makes up most of Earth's atmosphere?", "Nitrogen", ["Oxygen", "Carbon dioxide", "Argon"]],
    [2, "What is the hardest natural substance?", "Diamond", ["Quartz", "Topaz", "Granite"]],
    [2, "Which blood cells carry oxygen around the body?", "Red blood cells", ["White blood cells", "Platelets", "Plasma cells"]],
    [2, "Which element has the atomic number 1?", "Hydrogen", ["Helium", "Oxygen", "Carbon"]],
    [2, "How many bones are in the adult human body?", "206", ["186", "226", "256"]],
    [2, "Which scientist described the three laws of motion?", "Isaac Newton", ["Galileo Galilei", "Albert Einstein", "Johannes Kepler"]],
    [2, "Which metal is liquid at room temperature?", "Mercury", ["Lead", "Tin", "Aluminium"]],
    [3, "What is the chemical symbol for sodium?", "Na", ["So", "Sd", "Sn"]],
    [3, "Roughly how fast does light travel in a vacuum?", "300,000 km per second", ["30,000 km per second", "3,000,000 km per second", "3,000 km per second"]],
    [3, "What is the pH of pure water at 25 °C?", "7", ["0", "5", "14"]],
    [3, "What does DNA stand for?", "Deoxyribonucleic acid", ["Diribonucleic acid", "Deoxyribonitric acid", "Dinucleotide acid"]],
    [3, "Which part of the cell is known as its powerhouse?", "The mitochondrion", ["The nucleus", "The ribosome", "The vacuole"]],
    [3, "What kind of energy does an object have because it is moving?", "Kinetic energy", ["Potential energy", "Thermal energy", "Chemical energy"]],
  ]),

  ...group("space", "spc", [
    [1, "Which planet is known as the Red Planet?", "Mars", ["Venus", "Jupiter", "Mercury"]],
    [1, "What is the largest planet in our Solar System?", "Jupiter", ["Saturn", "Neptune", "Earth"]],
    [1, "How many planets are in our Solar System?", "8", ["7", "9", "10"]],
    [1, "Which planet is famous for its bright, wide rings?", "Saturn", ["Mars", "Mercury", "Venus"]],
    [1, "What is the name of our galaxy?", "The Milky Way", ["Andromeda", "The Whirlpool", "The Sombrero"]],
    [2, "Which planet is closest to the Sun?", "Mercury", ["Venus", "Mars", "Earth"]],
    [2, "Who was the first person to walk on the Moon?", "Neil Armstrong", ["Buzz Aldrin", "Yuri Gagarin", "Michael Collins"]],
    [2, "Who was the first human to travel into space?", "Yuri Gagarin", ["Neil Armstrong", "Alan Shepard", "John Glenn"]],
    [2, "What is the hottest planet in our Solar System?", "Venus", ["Mercury", "Mars", "Jupiter"]],
    [2, "What is a light-year a measure of?", "Distance", ["Time", "Brightness", "Speed"]],
    [2, "What was the first artificial satellite, launched in 1957?", "Sputnik 1", ["Explorer 1", "Vostok 1", "Apollo 1"]],
    [3, "Roughly how long does sunlight take to reach Earth?", "About 8 minutes", ["About 8 seconds", "About 8 hours", "About 1 minute"]],
    [3, "Which planet spins on its side, tilted about 98°?", "Uranus", ["Neptune", "Saturn", "Venus"]],
    [3, "In which year did people first land on the Moon?", "1969", ["1965", "1972", "1961"]],
    [3, "Olympus Mons, the tallest volcano in the Solar System, is on which planet?", "Mars", ["Venus", "Earth", "Mercury"]],
    [3, "Which is the largest moon in the Solar System?", "Ganymede", ["Titan", "Callisto", "Europa"]],
    [3, "What do we call a space rock that survives the fall and lands on Earth?", "A meteorite", ["A comet", "A quasar", "A pulsar"]],
  ]),

  ...group("geography", "geo", [
    [1, "What is the largest ocean on Earth?", "The Pacific", ["The Atlantic", "The Indian", "The Arctic"]],
    [1, "On which continent is the Sahara Desert?", "Africa", ["Asia", "Australia", "South America"]],
    [1, "What is the capital of Japan?", "Tokyo", ["Kyoto", "Osaka", "Seoul"]],
    [1, "Which country is shaped like a boot?", "Italy", ["Spain", "Greece", "Portugal"]],
    [1, "Which continent has no permanent residents?", "Antarctica", ["Australia", "Europe", "South America"]],
    [1, "Which ocean lies between Africa and Australia?", "The Indian Ocean", ["The Atlantic Ocean", "The Pacific Ocean", "The Arctic Ocean"]],
    [2, "Mount Kilimanjaro is in which country?", "Tanzania", ["Kenya", "Uganda", "Ethiopia"]],
    [2, "Mount Everest sits on the border of Nepal and which country?", "China", ["India", "Bhutan", "Pakistan"]],
    [2, "What is the capital of Australia?", "Canberra", ["Sydney", "Melbourne", "Perth"]],
    [2, "Which river flows through Cairo?", "The Nile", ["The Congo", "The Tigris", "The Niger"]],
    [2, "What is the smallest country in the world by area?", "Vatican City", ["Monaco", "San Marino", "Liechtenstein"]],
    [2, "What is the capital of Canada?", "Ottawa", ["Toronto", "Vancouver", "Montreal"]],
    [2, "Which is the largest continent by area?", "Asia", ["Africa", "North America", "Europe"]],
    [2, "The Great Barrier Reef lies off the coast of which country?", "Australia", ["Indonesia", "The Philippines", "Fiji"]],
    [2, "What is the capital of Brazil?", "Brasília", ["Rio de Janeiro", "São Paulo", "Salvador"]],
    [3, "What is the longest mountain range above sea level?", "The Andes", ["The Himalayas", "The Rockies", "The Alps"]],
    [3, "Lake Titicaca lies on the border of Peru and which country?", "Bolivia", ["Chile", "Ecuador", "Argentina"]],
    [3, "What is the capital of New Zealand?", "Wellington", ["Auckland", "Christchurch", "Queenstown"]],
    [3, "Which strait separates Europe from Africa at its narrowest point?", "The Strait of Gibraltar", ["The Bosphorus", "The Strait of Hormuz", "The Strait of Messina"]],
    [3, "Which is the deepest lake in the world?", "Lake Baikal", ["Lake Tanganyika", "Lake Superior", "Lake Victoria"]],
    [3, "The fjord city of Bergen is in which country?", "Norway", ["Sweden", "Iceland", "Denmark"]],
  ]),

  ...group("history", "his", [
    [1, "Which ancient civilisation built the pyramids of Giza?", "The Egyptians", ["The Romans", "The Greeks", "The Maya"]],
    [1, "In which city was the Colosseum built?", "Rome", ["Athens", "Istanbul", "Naples"]],
    [1, "Which Roman city was buried by Mount Vesuvius in 79 AD?", "Pompeii", ["Carthage", "Sparta", "Troy"]],
    [1, "Which seafaring people sailed longships out of Scandinavia?", "The Vikings", ["The Celts", "The Phoenicians", "The Saxons"]],
    [2, "Which structure was built across northern China over many centuries to guard its borders?", "The Great Wall", ["The Forbidden City", "The Terracotta Army", "The Grand Canal"]],
    [2, "In which year did the Titanic sink?", "1912", ["1905", "1918", "1923"]],
    [2, "Which civilisation built Machu Picchu?", "The Inca", ["The Aztecs", "The Maya", "The Olmecs"]],
    [2, "Who was the first woman to win a Nobel Prize?", "Marie Curie", ["Ada Lovelace", "Florence Nightingale", "Rosalind Franklin"]],
    [2, "Genghis Khan founded which empire?", "The Mongol Empire", ["The Ottoman Empire", "The Persian Empire", "The Roman Empire"]],
    [2, "Which ship carried Charles Darwin on his famous voyage?", "HMS Beagle", ["HMS Victory", "The Endeavour", "The Mayflower"]],
    [2, "What did the Wright brothers achieve in 1903?", "The first powered aeroplane flight", ["The first motor car", "The first radio broadcast", "The first hot-air balloon flight"]],
    [3, "The Rosetta Stone helped scholars decode which writing system?", "Egyptian hieroglyphs", ["Cuneiform", "Linear B", "Maya glyphs"]],
    [3, "Whose expedition completed the first voyage around the world?", "Ferdinand Magellan's", ["Christopher Columbus's", "Vasco da Gama's", "James Cook's"]],
    [3, "Who built Europe's first movable-type printing press, around 1440?", "Johannes Gutenberg", ["William Caxton", "Leonardo da Vinci", "Galileo Galilei"]],
    [3, "The Terracotta Army was buried with which Chinese emperor?", "Qin Shi Huang", ["Kublai Khan", "Emperor Wu", "Puyi"]],
    [3, "Which ancient Greek city-state was famous for its warrior culture?", "Sparta", ["Athens", "Corinth", "Thebes"]],
    [3, "The ruins of ancient Babylon are in which modern country?", "Iraq", ["Egypt", "Iran", "Turkey"]],
    [3, "Which ancient wonder was a giant bronze statue at a Greek harbour?", "The Colossus of Rhodes", ["The Lighthouse of Alexandria", "The Hanging Gardens", "The Mausoleum at Halicarnassus"]],
  ]),

  ...group("nature", "nat", [
    [1, "What is the largest animal known to have ever lived?", "The blue whale", ["The African elephant", "Argentinosaurus", "The whale shark"]],
    [1, "Which is the fastest land animal?", "The cheetah", ["The lion", "The pronghorn", "The greyhound"]],
    [1, "How many legs does an insect have?", "6", ["4", "8", "10"]],
    [1, "Which animal is known as the “ship of the desert”?", "The camel", ["The horse", "The llama", "The donkey"]],
    [1, "What do we call animals that eat only plants?", "Herbivores", ["Carnivores", "Omnivores", "Insectivores"]],
    [1, "What is the tallest animal in the world?", "The giraffe", ["The elephant", "The moose", "The ostrich"]],
    [2, "How many legs does a spider have?", "8", ["6", "10", "12"]],
    [2, "What is a group of lions called?", "A pride", ["A pack", "A herd", "A flock"]],
    [2, "Which mammal is capable of true flight?", "The bat", ["The flying squirrel", "The sugar glider", "The flying lemur"]],
    [2, "What is the largest species of big cat?", "The tiger", ["The lion", "The jaguar", "The leopard"]],
    [2, "What is a baby kangaroo called?", "A joey", ["A kit", "A cub", "A calf"]],
    [2, "Giant pandas eat mostly what?", "Bamboo", ["Eucalyptus", "Fish", "Berries"]],
    [2, "Which is the largest living bird?", "The ostrich", ["The emu", "The albatross", "The condor"]],
    [3, "How many hearts does an octopus have?", "3", ["1", "2", "8"]],
    [3, "Which tree grows acorns?", "The oak", ["The maple", "The birch", "The pine"]],
    [3, "Koalas feed almost only on the leaves of which tree?", "Eucalyptus", ["Bamboo", "Acacia", "Oak"]],
    [3, "Which of these mammals lays eggs?", "The platypus", ["The otter", "The beaver", "The wombat"]],
    [3, "Which flightless birds huddle together through the Antarctic winter?", "Emperor penguins", ["Albatrosses", "Puffins", "Ostriches"]],
  ]),

  ...group("food", "fod", [
    [1, "Which country does sushi come from?", "Japan", ["China", "Korea", "Thailand"]],
    [1, "Guacamole is made mainly from which fruit?", "Avocado", ["Lime", "Tomato", "Green pepper"]],
    [1, "Which country is famous for the pizza Margherita?", "Italy", ["Greece", "France", "Spain"]],
    [1, "Which vegetable is famous for making people cry when they cut it?", "The onion", ["The carrot", "The leek", "The potato"]],
    [1, "Which fruit is dried to make raisins?", "Grapes", ["Plums", "Figs", "Dates"]],
    [2, "Which spice, picked from crocus flowers, is the priciest by weight?", "Saffron", ["Vanilla", "Cardamom", "Turmeric"]],
    [2, "What is the main ingredient of hummus?", "Chickpeas", ["Lentils", "Fava beans", "White beans"]],
    [2, "Paella is a traditional rice dish from which country?", "Spain", ["Portugal", "Mexico", "Italy"]],
    [2, "Which nut is used to make marzipan?", "Almond", ["Walnut", "Cashew", "Hazelnut"]],
    [2, "Kimchi, usually made with fermented cabbage, comes from which country?", "Korea", ["Japan", "Vietnam", "China"]],
    [2, "What is tofu made from?", "Soybeans", ["Rice", "Chickpeas", "Coconut"]],
    [2, "Pad thai comes from which country?", "Thailand", ["Vietnam", "Malaysia", "Indonesia"]],
    [2, "Which cheese is traditionally used on a pizza Margherita?", "Mozzarella", ["Parmesan", "Cheddar", "Feta"]],
    [3, "Which grain is used to brew Japanese sake?", "Rice", ["Barley", "Wheat", "Millet"]],
    [3, "Which fruit wears its seeds on the outside?", "The strawberry", ["The raspberry", "The kiwi", "The blueberry"]],
    [3, "Couscous is made from which grain?", "Durum wheat", ["Rice", "Maize", "Quinoa"]],
    [3, "Which spiky Southeast Asian fruit is famous for its powerful smell?", "Durian", ["Jackfruit", "Mangosteen", "Rambutan"]],
    [3, "Which compound gives chilli peppers their heat?", "Capsaicin", ["Caffeine", "Piperine", "Menthol"]],
    [3, "Dal, a staple across South Asia, is made mainly from what?", "Lentils or split pulses", ["Rice", "Paneer", "Potatoes"]],
  ]),

  ...group("sport", "spt", [
    [1, "How many players does a football (soccer) team have on the pitch?", "11", ["9", "10", "12"]],
    [1, "In which sport would you perform a slam dunk?", "Basketball", ["Volleyball", "Tennis", "Handball"]],
    [1, "How many sides does a standard die have?", "6", ["4", "8", "12"]],
    [1, "How many cards are in a standard deck, without jokers?", "52", ["48", "54", "56"]],
    [1, "Which sport is played at Wimbledon?", "Tennis", ["Cricket", "Golf", "Polo"]],
    [2, "How many rings are on the Olympic flag?", "5", ["4", "6", "7"]],
    [2, "In tennis, what is a score of zero called?", "Love", ["Nil", "Duck", "Blank"]],
    [2, "How many squares are on a chessboard?", "64", ["49", "81", "100"]],
    [2, "Which chess piece can only ever move diagonally?", "The bishop", ["The rook", "The knight", "The king"]],
    [2, "In which sport do you hit a shuttlecock?", "Badminton", ["Squash", "Table tennis", "Cricket"]],
    [2, "How long is a marathon?", "About 42.2 km", ["About 26.2 km", "About 32 km", "About 50 km"]],
    [2, "In golf, what is one stroke under par called?", "A birdie", ["An eagle", "A bogey", "An albatross"]],
    [2, "How many players are on court for one volleyball team?", "6", ["5", "7", "8"]],
    [3, "Which country hosted the first modern Olympic Games, in 1896?", "Greece", ["France", "The United Kingdom", "The United States"]],
    [3, "What is the highest score possible with three darts?", "180", ["150", "160", "200"]],
    [3, "In snooker, how many points is the black ball worth?", "7", ["5", "6", "10"]],
    [3, "Which martial art's name means “the gentle way”?", "Judo", ["Karate", "Taekwondo", "Kung fu"]],
    [3, "In cricket, how many balls are bowled in a standard over?", "6", ["4", "8", "10"]],
  ]),

  ...group("arts", "art", [
    [1, "Who painted the Mona Lisa?", "Leonardo da Vinci", ["Michelangelo", "Raphael", "Botticelli"]],
    [1, "How many strings does a standard guitar have?", "6", ["4", "5", "8"]],
    [1, "In which city is the Louvre museum?", "Paris", ["London", "Rome", "Madrid"]],
    [1, "Who wrote “Romeo and Juliet”?", "William Shakespeare", ["Charles Dickens", "Jane Austen", "Christopher Marlowe"]],
    [1, "Who wrote the Harry Potter books?", "J.K. Rowling", ["Roald Dahl", "C.S. Lewis", "Philip Pullman"]],
    [2, "Who painted “The Starry Night”?", "Vincent van Gogh", ["Claude Monet", "Pablo Picasso", "Salvador Dalí"]],
    [2, "Which composer kept writing music after losing his hearing?", "Ludwig van Beethoven", ["Wolfgang Amadeus Mozart", "Johann Sebastian Bach", "Frédéric Chopin"]],
    [2, "Which artist painted melting clocks in “The Persistence of Memory”?", "Salvador Dalí", ["René Magritte", "Pablo Picasso", "Joan Miró"]],
    [2, "Who painted “Girl with a Pearl Earring”?", "Johannes Vermeer", ["Rembrandt", "Frans Hals", "Vincent van Gogh"]],
    [2, "The art of folding paper into shapes is known by which Japanese name?", "Origami", ["Ikebana", "Bonsai", "Kirigami"]],
    [2, "What are the three primary colours in traditional painting?", "Red, yellow and blue", ["Red, green and blue", "Red, yellow and green", "Blue, green and yellow"]],
    [2, "Which ballet features the Dance of the Sugar Plum Fairy?", "The Nutcracker", ["Swan Lake", "Giselle", "Sleeping Beauty"]],
    [2, "Which Shakespeare play contains the line “To be, or not to be”?", "Hamlet", ["Macbeth", "Othello", "King Lear"]],
    [3, "How many keys does a standard piano have?", "88", ["76", "92", "100"]],
    [3, "Which Norwegian painter created “The Scream”?", "Edvard Munch", ["Gustav Klimt", "Egon Schiele", "Wassily Kandinsky"]],
    [3, "Who wrote “Don Quixote”?", "Miguel de Cervantes", ["Gabriel García Márquez", "Lope de Vega", "Jorge Luis Borges"]],
    [3, "Which author created the detective Hercule Poirot?", "Agatha Christie", ["Arthur Conan Doyle", "Dorothy L. Sayers", "Georges Simenon"]],
    [3, "Who composed “The Four Seasons”?", "Antonio Vivaldi", ["Johann Sebastian Bach", "George Frideric Handel", "Joseph Haydn"]],
    [3, "Which country was the composer Frédéric Chopin from?", "Poland", ["France", "Austria", "Hungary"]],
  ]),

  ...group("numbers", "num", [
    [1, "How many sides does a hexagon have?", "6", ["5", "7", "8"]],
    [1, "What is 12 × 12?", "144", ["124", "132", "156"]],
    [1, "How many degrees are in a right angle?", "90", ["45", "180", "360"]],
    [1, "What number does the Roman numeral X stand for?", "10", ["5", "50", "100"]],
    [1, "How many zeros are in one million?", "6", ["5", "7", "9"]],
    [2, "What is the square root of 81?", "9", ["8", "7", "18"]],
    [2, "Which Roman numeral stands for 50?", "L", ["C", "D", "X"]],
    [2, "How many minutes are in a day?", "1,440", ["1,200", "1,560", "2,400"]],
    [2, "What is the only even prime number?", "2", ["4", "0", "6"]],
    [2, "What is the next prime number after 7?", "11", ["9", "13", "10"]],
    [2, "How many seconds are in an hour?", "3,600", ["360", "6,000", "36,000"]],
    [2, "What is the word for a word with the opposite meaning?", "An antonym", ["A synonym", "A homonym", "A pseudonym"]],
    [3, "What is pi to two decimal places?", "3.14", ["3.41", "3.12", "3.16"]],
    [3, "What do we call a word that reads the same backwards?", "A palindrome", ["An anagram", "An acronym", "A homophone"]],
    [3, "What is 15% of 200?", "30", ["15", "25", "35"]],
    [3, "How many sides does a dodecagon have?", "12", ["10", "14", "20"]],
    [3, "In the sequence 1, 1, 2, 3, 5, 8… what comes next?", "13", ["11", "12", "16"]],
    [3, "Which letter is used most often in written English?", "E", ["A", "T", "S"]],
    [3, "What is 2 to the power of 10?", "1,024", ["1,000", "512", "2,048"]],
  ]),

  ...group("tech", "tec", [
    [1, "What does “www” stand for in a web address?", "World Wide Web", ["World Web Wire", "Wide World Web", "Web Wide World"]],
    [1, "What does a thermometer measure?", "Temperature", ["Air pressure", "Humidity", "Wind speed"]],
    [1, "What does “AI” stand for?", "Artificial intelligence", ["Automatic input", "Advanced internet", "Analog interface"]],
    [1, "Which device turns sound into an electrical signal?", "A microphone", ["A loudspeaker", "An amplifier", "A battery"]],
    [1, "What does the “e” in “email” stand for?", "Electronic", ["Express", "External", "Easy"]],
    [2, "Who is credited with patenting the telephone in 1876?", "Alexander Graham Bell", ["Thomas Edison", "Nikola Tesla", "Guglielmo Marconi"]],
    [2, "What does “CPU” stand for?", "Central processing unit", ["Computer power unit", "Central program utility", "Core processing unit"]],
    [2, "Which programming language is named after a snake?", "Python", ["Java", "Ruby", "Swift"]],
    [2, "Who is often called the first computer programmer?", "Ada Lovelace", ["Grace Hopper", "Marie Curie", "Katherine Johnson"]],
    [2, "How many bits are in a byte?", "8", ["4", "10", "16"]],
    [2, "What does GPS stand for?", "Global Positioning System", ["General Positioning Service", "Geographic Pinpoint System", "Global Pathfinding Satellite"]],
    [2, "Who discovered penicillin in 1928?", "Alexander Fleming", ["Louis Pasteur", "Joseph Lister", "Edward Jenner"]],
    [2, "Who is famous for a practical, long-lasting incandescent light bulb?", "Thomas Edison", ["Nikola Tesla", "Alexander Graham Bell", "Michael Faraday"]],
    [3, "What does “USB” stand for?", "Universal Serial Bus", ["United System Board", "Universal Signal Box", "Unified Serial Bridge"]],
    [3, "What does “HTTP” stand for?", "HyperText Transfer Protocol", ["High Transfer Text Protocol", "HyperText Transmission Program", "Hyperlink Text Transfer Process"]],
    [3, "Who invented the World Wide Web?", "Tim Berners-Lee", ["Bill Gates", "Steve Jobs", "Vint Cerf"]],
    [3, "What is the binary number 101 in decimal?", "5", ["3", "6", "101"]],
    [3, "Who developed the first vaccine, against smallpox?", "Edward Jenner", ["Louis Pasteur", "Jonas Salk", "Alexander Fleming"]],
    [3, "What does the “QR” in QR code stand for?", "Quick Response", ["Quality Rating", "Quick Read", "Query Result"]],
  ]),
];
