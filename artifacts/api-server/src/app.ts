import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Trust the Replit proxy so that express-rate-limit can correctly identify
// clients from X-Forwarded-For rather than the internal proxy IP.
app.set("trust proxy", 1);

// Restrict CORS to the app's own origin.
// In the Replit environment, frontend and API share the same proxied host, so
// same-origin browser requests never trigger CORS at all. This origin list
// blocks external sites from making cross-origin authenticated requests.
const allowedOrigins = new Set<string>();

// REPLIT_DEV_DOMAIN — set in the dev workspace (e.g. *.replit.dev)
const devDomain = process.env.REPLIT_DEV_DOMAIN;
if (devDomain) {
  allowedOrigins.add(`https://${devDomain}`);
}

// REPLIT_DOMAINS — comma-separated list of all served domains; present in
// both dev and production (e.g. the *.replit.app production domain).
const replitDomains = process.env.REPLIT_DOMAINS;
if (replitDomains) {
  for (const d of replitDomains.split(",")) {
    const trimmed = d.trim();
    if (trimmed) allowedOrigins.add(`https://${trimmed}`);
  }
}

// ALLOWED_ORIGIN — manual escape hatch for custom domains or local testing
const extraOrigin = process.env.ALLOWED_ORIGIN;
if (extraOrigin) {
  allowedOrigins.add(extraOrigin);
}

app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin (non-browser) requests that have no Origin header
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} is not allowed`));
    },
    credentials: true,
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
