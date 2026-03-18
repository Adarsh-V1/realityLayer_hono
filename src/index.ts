import "dotenv/config";

import { handle } from "@hono/node-server/vercel";
import { createApp } from "./app.js";

const app = createApp();

export default handle(app);
