#!/usr/bin/env node
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { querySettlementRecords } from "@red-cup-engineering/witness-journal-rdf-projection-service/client";
import { NODE_ROOT, digest } from "./notebook.mjs";
const CATEGORY = "persistent-notebook.explainer-order-state";
function equal(left, right) { const a = createHash("sha256").update(String(left)).digest(), b = createHash("sha256").update(String(right)).digest(); return timingSafeEqual(a, b); }
export async function serveArtifactExchange(options = {}) {
  const dataRoot = resolve(options.dataRoot ?? join(NODE_ROOT, "data")), exchangeRoot = resolve(options.exchangeRoot ?? join(dataRoot, "artifact-exchange")), host = options.host ?? "127.0.0.1", port = options.port ?? 0;
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET") { response.writeHead(405).end(); return; }
      const match = new URL(request.url, `http://${request.headers.host}`).pathname.match(/^\/artifacts\/([a-f0-9]{64})\.mp4$/u); if (!match) { response.writeHead(404).end(); return; }
      const candidates = (await querySettlementRecords(CATEGORY)).filter((entry) => entry.status === "delivered" && entry.result?.delivery?.artifact?.sha256 === `sha256:${match[1]}`); if (candidates.length === 0) { response.writeHead(404).end(); return; }
      const supplied = String(request.headers.authorization ?? ""), row = candidates.find((entry) => entry.result.delivery.artifact.authorization?.scheme === "Bearer" && equal(supplied, `Bearer ${entry.result.delivery.artifact.authorization.token}`)); if (!row) { response.writeHead(401, { "www-authenticate": "Bearer" }).end(); return; }
      const bytes = readFileSync(join(exchangeRoot, `${match[1]}.mp4`)); if (digest(bytes) !== row.result.delivery.artifact.sha256 || bytes.length !== row.result.delivery.artifact.byteLength) { response.writeHead(409).end(); return; }
      response.writeHead(200, { "content-type": "video/mp4", "content-length": bytes.length, "cache-control": "private, no-store" }); response.end(bytes);
    } catch { response.writeHead(500).end(); }
  });
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(port, host, accept); }); return server;
}
if (process.argv[1] === new URL(import.meta.url).pathname) serveArtifactExchange({ port: Number(process.env.PERSISTENT_NOTEBOOK_ARTIFACT_PORT ?? 8081), host: process.env.PERSISTENT_NOTEBOOK_ARTIFACT_HOST ?? "127.0.0.1" }).then((server) => { process.stdout.write(`${JSON.stringify(server.address())}\n`); });
