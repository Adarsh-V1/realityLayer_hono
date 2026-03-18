// Vercel Node.js serverless function entry point
// Custom handler that properly buffers POST bodies
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createApp } from "../src/app.js";

const app = createApp();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Build the full URL
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const url = `${proto}://${host}${req.url}`;

  // Buffer the request body for non-GET/HEAD methods
  let body: BodyInit | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    if (chunks.length > 0) {
      body = Buffer.concat(chunks);
    }
  }

  // Build headers
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  // Create Web Request and pass to Hono
  const webReq = new Request(url, {
    method: req.method,
    headers,
    body,
  });

  const webRes = await app.fetch(webReq);

  // Write response
  res.status(webRes.status);
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  const resBody = await webRes.arrayBuffer();
  res.end(Buffer.from(resBody));
}
