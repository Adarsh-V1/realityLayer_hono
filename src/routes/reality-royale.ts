import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, and, sql, count } from "drizzle-orm";
import type { AuthedEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth-guard.js";
import { success, error } from "../lib/api-response.js";
import { db } from "../db/connection.js";
import {
  rrMatches,
  rrPlayers,
  rrLootDrops,
  rrCombatLog,
  type RRInventoryItem,
} from "../db/schema/games.js";
import {
  classifyRarity,
  generateLootPower,
  haversineDistance,
} from "../lib/game-helpers.js";

export const realityRoyaleRoute = new Hono<AuthedEnv>();

realityRoyaleRoute.use("/*", requireAuth);

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const createMatchSchema = z.object({
  centerLat: z.number().min(-90).max(90),
  centerLng: z.number().min(-180).max(180),
  initialRadius: z.number().min(100).max(5000).default(500),
  maxPlayers: z.number().int().min(2).max(50).default(20),
  matchDuration: z.number().int().min(60).max(3600).default(600),
});

const updateLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const scanLootSchema = z.object({
  objectName: z.string().min(1).max(255),
  confidence: z.number().min(0).max(1),
});

const attackSchema = z.object({
  targetUserId: z.string().min(1),
  weaponId: z.string().min(1),
});

const useItemSchema = z.object({
  itemId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Helper: compute current zone radius
// ---------------------------------------------------------------------------

function computeZoneRadius(
  startedAt: Date,
  initialRadius: number,
  shrinkRate: number,
): number {
  const elapsedMs = Date.now() - startedAt.getTime();
  const elapsedMinutes = elapsedMs / 60000;
  return Math.max(50, initialRadius - elapsedMinutes * shrinkRate);
}

// ---------------------------------------------------------------------------
// Helper: auto-finish match if time expired
// ---------------------------------------------------------------------------

async function maybeFinishMatch(matchId: string) {
  const [match] = await db
    .select()
    .from(rrMatches)
    .where(eq(rrMatches.id, matchId))
    .limit(1);

  if (!match || match.status === "finished" || !match.startedAt) return match;

  const elapsedSeconds = (Date.now() - new Date(match.startedAt).getTime()) / 1000;
  if (elapsedSeconds < match.matchDuration) return match;

  // Time expired — determine winner
  const alivePlayers = await db
    .select()
    .from(rrPlayers)
    .where(and(eq(rrPlayers.matchId, matchId), eq(rrPlayers.isAlive, true)))
    .orderBy(desc(rrPlayers.health));

  let winnerId: string | null = null;
  if (alivePlayers.length === 1) {
    winnerId = alivePlayers[0].userId;
  } else if (alivePlayers.length > 1) {
    // Highest health wins
    winnerId = alivePlayers[0].userId;
  }

  // Assign placement ranks to remaining alive players
  for (let i = 0; i < alivePlayers.length; i++) {
    await db
      .update(rrPlayers)
      .set({ placementRank: i + 1, isAlive: false, eliminatedAt: new Date() })
      .where(eq(rrPlayers.id, alivePlayers[i].id));
  }

  const [updated] = await db
    .update(rrMatches)
    .set({ status: "finished", finishedAt: new Date(), winnerId })
    .where(eq(rrMatches.id, matchId))
    .returning();

  return updated;
}

// ---------------------------------------------------------------------------
// POST /games/rr/matches — Create a match
// ---------------------------------------------------------------------------

realityRoyaleRoute.post("/games/rr/matches", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  const parsed = createMatchSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const { centerLat, centerLng, initialRadius, maxPlayers, matchDuration } =
    parsed.data;

  const [match] = await db
    .insert(rrMatches)
    .values({
      creatorId: user.id,
      status: "lobby",
      centerLat,
      centerLng,
      initialRadius,
      currentRadius: initialRadius,
      shrinkRate: 10,
      maxPlayers,
      matchDuration,
    })
    .returning();

  // Creator auto-joins
  const [player] = await db
    .insert(rrPlayers)
    .values({
      matchId: match.id,
      userId: user.id,
      health: 100,
      shield: 0,
      kills: 0,
      isAlive: true,
      inventory: [],
    })
    .returning();

  return success(c, { ...match, playerCount: 1, myPlayer: player }, 201);
});

// ---------------------------------------------------------------------------
// GET /games/rr/matches — List active/joinable matches
// ---------------------------------------------------------------------------

realityRoyaleRoute.get("/games/rr/matches", async (c) => {
  const url = new URL(c.req.url);
  const lat = url.searchParams.get("lat")
    ? Number(url.searchParams.get("lat"))
    : null;
  const lng = url.searchParams.get("lng")
    ? Number(url.searchParams.get("lng"))
    : null;

  const matches = await db
    .select({
      match: rrMatches,
      playerCount: count(rrPlayers.id),
    })
    .from(rrMatches)
    .leftJoin(rrPlayers, eq(rrPlayers.matchId, rrMatches.id))
    .where(
      sql`${rrMatches.status} IN ('lobby', 'countdown', 'active', 'shrinking')`,
    )
    .groupBy(rrMatches.id)
    .orderBy(desc(rrMatches.createdAt));

  const result = matches.map((row) => ({
    ...row.match,
    playerCount: Number(row.playerCount),
  }));

  // Sort by proximity if lat/lng provided
  if (lat !== null && lng !== null) {
    result.sort((a, b) => {
      const distA = haversineDistance(lat, lng, a.centerLat, a.centerLng);
      const distB = haversineDistance(lat, lng, b.centerLat, b.centerLng);
      return distA - distB;
    });
  }

  return success(c, { matches: result });
});

// ---------------------------------------------------------------------------
// GET /games/rr/matches/:id — Get match detail
// ---------------------------------------------------------------------------

realityRoyaleRoute.get("/games/rr/matches/:id", async (c) => {
  const { id } = c.req.param();

  const [matchRow] = await db
    .select({
      match: rrMatches,
      playerCount: count(rrPlayers.id),
    })
    .from(rrMatches)
    .leftJoin(rrPlayers, eq(rrPlayers.matchId, rrMatches.id))
    .where(eq(rrMatches.id, id))
    .groupBy(rrMatches.id)
    .limit(1);

  if (!matchRow) {
    return error(c, "NOT_FOUND", "Match not found", 404);
  }

  const players = await db
    .select()
    .from(rrPlayers)
    .where(eq(rrPlayers.matchId, id));

  return success(c, {
    ...matchRow.match,
    playerCount: Number(matchRow.playerCount),
    players,
  });
});

// ---------------------------------------------------------------------------
// POST /games/rr/matches/:id/join — Join match lobby
// ---------------------------------------------------------------------------

realityRoyaleRoute.post("/games/rr/matches/:id/join", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();

  const [match] = await db
    .select()
    .from(rrMatches)
    .where(eq(rrMatches.id, id))
    .limit(1);

  if (!match) {
    return error(c, "NOT_FOUND", "Match not found", 404);
  }

  if (match.status !== "lobby") {
    return error(c, "MATCH_STARTED", "Match has already started", 400);
  }

  // Check if already joined
  const [existing] = await db
    .select()
    .from(rrPlayers)
    .where(
      and(eq(rrPlayers.matchId, id), eq(rrPlayers.userId, user.id)),
    )
    .limit(1);

  if (existing) {
    return success(c, existing);
  }

  // Check if full
  const [{ count: playerCount }] = await db
    .select({ count: count() })
    .from(rrPlayers)
    .where(eq(rrPlayers.matchId, id));

  if (Number(playerCount) >= match.maxPlayers) {
    return error(c, "MATCH_FULL", "Match is full", 400);
  }

  const [player] = await db
    .insert(rrPlayers)
    .values({
      matchId: id,
      userId: user.id,
      health: 100,
      shield: 0,
      kills: 0,
      isAlive: true,
      inventory: [],
    })
    .returning();

  return success(c, player, 201);
});

// ---------------------------------------------------------------------------
// POST /games/rr/matches/:id/start — Creator-only start
// ---------------------------------------------------------------------------

realityRoyaleRoute.post("/games/rr/matches/:id/start", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();

  const [match] = await db
    .select()
    .from(rrMatches)
    .where(eq(rrMatches.id, id))
    .limit(1);

  if (!match) {
    return error(c, "NOT_FOUND", "Match not found", 404);
  }

  if (match.creatorId !== user.id) {
    return error(c, "FORBIDDEN", "Only the match creator can start the match", 403);
  }

  if (match.status !== "lobby") {
    return error(c, "INVALID_STATE", "Match is not in lobby state", 400);
  }

  const startTime = new Date(Date.now() + 10_000); // 10 seconds from now

  const [updated] = await db
    .update(rrMatches)
    .set({ status: "countdown", startedAt: startTime })
    .where(eq(rrMatches.id, id))
    .returning();

  return success(c, updated);
});

