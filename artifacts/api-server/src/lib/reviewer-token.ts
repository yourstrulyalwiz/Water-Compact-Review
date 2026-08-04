import crypto from "node:crypto";

const SECRET = process.env.SESSION_SECRET;

if (!SECRET) {
  throw new Error(
    "SESSION_SECRET environment variable must be set. " +
      "Server cannot start without a signing secret for reviewer tokens.",
  );
}

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SEP = "|";

/**
 * Create a signed reviewer session token.
 * Format (base64url): reviewerId|expiryMs|hmacHex
 */
export function createReviewerToken(reviewerId: string): string {
  const expiry = Date.now() + TOKEN_TTL_MS;
  const payload = `${reviewerId}${SEP}${expiry}`;
  const sig = crypto
    .createHmac("sha256", SECRET!)
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}${SEP}${sig}`).toString("base64url");
}

/**
 * Verify a reviewer session token.
 * Returns the reviewer_id on success, null on any failure.
 */
export function verifyReviewerToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString();
    // Format: reviewerId|expiryMs|hmacHex
    // reviewerId is a UUID (no pipes), so splitting is unambiguous.
    const parts = decoded.split(SEP);
    if (parts.length !== 3) return null;

    const [reviewerId, expiryStr, sig] = parts;
    const expiry = parseInt(expiryStr, 10);
    if (isNaN(expiry) || Date.now() > expiry) return null;

    const payload = `${reviewerId}${SEP}${expiry}`;
    const expected = crypto
      .createHmac("sha256", SECRET!)
      .update(payload)
      .digest("hex");

    // Constant-time comparison to prevent timing attacks
    if (sig.length !== expected.length) return null;
    const match = crypto.timingSafeEqual(
      Buffer.from(sig, "hex"),
      Buffer.from(expected, "hex"),
    );
    return match ? reviewerId : null;
  } catch {
    return null;
  }
}
