import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { env } from "../config/env.js";
import * as schema from "./schema/index.js";

// WebSocket constructor required for Node.js / Vercel serverless
neonConfig.webSocketConstructor = ws;

// Strip channel_binding param which can interfere with some drivers
const url = env.DATABASE_URL.replace(/[&?]channel_binding=[^&]*/g, "");

const pool = new Pool({ connectionString: url });

export const db = drizzle(pool, { schema });

export type Database = typeof db;
