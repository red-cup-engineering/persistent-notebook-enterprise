import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { querySettlementRecords } from "@red-cup-engineering/witness-journal-rdf-projection-service/client";
import { startWitnessJournalProviderProcess } from "@red-cup-engineering/witness-journal-rdf-projection-service/test-provider";
import { extractRmnPart, parseA2aMessage, userRmnMessage } from "@red-cup-engineering/a2a-rmn-part-service";
import { admitJsonSemanticContent, EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";

const A2A_JSON_OBJECT_KIND = "rsc-quiescent.a2a-json";
const semanticBytes = (value) => identifyJsonSemanticContent({ objectKind: A2A_JSON_OBJECT_KIND, value, witnessRoot: EMPTY_WITNESS_ROOT }).bytes;
const decodeSemantic = (bytes) => admitJsonSemanticContent({ bytes, objectKind: A2A_JSON_OBJECT_KIND }).value;
import { PROVIDER, contentId, digest, formInventoryObservationDemand, formSourceReconciliationDemand, formVideoDemand, admitInventoryObservationResult, admitSourceReconciliationResult, admitVideoResult, notebookIdentity } from "../src/notebook.mjs";

const NOW = "2096-07-21T12:00:00.000Z";
const TEST_SETTLEMENT = "eip155:31337:0x1111111111111111111111111111111111111111";
function source(sourceDigest, title = "Research") { return { digest: sourceDigest, title, mediaType: "text/markdown", byteLength: 8 }; }

test("the A2A executor returns a typed zero-effect refusal while live notebook activation is closed", () => {
  const fixture = mkdtempSync(join(tmpdir(), "persistent-notebook-refused-")), activationPath = join(fixture, "activation.json");
  writeFileSync(activationPath, `${JSON.stringify({ status: "refused" })}\n`);
  const sourceBytes = Buffer.from("research");
  const orderBody = { type: "PersistentNotebookExplainerOrder", customer: "urn:ame:youtube-channel-enterprise", provider: "urn:ame:persistent-notebook-enterprise", notebook: notebookIdentity().id, sourceLifecyclePolicy: "curated-cumulative-corpus", source: { bytes: sourceBytes, digest: digest(sourceBytes), title: "Research", mediaType: "text/markdown", byteLength: sourceBytes.length }, prompt: "Explain this relationally.", format: "explainer", style: "auto", language: "en" };
  const order = { id: contentId(orderBody), ...orderBody };
  const message = userRmnMessage(semanticBytes(["persistent-notebook-explainer-order", order]), "order.rmn.cbor", "00000000-0000-4000-8000-000000000001");
  const execution = spawnSync(process.execPath, [new URL("../src/explainer-a2a-executor.mjs", import.meta.url).pathname], { input: JSON.stringify(message), encoding: "utf8", env: { ...process.env, PERSISTENT_NOTEBOOK_NOW: NOW, PERSISTENT_NOTEBOOK_ACTIVATION: activationPath } });
  rmSync(fixture, { recursive: true, force: true });
  assert.equal(execution.status, 0, execution.stderr);
  const response = parseA2aMessage(JSON.parse(execution.stdout)), result = decodeSemantic(extractRmnPart(response.parts).bytes);
  assert.equal(result[0], "persistent-notebook-explainer-result");
  assert.equal(result[1].code, "provider-not-activated"); assert.equal(result[1].retryable, true); assert.deepEqual(result[1].externalEffects, []);
});

function providerSourceResult(demand) {
  const incumbentIds = [...demand.providerRequest.expectedCurrentSourceIds].sort();
  const desiredSources = demand.providerRequest.desiredSources.map(({ digest: sourceDigest, title }) => ({ digest: sourceDigest, title }));
  const addedSources = desiredSources.map((source, index) => ({ ...source, sourceId: `source-added-${String(index + 1).padStart(6, "0")}` }));
  const sourceIds = [...incumbentIds, ...addedSources.map((source) => source.sourceId)].sort();
  const core = {
    type: "NotebookLMSourceReconciliationReceipt", provider: PROVIDER,
    notebookId: notebookIdentity().notebookId, mode: "reconcile-live", policy: "curated-cumulative-add", outcome: "reconciled",
    previousSourceIds: incumbentIds, preservedSourceIds: incumbentIds, desiredSources,
    addedSources, reusedDesiredSources: [], deletedSourceIds: [],
    finalSourceIds: sourceIds, finalSourceSetDigest: digest(sourceIds), requestDigest: demand.providerRequestDigest, settledAt: NOW,
  };
  const receipt = { id: contentId(core), ...core };
  return { type: "Accept", id: "urn:provider:source-result", actor: PROVIDER, object: { type: "NotebookLMSourceReconciliationResult", requestDigest: demand.providerRequestDigest, receipt } };
}

function providerVideoArtifact(path, demand, overrides = {}) {
  const bytes = readFileSync(path);
  return {
    type: "video",
    path,
    payload: {
      format: "mp4",
      mediaType: "video/mp4",
      byteLength: bytes.length,
      sha256: digest(bytes),
      videoFormat: demand.providerRequest.videoFormat,
      videoStyle: demand.providerRequest.videoStyle,
      language: demand.providerRequest.videoLanguage,
      providerArtifactId: "video-provider-000001",
      ...overrides,
    },
  };
}

function providerCapacityReceipt(demand, invocation = "urn:provider:cinematic-invocation") {
  const body = {
    type: "NotebookLMCinematicCapacityReceipt",
    law: notebookIdentity().providerCinematicCapacityContract,
    provider: PROVIDER,
    civilDay: "2096-07-21",
    timezone: "America/Chicago",
    slot: "cinematic-1",
    allocation: demand.providerRequest.cinematicAllocation,
    customer: demand.providerRequest.capacityCustomer,
    invocation,
    requestDigest: demand.providerRequestDigest,
    claimedAt: NOW,
    disposition: "spent",
  };
  return { id: contentId(body), ...body };
}

function providerVideoCapacityReceipt(demand, invocation = "urn:provider:video-invocation") {
  const body = {
    type: "NotebookLMVideoOverviewCapacityReceipt",
    law: notebookIdentity().providerVideoOverviewCapacityContract,
    provider: PROVIDER,
    civilDay: "2096-07-21",
    weekday: "Saturday",
    timezone: "America/Chicago",
    allocation: demand.providerRequest.videoCapacityAllocation,
    customer: demand.providerRequest.videoCapacityCustomer,
    format: demand.providerRequest.videoFormat,
    invocation,
    requestDigest: demand.providerRequestDigest,
    claimedAt: NOW,
    disposition: "spent",
  };
  return { id: contentId(body), ...body };
}

test("the enterprise owns one exact notebook identity and forms only exact reconciliation demands", () => {
  assert.equal(notebookIdentity().notebookId, "67510ce7-79b3-4caa-b25c-28e0d3911b5a");
  const demand = formSourceReconciliationDemand({ sources: [source(`sha256:${"a".repeat(64)}`)], expectedCurrentSourceIds: ["source-old-000001"] });
  assert.equal(demand.providerRequest.notebookId, notebookIdentity().notebookId);
  assert.equal(demand.provider, PROVIDER);
  assert.equal(demand.providerRequest.policy, "curated-cumulative-add");
  assert.equal(demand.sourceLifecyclePolicy, "urn:emsenn:persistent-notebook-source-lifecycle:curated-cumulative-corpus:v1");
});

function providerInventoryActivity(demand, operation, overrides = {}) {
  const sources = [{ id: "source-incumbent-000001", title: "Existing study", status: "ready", type: "file", url: null }];
  const receiptBody = { type: "NotebookLMSourceReconciliationReceipt", provider: PROVIDER, notebookId: notebookIdentity().notebookId,
    requestDigest: demand.providerRequestDigest, operationId: operation, mode: "observe-live", policy: "observe-only", outcome: "observed",
    previousSources: sources, previousSourceIds: sources.map((row) => row.id), desiredSources: [], preservedSourceIds: sources.map((row) => row.id),
    addedSources: [], reusedDesiredSources: [], deletedSourceIds: [], finalSources: sources, finalSourceIds: sources.map((row) => row.id),
    finalSourceSetDigest: digest(sources.map((row) => row.id)), grounds: null, failureStage: null,
    cost: { denomination: "notebooklm-cli-call-and-wall-seconds", calls: 1, wallSeconds: 0.1 }, settledAt: NOW, ...overrides };
  const receipt = { id: contentId(receiptBody), ...receiptBody }, object = { type: "NotebookLMInventoryObservationResult", requestDigest: demand.providerRequestDigest, receipt };
  const activityBody = { type: "Accept", actor: PROVIDER, inReplyTo: operation, object }; return { id: contentId(activityBody), ...activityBody };
}

test("an observe-only provider receipt becomes a distinct notebook inventory admission", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "persistent-notebook-inventory-")), witnessJournal = await startWitnessJournalProviderProcess();
  t.after(async () => { await witnessJournal.close(); rmSync(root, { recursive: true, force: true }); });
  const demand = formInventoryObservationDemand(), operation = `urn:sha256:${"7".repeat(64)}`;
  const admission = await admitInventoryObservationResult(demand, providerInventoryActivity(demand, operation), { providerOperation: operation, at: NOW, dataRoot: root, witnessJournalAgentUrl: witnessJournal.agentCardUrl, settlement: TEST_SETTLEMENT });
  assert.equal(admission.type, "PersistentNotebookInventoryObservationAdmission"); assert.deepEqual(admission.finalSourceIds, ["source-incumbent-000001"]);
  const records = await querySettlementRecords("persistent-notebook.inventory-observation-admission"); assert.equal(records.length, 1);});

