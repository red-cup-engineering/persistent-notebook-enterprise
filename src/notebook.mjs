import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createSettlementStore, recordSettlementRecord } from "@red-cup-engineering/witness-journal-rdf-projection-service/client";

export const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ACTOR = "urn:ame:persistent-notebook-enterprise";
export const PROVIDER = "urn:ame:notebooklm-inference-team";
const VIDEO_CAPACITY_ALLOCATIONS = new Map([
  ["urn:ame:mathematics-youtube-channel-enterprise", { allocation: "mathematics-daily", format: "cinematic" }],
  ["urn:ame:youtube-channel-enterprise", { allocation: "relational-systems-daily", format: "explainer" }],
  ["urn:ame:climate-youtube-channel-enterprise", { allocation: "climate-place-daily", format: "explainer" }],
]);

export function canonical(value) {
  if (value instanceof Uint8Array) return `{\"$bytes\":${JSON.stringify(Buffer.from(value).toString("base64url"))}}`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function digest(value) {
  return `sha256:${createHash("sha256").update(value instanceof Uint8Array ? value : canonical(value)).digest("hex")}`;
}

export function contentId(value) { return identifyJsonSemanticContent({ objectKind: "emsweb.persistent-notebook.record", value: value, witnessRoot: EMPTY_WITNESS_ROOT }).token; }

export function notebookIdentity() {
  return JSON.parse(readFileSync(join(NODE_ROOT, "content/config/notebook.json"), "utf8"));
}

export function sourceLifecyclePolicy() {
  return JSON.parse(readFileSync(join(NODE_ROOT, "content/config/source-lifecycle.json"), "utf8"));
}

export function formInventoryObservationDemand({ maxRuntimeSeconds = 300 } = {}) {
  if (!Number.isInteger(maxRuntimeSeconds) || maxRuntimeSeconds < 60 || maxRuntimeSeconds > 3600) throw new TypeError("inventory observation runtime must be 60..3600 seconds");
  const providerRequest = { type: "NotebookLMInventoryObservationRequest", notebookId: notebookIdentity().notebookId, policy: "observe-only", executionMode: "observe-live", expectedCurrentSourceIds: null, desiredSources: [], maxRuntimeSeconds };
  const { type: _type, ...normalized } = providerRequest;
  const body = { type: "PersistentNotebookInventoryObservationDemand", notebook: notebookIdentity().id, provider: PROVIDER, providerRequest, providerRequestDigest: digest(normalized) };
  return { id: contentId(body), ...body };
}

function sourceManifest(sources) {
  if (!Array.isArray(sources) || sources.length === 0) throw new TypeError("sources must be a non-empty array");
  const manifest = sources.map((source, index) => {
    if (!source || typeof source !== "object") throw new TypeError(`sources[${index}] must be an object`);
    if (!/^sha256:[a-f0-9]{64}$/u.test(source.digest ?? "")) throw new TypeError(`sources[${index}].digest must be sha256`);
    if (typeof source.title !== "string" || source.title.trim() === "") throw new TypeError(`sources[${index}].title must be non-empty`);
    if (source.mediaType !== "text/markdown") throw new TypeError(`sources[${index}].mediaType must be text/markdown`);
    if (!Number.isSafeInteger(source.byteLength) || source.byteLength < 1 || source.byteLength > 10 * 1024 * 1024) throw new TypeError(`sources[${index}].byteLength must be 1..10485760`);
    if (Object.prototype.hasOwnProperty.call(source, "path")) throw new TypeError(`sources[${index}] must not convey foreign filesystem authority`);
    return { digest: source.digest, title: source.title, mediaType: source.mediaType, byteLength: source.byteLength };
  });
  const identities = manifest.map(({ digest: sourceDigest, title }) => canonical({ digest: sourceDigest, title }));
  if (new Set(identities).size !== identities.length) throw new TypeError("sources must have unique digest/title identities");
  return manifest;
}

export function formSourceReconciliationDemand({ sources, expectedCurrentSourceIds = [], executionMode = "reconcile-live", maxRuntimeSeconds = 1800 } = {}) {
  const identity = notebookIdentity();
  const lifecycle = sourceLifecyclePolicy();
  const desiredSources = sourceManifest(sources);
  if (!Array.isArray(expectedCurrentSourceIds) || new Set(expectedCurrentSourceIds).size !== expectedCurrentSourceIds.length) throw new TypeError("expectedCurrentSourceIds must be a unique array");
  const providerRequest = {
    type: "NotebookLMSourceReconciliationRequest",
    notebookId: identity.notebookId,
    policy: lifecycle.providerMutationPolicy,
    executionMode,
    expectedCurrentSourceIds,
    desiredSources,
    maxRuntimeSeconds,
  };
  const { type: _requestType, ...normalizedProviderRequest } = providerRequest;
  const body = { type: "PersistentNotebookSourceReconciliationDemand", notebook: identity.id, sourceLifecyclePolicy: lifecycle.id, provider: PROVIDER, providerRequest, providerRequestDigest: digest(normalizedProviderRequest), desiredSourceManifestDigest: digest(desiredSources.map(({ digest: sourceDigest, title }) => ({ digest: sourceDigest, title }))) };
  return { id: contentId(body), ...body };
}

function receiptCore(receipt) {
  const { id: _id, ...core } = receipt;
  return core;
}

function exactReceiptId(receipt) {
  return receipt?.id === contentId(receiptCore(receipt));
}

async function record(category, value, options = {}) {
  const at = options.at ?? new Date().toISOString();
  if (options.settlement) {
    if (!/^eip155:[0-9]+:0x[a-f0-9]{40}$/u.test(options.settlement)) throw new TypeError("test settlement must be a CAIP-10 EVM account");
    await recordSettlementRecord({ agentUrl: options.witnessJournalAgentUrl ?? process.env.WITNESS_JOURNAL_RDF_AGENT, settlement: options.settlement, actor: ACTOR, category, recordedAt: at, record: { ...value } });
    return;
  }
  const store = createSettlementStore({ settlementRoot: NODE_ROOT, agentUrl: options.witnessJournalAgentUrl ?? process.env.WITNESS_JOURNAL_RDF_AGENT });
  await store.record({ category, recordedAt: at, record: { ...value } });
}

export async function admitInventoryObservationResult(demand, activity, options = {}) {
  const result=activity?.object,receipt=result?.receipt,operation=options.providerOperation;
  if(activity?.type!=="Accept"||activity.actor!==PROVIDER||result?.type!=="NotebookLMInventoryObservationResult")throw new TypeError("inventory admission requires the provider's observation acceptance");
  if(!/^urn:sha256:[a-f0-9]{64}$/u.test(operation??"")||activity.inReplyTo!==operation||receipt?.operationId!==operation)throw new TypeError("inventory observation does not bind the deterministic provider operation");
  const{id:activityId,...activityBody}=activity;if(activityId!==contentId(activityBody))throw new TypeError("inventory provider acceptance identity is not content-valid");
  if(result.requestDigest!==demand?.providerRequestDigest||receipt?.requestDigest!==demand?.providerRequestDigest||receipt?.provider!==PROVIDER||receipt.notebookId!==notebookIdentity().notebookId)throw new TypeError("inventory result does not bind the exact notebook demand");
  if(receipt.mode!=="observe-live"||receipt.policy!=="observe-only"||receipt.outcome!=="observed")throw new TypeError("inventory receipt is not an observe-only successful observation");
  const{ id:receiptId,...receiptBody}=receipt;if(receiptId!==contentId(receiptBody))throw new TypeError("inventory receipt identity is not content-valid");
  if(!Array.isArray(receipt.previousSources)||!Array.isArray(receipt.finalSources)||!Array.isArray(receipt.previousSourceIds)||!Array.isArray(receipt.finalSourceIds)||new Set(receipt.finalSourceIds).size!==receipt.finalSourceIds.length)throw new TypeError("inventory receipt lacks unique source rows and IDs");
  if(canonical(receipt.previousSources)!==canonical(receipt.finalSources)||canonical([...receipt.previousSourceIds].sort())!==canonical([...receipt.finalSourceIds].sort())||canonical([...(receipt.preservedSourceIds??[])].sort())!==canonical([...receipt.finalSourceIds].sort()))throw new TypeError("inventory observation changed its source set");
  if((receipt.desiredSources??[]).length!==0||(receipt.addedSources??[]).length!==0||(receipt.reusedDesiredSources??[]).length!==0||(receipt.deletedSourceIds??[]).length!==0)throw new TypeError("inventory observation carries a mutation claim");
  if(receipt.finalSourceSetDigest!==digest([...receipt.finalSourceIds].sort())||canonical(receipt.finalSources.map(row=>row?.id).sort())!==canonical([...receipt.finalSourceIds].sort()))throw new TypeError("inventory source rows do not match the final source-set identity");
  if(receipt.finalSources.some(row=>typeof row?.id!=="string"||row.id.length===0||row.status!=="ready"))throw new TypeError("inventory admission requires every observed source to be ready");
  const body={type:"PersistentNotebookInventoryObservationAdmission",notebook:notebookIdentity().id,demand:demand.id,provider:PROVIDER,providerResult:activity.id,providerReceipt:receipt.id,providerOperation:operation,sources:receipt.finalSources,finalSourceIds:[...receipt.finalSourceIds],finalSourceSetDigest:receipt.finalSourceSetDigest,admittedAt:options.at??new Date().toISOString()};
  const admission={id:contentId(body),...body};await record("persistent-notebook.inventory-observation-admission",admission, options);return admission;
}

export async function admitSourceReconciliationResult(demand, activity, options = {}) {
  const identity = notebookIdentity();
  const result = activity?.object;
  const receipt = result?.receipt;
  if (activity?.type !== "Accept" || activity.actor !== PROVIDER || result?.type !== "NotebookLMSourceReconciliationResult") throw new TypeError("source admission requires the provider's ActivityStreams acceptance");
  if (result.requestDigest !== demand?.providerRequestDigest || receipt?.requestDigest !== demand?.providerRequestDigest) throw new TypeError("source result does not bind the exact provider request");
  if (receipt?.provider !== PROVIDER || receipt?.notebookId !== identity.notebookId || receipt?.outcome !== "reconciled") throw new TypeError("source receipt does not reconcile the owned notebook");
  if (receipt.policy !== sourceLifecyclePolicy().providerMutationPolicy || receipt.mode !== "reconcile-live") throw new TypeError("source receipt does not implement the adopted cumulative lifecycle");
  if (!exactReceiptId(receipt)) throw new TypeError("source receipt identity is not content-valid");
  if (!Array.isArray(receipt.finalSourceIds) || receipt.finalSourceIds.length === 0 || new Set(receipt.finalSourceIds).size !== receipt.finalSourceIds.length) throw new TypeError("source receipt has no unique final source set");
  if (receipt.finalSourceSetDigest !== digest([...receipt.finalSourceIds].sort())) throw new TypeError("source receipt final source-set digest is inconsistent");
  const expected = demand?.providerRequest?.desiredSources?.map(({ digest: sourceDigest, title }) => ({ digest: sourceDigest, title })) ?? null;
  if (canonical(receipt.desiredSources) !== canonical(expected)) throw new TypeError("source receipt desired sources do not match the demand");
  const incumbentIds = [...(demand?.providerRequest?.expectedCurrentSourceIds ?? [])].sort();
  if (canonical([...(receipt.previousSourceIds ?? [])].sort()) !== canonical(incumbentIds)) throw new TypeError("source receipt does not bind the accepted incumbent set");
  if (canonical([...(receipt.preservedSourceIds ?? [])].sort()) !== canonical(incumbentIds) || (receipt.deletedSourceIds ?? []).length !== 0) throw new TypeError("source receipt did not preserve every incumbent without deletion");
  const admittedDesired = [...(receipt.addedSources ?? []), ...(receipt.reusedDesiredSources ?? [])];
  if (canonical(admittedDesired.map(({ digest: sourceDigest, title }) => ({ digest: sourceDigest, title })).sort((a, b) => canonical(a).localeCompare(canonical(b)))) !== canonical([...expected].sort((a, b) => canonical(a).localeCompare(canonical(b))))) throw new TypeError("source receipt does not account for every cumulative desired identity");
  if (admittedDesired.some((source) => typeof source.sourceId !== "string" || source.sourceId.length === 0)) throw new TypeError("source receipt desired identity lacks a stable source ID");
  const addedIds = (receipt.addedSources ?? []).map((source) => source.sourceId);
  const reusedIds = (receipt.reusedDesiredSources ?? []).map((source) => source.sourceId);
  if (new Set([...addedIds, ...reusedIds]).size !== admittedDesired.length || addedIds.some((id) => incumbentIds.includes(id)) || reusedIds.some((id) => !incumbentIds.includes(id))) throw new TypeError("source receipt does not bind additions and reuses to distinct lawful source IDs");
  const requiredFinalIds = [...new Set([...incumbentIds, ...addedIds])].sort();
  if (canonical([...receipt.finalSourceIds].sort()) !== canonical(requiredFinalIds)) throw new TypeError("source receipt final set is not the incumbent-plus-additions union");
  const body = {
    type: "PersistentNotebookSourceStateAdmission",
    notebook: identity.id,
    demand: demand.id,
    provider: PROVIDER,
    providerResult: activity.id,
    providerReceipt: receipt.id,
    providerOperation: options.providerOperation ?? null,
    sourceLifecyclePolicy: sourceLifecyclePolicy().id,
    desiredSources: demand.providerRequest.desiredSources,
    finalSourceIds: [...receipt.finalSourceIds],
    finalSourceSetDigest: receipt.finalSourceSetDigest,
    admittedAt: options.at ?? new Date().toISOString(),
  };
  const admission = { id: contentId(body), ...body };
  await record("persistent-notebook.source-state-admission", admission, options);
  return admission;
}

function sourceAdmissionValid(admission) {
  if (admission?.type !== "PersistentNotebookSourceStateAdmission" || admission.notebook !== notebookIdentity().id || admission.provider !== PROVIDER) return false;
  const { id, ...body } = admission;
  return id === contentId(body);
}

export function formVideoDemand({ sourceAdmission, prompt, format, style, language = "en", customer } = {}) {
  if (!sourceAdmissionValid(sourceAdmission)) throw new TypeError("video demand requires a content-valid local source-state admission");
  if (typeof prompt !== "string" || prompt.trim() === "") throw new TypeError("video prompt must be non-empty");
  if (!['cinematic', 'explainer'].includes(format)) throw new TypeError("video format must be cinematic or explainer");
  if (typeof customer !== "string" || customer.trim() === "") throw new TypeError("video demand requires a customer enterprise actor");
  const videoCapacity = VIDEO_CAPACITY_ALLOCATIONS.get(customer);
  if (!videoCapacity || videoCapacity.format !== format) throw new TypeError("this notebook has no matching total Video Overview allocation for the customer and format");
  if (format === "cinematic" && customer !== "urn:ame:mathematics-youtube-channel-enterprise") throw new TypeError("the standing cinematic allocation belongs only to the mathematics channel enterprise");
  const videoStyle = format === "cinematic" ? null : (style ?? "auto");
  if (format === "cinematic" && language !== "en") throw new TypeError("cinematic language must be en");
  const providerRequest = {
    type: "NotebookLMRequest",
    sources: sourceAdmission.desiredSources,
    prompt,
    artifactType: "video",
    executionMode: "live",
    corpusMode: "reconciled-notebook",
    notebookSourceReceiptId: sourceAdmission.providerReceipt,
    videoFormat: format,
    videoStyle,
    videoLanguage: language,
    videoCapacityCustomer: customer,
    videoCapacityAllocation: videoCapacity.allocation,
    capacityCustomer: format === "cinematic" ? customer : null,
    cinematicAllocation: format === "cinematic" ? "mathematics-standing" : null,
  };
  const normalizedProviderRequest = {
    sources: providerRequest.sources.map(({ digest: sourceDigest, title }) => ({ digest: sourceDigest, title })),
    prompt,
    artifactType: "video",
    executionMode: "live",
    corpusMode: "reconciled-notebook",
    notebookSourceReceiptId: sourceAdmission.providerReceipt,
    sourcePacket: null,
    sourcePacketDigest: null,
    videoFormat: format,
    videoStyle,
    videoLanguage: language,
    videoCapacityCustomer: customer,
    videoCapacityAllocation: videoCapacity.allocation,
    capacityCustomer: format === "cinematic" ? customer : null,
    cinematicAllocation: format === "cinematic" ? "mathematics-standing" : null,
  };
  const body = { type: "PersistentNotebookVideoDemand", notebook: notebookIdentity().id, sourceAdmission: sourceAdmission.id, customer, provider: PROVIDER, providerRequest, providerRequestDigest: digest(normalizedProviderRequest) };
  return { id: contentId(body), ...body };
}

function inside(root, path) {
  const relation = relative(root, path);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}
function secureArtifactUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)); }
  catch { return false; }
}

