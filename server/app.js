import express from "express";
import cors from "cors";
import { verifyLicense } from "./src/license.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "iranexpedia-license-api",
    docs: {
      health: "GET /api/health",
      verify: "POST /api/license/verify"
    }
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "iranexpedia-license",
    time: new Date().toISOString()
  });
});

app.post("/api/license/verify", (req, res) => {
  const key = req.body?.key;
  const deviceId = req.body?.deviceId || null;
  const result = verifyLicense(key);

  console.log(
    "[license]",
    result.valid ? "VALID" : "INVALID",
    "| key:",
    String(key || "").slice(0, 8) + "***",
    "| device:",
    deviceId || "-",
    "| reason:",
    result.reason
  );

  res.status(result.valid ? 200 : 401).json({
    valid: result.valid,
    reason: result.reason,
    message: result.message,
    customer: result.customer || null,
    expiresAt: result.expiresAt || null,
    features: result.features || [],
    serverTime: new Date().toISOString()
  });
});

export default app;