test("inventory admission refuses a receipt that claims mutation", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "persistent-notebook-inventory-mutation-")), witnessJournal = await startWitnessJournalProviderProcess();
  t.after(async () => { await witnessJournal.close(); rmSync(root, { recursive: true, force: true }); });
  const demand = formInventoryObservationDemand(), operation = `urn:sha256:${"8".repeat(64)}`;
  await assert.rejects(() => admitInventoryObservationResult(demand, providerInventoryActivity(demand, operation, { deletedSourceIds: ["source-incumbent-000001"] }), { providerOperation: operation, at: NOW, dataRoot: root, witnessJournalAgentUrl: witnessJournal.agentCardUrl, settlement: TEST_SETTLEMENT }), /mutation claim/u);
});

test("a provider reconciliation receipt becomes a notebook-owned source-state admission", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "persistent-notebook-source-")); const witnessJournal = await startWitnessJournalProviderProcess();
  t.after(async () => { await witnessJournal.close(); rmSync(root, { recursive: true, force: true }); });
  const demand = formSourceReconciliationDemand({ sources: [source(`sha256:${"b".repeat(64)}`)] });
  const admission = await admitSourceReconciliationResult(demand, providerSourceResult(demand), { at: NOW, dataRoot: root, witnessJournalAgentUrl: witnessJournal.agentCardUrl, settlement: TEST_SETTLEMENT });
  assert.equal(admission.notebook, notebookIdentity().id);
  assert.equal(admission.providerReceipt.startsWith("urn:sha256:"), true);
  const records = await querySettlementRecords("persistent-notebook.source-state-admission");
  assert.equal(records.length, 1);});

