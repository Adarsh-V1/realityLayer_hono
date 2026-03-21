import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, and, sql, isNull, count, sum, avg } from "drizzle-orm";
import type { AuthedEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth-guard.js";
import { success, error } from "../lib/api-response.js";
import { db } from "../db/connection.js";
import {
  tycoonShops,
  tycoonInventory,
  tycoonTransactions,
  tycoonUpgrades,
} from "../db/schema/games.js";
import {
  classifyRarity,
  generateBaseValue,
  calculateIdleIncome,
  getUpgradeCost,
  generateCustomerName,
  normalizeObjectName,
} from "../lib/game-helpers.js";

export const scanTycoonRoute = new Hono<AuthedEnv>();

scanTycoonRoute.use("/*", requireAuth);

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const addItemSchema = z.object({
  objectName: z.string().min(1).max(255),
  confidence: z.number().min(0).max(1),
  imageUrl: z.string().url().optional(),
  objectData: z.record(z.string(), z.unknown()).optional(),
});

const updateItemSchema = z.object({
  listedPrice: z.number().int().positive().optional(),
  isDisplayed: z.boolean().optional(),
});

const upgradeSchema = z.object({
  upgradeType: z.enum([
    "display_case",
    "decor",
    "staff",
    "location",
    "advertising",
  ]),
});

// ---------------------------------------------------------------------------
// Helper: Get or create shop for the current user
// ---------------------------------------------------------------------------

async function getOrCreateShop(userId: string) {
  const [existing] = await db
    .select()
    .from(tycoonShops)
    .where(eq(tycoonShops.userId, userId))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(tycoonShops)
    .values({ userId, name: "My Shop", coins: 100 })
    .returning();

  return created;
}

// ---------------------------------------------------------------------------
// GET /games/tycoon/shop — Get user's shop (auto-create if first visit)
// ---------------------------------------------------------------------------

scanTycoonRoute.get("/games/tycoon/shop", async (c) => {
  const user = c.get("user");
  const shop = await getOrCreateShop(user.id);

  // Also fetch upgrades
  const upgrades = await db
    .select()
    .from(tycoonUpgrades)
    .where(eq(tycoonUpgrades.shopId, shop.id));

  // Count displayed items
  const [displayedCount] = await db
    .select({ count: count() })
    .from(tycoonInventory)
    .where(
      and(
        eq(tycoonInventory.shopId, shop.id),
        eq(tycoonInventory.isDisplayed, true),
        isNull(tycoonInventory.soldAt),
      ),
    );

  return success(c, {
    ...shop,
    upgrades,
    displayedItemCount: displayedCount?.count ?? 0,
  });
});

// ---------------------------------------------------------------------------
// POST /games/tycoon/shop/collect-idle — Collect idle income
// ---------------------------------------------------------------------------

scanTycoonRoute.post("/games/tycoon/shop/collect-idle", async (c) => {
  const user = c.get("user");
  const shop = await getOrCreateShop(user.id);

  // Count displayed rare+ items (rare, epic, legendary)
  const [rareDisplayed] = await db
    .select({ count: count() })
    .from(tycoonInventory)
    .where(
      and(
        eq(tycoonInventory.shopId, shop.id),
        eq(tycoonInventory.isDisplayed, true),
        isNull(tycoonInventory.soldAt),
        sql`${tycoonInventory.rarity} IN ('rare', 'epic', 'legendary')`,
      ),
    );

  const { coins, minutes } = calculateIdleIncome(
    new Date(shop.lastIdleCollect),
    shop.staffCount,
    rareDisplayed?.count ?? 0,
    shop.reputation,
  );

  if (coins <= 0) {
    return success(c, {
      coinsCollected: 0,
      minutesAccumulated: 0,
      newBalance: shop.coins,
    });
  }

  const [updated] = await db
    .update(tycoonShops)
    .set({
      coins: shop.coins + coins,
      totalEarned: shop.totalEarned + coins,
      lastIdleCollect: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tycoonShops.id, shop.id))
    .returning();

  // Record idle income transaction
  await db.insert(tycoonTransactions).values({
    shopId: shop.id,
    type: "idle_income",
    amount: coins,
  });

  return success(c, {
    coinsCollected: coins,
    minutesAccumulated: minutes,
    newBalance: updated.coins,
  });
});

// ---------------------------------------------------------------------------
// POST /games/tycoon/inventory/add — Add scanned object to inventory
// ---------------------------------------------------------------------------

scanTycoonRoute.post("/games/tycoon/inventory/add", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  const parsed = addItemSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const { objectName, confidence, imageUrl, objectData } = parsed.data;
  const shop = await getOrCreateShop(user.id);

  const rarity = classifyRarity(objectName, confidence);
  const baseValue = generateBaseValue(rarity);
  const category = normalizeObjectName(objectName);

  const [item] = await db
    .insert(tycoonInventory)
    .values({
      shopId: shop.id,
      objectName,
      objectCategory: category,
      rarity,
      baseValue,
      listedPrice: baseValue,
      imageUrl: imageUrl ?? null,
      scannedObjectData: objectData ?? null,
    })
    .returning();

  // Bump reputation by 1 for scanning
  await db
    .update(tycoonShops)
    .set({
      reputation: shop.reputation + 1,
      updatedAt: new Date(),
    })
    .where(eq(tycoonShops.id, shop.id));

  return success(c, item, 201);
});

