import "dotenv/config";
import express from "express";
import { createNetworkAnalytics } from "./networkAnalytics.js";

const app = express();
const port = Number(process.env.PORT || 3000);

// IMPORTANT: adapt this value to your hosting/proxy setup.
// With one trusted reverse proxy (common on managed Node hosting), 1 is typical.
app.set("trust proxy", Number(process.env.TRUST_PROXY || 1));
app.use(express.static("public"));

const analytics = createNetworkAnalytics();
app.use("/network-analytics", analytics.router);

app.get("/health", async (_req, res) => {
  try {
    await analytics.pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
