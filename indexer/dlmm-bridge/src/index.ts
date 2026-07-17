// Minimal HTTP sidecar — plain node:http rather than a framework, since
// this only ever serves two routes and is called exclusively by the Rust
// indexer's own API server (src/api.rs's /pool and /tx/buy-neb/build
// proxy handlers), never directly by the browser or the Next.js app.

import http from "node:http";
import { Connection, PublicKey } from "@solana/web3.js";
import { fetchNebPoolStatus } from "./pool";
import { buildBuyNebTx } from "./swap";

const PORT = Number(process.env.PORT || "8091");
const RPC_URL = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
const connection = new Connection(RPC_URL, "confirmed");

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/pool") {
      const pool = await fetchNebPoolStatus(connection);
      if (!pool) return sendJson(res, 404, { error: "no pool configured" });
      return sendJson(res, 200, pool);
    }

    if (req.method === "POST" && req.url === "/tx/buy-neb/build") {
      const body = await readJsonBody(req);
      const usdcAmount = Number(body.usdcAmount);
      if (!Number.isFinite(usdcAmount) || usdcAmount <= 0) {
        return sendJson(res, 400, { error: "invalid usdcAmount" });
      }
      const user = new PublicKey(body.user);
      const built = await buildBuyNebTx(connection, usdcAmount, user);
      return sendJson(res, 200, built);
    }

    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, { ok: true });
    }

    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    console.error("dlmm-bridge error:", err);
    sendJson(res, 500, { error: err instanceof Error ? err.message : "internal error" });
  }
});

server.listen(PORT, () => {
  console.log(`dlmm-bridge listening on :${PORT} (rpc: ${RPC_URL})`);
});