test("source-state admission refuses a cumulative receipt that deletes an incumbent", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "persistent-notebook-source-delete-")); const witnessJournal = await startWitnessJournalProviderProcess();
  t.after(async () => { await witnessJournal.close(); rmSync(root, { recursive: true, force: true }); });
  const demand = formSourceReconciliationDemand({ sources: [source(`sha256:${"9".repeat(64)}`)], expectedCurrentSourceIds: ["source-old-000001"] });
  const activity = providerSourceResult(demand); const receipt = activity.object.receipt;
  const invalidCore = { ...receipt, id: undefined, preservedSourceIds: [], deletedSourceIds: ["source-old-000001"], finalSourceIds: receipt.addedSources.map((source) => source.sourceId) };
  delete invalidCore.id; invalidCore.finalSourceSetDigest = digest(invalidCore.finalSourceIds);
  activity.object.receipt = { id: contentId(invalidCore), ...invalidCore };
  await assert.rejects(() => admitSourceReconciliationResult(demand, activity, { at: NOW, dataRoot: root, witnessJournalAgentUrl: witnessJournal.agentCardUrl, settlement: TEST_SETTLEMENT }), /preserve every incumbent without deletion/u);
});

test("video demands preserve the format split and bind the normalized provider request", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "persistent-notebook-demand-")); const witnessJournal = await startWitnessJournalProviderProcess();
  t.after(async () => { await witnessJournal.close(); rmSync(root, { recursive: true, force: true }); });
  const sourceDemand = formSourceReconciliationDemand({ sources: [source(`sha256:${"c".repeat(64)}`)] });
  const sourceAdmission = await admitSourceReconciliationResult(sourceDemand, providerSourceResult(sourceDemand), { at: NOW, dataRoot: root, witnessJournalAgentUrl: witnessJournal.agentCardUrl, settlement: TEST_SETTLEMENT });
  const cinematic = formVideoDemand({ sourceAdmission, prompt: "Show kinematic space.", format: "cinematic", customer: "urn:ame:mathematics-youtube-channel-enterprise" });
  const explainer = formVideoDemand({ sourceAdmission, prompt: "Explain the relation.", format: "explainer", style: "whiteboard", customer: "urn:ame:youtube-channel-enterprise" });
  assert.equal(cinematic.providerRequest.videoStyle, null); assert.equal(cinematic.providerRequest.videoLanguage, "en");
  assert.equal(cinematic.providerRequestDigest, digest({ sources: cinematic.providerRequest.sources.map(({ digest: sourceDigest, title }) => ({ digest: sourceDigest, title })), prompt: cinematic.providerRequest.prompt, artifactType: "video", executionMode: "live", corpusMode: "reconciled-notebook", notebookSourceReceiptId: cinematic.providerRequest.notebookSourceReceiptId, sourcePacket: null, sourcePacketDigest: null, videoFormat: "cinematic", videoStyle: null, videoLanguage: "en", videoCapacityCustomer: "urn:ame:mathematics-youtube-channel-enterprise", videoCapacityAllocation: "mathematics-daily", capacityCustomer: "urn:ame:mathematics-youtube-channel-enterprise", cinematicAllocation: "mathematics-standing" }));
  assert.equal(explainer.providerRequest.videoStyle, "whiteboard");
  assert.notEqual(cinematic.providerRequestDigest, explainer.providerRequestDigest);
});

