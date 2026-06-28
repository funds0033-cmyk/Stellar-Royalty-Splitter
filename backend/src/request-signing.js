import crypto from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

const DEFAULT_TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;
const usedNonces = new Map();

function getBodyText(req) {
  if (typeof req.rawBody === "string") return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString("utf8");
  return JSON.stringify(req.body ?? {});
}

export function buildSignaturePayload({ method, path, timestamp, nonce, body }) {
  const bodyHash = crypto.createHash("sha256").update(body ?? "").digest("hex");
  return [method.toUpperCase(), path, timestamp, nonce, bodyHash].join("\n");
}

function getAllowedPublicKeys() {
  return new Set(
    (process.env.REQUEST_SIGNING_PUBLIC_KEYS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function purgeExpiredNonces(now, windowMs) {
  for (const [nonce, seenAt] of usedNonces.entries()) {
    if (now - seenAt > windowMs) usedNonces.delete(nonce);
  }
}

export function resetSignatureNonceCache() {
  usedNonces.clear();
}

export function verifySignedPostRequests(req, res, next) {
  if (req.method !== "POST") return next();

  const publicKey = req.get("x-signature-public-key");
  const signature = req.get("x-signature");
  const timestamp = req.get("x-signature-timestamp");
  const nonce = req.get("x-signature-nonce");

  if (!publicKey || !signature || !timestamp || !nonce) {
    return res.status(401).json({ error: "Missing request signature headers" });
  }

  const now = Date.now();
  const timestampMs = Date.parse(timestamp);
  const windowMs = Number.parseInt(
    process.env.REQUEST_SIGNATURE_WINDOW_MS ?? `${DEFAULT_TIMESTAMP_WINDOW_MS}`,
    10,
  );

  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > windowMs) {
    return res.status(401).json({ error: "Request signature timestamp is outside the allowed window" });
  }

  purgeExpiredNonces(now, windowMs);
  if (usedNonces.has(nonce)) {
    return res.status(401).json({ error: "Request signature nonce has already been used" });
  }

  const allowedPublicKeys = getAllowedPublicKeys();
  if (allowedPublicKeys.size === 0 && process.env.NODE_ENV === "production") {
    return res.status(401).json({ error: "Request signature public key allowlist is not configured" });
  }

  if (allowedPublicKeys.size > 0 && !allowedPublicKeys.has(publicKey)) {
    return res.status(401).json({ error: "Request signature public key is not allowed" });
  }

  try {
    const payload = buildSignaturePayload({
      method: req.method,
      path: req.originalUrl,
      timestamp,
      nonce,
      body: getBodyText(req),
    });
    const verified = Keypair.fromPublicKey(publicKey).verify(
      Buffer.from(payload, "utf8"),
      Buffer.from(signature, "base64"),
    );

    if (!verified) {
      return res.status(401).json({ error: "Invalid request signature" });
    }

    usedNonces.set(nonce, now);
    req.signature = { publicKey, timestamp, nonce };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid request signature" });
  }
}