// ---------------------------------------------------------------------------
// POST /games/rr/matches/:id/location — Update player GPS
// ---------------------------------------------------------------------------

realityRoyaleRoute.post("/games/rr/matches/:id/location", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();
  const body = await c.req.json();

  const parsed = updateLocationSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const { lat, lng } = parsed.data;

  const [player] = await db
    .select()
    .from(rrPlayers)
    .where(
      and(eq(rrPlayers.matchId, id), eq(rrPlayers.userId, user.id)),
    )
    .limit(1);

  if (!player) {
    return error(c, "NOT_FOUND", "You are not in this match", 404);
  }

  if (!player.isAlive) {
    return error(c, "ELIMINATED", "You have been eliminated", 400);
  }

  const [updated] = await db
    .update(rrPlayers)
    .set({ lastLat: lat, lastLng: lng, lastLocationAt: new Date() })
    .where(eq(rrPlayers.id, player.id))
    .returning();

  // Check zone damage
  const [match] = await db
    .select()
    .from(rrMatches)
    .where(eq(rrMatches.id, id))
    .limit(1);

  let zoneDamage = 0;
  if (match && match.startedAt && (match.status === "active" || match.status === "shrinking")) {
    const currentRadius = computeZoneRadius(
      new Date(match.startedAt),
      match.initialRadius,
      match.shrinkRate,
    );
    const distFromCenter = haversineDistance(
      lat,
      lng,
      match.centerLat,
      match.centerLng,
    );
    if (distFromCenter > currentRadius) {
      zoneDamage = 5;
      const newHealth = Math.max(0, updated.health - zoneDamage);
      const isAlive = newHealth > 0;

      if (!isAlive) {
        // Count alive players for placement
        const [{ count: aliveCount }] = await db
          .select({ count: count() })
          .from(rrPlayers)
          .where(
            and(eq(rrPlayers.matchId, id), eq(rrPlayers.isAlive, true)),
          );
        const placement = Number(aliveCount);

        await db
          .update(rrPlayers)
          .set({
            health: 0,
            isAlive: false,
            eliminatedAt: new Date(),
            placementRank: placement,
          })
          .where(eq(rrPlayers.id, player.id));
      } else {
        await db
          .update(rrPlayers)
          .set({ health: newHealth })
          .where(eq(rrPlayers.id, player.id));
      }
    }
  }

  return success(c, { ...updated, zoneDamage });
});

