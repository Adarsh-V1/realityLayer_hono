import { Hono } from "hono";
import { z } from "zod";
import { eq, and, desc, sql, count } from "drizzle-orm";
import type { AuthedEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth-guard.js";
import { success, error } from "../lib/api-response.js";
import { db } from "../db/connection.js";
import {
  alchemyRecipes,
  alchemyDiscoveries,
  alchemyLeaderboard,
} from "../db/schema/games.js";
import { generateText, parseAIJson } from "../plugins/ai-helper.js";
import { normalizeRecipePair, getAlchemyXP } from "../lib/game-helpers.js";
import { GOLDEN_RECIPES } from "../lib/golden-recipes.js";

export const objectAlchemistRoute = new Hono<AuthedEnv>();

objectAlchemistRoute.use("/*", requireAuth);

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const combineSchema = z.object({
  objectA: z.string().min(1).max(255),
  objectB: z.string().min(1).max(255),
});

// ---------------------------------------------------------------------------
// POST /games/alchemy/combine — Core combination endpoint
// ---------------------------------------------------------------------------

objectAlchemistRoute.post("/games/alchemy/combine", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  const parsed = combineSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const { objectA, objectB } = parsed.data;
  const [inputA, inputB] = normalizeRecipePair(objectA, objectB);

  // 1. Check for existing recipe
  const [existingRecipe] = await db
    .select()
    .from(alchemyRecipes)
    .where(
      and(
        eq(alchemyRecipes.inputA, inputA),
        eq(alchemyRecipes.inputB, inputB),
      ),
    )
    .limit(1);

  let recipe = existingRecipe;
  let isNew = false;
  let isFirstDiscovery = false;

  if (recipe) {
    // Increment timesDiscovered
    await db
      .update(alchemyRecipes)
      .set({ timesDiscovered: sql`${alchemyRecipes.timesDiscovered} + 1` })
      .where(eq(alchemyRecipes.id, recipe.id));

    recipe = { ...recipe, timesDiscovered: recipe.timesDiscovered + 1 };

    // Check if user already discovered this
    const [existingDiscovery] = await db
      .select()
      .from(alchemyDiscoveries)
      .where(
        and(
          eq(alchemyDiscoveries.userId, user.id),
          eq(alchemyDiscoveries.recipeId, recipe.id),
        ),
      )
      .limit(1);

    if (existingDiscovery) {
      // Already discovered — return existing data, no XP
      return success(c, {
        recipe,
        discovery: existingDiscovery,
        isNew: false,
        isFirstDiscovery: false,
        xpAwarded: 0,
      });
    }
  } else {
    // 2. No existing recipe — generate via AI
    isNew = true;

    // Check if this matches a golden recipe
    const goldenMatch = GOLDEN_RECIPES.find(
      (gr) => {
        const [gA, gB] = normalizeRecipePair(gr.inputA, gr.inputB);
        return gA === inputA && gB === inputB;
      },
    );

    let resultName: string;
    let resultDescription: string;
    let category: string;
    let resultImagePrompt: string | null = null;
    let rarity: string;
    let isGolden = false;

    if (goldenMatch) {
      // Use the pre-seeded golden recipe
      resultName = goldenMatch.resultName;
      resultDescription = goldenMatch.resultDescription;
      category = goldenMatch.category;
      rarity = "golden";
      isGolden = true;
      resultImagePrompt = `A magical golden artifact called "${resultName}": ${resultDescription}`;
    } else {
      // Generate via AI
      const prompt = `You are a creative inventor in a magical alchemy game. A player is combining two real-world objects to create a fictional invention.

Object A: "${inputA}"
Object B: "${inputB}"

Create a whimsical, imaginative result that creatively merges aspects of both objects. Return JSON with:
- "resultName": A catchy, creative name for the invention (2-4 words)
- "resultDescription": A fun, vivid description of what it does (1-2 sentences, max 200 chars)
- "category": One of: "gadgets", "food", "transport", "fashion", "tools", "magic", "nature", "misc"
- "rarity": One of: "common", "uncommon", "rare", "epic", "legendary" — base this on how creative/unusual the combination is. Most combinations should be common or uncommon. Reserve legendary for truly unexpected pairings.

Return ONLY valid JSON, no markdown fences.`;

      const raw = await generateText(prompt);
      const generated = parseAIJson<{
        resultName: string;
        resultDescription: string;
        category: string;
        rarity: string;
      }>(raw);

      resultName = generated.resultName;
      resultDescription = generated.resultDescription;
      category = generated.category;
      rarity = generated.rarity;

      // Validate category
      const validCategories = ["gadgets", "food", "transport", "fashion", "tools", "magic", "nature", "misc"];
      if (!validCategories.includes(category)) category = "misc";

      // Validate rarity
      const validRarities = ["common", "uncommon", "rare", "epic", "legendary"];
      if (!validRarities.includes(rarity)) rarity = "common";
    }

    // Create the recipe in DB
    const [newRecipe] = await db
      .insert(alchemyRecipes)
      .values({
        inputA,
        inputB,
        resultName,
        resultDescription,
        resultImagePrompt,
        category: category as any,
        rarity: rarity as any,
        isGolden,
        timesDiscovered: 1,
        firstDiscoveredBy: user.id,
      })
      .returning();

    recipe = newRecipe;
    isFirstDiscovery = true;
  }

  // 3. Create discovery record for this user
  const [discovery] = await db
    .insert(alchemyDiscoveries)
    .values({
      userId: user.id,
      recipeId: recipe.id,
      inputAScanObject: objectA,
      inputBScanObject: objectB,
      isFirstDiscovery,
    })
    .returning();

  // 4. Calculate XP
  const xpAwarded = getAlchemyXP(recipe.rarity, isFirstDiscovery);

  // 5. Upsert leaderboard entry
  const [existingEntry] = await db
    .select()
    .from(alchemyLeaderboard)
    .where(eq(alchemyLeaderboard.userId, user.id))
    .limit(1);

  if (existingEntry) {
    await db
      .update(alchemyLeaderboard)
      .set({
        totalDiscoveries: sql`${alchemyLeaderboard.totalDiscoveries} + 1`,
        goldenCount: recipe.isGolden
          ? sql`${alchemyLeaderboard.goldenCount} + 1`
          : existingEntry.goldenCount,
        rareCount:
          recipe.rarity === "rare" || recipe.rarity === "epic" || recipe.rarity === "legendary"
            ? sql`${alchemyLeaderboard.rareCount} + 1`
            : existingEntry.rareCount,
        firstDiscoveries: isFirstDiscovery
          ? sql`${alchemyLeaderboard.firstDiscoveries} + 1`
          : existingEntry.firstDiscoveries,
        score: sql`${alchemyLeaderboard.score} + ${xpAwarded}`,
        updatedAt: new Date(),
      })
      .where(eq(alchemyLeaderboard.userId, user.id));
  } else {
    await db.insert(alchemyLeaderboard).values({
      userId: user.id,
      totalDiscoveries: 1,
      goldenCount: recipe.isGolden ? 1 : 0,
      rareCount:
        recipe.rarity === "rare" || recipe.rarity === "epic" || recipe.rarity === "legendary"
          ? 1
          : 0,
      firstDiscoveries: isFirstDiscovery ? 1 : 0,
      score: xpAwarded,
    });
  }

  return success(c, {
    recipe,
    discovery,
    isNew,
    isFirstDiscovery,
    xpAwarded,
  });
});

