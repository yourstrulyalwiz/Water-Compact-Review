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

    const result = await pool.query(
      "SELECT reviewer_id, display_name FROM reviewers WHERE display_name = $1",
      [display_name.trim()],
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: "Reviewer not found" });
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
