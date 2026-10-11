import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startWitnessJournalProviderProcess } from "@red-cup-engineering/witness-journal-document-service/test-provider";
import { advanceExplainerOrder, explainerOrderStates } from "../src/explainer-backend.mjs";
import { serveArtifactExchange } from "../src/artifact-exchange.mjs";
import { contentId, digest, notebookIdentity, sourceLifecyclePolicy } from "../src/notebook.mjs";

const NOW = "2096-07-21T12:00:00.000Z", SETTLEMENT = "eip155:31337:0x1111111111111111111111111111111111111111";
function exact(body) { return { id: contentId(body), ...body }; }

test("one explainer order settles once, replays without provider calls, and serves only its bearer-bound digest", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "persistent-explainer-backend-")), dataRoot = join(root, "data"), exchangeRoot = join(root, "exchange"), runtimeRoot = join(root, "runtime"); const witnessJournal = await startWitnessJournalProviderProcess();
  const server = await serveArtifactExchange({ dataRoot, exchangeRoot, host: "127.0.0.1", port: 0 }); const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise((accept) => server.close(accept)); await witnessJournal.close(); rmSync(root, { recursive: true, force: true }); });
  const videoPath = join(root, "video.mp4"), bytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from("settled explainer")]); writeFileSync(videoPath, bytes);
  const researchBytes = Buffer.from("research"); const orderBody = { type: "PersistentNotebookExplainerOrder", customer: "urn:ame:youtube-channel-enterprise", provider: "urn:ame:persistent-notebook-enterprise", notebook: notebookIdentity().id, sourceLifecyclePolicy: "curated-cumulative-corpus", source: { bytes: researchBytes, byteLength: researchBytes.length, digest: digest(researchBytes), mediaType: "text/markdown", title: "Research" }, prompt: "Explain.", format: "explainer", style: "auto", language: "en" }; const order = exact(orderBody);
  const sourceAdmission = exact({ type: "PersistentNotebookSourceStateAdmission", sourceLifecyclePolicy: sourceLifecyclePolicy().id });
  const videoAdmission = exact({ type: "PersistentNotebookVideoArtifactAdmission", videoFormat: "explainer", cinematicCapacityReceipt: null, sha256: digest(bytes) });
  let sourceCalls = 0, videoCalls = 0; const services = { async reconcileSource() { sourceCalls += 1; return { status: "completed", sourceAdmission }; }, async generateVideo() { videoCalls += 1; return { status: "completed", videoAdmission, artifactPath: videoPath }; } };
  const options = { at: NOW, dataRoot, exchangeRoot, runtimeRoot, artifactBaseUrl: baseUrl, settlement: SETTLEMENT, witnessJournalAgentUrl: witnessJournal.agentCardUrl, tokenBytes: Buffer.alloc(32, 7) };
  const first = await advanceExplainerOrder(order, services, options), replay = await advanceExplainerOrder(order, services, options);
  assert.deepEqual(replay, first); assert.equal(sourceCalls, 1); assert.equal(videoCalls, 1); assert.equal(first.disposition, "artifact");
  assert.deepEqual((await explainerOrderStates(order.id, options)).map((row) => row.status), ["accepted", "source-admitted", "video-admitted", "delivered"]);
  assert.equal((await fetch(first.delivery.artifact.url)).status, 401);
  const response = await fetch(first.delivery.artifact.url, { headers: { Authorization: `Bearer ${first.delivery.artifact.authorization.token}` } }); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  const secondOrder = exact({ ...orderBody, prompt: "Explain this again." }); const secondResult = await advanceExplainerOrder(secondOrder, services, { ...options, tokenBytes: Buffer.alloc(32, 8) });
  const secondResponse = await fetch(secondResult.delivery.artifact.url, { headers: { Authorization: `Bearer ${secondResult.delivery.artifact.authorization.token}` } }); assert.equal(secondResponse.status, 200); assert.deepEqual(Buffer.from(await secondResponse.arrayBuffer()), bytes);
});

test("in-progress source work is resumed under the same operation before video purchase", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "persistent-explainer-progress-")), dataRoot = join(root, "data"); const witnessJournal = await startWitnessJournalProviderProcess(); t.after(async () => { await witnessJournal.close(); rmSync(root, { recursive: true, force: true }); });
  const order = exact({ type: "PersistentNotebookExplainerOrder", source: { digest: `sha256:${"b".repeat(64)}` }, sourceLifecyclePolicy: "curated-cumulative-corpus" }); const sourceAdmission = exact({ type: "PersistentNotebookSourceStateAdmission", sourceLifecyclePolicy: sourceLifecyclePolicy().id }); let calls = 0, observedOperation;
  let expectedSourceOperation, expectedVideoOperation; const services = { async reconcileSource(_order, operation) { calls += 1; observedOperation = operation; expectedSourceOperation ??= operation; return calls === 1 ? { status: "in-progress", operation, retryAfterSeconds: 1 } : { status: "completed", operation, sourceAdmission }; }, async generateVideo(_order, _admission, operation) { expectedVideoOperation = operation; return { status: "in-progress", operation }; } };
  const options = { at: NOW, dataRoot, runtimeRoot: join(root, "runtime"), settlement: SETTLEMENT, witnessJournalAgentUrl: witnessJournal.agentCardUrl };
  const first = await advanceExplainerOrder(order, services, options); assert.equal(first.phase, "source");
  const second = await advanceExplainerOrder(order, services, options); assert.equal(observedOperation, expectedSourceOperation); assert.equal(second.operation, expectedVideoOperation); assert.equal(second.phase, "video");
  assert.deepEqual((await explainerOrderStates(order.id, options)).map((row) => row.status), ["accepted", "source-in-progress", "source-admitted", "video-in-progress"]);
});