// ---------------------------------------------------------------------------
// GET /games/alchemy/discoveries — User's discovered recipes
// ---------------------------------------------------------------------------

objectAlchemistRoute.get("/games/alchemy/discoveries", async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  const discoveries = await db
    .select({
      discovery: alchemyDiscoveries,
      recipe: alchemyRecipes,
    })
    .from(alchemyDiscoveries)
    .innerJoin(alchemyRecipes, eq(alchemyDiscoveries.recipeId, alchemyRecipes.id))
    .where(eq(alchemyDiscoveries.userId, user.id))
    .orderBy(desc(alchemyDiscoveries.discoveredAt))
    .limit(limit)
    .offset(offset);

  const result = discoveries.map((d) => ({
    ...d.discovery,
    recipe: d.recipe,
  }));

  return success(c, { discoveries: result, limit, offset });
});

// ---------------------------------------------------------------------------
// GET /games/alchemy/recipes — All community-discovered recipes
// ---------------------------------------------------------------------------

objectAlchemistRoute.get("/games/alchemy/recipes", async (c) => {
  const url = new URL(c.req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const category = url.searchParams.get("category");

  const conditions = [];
  if (category) {
    conditions.push(eq(alchemyRecipes.category, category as any));
  }

  const query = db
    .select()
    .from(alchemyRecipes)
    .orderBy(desc(alchemyRecipes.createdAt))
    .limit(limit)
    .offset(offset);

  const recipes = conditions.length > 0
    ? await query.where(conditions[0])
    : await query;

  return success(c, { recipes, limit, offset });
});

// ---------------------------------------------------------------------------
// GET /games/alchemy/recipes/categories — Category stats
// ---------------------------------------------------------------------------

objectAlchemistRoute.get("/games/alchemy/recipes/categories", async (c) => {
  const user = c.get("user");

  const allCategories = ["gadgets", "food", "transport", "fashion", "tools", "magic", "nature", "misc"] as const;

  const categoryStats = await Promise.all(
    allCategories.map(async (cat) => {
      const [totalResult] = await db
        .select({ count: count() })
        .from(alchemyRecipes)
        .where(eq(alchemyRecipes.category, cat));

      const [discoveredResult] = await db
        .select({ count: count() })
        .from(alchemyDiscoveries)
        .innerJoin(alchemyRecipes, eq(alchemyDiscoveries.recipeId, alchemyRecipes.id))
        .where(
          and(
            eq(alchemyDiscoveries.userId, user.id),
            eq(alchemyRecipes.category, cat),
          ),
        );

      const total = totalResult?.count ?? 0;
      const discovered = discoveredResult?.count ?? 0;

      return {
        category: cat,
        totalRecipes: total,
        discovered,
        completionPercent: total > 0 ? Math.round((discovered / total) * 100) : 0,
      };
    }),
  );

  return success(c, { categories: categoryStats });
});

// ---------------------------------------------------------------------------
// GET /games/alchemy/leaderboard — Top discoverers
// ---------------------------------------------------------------------------

objectAlchemistRoute.get("/games/alchemy/leaderboard", async (c) => {
  const entries = await db
    .select()
    .from(alchemyLeaderboard)
    .orderBy(desc(alchemyLeaderboard.score))
    .limit(50);

  const leaderboard = entries.map((e, i) => ({
    rank: i + 1,
    userId: e.userId,
    totalDiscoveries: e.totalDiscoveries,
    goldenCount: e.goldenCount,
    firstDiscoveries: e.firstDiscoveries,
    score: e.score,
  }));

  return success(c, { leaderboard });
});

// ---------------------------------------------------------------------------
// GET /games/alchemy/stats — User's personal stats
// ---------------------------------------------------------------------------

objectAlchemistRoute.get("/games/alchemy/stats", async (c) => {
  const user = c.get("user");

  // Get leaderboard entry for score/counts
  const [entry] = await db
    .select()
    .from(alchemyLeaderboard)
    .where(eq(alchemyLeaderboard.userId, user.id))
    .limit(1);

  // Count by rarity
  const rarityCounts = await db
    .select({
      rarity: alchemyRecipes.rarity,
      count: count(),
    })
    .from(alchemyDiscoveries)
    .innerJoin(alchemyRecipes, eq(alchemyDiscoveries.recipeId, alchemyRecipes.id))
    .where(eq(alchemyDiscoveries.userId, user.id))
    .groupBy(alchemyRecipes.rarity);

  const rarityMap: Record<string, number> = {};
  for (const r of rarityCounts) {
    rarityMap[r.rarity] = r.count;
  }

  // Category coverage
  const allCategories = ["gadgets", "food", "transport", "fashion", "tools", "magic", "nature", "misc"] as const;
  const categoryCoverage = await Promise.all(
    allCategories.map(async (cat) => {
      const [totalResult] = await db
        .select({ count: count() })
        .from(alchemyRecipes)
        .where(eq(alchemyRecipes.category, cat));

      const [discoveredResult] = await db
        .select({ count: count() })
        .from(alchemyDiscoveries)
        .innerJoin(alchemyRecipes, eq(alchemyDiscoveries.recipeId, alchemyRecipes.id))
        .where(
          and(
            eq(alchemyDiscoveries.userId, user.id),
            eq(alchemyRecipes.category, cat),
          ),
        );

      const total = totalResult?.count ?? 0;
      const discovered = discoveredResult?.count ?? 0;

      return {
        category: cat,
        totalRecipes: total,
        discovered,
        completionPercent: total > 0 ? Math.round((discovered / total) * 100) : 0,
      };
    }),
  );

  return success(c, {
    totalDiscoveries: entry?.totalDiscoveries ?? 0,
    goldenCount: entry?.goldenCount ?? 0,
    rareCount: rarityMap["rare"] ?? 0,
    epicCount: rarityMap["epic"] ?? 0,
    legendaryCount: rarityMap["legendary"] ?? 0,
    firstDiscoveries: entry?.firstDiscoveries ?? 0,
    score: entry?.score ?? 0,
    categoryCoverage,
  });
});

// ---------------------------------------------------------------------------
// GET /games/alchemy/hints — Suggest undiscovered combos
// ---------------------------------------------------------------------------

objectAlchemistRoute.get("/games/alchemy/hints", async (c) => {
  const user = c.get("user");

  // Get objects the user has used
  const userDiscoveries = await db
    .select({
      inputA: alchemyRecipes.inputA,
      inputB: alchemyRecipes.inputB,
    })
    .from(alchemyDiscoveries)
    .innerJoin(alchemyRecipes, eq(alchemyDiscoveries.recipeId, alchemyRecipes.id))
    .where(eq(alchemyDiscoveries.userId, user.id));

  // Collect unique objects the user has used
  const usedObjects = new Set<string>();
  const discoveredPairs = new Set<string>();
  for (const d of userDiscoveries) {
    usedObjects.add(d.inputA);
    usedObjects.add(d.inputB);
    discoveredPairs.add(`${d.inputA}|${d.inputB}`);
  }

  const objectList = Array.from(usedObjects);

  if (objectList.length < 2) {
    // Not enough data for hints — give generic ones
    return success(c, {
      hints: [
        { knownObject: "any object", hintText: "Try combining a phone with a plant for something magical!", difficulty: "easy" as const },
        { knownObject: "any object", hintText: "Scan two different items and see what invention you create!", difficulty: "easy" as const },
        { knownObject: "any object", hintText: "Kitchen items + electronics often make interesting gadgets.", difficulty: "medium" as const },
      ],
    });
  }

  // Generate hints: find pairs not yet discovered
  const hints: { knownObject: string; hintText: string; difficulty: "easy" | "medium" | "hard" }[] = [];
  const maxHints = 5;

  // Check golden recipes that involve objects the user knows
  for (const golden of GOLDEN_RECIPES) {
    if (hints.length >= maxHints) break;
    const [gA, gB] = normalizeRecipePair(golden.inputA, golden.inputB);
    const pairKey = `${gA}|${gB}`;

    if (discoveredPairs.has(pairKey)) continue;

    if (usedObjects.has(gA) && !usedObjects.has(gB)) {
      hints.push({
        knownObject: gA,
        hintText: `Try combining your "${gA}" with something new... perhaps something related to "${gB}"?`,
        difficulty: "hard",
      });
    } else if (usedObjects.has(gB) && !usedObjects.has(gA)) {
      hints.push({
        knownObject: gB,
        hintText: `Your "${gB}" might create something golden when paired with a "${gA}"...`,
        difficulty: "hard",
      });
    } else if (usedObjects.has(gA) && usedObjects.has(gB)) {
      hints.push({
        knownObject: gA,
        hintText: `You've used both "${gA}" and "${gB}" before, but never together. A golden discovery awaits!`,
        difficulty: "medium",
      });
    }
  }

  // Fill remaining slots with random undiscovered pairs from user's known objects
  for (let i = 0; i < objectList.length && hints.length < maxHints; i++) {
    for (let j = i + 1; j < objectList.length && hints.length < maxHints; j++) {
      const [a, b] = objectList[i] <= objectList[j]
        ? [objectList[i], objectList[j]]
        : [objectList[j], objectList[i]];
      const pairKey = `${a}|${b}`;

      if (!discoveredPairs.has(pairKey)) {
        hints.push({
          knownObject: a,
          hintText: `What happens when you mix "${a}" with "${b}"? Only one way to find out!`,
          difficulty: "easy",
        });
      }
    }
  }

  return success(c, { hints: hints.slice(0, maxHints) });
});
