import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "../config/env.js";
import * as schema from "./schema/index.js";

// Strip channel_binding param which can interfere with HTTP driver
const url = env.DATABASE_URL.replace(/[&?]channel_binding=[^&]*/g, "");

const sql = neon(url);

export const db = drizzle(sql, { schema });

export type Database = typeof db;