test("an exact provider MP4 is imported onto the notebook plate and witnessed", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "persistent-notebook-video-")); const providerExport = join(root, "provider-export"); const dataRoot = join(root, "notebook-data");
  mkdirSync(providerExport); const providerPath = join(providerExport, "exchange-video.mp4");
  writeFileSync(providerPath, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from("exact provider video bytes")]));
  const witnessJournal = await startWitnessJournalProviderProcess(); t.after(async () => { await witnessJournal.close(); rmSync(root, { recursive: true, force: true }); });
  const sourceDemand = formSourceReconciliationDemand({ sources: [source(`sha256:${"d".repeat(64)}`)] });
  const sourceAdmission = await admitSourceReconciliationResult(sourceDemand, providerSourceResult(sourceDemand), { at: NOW, dataRoot, witnessJournalAgentUrl: witnessJournal.agentCardUrl, settlement: TEST_SETTLEMENT });
  const demand = formVideoDemand({ sourceAdmission, prompt: "Explain this system.", format: "explainer", style: "classic", customer: "urn:ame:youtube-channel-enterprise" });
  const invocation = "urn:provider:video-invocation";
  const activity = { type: "Accept", id: "urn:provider:video-result", actor: PROVIDER, inReplyTo: invocation, object: { type: "NotebookLMServiceResult", disposition: "artifact", requestDigest: demand.providerRequestDigest, notebookSourceReceiptId: sourceAdmission.providerReceipt, videoOverviewCapacityReceipt: providerVideoCapacityReceipt(demand, invocation), cinematicCapacityReceipt: null, artifact: providerVideoArtifact(providerPath, demand) } };
  const admission = await admitVideoResult(demand, sourceAdmission, activity, { at: NOW, dataRoot, providerExportRoot: providerExport, witnessJournalAgentUrl: witnessJournal.agentCardUrl, settlement: TEST_SETTLEMENT });
  assert.equal(admission.mediaType, "video/mp4"); assert.equal(admission.videoFormat, "explainer");
  assert.equal(admission.providerArtifactId, "video-provider-000001");
  assert.deepEqual(readFileSync(join(dataRoot, "artifacts", `${admission.sha256.slice(7)}.mp4`)), readFileSync(providerPath));
  const records = await querySettlementRecords("persistent-notebook.video-artifact-admission");
  assert.equal(records.length, 1);});