// ---------------------------------------------------------------------------
// PATCH /games/tycoon/inventory/:id — Update item
// ---------------------------------------------------------------------------

scanTycoonRoute.patch("/games/tycoon/inventory/:id", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();
  const body = await c.req.json();

  const parsed = updateItemSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const shop = await getOrCreateShop(user.id);

  // Verify item belongs to user's shop
  const [item] = await db
    .select()
    .from(tycoonInventory)
    .where(
      and(eq(tycoonInventory.id, id), eq(tycoonInventory.shopId, shop.id)),
    )
    .limit(1);

  if (!item) {
    return error(c, "NOT_FOUND", "Inventory item not found", 404);
  }

  if (item.soldAt) {
    return error(c, "ALREADY_SOLD", "This item has already been sold", 400);
  }

  const updates: Record<string, unknown> = {};

  if (parsed.data.listedPrice !== undefined) {
    updates.listedPrice = parsed.data.listedPrice;
  }

  if (parsed.data.isDisplayed !== undefined) {
    // Enforce display case limit
    if (parsed.data.isDisplayed && !item.isDisplayed) {
      const [displayedCount] = await db
        .select({ count: count() })
        .from(tycoonInventory)
        .where(
          and(
            eq(tycoonInventory.shopId, shop.id),
            eq(tycoonInventory.isDisplayed, true),
            isNull(tycoonInventory.soldAt),
          ),
        );

      if ((displayedCount?.count ?? 0) >= shop.displayCases) {
        return error(
          c,
          "DISPLAY_FULL",
          `All ${shop.displayCases} display cases are full. Upgrade to add more!`,
          400,
        );
      }
    }
    updates.isDisplayed = parsed.data.isDisplayed;
  }

  const [updated] = await db
    .update(tycoonInventory)
    .set(updates)
    .where(eq(tycoonInventory.id, id))
    .returning();

  return success(c, updated);
});

// ---------------------------------------------------------------------------
// DELETE /games/tycoon/inventory/:id — Remove item from inventory
// ---------------------------------------------------------------------------

scanTycoonRoute.delete("/games/tycoon/inventory/:id", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();

  const shop = await getOrCreateShop(user.id);

  const [item] = await db
    .select()
    .from(tycoonInventory)
    .where(
      and(eq(tycoonInventory.id, id), eq(tycoonInventory.shopId, shop.id)),
    )
    .limit(1);

  if (!item) {
    return error(c, "NOT_FOUND", "Inventory item not found", 404);
  }

  await db.delete(tycoonInventory).where(eq(tycoonInventory.id, id));

  return success(c, { deleted: true });
});

// ---------------------------------------------------------------------------
// GET /games/tycoon/inventory — List items with pagination
// ---------------------------------------------------------------------------

scanTycoonRoute.get("/games/tycoon/inventory", async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.url);
  const limit = Math.min(
    50,
    Math.max(1, Number(url.searchParams.get("limit")) || 20),
  );
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  const shop = await getOrCreateShop(user.id);

  const items = await db
    .select()
    .from(tycoonInventory)
    .where(
      and(eq(tycoonInventory.shopId, shop.id), isNull(tycoonInventory.soldAt)),
    )
    .orderBy(desc(tycoonInventory.addedAt))
    .limit(limit)
    .offset(offset);

  const [totalCount] = await db
    .select({ count: count() })
    .from(tycoonInventory)
    .where(
      and(eq(tycoonInventory.shopId, shop.id), isNull(tycoonInventory.soldAt)),
    );

  return success(c, {
    items,
    total: totalCount?.count ?? 0,
    limit,
    offset,
  });
});