// ---------------------------------------------------------------------------
// POST /games/rr/matches/:id/scan-loot — Scan an object for loot
// ---------------------------------------------------------------------------

realityRoyaleRoute.post("/games/rr/matches/:id/scan-loot", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();
  const body = await c.req.json();

  const parsed = scanLootSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const { objectName, confidence } = parsed.data;

  const [player] = await db
    .select()
    .from(rrPlayers)
    .where(
      and(eq(rrPlayers.matchId, id), eq(rrPlayers.userId, user.id)),
    )
    .limit(1);

  if (!player) {
    return error(c, "NOT_FOUND", "You are not in this match", 404);
  }

  if (!player.isAlive) {
    return error(c, "ELIMINATED", "You have been eliminated", 400);
  }

  const rarity = classifyRarity(objectName, confidence);
  const power = generateLootPower(rarity);

  // Determine loot type: 50% weapon, 25% shield, 25% health
  const roll = Math.random();
  let lootType: "weapon" | "shield" | "health";
  if (roll < 0.5) {
    lootType = "weapon";
  } else if (roll < 0.75) {
    lootType = "shield";
  } else {
    lootType = "health";
  }

  // Create loot drop record
  const [lootDrop] = await db
    .insert(rrLootDrops)
    .values({
      matchId: id,
      claimedByUserId: user.id,
      objectName,
      lootType,
      rarity,
      power,
      scannedFromObject: objectName,
      claimedAt: new Date(),
    })
    .returning();

  // Add to player inventory
  const newItem: RRInventoryItem = {
    id: lootDrop.id,
    lootType,
    name: objectName,
    rarity,
    power,
    scannedFrom: objectName,
  };

  const currentInventory = (player.inventory as RRInventoryItem[]) || [];
  const updatedInventory = [...currentInventory, newItem];

  await db
    .update(rrPlayers)
    .set({ inventory: updatedInventory })
    .where(eq(rrPlayers.id, player.id));

  return success(c, { lootDrop, inventoryItem: newItem }, 201);
});

