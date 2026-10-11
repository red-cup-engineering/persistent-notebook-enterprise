import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { querySettlementRecords, recordSettlementRecord } from "@red-cup-engineering/witness-journal-document-service";
import { ACTOR, NODE_ROOT, contentId, digest, sourceLifecyclePolicy } from "./notebook.mjs";

const CATEGORY = "persistent-notebook.explainer-order-state";
const NODE_ID = "persistent-notebook-enterprise";
function exact(value) { if (!value || typeof value !== "object") return false; const { id, ...body } = value; return id === contentId(body); }
async function states(orderId, options) { return (await querySettlementRecords(CATEGORY, { agentUrl: options.witnessJournalAgentUrl ?? process.env.WITNESS_JOURNAL_RDF_AGENT })).filter((row) => row.order === orderId).sort((a, b) => Number(a.sequence) - Number(b.sequence)); }
async function append(order, status, fields, options) {
  const prior = (await states(order.id, options)).at(-1); const at = options.at ?? new Date().toISOString();
  const body = { type: "PersistentNotebookExplainerOrderState", order: order.id, status, sequence: Number(prior?.sequence ?? 0) + 1, ...fields, recordedAt: at };
  const row = { id: contentId(body), ...body };
  await recordSettlementRecord({ agentUrl: options.witnessJournalAgentUrl ?? process.env.WITNESS_JOURNAL_RDF_AGENT, settlement: options.settlement, actor: ACTOR, category: CATEGORY, recordedAt: at, record: { ...row } });
  return row;
}
function completion(value, phase) {
  if (value?.status === "in-progress" && typeof value.operation === "string") return value;
  if (value?.status !== "completed") throw new TypeError(`${phase} provider returned neither in-progress nor completed`);
  return value;
}

