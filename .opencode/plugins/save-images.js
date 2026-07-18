// save-images.js — OpenCode plugin: saves user-pasted images to disk on arrival
//
// The problem: When a user pastes an image in opencode chat, the image data
// lives ONLY in the conversation context (data URI in a FilePart). It is NOT
// persisted to the SQLite DB as an extractable blob. The `task` tool does not
// forward attachments to sub-agents. So @vision has no way to see the image.
//
// Solution: This plugin hooks the server-side `chat.message` event, which fires
// when a user message is received. It finds FilePart entries with image data
// URIs, extracts the base64 data, saves them to screenshots/ as files, and
// updates a manifest.json with the latest image path.
//
// Usage: After the user pastes an image, check for screenshots/.new-image
// (which contains the absolute path of the latest saved image). If it exists,
// read it and dispatch to @vision with that path. Then delete .new-image to
// prevent re-processing.
//
// This plugin writes TWO files for every image:
//   screenshots/manifest.json — canonical record (absolute path, metadata)
//   screenshots/.new-image    — trigger flag (absolute path only, deleted after dispatch)
//
// Install: Add to .opencode/opencode.json:
//   "plugin": [".opencode/plugins/graphify.js", ".opencode/plugins/save-images.js"]

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export const SaveImagesPlugin = async ({ directory }) => {
  const screenshotsDir = join(directory, "screenshots");
  let imageCounter = 0;

  // Ensure screenshots directory exists
  mkdirSync(screenshotsDir, { recursive: true });

  return {
    /**
     * Fires for every user message received by the server.
     * We scan parts for image FilePart entries and save them to disk.
     */
    "chat.message": async (input, output) => {
      const { parts, message } = output;
      if (!parts || parts.length === 0) return;

      for (const part of parts) {
        // Only handle file-type parts with image MIME types and data URIs
        if (
          part.type === "file" &&
          part.mime &&
          part.mime.startsWith("image/") &&
          part.url &&
          part.url.startsWith("data:")
        ) {
          try {
            imageCounter++;
            const timestamp = Date.now();
            const now = new Date().toISOString();

            // Determine file extension from MIME type
            const extMap = {
              "image/png": ".png",
              "image/jpeg": ".jpg",
              "image/jpg": ".jpg",
              "image/webp": ".webp",
              "image/gif": ".gif",
              "image/svg+xml": ".svg",
              "image/bmp": ".bmp",
            };
            const ext = extMap[part.mime] || ".png";
            const filename = `chat-image-${timestamp}-${imageCounter}${ext}`;
            const filepath = join(screenshotsDir, filename);

            // Extract base64 data from data URI (format: "data:image/png;base64,<data>")
            const base64Data = part.url.split(",")[1];
            if (!base64Data) continue;

            const buffer = Buffer.from(base64Data, "base64");
            // Skip tiny/invalid data
            if (buffer.length < 100) continue;

            writeFileSync(filepath, buffer);

            // Update manifest — keeps absolute latest, previous entries keep
            // as history so Glitch can reference any recent image
            const manifest = {
              latest: {
                relative: `screenshots/${filename}`,
                absolute: filepath,
                timestamp,
                iso: now,
                mime: part.mime,
                filename: part.filename || filename,
                size_bytes: buffer.length,
                size_kb: (buffer.length / 1024).toFixed(1),
                sessionID: input.sessionID,
              },
            };

            const manifestPath = join(screenshotsDir, "manifest.json");
            writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

            // Write trigger flag — Glitch checks for this file at response start.
            // Content is the absolute path ONLY. Glitch reads this, dispatches to
            // @vision, then deletes the trigger to prevent re-processing.
            const triggerPath = join(screenshotsDir, ".new-image");
            writeFileSync(triggerPath, filepath + "\n");

            console.log(
              `[save-images] Saved: screenshots/${filename} (${(buffer.length / 1024).toFixed(1)} KB, ${part.mime})`
            );
          } catch (err) {
            console.error(`[save-images] Error saving image: ${err.message}`);
          }
        }
      }
    },
  };
};
