import express from "express";
import mysql from "mysql2/promise";

export function createNetworkAnalytics(options = {}) {
  const adminToken = options.adminToken || process.env.ADMIN_TOKEN;
  const ipinfoToken = options.ipinfoToken || process.env.IPINFO_TOKEN;
  if (!adminToken) throw new Error("ADMIN_TOKEN is required");
  if (!ipinfoToken) throw new Error("IPINFO_TOKEN is required");

  const pool = options.pool || mysql.createPool({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || "ip_dashboard",
    waitForConnections: true,
    connectionLimit: 10,
    ssl: process.env.MYSQL_SSL === "true" ? {} : undefined
  });

  const router = express.Router();
  router.use(express.json({ limit: "16kb" }));

  const normalizeIp = (value = "") => {
    const ip = String(value).trim();
    return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  };

  const normalizeOperator = (data) => String(
    data?.as?.name || data?.asn?.name || data?.as_name || data?.company?.name || data?.org || "Inconnu"
  ).replace(/^AS\d+\s+/i, "").trim().slice(0, 191) || "Inconnu";

  const detectVpn = (data) => data?.anonymous ? Boolean(data.anonymous.is_vpn) : Boolean(data?.privacy?.vpn);

  async function enrichIp(ip) {
    let response = await fetch(
      `https://api.ipinfo.io/lookup/${encodeURIComponent(ip)}?token=${encodeURIComponent(ipinfoToken)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!response.ok) {
      response = await fetch(
        `https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${encodeURIComponent(ipinfoToken)}`,
        { signal: AbortSignal.timeout(5000) }
      );
    }
    if (!response.ok) throw new Error(`IP provider returned ${response.status}`);
    const data = await response.json();
    return { operator: normalizeOperator(data), vpn: detectVpn(data) };
  }

  async function incrementStats(operator, vpn) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO operator_stats (operator_name, visit_count) VALUES (?, 1)
         ON DUPLICATE KEY UPDATE visit_count = visit_count + 1`, [operator]
      );
      await connection.execute(
        `INSERT INTO vpn_stats (vpn_used, visit_count) VALUES (?, 1)
         ON DUPLICATE KEY UPDATE visit_count = visit_count + 1`, [vpn ? 1 : 0]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  function requireAdmin(req, res, next) {
    if (req.headers.authorization !== `Bearer ${adminToken}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  }

  router.post("/checkin", async (req, res) => {
    try {
      const ip = normalizeIp(req.ip);
      const classification = await enrichIp(ip);
      await incrementStats(classification.operator, classification.vpn);
      res.json({ success: true });
    } catch (error) {
      console.error("network analytics checkin failed:", error.message);
      res.status(502).json({ success: false, error: "Unable to classify network" });
    }
  });

  router.get("/dashboard", requireAdmin, async (_req, res) => {
    const [operators] = await pool.query(
      "SELECT operator_name AS name, visit_count AS value FROM operator_stats WHERE visit_count > 0 ORDER BY visit_count DESC"
    );
    const [vpnRows] = await pool.query("SELECT vpn_used, visit_count FROM vpn_stats ORDER BY vpn_used");
    const vpn = { yes: 0, no: 0 };
    for (const row of vpnRows) Number(row.vpn_used) === 1 ? vpn.yes = Number(row.visit_count) : vpn.no = Number(row.visit_count);
    res.json({ operators: operators.map(x => ({ name: x.name, value: Number(x.value) })), vpn });
  });

  return { router, pool };
}
