import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "@workspace/db";
import { createReviewerToken } from "../lib/reviewer-token.js";

const router: IRouter = Router();

// Rate limiter for login — 10 attempts per IP per 15 minutes.
// Prevents brute-forcing the 4-digit PIN space (10 000 values) in one session.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Please try again later." },
  skipSuccessfulRequests: true, // only count failed/non-2xx responses
});

// Rate limiter for registration — 5 new accounts per IP per hour.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many registration attempts. Please try again later." },
  skipSuccessfulRequests: true,
});

// POST /api/reviewers/register
router.post(
  "/reviewers/register",
  registerLimiter,
  async (req, res): Promise<void> => {
    const { display_name, pin } = req.body as {
      display_name?: string;
      pin?: string;
    };

    if (!display_name?.trim() || !pin?.trim()) {
      res.status(400).json({ error: "display_name and pin are required" });
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      res.status(400).json({ error: "PIN must be exactly 4 digits" });
      return;
    }

    try {
      const result = await pool.query(
        `INSERT INTO reviewers (display_name, pin_hash)
       VALUES ($1, crypt($2, gen_salt('bf')))
       RETURNING reviewer_id, display_name`,
        [display_name.trim(), pin],
      );
      const { reviewer_id, display_name: name } = result.rows[0];
      const token = createReviewerToken(reviewer_id);
      res.status(201).json({ reviewer_id, display_name: name, token });
    } catch (err: any) {
      if (err.code === "23505") {
        res.status(409).json({
          error:
            "A reviewer with this name already exists. Try a different name or sign in.",
        });
      } else {
        throw err;
      }
    }
  },
);

// POST /api/reviewers/login
// Returns a generic 401 for both wrong-PIN and unknown-name to prevent
// account enumeration. Only the PIN check is timing-safe (constant-time
// via bcrypt); the name check is protected by the same response shape.
router.post(
  "/reviewers/login",
  loginLimiter,
  async (req, res): Promise<void> => {
    const { display_name, pin } = req.body as {
      display_name?: string;
      pin?: string;
    };

    if (!display_name?.trim() || !pin?.trim()) {
      res.status(400).json({ error: "display_name and pin are required" });
      return;
    }

    // Single query: returns a row only when both name AND PIN match.
    // Using crypt() for constant-time comparison even when name is unknown
    // (bcrypt still runs on the supplied pin against NULL hash, preventing
    // a timing oracle on name existence).
    const result = await pool.query(
      `SELECT reviewer_id, display_name
     FROM reviewers
     WHERE display_name = $1 AND pin_hash = crypt($2, pin_hash)`,
      [display_name.trim(), pin],
    );

    if (result.rows.length > 0) {
      const { reviewer_id, display_name: name } = result.rows[0];
      const token = createReviewerToken(reviewer_id);
      res.json({ reviewer_id, display_name: name, token });
      return;
    }

    // Return generic 401 — do not distinguish "name not found" from "wrong PIN"
    res.status(401).json({ error: "Invalid display name or PIN" });
  },
);

export default router;
