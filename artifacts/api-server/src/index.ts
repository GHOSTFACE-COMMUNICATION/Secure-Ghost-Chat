import { createServer } from "http";
import { WebSocketServer } from "ws";
import app from "./app";
import { logger } from "./lib/logger";
import { createWsServer } from "./ws/manager";
import { startRotationScheduler } from "./lib/rotationScheduler";
import { startInviteExpiryScheduler } from "./lib/inviteExpiryScheduler";
import { startPushHealthMonitor } from "./lib/pushHealthMonitor";
import { warnIfApnsSandboxMismatch } from "./lib/nativeCallPushSender";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);

const wss = new WebSocketServer({ server: httpServer, path: "/api/ws" });
createWsServer(wss);
logger.info("WebSocket server attached at /api/ws");

// Task #171: warn loudly at startup when a dev server would push dev-build
// VoIP tokens at the production APNs host (silent BadDeviceToken failures).
warnIfApnsSandboxMismatch();

startRotationScheduler();
startInviteExpiryScheduler();
// Task #183: automatic alerting when push credentials break — periodically
// polls /api/admin/push-health and pushes to a configurable webhook.
startPushHealthMonitor();

httpServer.listen(port, () => {
  logger.info({ port }, "Server listening");
});
