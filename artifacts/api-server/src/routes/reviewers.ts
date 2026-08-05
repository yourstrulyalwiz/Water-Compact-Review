import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "@workspace/db";
import { createReviewerToken } from "../lib/reviewer-token.js";

const router: IRouter = Router();

// The four fixed reviewer names. Any request for a name not in this list is rejected.
const REVIEWER_NAMES = new Set(["Christina", "Billy", "Juliana", "Patricia"]);

// Rate limiter — 10 attempts per IP per 15 minutes (same policy as the old login endpoint)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Please try again later." },
  skipSuccessfulRequests: true,
});

/**
 * POST /api/reviewers/authenticate
 *
 * Accepts { display_name, password }.
 * Checks the supplied password against the REVIEWER_MASTER_PASSWORD env var,
 * then looks up the pre-seeded reviewer record and returns a signed token.
 *
 * Returns generic 401 for both wrong-password and unknown-name to prevent
 * enumeration.
 */
router.post(
  "/reviewers/authenticate",
  authLimiter,
  async (req, res): Promise<void> => {
    const masterPassword = process.env.REVIEWER_MASTER_PASSWORD;
    if (!masterPassword) {
      res
        .status(503)
        .json({ error: "Authentication is not configured on this server." });
      return;
    }

    const { display_name, password } = req.body as {
      display_name?: string;
      password?: string;
    };

    if (!display_name?.trim() || !password) {
      res
        .status(400)
        .json({ error: "display_name and password are required" });
      return;
    }

    // Reject unknown names before checking the password to avoid leaking
    // timing information about known vs unknown names.
    if (!REVIEWER_NAMES.has(display_name.trim())) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (password !== masterPassword) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const result = await pool.query(
      "SELECT reviewer_id, display_name FROM reviewers WHERE display_name = $1",
      [display_name.trim()],
    );

    if (result.rows.length === 0) {
      // Reviewer not seeded yet — shouldn't happen after migration 002
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const { reviewer_id, display_name: name } = result.rows[0];
    const token = createReviewerToken(reviewer_id);
    res.json({ reviewer_id, display_name: name, token });
  },
);

// Legacy endpoints — retired. Return 410 so clients get a clear signal.
router.post("/reviewers/register", (_req, res) => {
  res.status(410).json({
    error:
      "Self-registration is no longer available. Use POST /api/reviewers/authenticate.",
  });
});

router.post("/reviewers/login", (_req, res) => {
  res.status(410).json({
    error:
      "This endpoint has been retired. Use POST /api/reviewers/authenticate.",
  });
});

export default router;