// ---------------------------------------------------------------------------
// POST /games/rr/matches/:id/attack — Attack another player
// ---------------------------------------------------------------------------

realityRoyaleRoute.post("/games/rr/matches/:id/attack", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();
  const body = await c.req.json();

  const parsed = attackSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const { targetUserId, weaponId } = parsed.data;

  // Get attacker
  const [attacker] = await db
    .select()
    .from(rrPlayers)
    .where(
      and(eq(rrPlayers.matchId, id), eq(rrPlayers.userId, user.id)),
    )
    .limit(1);

  if (!attacker) {
    return error(c, "NOT_FOUND", "You are not in this match", 404);
  }

  if (!attacker.isAlive) {
    return error(c, "ELIMINATED", "You have been eliminated", 400);
  }

  // Get defender
  const [defender] = await db
    .select()
    .from(rrPlayers)
    .where(
      and(eq(rrPlayers.matchId, id), eq(rrPlayers.userId, targetUserId)),
    )
    .limit(1);

  if (!defender) {
    return error(c, "NOT_FOUND", "Target player not found in this match", 404);
  }

  if (!defender.isAlive) {
    return error(c, "TARGET_ELIMINATED", "Target player is already eliminated", 400);
  }

  // Check distance — both must have locations
  if (
    attacker.lastLat == null ||
    attacker.lastLng == null ||
    defender.lastLat == null ||
    defender.lastLng == null
  ) {
    return error(
      c,
      "NO_LOCATION",
      "Both players must have GPS locations to attack",
      400,
    );
  }

  const distance = haversineDistance(
    attacker.lastLat,
    attacker.lastLng,
    defender.lastLat,
    defender.lastLng,
  );

  if (distance > 100) {
    return error(
      c,
      "OUT_OF_RANGE",
      `Target is ${Math.round(distance)}m away. Must be within 100m.`,
      400,
    );
  }

  // Find weapon in inventory
  const attackerInventory = (attacker.inventory as RRInventoryItem[]) || [];
  const weapon = attackerInventory.find(
    (item) => item.id === weaponId && item.lootType === "weapon",
  );

  if (!weapon) {
    return error(c, "NO_WEAPON", "Weapon not found in your inventory", 400);
  }

  // Calculate damage: shield absorbs first, then health
  const damage = weapon.power;
  let shieldDamage = 0;
  let healthDamage = 0;
  let remainingDamage = damage;

  if (defender.shield > 0) {
    shieldDamage = Math.min(defender.shield, remainingDamage);
    remainingDamage -= shieldDamage;
  }
  healthDamage = remainingDamage;

  const newShield = defender.shield - shieldDamage;
  const newHealth = Math.max(0, defender.health - healthDamage);
  const isKill = newHealth <= 0;

  // Update defender
  const defenderUpdate: Record<string, unknown> = {
    shield: newShield,
    health: newHealth,
  };

  if (isKill) {
    // Count alive players for placement rank
    const [{ count: aliveCount }] = await db
      .select({ count: count() })
      .from(rrPlayers)
      .where(
        and(eq(rrPlayers.matchId, id), eq(rrPlayers.isAlive, true)),
      );
    const placement = Number(aliveCount);

    defenderUpdate.isAlive = false;
    defenderUpdate.eliminatedAt = new Date();
    defenderUpdate.placementRank = placement;
  }

  await db
    .update(rrPlayers)
    .set(defenderUpdate)
    .where(eq(rrPlayers.id, defender.id));

  // Update attacker: remove weapon from inventory, increment kills if kill
  const updatedInventory = attackerInventory.filter(
    (item) => item.id !== weaponId,
  );
  const attackerUpdate: Record<string, unknown> = {
    inventory: updatedInventory,
  };
  if (isKill) {
    attackerUpdate.kills = attacker.kills + 1;
  }

  await db
    .update(rrPlayers)
    .set(attackerUpdate)
    .where(eq(rrPlayers.id, attacker.id));

  // Log combat
  await db.insert(rrCombatLog).values({
    matchId: id,
    attackerId: user.id,
    defenderId: targetUserId,
    weaponUsed: weapon.name,
    damage,
    isKill,
  });

  // Check if match should end (only 1 player alive)
  if (isKill) {
    const [{ count: remainingAlive }] = await db
      .select({ count: count() })
      .from(rrPlayers)
      .where(
        and(eq(rrPlayers.matchId, id), eq(rrPlayers.isAlive, true)),
      );

    if (Number(remainingAlive) <= 1) {
      // Winner!
      const [winner] = await db
        .select()
        .from(rrPlayers)
        .where(
          and(eq(rrPlayers.matchId, id), eq(rrPlayers.isAlive, true)),
        )
        .limit(1);

      if (winner) {
        await db
          .update(rrPlayers)
          .set({ placementRank: 1 })
          .where(eq(rrPlayers.id, winner.id));

        await db
          .update(rrMatches)
          .set({
            status: "finished",
            finishedAt: new Date(),
            winnerId: winner.userId,
          })
          .where(eq(rrMatches.id, id));
      }
    }
  }

  return success(c, {
    damage,
    shieldDamage,
    healthDamage,
    isKill,
    defenderHealth: newHealth,
    defenderShield: newShield,
  });
});

