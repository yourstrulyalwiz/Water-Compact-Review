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
 * Accepts { display_name }.
 * No password required — name must be one of the four fixed reviewers.
 * Returns a signed token for the selected reviewer.
 */
router.post(
  "/reviewers/authenticate",
  authLimiter,
  async (req, res): Promise<void> => {
    const { display_name } = req.body as { display_name?: string };

    if (!display_name?.trim()) {
      res.status(400).json({ error: "display_name is required" });
      return;
    }

    if (!REVIEWER_NAMES.has(display_name.trim())) {
      res.status(401).json({ error: "Unknown reviewer name" });
      return;
    }

    // Self-healing lookup: if this allowed name isn't seeded in the current
    // database (e.g. production, where the dev seed never ran), create it.
    // pin_hash is unused by this flow — filled with a random value to satisfy
    // the NOT NULL constraint.
    const result = await pool.query(
      `INSERT INTO reviewers (display_name, pin_hash)
       VALUES ($1, crypt(gen_random_uuid()::text, gen_salt('bf')))
       ON CONFLICT (display_name) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING reviewer_id, display_name`,
      [display_name.trim()],
    );

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
