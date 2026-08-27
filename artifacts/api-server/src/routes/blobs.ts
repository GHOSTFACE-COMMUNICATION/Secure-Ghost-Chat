import { Router, type IRouter, type Request, type Response } from "express";
import express from "express";
import { mkdir, writeFile, stat, readFile, rename, unlink } from "fs/promises";
import { createReadStream } from "fs";
import { join, resolve } from "path";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger";
import { RateLimiter, GlobalLimiter, getIpKey } from "../lib/rateLimiter";
import { checkAuth } from "../lib/auth";

const router: IRouter = Router();

// Encrypted attachment blobs. The server treats these as opaque bytes —
// the client encrypts each blob with a per-blob symmetric key and embeds
// only the blob id + key in the (already E2EE) message. The server never
// sees plaintext and never sees the key.
//
// Storage is the local filesystem under BLOB_DIR (default ./data/blobs).
// Persistent disk is intentional so that a recipient who is offline when
// the message is sent can still fetch the blob after they reconnect.
const BLOB_DIR = resolve(process.env.BLOB_DIR?.trim() || "./data/blobs");
const MAX_BLOB_BYTES = 32 * 1024 * 1024; // 32 MiB — fits a ~25 MiB photo + AEAD overhead
const BLOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Per-IP rate limiters. Uploads cost disk; downloads are cheap but we
// still cap them so a single client can't tarpit the server.
const uploadLimiter = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 1_200, prefix: "blobUpload" });
// Per-IP cannot discriminate under carrier NAT, so the disk itself gets a
// ceiling regardless of auth. Retained after auth landed: it still bounds a
// single compromised or misbehaving account.
const uploadGlobal = new GlobalLimiter({ windowMs: 60 * 60 * 1000, max: 12_000, prefix: "blobUploadGlobal" });
const downloadLimiter = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 6_000, prefix: "blobDownload" });
const downloadGlobal = new GlobalLimiter({ windowMs: 60 * 60 * 1000, max: 60_000, prefix: "blobDownloadGlobal" });

let dirReady: Promise<void> | null = null;
function ensureDir(): Promise<void> {
  if (!dirReady) dirReady = mkdir(BLOB_DIR, { recursive: true }).then(() => undefined);
  return dirReady;
}

function blobPath(id: string): string {
  return join(BLOB_DIR, id);
}

router.post(
  "/blobs",
  express.raw({ type: "application/octet-stream", limit: MAX_BLOB_BYTES }),
  async (req: Request, res: Response) => {
    // Authenticated write — this costs server disk. Gated by
    // ENFORCE_ENDPOINT_AUTH; off (the default) this is a no-op and legacy
    // clients keep working. See lib/auth.ts for why the default matters.
    const auth = await checkAuth(req, res, "POST /blobs", "query");
    if (!auth.ok) return;

    if (!(await uploadLimiter.check(getIpKey(req))) || !(await uploadGlobal.check())) {
      res.status(429).json({ error: "Too many uploads" });
      return;
    }
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res
        .status(400)
        .json({ error: "Body must be raw bytes with Content-Type application/octet-stream" });
      return;
    }
    if (body.length > MAX_BLOB_BYTES) {
      res.status(413).json({ error: "Blob too large" });
      return;
    }
    try {
      await ensureDir();
      const blobId = randomUUID();
      // Write to a temp file in the same directory and rename atomically so
      // a server crash mid-write can never leave a half-written blob behind
      // that a GET would happily stream as if it were valid ciphertext.
      const finalPath = blobPath(blobId);
      const tmpPath = `${finalPath}.tmp`;
      try {
        await writeFile(tmpPath, body, { flag: "wx" });
        await rename(tmpPath, finalPath);
      } catch (writeErr) {
        await unlink(tmpPath).catch(() => undefined);
        throw writeErr;
      }
      res.json({ blobId, bytes: body.length });
    } catch (err) {
      logger.error({ err }, "blob upload failed");
      res.status(500).json({ error: "Upload failed" });
    }
  },
);

router.get("/blobs/:id", async (req: Request, res: Response) => {
  if (!(await downloadLimiter.check(getIpKey(req))) || !(await downloadGlobal.check())) {
    res.status(429).json({ error: "Too many downloads" });
    return;
  }
  const idParam = req.params["id"];
  const id = typeof idParam === "string" ? idParam : "";
  if (!id || !BLOB_ID_RE.test(id)) {
    res.status(400).json({ error: "Invalid blob id" });
    return;
  }
  const path = blobPath(id);
  try {
    const st = await stat(path);
    if (!st.isFile()) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", String(st.size));
    res.setHeader("Cache-Control", "private, max-age=86400, immutable");
    createReadStream(path).pipe(res);
  } catch {
    res.status(404).json({ error: "Not found" });
  }
});

// Exposed for tests
export const __internal = { BLOB_DIR, MAX_BLOB_BYTES, blobPath, readFile };

export default router;
