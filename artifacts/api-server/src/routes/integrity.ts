import { Router, type IRouter, type Request, type Response } from "express";
import { playintegrity } from "@googleapis/playintegrity";
import { GoogleAuth } from "google-auth-library";
import { RateLimiter, getIpKey } from "../lib/rateLimiter";
import { normalizeAlias } from "../utils/alias";
import { toErrorMessage } from "../utils/error";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// One verification per device per minute is plenty — this only needs to run
// occasionally (app open / sensitive action), not on every request.
const verifyLimiter = new RateLimiter({ windowMs: 60_000, max: 20 });

// Set in Play Console → your app → Setup → App integrity, once a Cloud
// project is linked. Must match the packageName the client's cloud project
// number was prepared against, or every token will fail to decode.
const ANDROID_PACKAGE_NAME = process.env.ANDROID_PACKAGE_NAME ?? "";

// GoogleAuth resolves credentials the standard ways: GOOGLE_APPLICATION_CREDENTIALS
// pointing at a service account key file/JSON, or workload identity / ADC if
// the environment provides it. NOTE: this project's Google Cloud org has
// previously blocked service-account KEY creation (iam.disableServiceAccountKeyCreation
// — see the Play Console submission history) — the same policy will block
// minting a downloadable key for this too. If so, use Workload Identity
// Federation instead of a key file; GoogleAuth supports both without any
// code change here, only env/config.
let authClient: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (!authClient) {
    authClient = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/playintegrity"] });
  }
  return authClient;
}

// ── POST /api/integrity/verify — decode and grade a Play Integrity token ──────
//
// Body: { token: string, alias?: string }
// The alias is only used for logging/rate-limit context; the actual identity
// binding lives in the requestHash the client hashed the token against
// (see lib/deviceIntegrity.ts on the mobile side).
router.post("/integrity/verify", async (req: Request, res: Response) => {
  if (!verifyLimiter.check(getIpKey(req))) {
    return res.status(429).json({ error: "Too many integrity checks. Try again shortly." });
  }

  if (!ANDROID_PACKAGE_NAME) {
    // Not configured yet — fail closed (verified: false) rather than 500,
    // so a half-set-up server doesn't look like a crash to the client.
    return res.json({ verified: false, strong: false, reason: "server-not-configured" });
  }

  const { token, alias } = req.body as { token?: string; alias?: string };
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "token required" });
  }

  try {
    const client = playintegrity({ version: "v1", auth: getAuth() });
    const { data } = await client.v1.decodeIntegrityToken({
      packageName: ANDROID_PACKAGE_NAME,
      requestBody: { integrityToken: token },
    });

    const verdict = data.tokenPayloadExternal;
    const deviceRecognitionVerdict =
      verdict?.deviceIntegrity?.deviceRecognitionVerdict ?? [];
    const appRecognitionVerdict = verdict?.appIntegrity?.appRecognitionVerdict;

    const strong = deviceRecognitionVerdict.includes("MEETS_STRONG_INTEGRITY");
    const basicOrBetter =
      strong ||
      deviceRecognitionVerdict.includes("MEETS_DEVICE_INTEGRITY") ||
      deviceRecognitionVerdict.includes("MEETS_BASIC_INTEGRITY");
    const genuineApp = appRecognitionVerdict === "PLAY_RECOGNIZED";

    const verified = basicOrBetter && genuineApp;

    if (!verified) {
      logger.warn(
        { alias: alias ? normalizeAlias(alias) : undefined, deviceRecognitionVerdict, appRecognitionVerdict },
        "[integrity] check failed",
      );
    }

    return res.json({
      verified,
      strong,
      reason: verified ? undefined : "did-not-meet-integrity-bar",
    });
  } catch (err) {
    logger.error({ err: toErrorMessage(err) }, "[integrity] decode failed");
    // Fail closed: an error decoding the token is not the same as a passing
    // verdict, so this must not report verified: true.
    return res.json({ verified: false, strong: false, reason: "decode-error" });
  }
});

export default router;
