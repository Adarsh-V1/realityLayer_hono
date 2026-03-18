import { eq, desc } from "drizzle-orm";
import { db } from "../connection.js";
import { scans, scanResults, type NewScan, type NewScanResult } from "../schema/scans.js";

export async function createScan(data: NewScan) {
  const [scan] = await db.insert(scans).values(data).returning();
  return scan;
}

export async function getScansByUser(userId: string, limit = 20, offset = 0) {
  return db.query.scans.findMany({
    where: eq(scans.userId, userId),
    orderBy: desc(scans.createdAt),
    limit,
    offset,
    with: {
      results: true,
    },
  });
}

export async function getScanById(id: string) {
  return db.query.scans.findFirst({
    where: eq(scans.id, id),
    with: {
      results: true,
    },
  });
}

export async function createScanResult(data: NewScanResult) {
  const [result] = await db.insert(scanResults).values(data).returning();
  return result;
}

export async function updateScanStatus(
  id: string,
  status: "processing" | "completed" | "failed",
) {
  const [scan] = await db
    .update(scans)
    .set({ status })
    .where(eq(scans.id, id))
    .returning();
  return scan;
}
