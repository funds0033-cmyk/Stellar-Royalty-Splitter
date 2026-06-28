import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import express from "express";
import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  buildSignaturePayload,
  resetSignatureNonceCache,
  verifySignedPostRequests,
} from "../src/request-signing.js";

function buildApp() {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString("utf8");
      },
    }),
  );
  app.use(verifySignedPostRequests);
  app.post("/api/v1/distribute", (req, res) => res.json({ ok: true, body: req.body }));
  app.get("/api/v1/health", (_req, res) => res.json({ ok: true }));
  return app;
}

function signHeaders({
  keypair,
  body = {},
  path = "/api/v1/distribute",
  timestamp = new Date().toISOString(),
  nonce = "nonce-1",
}) {
  const bodyText = JSON.stringify(body);
  const payload = buildSignaturePayload({
    method: "POST",
    path,
    timestamp,
    nonce,
    body: bodyText,
  });

  return {
    "x-signature-public-key": keypair.publicKey(),
    "x-signature": keypair.sign(Buffer.from(payload, "utf8")).toString("base64"),
    "x-signature-timestamp": timestamp,
    "x-signature-nonce": nonce,
  };
}

describe("request signature middleware", () => {
  let originalAllowedKeys;
  let originalNodeEnv;

  beforeEach(() => {
    originalAllowedKeys = process.env.REQUEST_SIGNING_PUBLIC_KEYS;
    originalNodeEnv = process.env.NODE_ENV;
    delete process.env.REQUEST_SIGNING_PUBLIC_KEYS;
    process.env.NODE_ENV = "test";
    resetSignatureNonceCache();
    jest.useRealTimers();
  });

  afterEach(() => {
    if (originalAllowedKeys === undefined) delete process.env.REQUEST_SIGNING_PUBLIC_KEYS;
    else process.env.REQUEST_SIGNING_PUBLIC_KEYS = originalAllowedKeys;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    resetSignatureNonceCache();
  });

  test("allows GET requests without a signature", async () => {
    const res = await request(buildApp()).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test("accepts a valid Ed25519 signature for a POST request", async () => {
    const keypair = Keypair.random();
    const body = { contractId: "contract", walletAddress: keypair.publicKey(), amount: 1 };

    const res = await request(buildApp())
      .post("/api/v1/distribute")
      .set(signHeaders({ keypair, body }))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, body });
  });

  test("rejects unsigned POST requests with 401", async () => {
    const res = await request(buildApp()).post("/api/v1/distribute").send({ amount: 1 });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/missing request signature/i);
  });

  test("rejects invalid signatures with 401", async () => {
    const keypair = Keypair.random();
    const body = { amount: 1 };
    const headers = signHeaders({ keypair, body });
    headers["x-signature"] = Keypair.random().sign(Buffer.from("wrong")).toString("base64");

    const res = await request(buildApp()).post("/api/v1/distribute").set(headers).send(body);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid request signature/i);
  });

  test("rejects replayed nonces with 401", async () => {
    const keypair = Keypair.random();
    const body = { amount: 1 };
    const headers = signHeaders({ keypair, body, nonce: "replay-me" });
    const app = buildApp();

    const first = await request(app).post("/api/v1/distribute").set(headers).send(body);
    const replay = await request(app).post("/api/v1/distribute").set(headers).send(body);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(401);
    expect(replay.body.error).toMatch(/nonce/i);
  });

  test("rejects stale timestamps with 401", async () => {
    const keypair = Keypair.random();
    const body = { amount: 1 };
    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const res = await request(buildApp())
      .post("/api/v1/distribute")
      .set(signHeaders({ keypair, body, timestamp: staleTimestamp }))
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/timestamp/i);
  });

  test("rejects signed requests from public keys outside the allowlist", async () => {
    const keypair = Keypair.random();
    process.env.REQUEST_SIGNING_PUBLIC_KEYS = Keypair.random().publicKey();
    const body = { amount: 1 };

    const res = await request(buildApp())
      .post("/api/v1/distribute")
      .set(signHeaders({ keypair, body }))
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not allowed/i);
  });

  test("requires a public key allowlist in production", async () => {
    const keypair = Keypair.random();
    process.env.NODE_ENV = "production";
    delete process.env.REQUEST_SIGNING_PUBLIC_KEYS;
    const body = { amount: 1 };

    const res = await request(buildApp())
      .post("/api/v1/distribute")
      .set(signHeaders({ keypair, body }))
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/allowlist/i);
  });
});
