/**
 * Shared game helper utilities: rarity classification, value generation,
 * Haversine distance, idle income calculation.
 */

// ---------------------------------------------------------------------------
// Rarity Classification
// ---------------------------------------------------------------------------

type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

const RARITY_PATTERNS: Record<Rarity, RegExp> = {
  legendary:
    /antique|vintage|diamond|gold|platinum|crystal|porcelain|silk|cashmere|rolex|ferrari|grand piano|chandelier|sculpture/i,
  epic: /laptop|tablet|drone|telescope|projector|camera|espresso machine|synthesizer|violin|saxophone|microscope|3d printer/i,
  rare: /watch|headphones|guitar|keyboard|monitor|bicycle|chess set|turntable|binoculars|speaker|microphone/i,
  uncommon:
    /book|plant|tool|bag|lamp|clock|candle|vase|picture frame|mirror|cushion|blanket|jar|basket|radio/i,
  common:
    /pen|cup|paper|key|bottle|spoon|fork|plate|mug|remote|tissue|tape|rubber|coin|clip|eraser|napkin|straw/i,
};

export function classifyRarity(
  objectName: string,
  confidence: number,
): Rarity {
  const name = objectName.toLowerCase();
  for (const [rarity, pattern] of Object.entries(RARITY_PATTERNS) as [
    Rarity,
    RegExp,
  ][]) {
    if (pattern.test(name)) return rarity;
  }
  // Fallback by confidence
  if (confidence > 0.95) return "rare";
  if (confidence > 0.85) return "uncommon";
  return "common";
}

// ---------------------------------------------------------------------------
// Value Generation
// ---------------------------------------------------------------------------

const VALUE_RANGES: Record<Rarity, [number, number]> = {
  common: [10, 50],
  uncommon: [50, 150],
  rare: [150, 500],
  epic: [500, 2000],
  legendary: [2000, 10000],
};

export function generateBaseValue(rarity: Rarity): number {
  const [min, max] = VALUE_RANGES[rarity];
  return Math.floor(min + Math.random() * (max - min));
}

// ---------------------------------------------------------------------------
// Haversine Distance (meters)
// ---------------------------------------------------------------------------

export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Idle Income Calculator
// ---------------------------------------------------------------------------

export function calculateIdleIncome(
  lastCollect: Date,
  staffCount: number,
  displayedRareItemCount: number,
  reputation: number,
): { coins: number; minutes: number } {
  const now = new Date();
  const diffMs = now.getTime() - lastCollect.getTime();
  const minutes = Math.min(480, Math.max(0, diffMs / 60000)); // cap 8 hours
  const ratePerMinute = staffCount * 2 + displayedRareItemCount * 5 + reputation / 10;
  const coins = Math.floor(minutes * ratePerMinute);
  return { coins, minutes: Math.floor(minutes) };
}

// ---------------------------------------------------------------------------
// Upgrade Cost Calculator
// ---------------------------------------------------------------------------

export function getUpgradeCost(
  upgradeType: string,
  currentLevel: number,
): number {
  switch (upgradeType) {
    case "display_case":
      return 100 * Math.pow(2, currentLevel - 1);
    case "staff":
      return 200 * Math.pow(2, currentLevel);
    case "decor":
      return 150 * currentLevel;
    case "location":
      return 5000 * currentLevel;
    case "advertising":
      return 300 * currentLevel;
    default:
      return 500;
  }
}

// ---------------------------------------------------------------------------
// Loot Power Generator
// ---------------------------------------------------------------------------

const RARITY_BASE_POWER: Record<Rarity, [number, number]> = {
  common: [5, 15],
  uncommon: [15, 30],
  rare: [30, 50],
  epic: [50, 80],
  legendary: [80, 120],
};

export function generateLootPower(rarity: Rarity): number {
  const [min, max] = RARITY_BASE_POWER[rarity];
  return Math.floor(min + Math.random() * (max - min));
}

// ---------------------------------------------------------------------------
// XP Awards for Alchemy
// ---------------------------------------------------------------------------

const ALCHEMY_XP: Record<string, number> = {
  common: 10,
  uncommon: 25,
  rare: 50,
  epic: 100,
  legendary: 200,
  golden: 500,
};

export function getAlchemyXP(rarity: string, isFirstDiscovery: boolean): number {
  const base = ALCHEMY_XP[rarity] ?? 10;
  return isFirstDiscovery ? Math.floor(base * 1.5) : base;
}

// ---------------------------------------------------------------------------
// Object Name Normalization
// ---------------------------------------------------------------------------