export async function advanceExplainerOrder(order, services, options = {}) {
  if (!options.settlement || !/^eip155:[0-9]+:0x[a-f0-9]{40}$/u.test(options.settlement)) throw new TypeError("explainer backend requires its sovereign settlement account");
  if (typeof services?.reconcileSource !== "function" || typeof services?.generateVideo !== "function") throw new TypeError("explainer backend requires contracted source and video services");
  const dataRoot = resolve(options.dataRoot ?? join(NODE_ROOT, "data")), runtimeRoot = resolve(options.runtimeRoot ?? join(NODE_ROOT, "content/runtime/explainer-locks")); mkdirSync(runtimeRoot, { recursive: true });
  const lock = join(runtimeRoot, order.id.slice(-64)); try { mkdirSync(lock); } catch (error) { if (error?.code === "EEXIST") return { disposition: "in-progress", order: order.id, phase: "concurrent-invocation", retryAfterSeconds: 5 }; throw error; }
  try {
    let current = (await states(order.id, options)).at(-1);
    if (current?.status === "delivered") return current.result;
    if (!current) current = await append(order, "accepted", { sourceDigest: order.source.digest, sourceOperation: contentId({ order: order.id, phase: "source-reconciliation" }) }, options);
    if (["accepted", "source-in-progress"].includes(current.status)) {
      const source = completion(await services.reconcileSource(order, current.sourceOperation), "source");
      if (source.operation !== undefined && source.operation !== current.sourceOperation) throw new TypeError("source provider changed the deterministic operation identity");
      if (source.status === "in-progress") { await append(order, "source-in-progress", { sourceOperation: current.sourceOperation }, options); return { disposition: "in-progress", order: order.id, phase: "source", operation: current.sourceOperation, retryAfterSeconds: source.retryAfterSeconds ?? 30 }; }
      if (!exact(source.sourceAdmission) || source.sourceAdmission.type !== "PersistentNotebookSourceStateAdmission" || source.sourceAdmission.sourceLifecyclePolicy !== sourceLifecyclePolicy().id) throw new TypeError("source provider completion lacks the exact cumulative admission");
      current = await append(order, "source-admitted", { sourceAdmission: source.sourceAdmission, sourceOperation: current.sourceOperation, videoOperation: contentId({ order: order.id, phase: "video-generation" }) }, options);
    }
    if (["source-admitted", "video-in-progress"].includes(current.status)) {
      const video = completion(await services.generateVideo(order, current.sourceAdmission, current.videoOperation), "video");
      if (video.operation !== undefined && video.operation !== current.videoOperation) throw new TypeError("video provider changed the deterministic operation identity");
      if (video.status === "in-progress") { await append(order, "video-in-progress", { sourceAdmission: current.sourceAdmission, sourceOperation: current.sourceOperation, videoOperation: current.videoOperation }, options); return { disposition: "in-progress", order: order.id, phase: "video", operation: current.videoOperation, retryAfterSeconds: video.retryAfterSeconds ?? 60 }; }
      if (!exact(video.videoAdmission) || video.videoAdmission.type !== "PersistentNotebookVideoArtifactAdmission" || video.videoAdmission.videoFormat !== "explainer" || video.videoAdmission.cinematicCapacityReceipt !== null) throw new TypeError("video provider completion lacks the exact non-cinematic admission");
      const artifactPath = resolve(video.artifactPath ?? ""); if (!existsSync(artifactPath) || !lstatSync(artifactPath).isFile() || lstatSync(artifactPath).isSymbolicLink()) throw new TypeError("video completion lacks a regular local artifact carrier");
      current = await append(order, "video-admitted", { sourceAdmission: current.sourceAdmission, sourceOperation: current.sourceOperation, videoAdmission: video.videoAdmission, videoOperation: current.videoOperation, artifactPath }, options);
    }
    const bytes = readFileSync(current.artifactPath); if (bytes.length < 12 || bytes.subarray(4, 8).toString("ascii") !== "ftyp" || digest(bytes) !== current.videoAdmission.sha256) throw new TypeError("admitted video carrier bytes are invalid or changed");
    const sha = digest(bytes), exchangeRoot = resolve(options.exchangeRoot ?? join(dataRoot, "artifact-exchange")); mkdirSync(exchangeRoot, { recursive: true }); const carrier = join(exchangeRoot, `${sha.slice(7)}.mp4`);
    if (existsSync(carrier)) { if (digest(readFileSync(carrier)) !== sha) throw new TypeError("existing artifact exchange carrier conflicts with admitted digest"); } else writeFileSync(carrier, bytes, { flag: "wx", mode: 0o600 });
    const token = (options.tokenBytes ?? randomBytes(32)).toString("base64url"), baseUrl = String(options.artifactBaseUrl ?? "").replace(/\/$/u, ""); if (!/^https?:\/\//u.test(baseUrl)) throw new TypeError("artifactBaseUrl must be absolute HTTP(S)");
    const deliveryBody = { type: "PersistentNotebookExplainerDelivery", provider: ACTOR, customer: order.customer, order: order.id, disposition: "artifact", sourceLifecyclePolicy: "curated-cumulative-corpus", sourceAdmission: current.sourceAdmission.id, videoAdmission: current.videoAdmission.id, artifact: { url: `${baseUrl}/artifacts/${basename(carrier)}`, authorization: { scheme: "Bearer", token }, mediaType: "video/mp4", byteLength: bytes.length, sha256: sha } };
    const delivery = { id: contentId(deliveryBody), ...deliveryBody }; const result = { type: "PersistentNotebookExplainerServiceResult", provider: ACTOR, order: order.id, disposition: "artifact", delivery };
    await append(order, "delivered", { sourceAdmission: current.sourceAdmission, videoAdmission: current.videoAdmission, exchangeCarrier: carrier, result }, options); return result;
  } finally { rmSync(lock, { recursive: true, force: true }); }
}

export function explainerOrderStates(orderId, options = {}) { return states(orderId, options); }
