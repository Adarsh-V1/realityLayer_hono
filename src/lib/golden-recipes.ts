/**
 * 50 pre-seeded golden alchemy recipes — special combinations that
 * yield legendary items when discovered.
 */

export interface GoldenRecipeSeed {
  inputA: string;
  inputB: string;
  resultName: string;
  resultDescription: string;
  category: "gadgets" | "food" | "transport" | "fashion" | "tools" | "magic" | "nature" | "misc";
}

export const GOLDEN_RECIPES: GoldenRecipeSeed[] = [
  // Gadgets
  { inputA: "phone", inputB: "plant", resultName: "BioPhone", resultDescription: "A living smartphone that photosynthesizes to charge itself and grows new features as branches.", category: "gadgets" },
  { inputA: "clock", inputB: "camera", resultName: "Chrono Lens", resultDescription: "A camera that captures photos from the past or future. Wind the dial to choose your temporal destination.", category: "gadgets" },
  { inputA: "headphones", inputB: "book", resultName: "Mind Reader", resultDescription: "Headphones that read books aloud in the author's actual voice, channeled from across time and space.", category: "gadgets" },
  { inputA: "lamp", inputB: "guitar", resultName: "Lumina Strings", resultDescription: "A guitar whose strings emit colored light beams based on the notes played, painting the air with music.", category: "gadgets" },
  { inputA: "keyboard", inputB: "candle", resultName: "Flame Writer", resultDescription: "A keyboard that writes in hovering fire letters. Each keystroke produces a tiny flame that forms words in midair.", category: "gadgets" },
  { inputA: "monitor", inputB: "mirror", resultName: "Reality Screen", resultDescription: "A screen that shows what's happening in parallel dimensions. Toggle between 11 alternate realities.", category: "gadgets" },
  { inputA: "drone", inputB: "umbrella", resultName: "Storm Rider", resultDescription: "A personal flying umbrella-drone that carries you through rainstorms while keeping you perfectly dry.", category: "gadgets" },
  { inputA: "speaker", inputB: "rock", resultName: "Echo Stone", resultDescription: "A mystical stone that amplifies whispers to thunder and can replay any sound it has ever heard.", category: "gadgets" },

  // Food
  { inputA: "cup", inputB: "sunglasses", resultName: "Visio Brew", resultDescription: "A beverage that grants temporary X-ray vision. Serve hot for bones, cold for through walls.", category: "food" },
  { inputA: "plate", inputB: "clock", resultName: "Time Feast Platter", resultDescription: "Food placed on this plate never spoils and tastes freshly cooked no matter how old it gets.", category: "food" },
  { inputA: "bottle", inputB: "lamp", resultName: "Liquid Light", resultDescription: "A glowing drink that makes the drinker's body emit soft bioluminescence for 24 hours.", category: "food" },
  { inputA: "spoon", inputB: "key", resultName: "Unlock Ladle", resultDescription: "A spoon that can stir any locked container open and turns water into any soup the user imagines.", category: "food" },
  { inputA: "fork", inputB: "plant", resultName: "Garden Fork", resultDescription: "Any food touched by this fork instantly grows its ingredients as a small garden on the table.", category: "food" },
  { inputA: "kettle", inputB: "shoe", resultName: "Wanderer's Brew", resultDescription: "Tea from this kettle gives the drinker perfect knowledge of all paths within a 10km radius.", category: "food" },

  // Transport
  { inputA: "shoe", inputB: "lamp", resultName: "Lightwalkers", resultDescription: "Shoes that create a glowing path of light beneath your feet and let you walk on any surface, including water.", category: "transport" },
  { inputA: "bicycle", inputB: "clock", resultName: "ChronoCycle", resultDescription: "A bike that travels through time. Pedal forward for the future, backward for the past. Speed = years per hour.", category: "transport" },
  { inputA: "chair", inputB: "drone", resultName: "Hover Throne", resultDescription: "An antigravity armchair that floats 3 feet above ground and follows your gaze for navigation.", category: "transport" },
  { inputA: "bag", inputB: "table", resultName: "Pocket Dimension Satchel", resultDescription: "A bag that contains a furnished room inside. Step through the flap into your portable apartment.", category: "transport" },
  { inputA: "umbrella", inputB: "bicycle", resultName: "Wind Glider", resultDescription: "An umbrella that catches wind currents and lets you glide between buildings like a graceful bird.", category: "transport" },
  { inputA: "skateboard", inputB: "speaker", resultName: "Sonic Board", resultDescription: "A hoverboard propelled by sound waves. The louder the music, the faster it goes.", category: "transport" },

  // Fashion
  { inputA: "hat", inputB: "camera", resultName: "Memory Cap", resultDescription: "A hat that records everything you see and lets you replay memories as holograms by tipping the brim.", category: "fashion" },
  { inputA: "jacket", inputB: "lamp", resultName: "Aurora Coat", resultDescription: "A coat that displays the northern lights across its fabric, warming the wearer with captured starlight.", category: "fashion" },
  { inputA: "sunglasses", inputB: "book", resultName: "Wisdom Shades", resultDescription: "Glasses that display the life story of anyone you look at, including their happiest memory.", category: "fashion" },
  { inputA: "wallet", inputB: "plant", resultName: "Money Tree Wallet", resultDescription: "A wallet that slowly grows currency from a tiny bonsai tree inside. The more you save, the faster it grows.", category: "fashion" },
  { inputA: "watch", inputB: "candle", resultName: "Ember Watch", resultDescription: "A timepiece with a living flame that never goes out. It can heat objects, tell fortunes, and slow time for 3 seconds.", category: "fashion" },
  { inputA: "shirt", inputB: "monitor", resultName: "Living Canvas Tee", resultDescription: "A t-shirt that displays real-time feeds, memes, or art. Gesture-controlled with collar swipe.", category: "fashion" },

  // Tools
  { inputA: "pen", inputB: "lamp", resultName: "Light Scribe", resultDescription: "A pen that writes in beams of solid light. Anything drawn becomes a temporary 3D hologram.", category: "tools" },
  { inputA: "scissors", inputB: "clock", resultName: "Time Shears", resultDescription: "Scissors that can cut out moments in time. Snip a bad memory, paste in a good one.", category: "tools" },
  { inputA: "ruler", inputB: "mirror", resultName: "Infinity Ruler", resultDescription: "A ruler that measures anything—distance, emotions, probability, and the gap between dimensions.", category: "tools" },
  { inputA: "tape", inputB: "rock", resultName: "Geo Tape", resultDescription: "Tape that bonds anything to anything with geological-scale permanence. Also works on abstract concepts.", category: "tools" },
  { inputA: "stapler", inputB: "guitar", resultName: "Rhythm Binder", resultDescription: "A stapler that binds pages with musical notes. Each document plays its content as a song when opened.", category: "tools" },
  { inputA: "eraser", inputB: "mirror", resultName: "Reality Eraser", resultDescription: "An eraser that removes things from existence. Use carefully—erased things leave a faint shimmer where they were.", category: "tools" },

  // Magic
  { inputA: "candle", inputB: "book", resultName: "Grimoire Flame", resultDescription: "A candle whose flame reveals hidden text in any book and writes new chapters in blank ones.", category: "magic" },
  { inputA: "key", inputB: "mirror", resultName: "Portal Key", resultDescription: "A skeleton key that turns any mirror into a door to the location reflected in it.", category: "magic" },
  { inputA: "pillow", inputB: "camera", resultName: "Dream Catcher Pro", resultDescription: "A pillow that records dreams in 4K and lets you share them as holographic stories.", category: "magic" },
  { inputA: "clock", inputB: "plant", resultName: "Time Bloomer", resultDescription: "A flower that blooms at different speeds—fast forward to see a century of growth in seconds.", category: "magic" },
  { inputA: "toy", inputB: "lamp", resultName: "Wish Lantern", resultDescription: "A toy lantern that grants micro-wishes: finding lost items, perfect weather for an hour, or a good parking spot.", category: "magic" },
  { inputA: "glass", inputB: "pen", resultName: "Inkwell of Truths", resultDescription: "A glass inkwell that only allows true statements to be written. Lies evaporate from the page.", category: "magic" },
  { inputA: "key", inputB: "plant", resultName: "Skeleton Blossom", resultDescription: "A living key made of vines that grows to fit any lock and blooms when the door opens.", category: "magic" },
  { inputA: "candle", inputB: "rock", resultName: "Eternal Ember Stone", resultDescription: "A stone that holds a candle flame inside forever. Carry warmth in your pocket through any cold.", category: "magic" },

  // Nature
  { inputA: "plant", inputB: "speaker", resultName: "Harmony Vine", resultDescription: "A vine that translates plant communication into music. Gardens become orchestras at dawn.", category: "nature" },
  { inputA: "leaf", inputB: "pen", resultName: "Nature's Quill", resultDescription: "A leaf-pen that writes in chlorophyll ink. Messages grow into the surface they're written on.", category: "nature" },
  { inputA: "rock", inputB: "headphones", resultName: "Earth Listener", resultDescription: "Headphones that let you hear the geological heartbeat of the planet and the whispers of ancient stones.", category: "nature" },
  { inputA: "tree", inputB: "keyboard", resultName: "Root Network Terminal", resultDescription: "A wooden keyboard connected to the mycorrhizal network. Chat with trees worldwide.", category: "nature" },
  { inputA: "flower", inputB: "watch", resultName: "Seasonal Ticker", resultDescription: "A watch face made of petals that shows real-time seasons across the globe simultaneously.", category: "nature" },

  // Misc
  { inputA: "remote", inputB: "shoe", resultName: "Life Remote", resultDescription: "A remote control for real life. Pause awkward moments, rewind compliments, and fast-forward commutes.", category: "misc" },
  { inputA: "wallet", inputB: "clock", resultName: "Time Bank", resultDescription: "A wallet that stores saved time instead of money. Deposit boring hours, withdraw them as exciting ones.", category: "misc" },
  { inputA: "pillow", inputB: "shoe", resultName: "Cloud Walkers", resultDescription: "Shoes stuffed with sentient cloud material that adjust firmness to make every surface feel like walking on clouds.", category: "misc" },
  { inputA: "umbrella", inputB: "pen", resultName: "Story Shelter", resultDescription: "An umbrella that projects the pages of a story on the rain around you, turning drizzle into a reading nook.", category: "misc" },
  { inputA: "mug", inputB: "guitar", resultName: "Melody Mug", resultDescription: "A coffee mug that plays a unique song based on the drink's temperature, flavor, and the drinker's mood.", category: "misc" },
];
