import { eq } from "drizzle-orm";
import { db } from "../connection.js";
import { userProfiles, type NewUserProfile } from "../schema/users.js";

export async function getProfileByUserId(userId: string) {
  return db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
  });
}

export async function createProfile(data: NewUserProfile) {
  const [profile] = await db.insert(userProfiles).values(data).returning();
  return profile;
}

export async function updateProfile(
  userId: string,
  data: Partial<Omit<NewUserProfile, "userId">>,
) {
  const [profile] = await db
    .update(userProfiles)
    .set(data)
    .where(eq(userProfiles.userId, userId))
    .returning();
  return profile;
}