test("artifact admission refuses a carrier outside the provider export boundary", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "persistent-notebook-escape-")); const providerExport = join(root, "provider-export"); const dataRoot = join(root, "notebook-data");
  mkdirSync(providerExport); const outside = join(root, "outside.mp4"); writeFileSync(outside, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from("outside")]));
  const witnessJournal = await startWitnessJournalProviderProcess(); t.after(async () => { await witnessJournal.close(); rmSync(root, { recursive: true, force: true }); });
  const sourceDemand = formSourceReconciliationDemand({ sources: [source(`sha256:${"e".repeat(64)}`)] });
  const sourceAdmission = await admitSourceReconciliationResult(sourceDemand, providerSourceResult(sourceDemand), { at: NOW, dataRoot, witnessJournalAgentUrl: witnessJournal.agentCardUrl, settlement: TEST_SETTLEMENT });
  const demand = formVideoDemand({ sourceAdmission, prompt: "Explain.", format: "explainer", customer: "urn:ame:youtube-channel-enterprise" });
  const invocation = "urn:provider:video-invocation";
  const activity = { type: "Accept", id: "urn:provider:video-result", actor: PROVIDER, inReplyTo: invocation, object: { type: "NotebookLMServiceResult", disposition: "artifact", requestDigest: demand.providerRequestDigest, notebookSourceReceiptId: sourceAdmission.providerReceipt, videoOverviewCapacityReceipt: providerVideoCapacityReceipt(demand, invocation), cinematicCapacityReceipt: null, artifact: providerVideoArtifact(outside, demand) } };
  await assert.rejects(() => admitVideoResult(demand, sourceAdmission, activity, { at: NOW, dataRoot, providerExportRoot: providerExport, witnessJournalAgentUrl: witnessJournal.agentCardUrl, settlement: TEST_SETTLEMENT }), /escapes the declared export boundary/u);
});