// ---------------------------------------------------------------------------
// POST /games/tycoon/simulate-customers — Generate AI customers
// ---------------------------------------------------------------------------

scanTycoonRoute.post("/games/tycoon/simulate-customers", async (c) => {
  const user = c.get("user");
  const shop = await getOrCreateShop(user.id);

  // Get displayed items that are for sale
  const displayedItems = await db
    .select()
    .from(tycoonInventory)
    .where(
      and(
        eq(tycoonInventory.shopId, shop.id),
        eq(tycoonInventory.isDisplayed, true),
        isNull(tycoonInventory.soldAt),
      ),
    );

  if (displayedItems.length === 0) {
    return error(
      c,
      "NO_ITEMS",
      "You need to display items in your shop first!",
      400,
    );
  }

  // Generate 1-5 customers based on reputation
  const customerCount = Math.min(
    5,
    Math.max(1, Math.floor(1 + (shop.reputation / 100) * 4 + Math.random())),
  );

  const customers: {
    name: string;
    reaction: "happy" | "neutral" | "unhappy" | "thrilled";
    purchased: boolean;
    itemName?: string;
    pricePaid?: number;
  }[] = [];
  let totalSales = 0;
  let currentCoins = shop.coins;

  for (let i = 0; i < customerCount; i++) {
    const customerName = generateCustomerName();

    // Each customer picks a random displayed item to evaluate
    const availableItems = displayedItems.filter(
      (item) => !customers.some((c) => c.itemName === item.objectName && c.purchased),
    );

    if (availableItems.length === 0) break;

    const targetItem =
      availableItems[Math.floor(Math.random() * availableItems.length)];

    const listedPrice = targetItem.listedPrice ?? targetItem.baseValue;
    const baseValue = targetItem.baseValue;

    // Willingness formula
    const priceDiffRatio =
      baseValue > 0 ? (listedPrice - baseValue) / baseValue : 0;
    const willingness =
      (shop.reputation / 100) * (1 - priceDiffRatio);

    if (willingness > 0.5) {
      // Customer buys!
      const reaction =
        willingness > 0.9
          ? "thrilled"
          : willingness > 0.7
            ? "happy"
            : "neutral";

      customers.push({
        name: customerName,
        reaction,
        purchased: true,
        itemName: targetItem.objectName,
        pricePaid: listedPrice,
      });

      totalSales += listedPrice;
      currentCoins += listedPrice;

      // Mark item as sold
      await db
        .update(tycoonInventory)
        .set({ soldAt: new Date(), isDisplayed: false })
        .where(eq(tycoonInventory.id, targetItem.id));

      // Remove from displayed items for subsequent customers
      const idx = displayedItems.findIndex((it) => it.id === targetItem.id);
      if (idx >= 0) displayedItems.splice(idx, 1);

      // Record sale transaction
      await db.insert(tycoonTransactions).values({
        shopId: shop.id,
        inventoryItemId: targetItem.id,
        type: "sale",
        amount: listedPrice,
        customerName,
        customerReaction: reaction,
      });
    } else {
      // Customer walks away
      const reaction = willingness > 0.3 ? "neutral" : "unhappy";
      customers.push({
        name: customerName,
        reaction,
        purchased: false,
        itemName: targetItem.objectName,
      });
    }
  }

  // Update shop coins and reputation
  const reputationGain = customers.filter((c) => c.purchased).length * 2;
  const reputationLoss = customers.filter(
    (c) => !c.purchased && c.reaction === "unhappy",
  ).length;

  await db
    .update(tycoonShops)
    .set({
      coins: currentCoins,
      totalEarned: shop.totalEarned + totalSales,
      reputation: Math.max(0, shop.reputation + reputationGain - reputationLoss),
      updatedAt: new Date(),
    })
    .where(eq(tycoonShops.id, shop.id));

  return success(c, {
    customers,
    totalSales,
    newBalance: currentCoins,
  });
});

// ---------------------------------------------------------------------------
// POST /games/tycoon/upgrade — Purchase upgrade
// ---------------------------------------------------------------------------

