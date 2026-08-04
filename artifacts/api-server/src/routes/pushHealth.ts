import { Router, type IRouter, type Request, type Response } from "express";
import { getPushHealthReport } from "../lib/pushCredentialHealth";

/**
 * GET /admin/push-health (task #166) — credential-health check for the
 * native call-push transports (APNs VoIP / FCM v1). Reports whether each
 * transport is configured, its current error run, and rolling 15-minute
 * success/error counts, so a broken cert is visible before users notice
 * that incoming calls stopped ringing.
 *
 * Contains no user data, tokens, or secrets — only aggregate counters.
 */
const router: IRouter = Router();

router.get("/admin/push-health", (_req: Request, res: Response) => {
  const report = getPushHealthReport();
  const unhealthy = report.transports.some((t) => t.configured && t.status === "alerting");
  res.status(unhealthy ? 503 : 200).json(report);
});

export default router;