// ---------------------------------------------------------------------------
// POST /games/rr/matches/:id/use-item — Use a health/shield item
// ---------------------------------------------------------------------------

realityRoyaleRoute.post("/games/rr/matches/:id/use-item", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();
  const body = await c.req.json();

  const parsed = useItemSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const { itemId } = parsed.data;

  const [player] = await db
    .select()
    .from(rrPlayers)
    .where(
      and(eq(rrPlayers.matchId, id), eq(rrPlayers.userId, user.id)),
    )
    .limit(1);

  if (!player) {
    return error(c, "NOT_FOUND", "You are not in this match", 404);
  }

  if (!player.isAlive) {
    return error(c, "ELIMINATED", "You have been eliminated", 400);
  }

  const currentInventory = (player.inventory as RRInventoryItem[]) || [];
  const item = currentInventory.find((i) => i.id === itemId);

  if (!item) {
    return error(c, "NOT_FOUND", "Item not found in your inventory", 404);
  }

  if (item.lootType !== "health" && item.lootType !== "shield") {
    return error(c, "INVALID_ITEM", "Only health and shield items can be used", 400);
  }

  const updatedInventory = currentInventory.filter((i) => i.id !== itemId);

  let newHealth = player.health;
  let newShield = player.shield;

  if (item.lootType === "health") {
    newHealth = Math.min(100, player.health + item.power);
  } else if (item.lootType === "shield") {
    newShield = Math.min(100, player.shield + item.power);
  }

  const [updated] = await db
    .update(rrPlayers)
    .set({
      health: newHealth,
      shield: newShield,
      inventory: updatedInventory,
    })
    .where(eq(rrPlayers.id, player.id))
    .returning();

  return success(c, {
    health: newHealth,
    shield: newShield,
    itemUsed: item,
    player: updated,
  });
});

