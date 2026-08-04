import { createServer } from "http";
import { WebSocketServer } from "ws";
import app from "./app";
import { logger } from "./lib/logger";
import { createWsServer } from "./ws/manager";
import { startRotationScheduler } from "./lib/rotationScheduler";

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

startRotationScheduler();

httpServer.listen(port, () => {
  logger.info({ port }, "Server listening");
});
