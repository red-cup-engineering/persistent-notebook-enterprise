#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { agentSenMessage, extractSenPart, parseA2aMessage } from "@red-cup-engineering/a2a-services-section/sen-part";
import { admitJsonSemanticContent, EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-content-address-engineering-services-section/semantic-content-identity";
const A2A_CARRIER_KIND = "rsc-quiescent.a2a-json";
const semanticBytes = (value) => identifyJsonSemanticContent({ objectKind: A2A_CARRIER_KIND, value, witnessRoot: EMPTY_WITNESS_ROOT }).bytes;
const decodeSemantic = (bytes) => admitJsonSemanticContent({ bytes, objectKind: A2A_CARRIER_KIND }).value;
import { ACTOR, contentId, digest, notebookIdentity } from "./notebook.mjs";
import { advanceExplainerOrder } from "./explainer-backend.mjs";

const CUSTOMER = "urn:ame:youtube-channel-enterprise";
function exact(value) { if (!value || typeof value !== "object") return false; const { id, ...body } = value; return id === contentId(body); }
function parts(message) { return Array.isArray(message?.parts) ? message.parts : []; }
function validOrder(order) {
  const bytes = order?.source?.bytes;
  const sourceBytes = Buffer.isBuffer(bytes) || bytes instanceof Uint8Array ? Buffer.from(bytes) : null;
  return exact(order) && order.type === "PersistentNotebookExplainerOrder" && order.customer === CUSTOMER && order.provider === ACTOR && order.notebook === notebookIdentity().id &&
    order.sourceLifecyclePolicy === "curated-cumulative-corpus" && order.format === "explainer" && order.language === "en" && typeof order.style === "string" && typeof order.prompt === "string" && order.prompt.trim() !== "" &&
    sourceBytes !== null && sourceBytes.length > 0 && sourceBytes.length <= 10 * 1024 * 1024 && order.source.byteLength === sourceBytes.length && order.source.mediaType === "text/markdown" &&
    digest(sourceBytes) === order.source.digest && typeof order.source.title === "string" && order.source.title.trim() !== "" && !Object.prototype.hasOwnProperty.call(order.source, "path");
}
function refusal(order, code, at) {
  const body = { type: "PersistentNotebookExplainerServiceRefusal", provider: ACTOR, order: order?.id ?? null, disposition: "refused", code, retryable: ["provider-not-activated", "backend-not-contracted"].includes(code), externalEffects: [], refusedAt: at };
  return { id: contentId(body), ...body };
}
async function handle(order) {
  const at = process.env.PERSISTENT_NOTEBOOK_NOW ?? new Date().toISOString();
  if (!validOrder(order)) return refusal(order, "invalid-explainer-order", at);
  const activation = JSON.parse(readFileSync(process.env.PERSISTENT_NOTEBOOK_ACTIVATION ?? new URL("../content/config/activation.json", import.meta.url), "utf8"));
  if (activation.status !== "active") return refusal(order, "provider-not-activated", at);
  const clientPath = process.env.PERSISTENT_NOTEBOOK_PROVIDER_CLIENT_MODULE;
  if (!clientPath) return refusal(order, "backend-not-contracted", at);
  const client = await import(pathToFileURL(clientPath).href), services = client.default?.() ?? client.services ?? client;
  return advanceExplainerOrder(order, services, { at, dataRoot: process.env.PERSISTENT_NOTEBOOK_DATA_ROOT, runtimeRoot: process.env.PERSISTENT_NOTEBOOK_RUNTIME_ROOT, exchangeRoot: process.env.PERSISTENT_NOTEBOOK_EXCHANGE_ROOT, artifactBaseUrl: process.env.PERSISTENT_NOTEBOOK_ARTIFACT_BASE_URL, settlement: process.env.PERSISTENT_NOTEBOOK_SETTLEMENT_ACCOUNT, witnessJournalAgentUrl: process.env.WITNESS_JOURNAL_RDF_AGENT });
}

let input = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", async () => {
  try {
    const message = parseA2aMessage(JSON.parse(input)), request = decodeSemantic(extractSenPart(parts(message)).bytes);
    if (request?.[0] !== "persistent-notebook-explainer-order" || request.length !== 2) throw new TypeError("foreign SEN operation");
    const result = await handle(request[1]);
    process.stdout.write(`${JSON.stringify(agentSenMessage(semanticBytes(["persistent-notebook-explainer-result", result]), "persistent-notebook-explainer-result.sen.cbor"))}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
});