const CATEGORY_MAP: Record<string, string> = {
  // Electronics
  laptop: "laptop", notebook: "laptop", macbook: "laptop", chromebook: "laptop",
  phone: "phone", smartphone: "phone", iphone: "phone", android: "phone", mobile: "phone",
  tablet: "tablet", ipad: "tablet",
  monitor: "monitor", screen: "monitor", display: "monitor",
  keyboard: "keyboard",
  mouse: "mouse",
  headphones: "headphones", earbuds: "headphones", airpods: "headphones",
  speaker: "speaker", bluetooth: "speaker",
  camera: "camera", dslr: "camera", webcam: "camera",
  tv: "television", television: "television",
  remote: "remote", controller: "remote",
  charger: "charger", cable: "charger", cord: "charger",
  watch: "watch", smartwatch: "watch",
  drone: "drone",
  // Kitchen
  cup: "cup", mug: "cup", glass: "cup", tumbler: "cup",
  plate: "plate", dish: "plate", bowl: "plate",
  fork: "fork", spoon: "spoon", knife: "knife",
  pot: "pot", pan: "pot", wok: "pot",
  bottle: "bottle", jar: "bottle",
  kettle: "kettle", teapot: "kettle",
  toaster: "toaster",
  microwave: "microwave",
  blender: "blender", mixer: "blender",
  fridge: "fridge", refrigerator: "fridge",
  // Furniture
  chair: "chair", stool: "chair", seat: "chair",
  table: "table", desk: "table",
  bed: "bed", mattress: "bed",
  sofa: "sofa", couch: "sofa",
  lamp: "lamp", light: "lamp",
  shelf: "shelf", bookcase: "shelf",
  mirror: "mirror",
  clock: "clock",
  // Stationery
  pen: "pen", pencil: "pen", marker: "pen",
  book: "book", notebook_paper: "book", journal: "book",
  paper: "paper", document: "paper",
  scissors: "scissors",
  stapler: "stapler",
  ruler: "ruler",
  eraser: "eraser",
  tape: "tape",
  // Nature
  plant: "plant", flower: "plant", succulent: "plant", cactus: "plant",
  tree: "tree",
  rock: "rock", stone: "rock", pebble: "rock",
  leaf: "leaf",
  // Clothing
  shirt: "shirt", tshirt: "shirt", blouse: "shirt",
  pants: "pants", jeans: "pants", trousers: "pants",
  shoe: "shoe", sneaker: "shoe", boot: "shoe", sandal: "shoe",
  hat: "hat", cap: "hat", beanie: "hat",
  jacket: "jacket", coat: "jacket", hoodie: "jacket",
  bag: "bag", backpack: "bag", purse: "bag",
  sunglasses: "sunglasses", glasses: "sunglasses",
  // Music
  guitar: "guitar",
  piano: "piano", keyboard_music: "piano",
  drum: "drum",
  violin: "violin",
  // Sports
  ball: "ball", basketball: "ball", football: "ball", soccer: "ball",
  bicycle: "bicycle", bike: "bicycle",
  // Other
  key: "key", keys: "key",
  wallet: "wallet",
  umbrella: "umbrella",
  candle: "candle",
  toy: "toy", figurine: "toy",
  pillow: "pillow", cushion: "pillow",
};

export function normalizeObjectName(rawName: string): string {
  const lower = rawName.toLowerCase().trim();
  // Direct match
  if (CATEGORY_MAP[lower]) return CATEGORY_MAP[lower];
  // Partial match — find if any key is a substring
  for (const [keyword, category] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(keyword)) return category;
  }
  // No match — use the raw name lowercased
  return lower.replace(/[^a-z0-9 ]/g, "").trim();
}

/**
 * Given two object names, normalize and sort them alphabetically
 * so (A, B) === (B, A).
 */
export function normalizeRecipePair(
  a: string,
  b: string,
): [string, string] {
  const na = normalizeObjectName(a);
  const nb = normalizeObjectName(b);
  return na <= nb ? [na, nb] : [nb, na];
}

// ---------------------------------------------------------------------------
// Customer Name Generator
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  "Alex", "Bailey", "Casey", "Dana", "Ellis", "Frankie", "Glen", "Harper",
  "Indigo", "Jordan", "Kit", "Luna", "Morgan", "Nova", "Oakley", "Parker",
  "Quinn", "Riley", "Sage", "Taylor", "Uma", "Val", "Winter", "Xen", "Yuki", "Zen",
];

const TITLES = [
  "the Bargain Hunter", "the Collector", "the Curious", "the Picky",
  "the Generous", "the Enthusiast", "the Connoisseur", "the Shopper",
  "the Wanderer", "the Regular", "the VIP", "the Newbie",
];

export function generateCustomerName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const title = TITLES[Math.floor(Math.random() * TITLES.length)];
  return `${first} ${title}`;
}