// ---------------------------------------------------------------------------
// GET /games/rr/matches/:id/state — Full match state
// ---------------------------------------------------------------------------

realityRoyaleRoute.get("/games/rr/matches/:id/state", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();

  // Auto-finish if time expired
  const match = await maybeFinishMatch(id);

  if (!match) {
    return error(c, "NOT_FOUND", "Match not found", 404);
  }

  // If match is in countdown and past start time, transition to active
  if (match.status === "countdown" && match.startedAt) {
    const now = Date.now();
    const startTime = new Date(match.startedAt).getTime();
    if (now >= startTime) {
      await db
        .update(rrMatches)
        .set({ status: "active" })
        .where(eq(rrMatches.id, id));
      (match as { status: string }).status = "active";
    }
  }

  // Get all players
  const players = await db
    .select()
    .from(rrPlayers)
    .where(eq(rrPlayers.matchId, id));

  // Get current user's player data
  const myPlayer = players.find((p) => p.userId === user.id) ?? null;

  // Recent combat log (last 20)
  const recentCombatLog = await db
    .select()
    .from(rrCombatLog)
    .where(eq(rrCombatLog.matchId, id))
    .orderBy(desc(rrCombatLog.createdAt))
    .limit(20);

  // Alive count
  const aliveCount = players.filter((p) => p.isAlive).length;

  // Time remaining
  let timeRemaining = match.matchDuration;
  let zoneRadius = match.initialRadius;

  if (match.startedAt) {
    const startedAt = new Date(match.startedAt);
    const elapsedSeconds = (Date.now() - startedAt.getTime()) / 1000;
    timeRemaining = Math.max(0, match.matchDuration - elapsedSeconds);
    zoneRadius = computeZoneRadius(startedAt, match.initialRadius, match.shrinkRate);
  }

  // For non-alive players, redact location data of alive players
  const visiblePlayers = players.map((p) => {
    if (p.userId === user.id) return p;
    if (!p.isAlive) {
      return { ...p, lastLat: p.lastLat, lastLng: p.lastLng };
    }
    return p;
  });

  return success(c, {
    match: { ...match, playerCount: players.length },
    players: visiblePlayers,
    myPlayer,
    recentCombatLog: recentCombatLog.reverse(),
    aliveCount,
    timeRemaining: Math.round(timeRemaining),
    zoneRadius: Math.round(zoneRadius),
  });
});

// ---------------------------------------------------------------------------
// GET /games/rr/stats — Player lifetime stats
// ---------------------------------------------------------------------------

realityRoyaleRoute.get("/games/rr/stats", async (c) => {
  const user = c.get("user");

  const allPlayerRecords = await db
    .select()
    .from(rrPlayers)
    .where(eq(rrPlayers.userId, user.id));

  const totalMatches = allPlayerRecords.length;
  const wins = allPlayerRecords.filter((p) => p.placementRank === 1).length;
  const totalKills = allPlayerRecords.reduce((sum, p) => sum + p.kills, 0);

  const placements = allPlayerRecords
    .filter((p) => p.placementRank != null)
    .map((p) => p.placementRank!);

  const bestPlacement =
    placements.length > 0 ? Math.min(...placements) : 0;
  const avgPlacement =
    placements.length > 0
      ? Math.round(
          (placements.reduce((s, p) => s + p, 0) / placements.length) * 10,
        ) / 10
      : 0;

  return success(c, {
    totalMatches,
    wins,
    totalKills,
    bestPlacement,
    avgPlacement,
  });
});