test("artifact admission refuses provider payload terms that do not describe the carrier", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "persistent-notebook-video-payload-")); const providerExport = join(root, "provider-export"); const dataRoot = join(root, "notebook-data");
  mkdirSync(providerExport); const providerPath = join(providerExport, "exchange-video.mp4");
  writeFileSync(providerPath, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from("exact provider video bytes")]));
  const witnessJournal = await startWitnessJournalProviderProcess(); t.after(async () => { await witnessJournal.close(); rmSync(root, { recursive: true, force: true }); });
  const sourceDemand = formSourceReconciliationDemand({ sources: [source(`sha256:${"f".repeat(64)}`)] });
  const sourceAdmission = await admitSourceReconciliationResult(sourceDemand, providerSourceResult(sourceDemand), { at: NOW, dataRoot, witnessJournalAgentUrl: witnessJournal.agentCardUrl, settlement: TEST_SETTLEMENT });
  const demand = formVideoDemand({ sourceAdmission, prompt: "Explain this system.", format: "explainer", style: "classic", customer: "urn:ame:youtube-channel-enterprise" });
  const artifact = providerVideoArtifact(providerPath, demand, { sha256: `sha256:${"0".repeat(64)}` });
  const invocation = "urn:provider:video-invocation";
  const activity = { type: "Accept", id: "urn:provider:video-result", actor: PROVIDER, inReplyTo: invocation, object: { type: "NotebookLMServiceResult", disposition: "artifact", requestDigest: demand.providerRequestDigest, notebookSourceReceiptId: sourceAdmission.providerReceipt, videoOverviewCapacityReceipt: providerVideoCapacityReceipt(demand, invocation), cinematicCapacityReceipt: null, artifact } };
  await assert.rejects(() => admitVideoResult(demand, sourceAdmission, activity, { at: NOW, dataRoot, providerExportRoot: providerExport, witnessJournalAgentUrl: witnessJournal.agentCardUrl, settlement: TEST_SETTLEMENT }), /does not describe the exported carrier/u);
});

test("cinematic admission binds the exact spent math capacity receipt", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "persistent-notebook-cinematic-")); const providerExport = join(root, "provider-export"); const dataRoot = join(root, "notebook-data");
  mkdirSync(providerExport); const providerPath = join(providerExport, "cinematic.mp4");
  writeFileSync(providerPath, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from("cinematic provider bytes")]));
  const witnessJournal = await startWitnessJournalProviderProcess(); t.after(async () => { await witnessJournal.close(); rmSync(root, { recursive: true, force: true }); });
  const sourceDemand = formSourceReconciliationDemand({ sources: [source(`sha256:${"1".repeat(64)}`, "Math lesson")] });
  const sourceAdmission = await admitSourceReconciliationResult(sourceDemand, providerSourceResult(sourceDemand), { at: NOW, dataRoot, witnessJournalAgentUrl: witnessJournal.agentCardUrl, settlement: TEST_SETTLEMENT });
  const demand = formVideoDemand({ sourceAdmission, prompt: "Show kinematic space.", format: "cinematic", customer: "urn:ame:mathematics-youtube-channel-enterprise" });
  const invocation = "urn:provider:cinematic-invocation"; const capacity = providerCapacityReceipt(demand, invocation);
  const activity = { type: "Accept", id: "urn:provider:cinematic-result", actor: PROVIDER, inReplyTo: invocation, object: { type: "NotebookLMServiceResult", disposition: "artifact", requestDigest: demand.providerRequestDigest, notebookSourceReceiptId: sourceAdmission.providerReceipt, videoOverviewCapacityReceipt: providerVideoCapacityReceipt(demand, invocation), cinematicCapacityReceipt: capacity, artifact: providerVideoArtifact(providerPath, demand) } };
  const admission = await admitVideoResult(demand, sourceAdmission, activity, { at: NOW, dataRoot, providerExportRoot: providerExport, witnessJournalAgentUrl: witnessJournal.agentCardUrl, settlement: TEST_SETTLEMENT });
  assert.equal(admission.cinematicCapacityReceipt, capacity.id);
  assert.deepEqual(admission.providerDemand, demand);
  assert.deepEqual(admission.cinematicCapacity, capacity);
  assert.equal(admission.videoOverviewCapacity.id, admission.videoOverviewCapacityReceipt);
  const missing = { ...activity, object: { ...activity.object, cinematicCapacityReceipt: null } };
  await assert.rejects(() => admitVideoResult(demand, sourceAdmission, missing, { at: NOW, dataRoot, providerExportRoot: providerExport, witnessJournalAgentUrl: witnessJournal.agentCardUrl, settlement: TEST_SETTLEMENT }), /lacks the provider's spent capacity receipt/u);
});
