import { Router, type IRouter, type Request, type Response } from "express";
import { getPushHealthReport } from "../lib/pushCredentialHealth";
import { apnsResolvedHost, apnsSandboxMismatch } from "../lib/nativeCallPushSender";
import { requireAdminSecret } from "../middlewares/adminAuth";

/**
 * GET /admin/push-health (task #166) — credential-health check for the
 * native call-push transports (APNs VoIP / FCM v1). Reports whether each
 * transport is configured, its current error run, and rolling 15-minute
 * success/error counts, so a broken cert is visible before users notice
 * that incoming calls stopped ringing.
 *
 * Contains no user data, tokens, or secrets — only aggregate counters.
 *
 * Task #168: gated behind the shared ADMIN_SECRET credential like every
 * other /admin surface. Monitoring can authenticate via the
 * `Authorization: Bearer <secret>` or `x-admin-secret` header (or `?key=`).
 */
const router: IRouter = Router();

router.get("/admin/push-health", requireAdminSecret, (_req: Request, res: Response) => {
  const report = getPushHealthReport();
  const unhealthy = report.transports.some((t) => t.configured && t.status === "alerting");
  // Task #174: surface which APNs server (sandbox vs production) is in use
  // and whether a non-production server is pointed at the production host
  // (silent BadDeviceToken failures) alongside the credential checks.
  const apns = { ...apnsResolvedHost(), sandboxMismatch: apnsSandboxMismatch() };
  res.status(unhealthy ? 503 : 200).json({ ...report, apns });
});

export default router;
