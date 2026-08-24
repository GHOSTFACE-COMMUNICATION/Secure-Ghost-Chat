import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// ── Proxy trust ───────────────────────────────────────────────────────────────
// Railway terminates TLS at its edge and forwards over the private network, so
// the socket peer is always the proxy — without this, `req.ip` is useless and
// X-Forwarded-For has to be parsed by hand (which is what lib/rateLimiter.ts
// used to do, taking the leftmost, client-supplied value).
//
// `1` = trust exactly one hop. Express then walks X-Forwarded-For from the
// right, skipping that many trusted proxies, so anything a client prepends is
// ignored. Verified 24 Aug that Railway's edge OVERWRITES the header rather
// than appending, so today there is exactly one entry and it is the real client
// — but `1` stays correct either way, which is the point of setting it.
//
// Raise this only if another trusted proxy is ever put in front of Railway;
// setting it too high would let a client's forged prefix be read as the peer.
app.set("trust proxy", 1);

// ── Security headers via helmet ───────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false, // keep off — mobile WebView compat
    hsts: {
      maxAge: 31_536_000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
  }),
);

// ── CORS — only allow requests from the Replit dev domain and deployed app ───
const ALLOWED_ORIGINS = [
  // Replit dev proxy (Expo WebView + browser preview)
  process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : null,
  // Expo web preview runs on *.expo.spock.replit.dev — add that variant too
  process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN.replace("spock.replit.dev", "expo.spock.replit.dev")}`
    : null,
  // Deployed app domain (set ALLOWED_ORIGIN env var in production)
  process.env.ALLOWED_ORIGIN ?? null,
  // Local Expo dev
  "http://localhost:8081",
  "http://localhost:19000",
  "http://localhost:19006",
].filter(Boolean) as string[];

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser requests (mobile app, curl)
      if (!origin) return callback(null, true);
      // Allow any Replit dev subdomain (*.spock.replit.dev) — covers expo.*, api.*, etc.
      if (origin.endsWith(".spock.replit.dev") || origin.endsWith(".replit.dev")) {
        return callback(null, true);
      }
      if (ALLOWED_ORIGINS.some((o) => origin.startsWith(o))) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    maxAge: 600, // preflight cache 10 min
  }),
);

// ── Request logging ───────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── General middleware ────────────────────────────────────────────────────────
// Limit body size to 256 KB to prevent DoS via large payloads.
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true, limit: "256kb" }));

app.use("/api", router);

app.get("/admin", (_req, res) => res.redirect("/api/admin"));

// ── Global error handler ─────────────────────────────────────────────────────
// Catches CORS errors and any unhandled synchronous throws in route handlers.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err.message?.startsWith("CORS:")) {
    return res.status(403).json({ error: err.message });
  }
  logger.error({ err }, "Unhandled error");
  return res.status(500).json({ error: "Internal server error" });
});

export default app;