scanTycoonRoute.post("/games/tycoon/upgrade", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  const parsed = upgradeSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const { upgradeType } = parsed.data;
  const shop = await getOrCreateShop(user.id);

  // Get current upgrade level
  const [existingUpgrade] = await db
    .select()
    .from(tycoonUpgrades)
    .where(
      and(
        eq(tycoonUpgrades.shopId, shop.id),
        eq(tycoonUpgrades.upgradeType, upgradeType),
      ),
    )
    .limit(1);

  const currentLevel = existingUpgrade?.level ?? 0;
  const cost = getUpgradeCost(upgradeType, currentLevel);

  if (shop.coins < cost) {
    return error(
      c,
      "INSUFFICIENT_FUNDS",
      `You need ${cost} coins but only have ${shop.coins}`,
      400,
    );
  }

  // Deduct coins
  const shopUpdates: Record<string, unknown> = {
    coins: shop.coins - cost,
    updatedAt: new Date(),
  };

  // Apply upgrade effect to shop
  if (upgradeType === "display_case") {
    shopUpdates.displayCases = shop.displayCases + 2;
  } else if (upgradeType === "staff") {
    shopUpdates.staffCount = shop.staffCount + 1;
  }

  await db
    .update(tycoonShops)
    .set(shopUpdates)
    .where(eq(tycoonShops.id, shop.id));

  // Upsert upgrade record
  let upgrade;
  if (existingUpgrade) {
    [upgrade] = await db
      .update(tycoonUpgrades)
      .set({ level: currentLevel + 1, purchasedAt: new Date() })
      .where(eq(tycoonUpgrades.id, existingUpgrade.id))
      .returning();
  } else {
    [upgrade] = await db
      .insert(tycoonUpgrades)
      .values({
        shopId: shop.id,
        upgradeType,
        level: 1,
      })
      .returning();
  }

  // Record transaction
  await db.insert(tycoonTransactions).values({
    shopId: shop.id,
    type: "upgrade_cost",
    amount: -cost,
  });

  return success(c, {
    upgrade,
    cost,
    newBalance: shop.coins - cost,
  });
});

// ---------------------------------------------------------------------------
// GET /games/tycoon/transactions — Transaction history
// ---------------------------------------------------------------------------

scanTycoonRoute.get("/games/tycoon/transactions", async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.url);
  const limit = Math.min(
    50,
    Math.max(1, Number(url.searchParams.get("limit")) || 20),
  );
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  const shop = await getOrCreateShop(user.id);

  const transactions = await db
    .select()
    .from(tycoonTransactions)
    .where(eq(tycoonTransactions.shopId, shop.id))
    .orderBy(desc(tycoonTransactions.createdAt))
    .limit(limit)
    .offset(offset);

  return success(c, { transactions, limit, offset });
});

// ---------------------------------------------------------------------------
// GET /games/tycoon/leaderboard — Top shops by totalEarned
// ---------------------------------------------------------------------------

scanTycoonRoute.get("/games/tycoon/leaderboard", async (c) => {
  const shops = await db
    .select({
      id: tycoonShops.id,
      userId: tycoonShops.userId,
      name: tycoonShops.name,
      level: tycoonShops.level,
      totalEarned: tycoonShops.totalEarned,
      reputation: tycoonShops.reputation,
    })
    .from(tycoonShops)
    .orderBy(desc(tycoonShops.totalEarned))
    .limit(20);

  const leaderboard = shops.map((shop, i) => ({
    rank: i + 1,
    ...shop,
  }));

  return success(c, { leaderboard });
});

// ---------------------------------------------------------------------------
// GET /games/tycoon/stats — Total revenue, items sold, avg sale price
// ---------------------------------------------------------------------------

scanTycoonRoute.get("/games/tycoon/stats", async (c) => {
  const user = c.get("user");
  const shop = await getOrCreateShop(user.id);

  const [salesStats] = await db
    .select({
      totalRevenue: sum(tycoonTransactions.amount),
      totalItemsSold: count(),
    })
    .from(tycoonTransactions)
    .where(
      and(
        eq(tycoonTransactions.shopId, shop.id),
        eq(tycoonTransactions.type, "sale"),
      ),
    );

  const [avgStats] = await db
    .select({
      avgPrice: avg(tycoonTransactions.amount),
    })
    .from(tycoonTransactions)
    .where(
      and(
        eq(tycoonTransactions.shopId, shop.id),
        eq(tycoonTransactions.type, "sale"),
      ),
    );

  const [customerCount] = await db
    .select({ count: count() })
    .from(tycoonTransactions)
    .where(
      and(
        eq(tycoonTransactions.shopId, shop.id),
        sql`${tycoonTransactions.customerName} IS NOT NULL`,
      ),
    );

  return success(c, {
    totalRevenue: Number(salesStats?.totalRevenue ?? 0),
    totalItemsSold: salesStats?.totalItemsSold ?? 0,
    totalCustomers: customerCount?.count ?? 0,
    avgSalePrice: Math.round(Number(avgStats?.avgPrice ?? 0)),
    bestSellingItem: null,
  });
});
