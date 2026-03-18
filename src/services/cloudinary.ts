import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

// Cloudinary auto-configures from CLOUDINARY_URL env var.
// We just verify it's available.
if (!env.CLOUDINARY_URL) {
  logger.warn("CLOUDINARY_URL not set — image uploads will fail");
}

export interface UploadResult {
  publicId: string;
  url: string;
  secureUrl: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
}

/**
 * Upload a base64 image or buffer to Cloudinary.
 * Returns a slim result with only what we need downstream.
 */
export async function uploadImage(
  data: string,
  folder = "scans",
): Promise<UploadResult> {
  const result = await cloudinary.uploader.upload(data, {
    folder,
    resource_type: "image",
    transformation: [{ quality: "auto", fetch_format: "auto" }],
  });

  return {
    publicId: result.public_id,
    url: result.url,
    secureUrl: result.secure_url,
    width: result.width,
    height: result.height,
    format: result.format,
    bytes: result.bytes,
  };
}
