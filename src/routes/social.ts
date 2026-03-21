import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, and, sql } from "drizzle-orm";
import type { AuthedEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth-guard.js";
import { success, error } from "../lib/api-response.js";
import { db } from "../db/connection.js";
import { socialPosts, socialComments } from "../db/schema/features.js";

export const socialRoute = new Hono<AuthedEnv>();

socialRoute.use("/*", requireAuth);

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const createPostSchema = z.object({
  imageUrl: z.string().url(),
  question: z.string().min(1).max(2000),
  aiSuggestion: z.string().max(2000).optional(),
});

const createCommentSchema = z.object({
  content: z.string().min(1).max(2000),
  isAnswer: z.boolean().default(false),
});

const solvePostSchema = z.object({
  answer: z.string().min(1).max(2000),
});

// ---------------------------------------------------------------------------
// POST /social/posts — Create a post
// ---------------------------------------------------------------------------

socialRoute.post("/social/posts", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  const parsed = createPostSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const { imageUrl, question, aiSuggestion } = parsed.data;

  const [post] = await db
    .insert(socialPosts)
    .values({
      userId: user.id,
      imageUrl,
      question,
      aiSuggestion: aiSuggestion ?? null,
      status: "open",
      upvotes: 0,
    })
    .returning();

  return success(c, post, 201);
});

// ---------------------------------------------------------------------------
// GET /social/posts — List posts (public feed, paginated)
// ---------------------------------------------------------------------------

socialRoute.get("/social/posts", async (c) => {
  const url = new URL(c.req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const status = url.searchParams.get("status") as
    | "open"
    | "solved"
    | "closed"
    | null;

  const conditions = [];
  if (status && ["open", "solved", "closed"].includes(status)) {
    conditions.push(eq(socialPosts.status, status));
  }

  const posts = await db
    .select()
    .from(socialPosts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(socialPosts.createdAt))
    .limit(limit)
    .offset(offset);

  return success(c, { posts, limit, offset });
});

// ---------------------------------------------------------------------------
// GET /social/posts/:id — Get post with comments
// ---------------------------------------------------------------------------

socialRoute.get("/social/posts/:id", async (c) => {
  const { id } = c.req.param();

  const [post] = await db
    .select()
    .from(socialPosts)
    .where(eq(socialPosts.id, id))
    .limit(1);

  if (!post) {
    return error(c, "NOT_FOUND", "Post not found", 404);
  }

  const comments = await db
    .select()
    .from(socialComments)
    .where(eq(socialComments.postId, id))
    .orderBy(desc(socialComments.upvotes), socialComments.createdAt);

  return success(c, { post, comments });
});

// ---------------------------------------------------------------------------
// POST /social/posts/:id/comments — Add comment
// ---------------------------------------------------------------------------

socialRoute.post("/social/posts/:id/comments", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();
  const body = await c.req.json();

  const parsed = createCommentSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  // Verify post exists
  const [post] = await db
    .select()
    .from(socialPosts)
    .where(eq(socialPosts.id, id))
    .limit(1);

  if (!post) {
    return error(c, "NOT_FOUND", "Post not found", 404);
  }

  const { content, isAnswer } = parsed.data;

  const [comment] = await db
    .insert(socialComments)
    .values({
      postId: id,
      userId: user.id,
      content,
      isAnswer,
      upvotes: 0,
    })
    .returning();

  return success(c, comment, 201);
});

// ---------------------------------------------------------------------------
// POST /social/posts/:id/upvote — Toggle upvote on post
// ---------------------------------------------------------------------------

socialRoute.post("/social/posts/:id/upvote", async (c) => {
  const { id } = c.req.param();

  const [post] = await db
    .select()
    .from(socialPosts)
    .where(eq(socialPosts.id, id))
    .limit(1);

  if (!post) {
    return error(c, "NOT_FOUND", "Post not found", 404);
  }

  // Simple upvote increment (toggle would require a separate votes table)
  const [updated] = await db
    .update(socialPosts)
    .set({
      upvotes: sql`${socialPosts.upvotes} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(socialPosts.id, id))
    .returning();

  return success(c, updated);
});

// ---------------------------------------------------------------------------
// POST /social/posts/:id/solve — Mark as solved with an answer
// ---------------------------------------------------------------------------

socialRoute.post("/social/posts/:id/solve", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();
  const body = await c.req.json();

  const parsed = solvePostSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const [post] = await db
    .select()
    .from(socialPosts)
    .where(eq(socialPosts.id, id))
    .limit(1);

  if (!post) {
    return error(c, "NOT_FOUND", "Post not found", 404);
  }

  // Only the post author can mark it as solved
  if (post.userId !== user.id) {
    return error(
      c,
      "FORBIDDEN",
      "Only the post author can mark it as solved",
      403,
    );
  }

  if (post.status === "solved") {
    return error(c, "ALREADY_SOLVED", "This post is already solved", 400);
  }

  const [updated] = await db
    .update(socialPosts)
    .set({
      status: "solved",
      solvedAnswer: parsed.data.answer,
      updatedAt: new Date(),
    })
    .where(eq(socialPosts.id, id))
    .returning();

  return success(c, updated);
});