export async function admitVideoResult(demand, sourceAdmission, activity, options = {}) {
  if (!sourceAdmissionValid(sourceAdmission) || demand?.sourceAdmission !== sourceAdmission.id) throw new TypeError("video result is not bound to the admitted source state");
  const result = activity?.object;
  if (activity?.type !== "Accept" || activity.actor !== PROVIDER || result?.type !== "NotebookLMServiceResult" || result.disposition !== "artifact") throw new TypeError("video admission requires the provider's artifact acceptance");
  if (result.requestDigest !== demand.providerRequestDigest || result.notebookSourceReceiptId !== sourceAdmission.providerReceipt) throw new TypeError("provider result does not bind the video demand and source receipt");
  const videoCapacityReceipt = result.videoOverviewCapacityReceipt;
  if (videoCapacityReceipt?.type !== "NotebookLMVideoOverviewCapacityReceipt" || videoCapacityReceipt.provider !== PROVIDER || videoCapacityReceipt.law !== notebookIdentity().providerVideoOverviewCapacityContract || videoCapacityReceipt.disposition !== "spent") throw new TypeError("video result lacks the provider's spent total Video Overview capacity receipt");
  const { id: videoCapacityId, ...videoCapacityBody } = videoCapacityReceipt;
  if (videoCapacityId !== contentId(videoCapacityBody)) throw new TypeError("Video Overview capacity receipt identity is not content-valid");
  if (videoCapacityReceipt.requestDigest !== demand.providerRequestDigest || videoCapacityReceipt.customer !== demand.providerRequest.videoCapacityCustomer || videoCapacityReceipt.allocation !== demand.providerRequest.videoCapacityAllocation || videoCapacityReceipt.format !== demand.providerRequest.videoFormat || videoCapacityReceipt.invocation !== activity.inReplyTo) throw new TypeError("Video Overview capacity receipt does not bind the video demand and invocation");
  const capacityReceipt = result.cinematicCapacityReceipt;
  if (demand.providerRequest.videoFormat === "cinematic") {
    if (capacityReceipt?.type !== "NotebookLMCinematicCapacityReceipt" || capacityReceipt.provider !== PROVIDER || capacityReceipt.law !== notebookIdentity().providerCinematicCapacityContract || capacityReceipt.disposition !== "spent") throw new TypeError("cinematic result lacks the provider's spent capacity receipt");
    const { id: capacityId, ...capacityBody } = capacityReceipt;
    if (capacityId !== contentId(capacityBody)) throw new TypeError("cinematic capacity receipt identity is not content-valid");
    if (capacityReceipt.requestDigest !== demand.providerRequestDigest || capacityReceipt.customer !== demand.providerRequest.capacityCustomer || capacityReceipt.allocation !== demand.providerRequest.cinematicAllocation || capacityReceipt.invocation !== activity.inReplyTo) throw new TypeError("cinematic capacity receipt does not bind the video demand and invocation");
  } else if (capacityReceipt !== null) {
    throw new TypeError("explainer result must not carry or consume cinematic capacity");
  }
  const carrier = result.artifact;
  if (carrier?.type !== "video") throw new TypeError("provider result lacks a video carrier");
  const payload = carrier.payload;
  if (payload?.format !== "mp4" || payload.mediaType !== "video/mp4" || !Number.isInteger(payload.byteLength) || payload.byteLength < 12 || !/^sha256:[a-f0-9]{64}$/u.test(payload.sha256 ?? "") || typeof payload.providerArtifactId !== "string" || payload.providerArtifactId.trim() === "") throw new TypeError("provider result lacks validated video payload terms");
  if (payload.videoFormat !== demand.providerRequest.videoFormat || payload.videoStyle !== demand.providerRequest.videoStyle || payload.language !== demand.providerRequest.videoLanguage) throw new TypeError("provider video payload does not preserve the demanded format terms");
  let providerPath, deliveryKind;
  if (typeof carrier.url === "string") {
    if (!secureArtifactUrl(carrier.url) || carrier.authorization?.scheme !== "Bearer" || typeof carrier.authorization.token !== "string" || carrier.authorization.token.length < 32) throw new TypeError("provider result lacks a secure attenuated video delivery capability");
    if (!/^urn:sha256:[a-f0-9]{64}$/u.test(options.providerOperation ?? "") || activity.inReplyTo !== options.providerOperation) throw new TypeError("remote provider result does not bind the deterministic video operation");
    const { id: activityId, ...activityBody } = activity; if (activityId !== contentId(activityBody)) throw new TypeError("remote provider acceptance identity is not content-valid");
    if (typeof options.materializedProviderArtifact !== "string" || !isAbsolute(options.materializedProviderArtifact)) throw new TypeError("remote provider result lacks a customer-materialized carrier");
    const ingressRoot = realpathSync(options.materializedArtifactRoot ?? join(options.dataRoot ?? join(NODE_ROOT, "data"), "provider-ingress"));
    if (!existsSync(options.materializedProviderArtifact) || lstatSync(options.materializedProviderArtifact).isSymbolicLink() || !lstatSync(options.materializedProviderArtifact).isFile()) throw new TypeError("materialized provider carrier must be a regular non-symlink file");
    providerPath = realpathSync(options.materializedProviderArtifact);
    if (!inside(ingressRoot, providerPath)) throw new TypeError("materialized provider carrier escapes the notebook ingress boundary");
    deliveryKind = "remote-bearer-capability";
  } else {
    if (typeof carrier.path !== "string" || !isAbsolute(carrier.path)) throw new TypeError("provider result lacks an absolute legacy video carrier");
    const configuredRoot = resolve(NODE_ROOT, notebookIdentity().providerExportRoot), exportRoot = realpathSync(options.providerExportRoot ?? configuredRoot);
    if (!existsSync(carrier.path)) throw new TypeError("provider video carrier is absent");
    const stats = lstatSync(carrier.path); if (!stats.isFile() || stats.isSymbolicLink()) throw new TypeError("provider video carrier must be a regular non-symlink file");
    providerPath = realpathSync(carrier.path); if (!inside(exportRoot, providerPath)) throw new TypeError("provider video carrier escapes the declared export boundary");
    deliveryKind = "legacy-provider-export";
  }
  const bytes = readFileSync(providerPath);
  if (bytes.length < 12 || bytes.subarray(4, 8).toString("ascii") !== "ftyp") throw new TypeError("provider video carrier is not an ISO-BMFF MP4");
  const sha256 = digest(bytes);
  if (payload.byteLength !== bytes.length || payload.sha256 !== sha256) throw new TypeError("provider video payload does not describe the exported carrier");
  const artifactRoot = resolve(options.artifactRoot ?? join(options.dataRoot ?? join(NODE_ROOT, "data"), "artifacts"));
  mkdirSync(artifactRoot, { recursive: true });
  const importedPath = join(artifactRoot, `${sha256.slice("sha256:".length)}.mp4`);
  if (!existsSync(importedPath)) writeFileSync(importedPath, bytes, { flag: "wx", mode: 0o600 });
  const imported = readFileSync(importedPath);
  if (digest(imported) !== sha256 || imported.length !== bytes.length) throw new TypeError("imported video carrier does not match the provider bytes");
  const body = {
    type: "PersistentNotebookVideoArtifactAdmission",
    notebook: notebookIdentity().id,
    demand: demand.id,
    sourceAdmission: sourceAdmission.id,
    provider: PROVIDER,
    providerResult: activity.id,
    providerOperation: options.providerOperation ?? null,
    providerDemand: demand,
    providerRequestDigest: demand.providerRequestDigest,
    providerArtifactId: payload.providerArtifactId,
    deliveryKind,
    videoOverviewCapacityReceipt: videoCapacityReceipt.id,
    videoOverviewCapacity: videoCapacityReceipt,
    cinematicCapacityReceipt: capacityReceipt?.id ?? null,
    cinematicCapacity: capacityReceipt,
    videoFormat: demand.providerRequest.videoFormat,
    videoStyle: demand.providerRequest.videoStyle,
    language: demand.providerRequest.videoLanguage,
    mediaType: "video/mp4",
    byteLength: imported.length,
    sha256,
    importedCarrier: relative(NODE_ROOT, importedPath),
    admittedAt: options.at ?? new Date().toISOString(),
  };
  const admission = { id: contentId(body), ...body };
  await record("persistent-notebook.video-artifact-admission", admission, options);
  return admission;
}
