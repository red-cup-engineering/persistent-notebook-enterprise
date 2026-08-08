import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const binding = JSON.parse(readFileSync(new URL("../content/config/notebooklm-provider.json", import.meta.url), "utf8"));
const activation = JSON.parse(readFileSync(new URL("../content/config/activation.json", import.meta.url), "utf8"));
const accountBinding = JSON.parse(readFileSync(new URL("../content/evm/accounts/eip155-31337.json", import.meta.url), "utf8"));

test("the persistent notebook pins exactly one authenticated provider face", () => {
  assert.equal(binding.provider, "urn:ame:notebooklm-inference-team");
  assert.equal(binding.customer, "urn:ame:persistent-notebook-enterprise");
  assert.equal(binding.notebookId, "67510ce7-79b3-4caa-b25c-28e0d3911b5a");
  assert.equal(binding.agentUrl, "http://127.0.0.1:18436/.well-known/agent-card.json");
  assert.match(binding.agentCardIdentity, /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u);
  assert.match(binding.standingGrantAcceptance, /^urn:sha256:[a-f0-9]{64}$/u);
  assert.equal(binding.settlementAccount, "eip155:31337:0x7bbb8b1bc2956d64fd88faa4fec2756d91da83b5");
  assert.equal(binding.settlementAccount, accountBinding.account.caip10);
  assert.equal(accountBinding.enterprise.urn, binding.customer);
  assert.match(binding.inventoryAdmission, /^urn:sha256:[a-f0-9]{64}$/u);
});

test("historical standing-grant evidence does not falsely claim a live customer runtime", () => {
  assert.equal(activation.status, "frozen-provider-runtime-misaddressed");
  assert.equal(activation.gates.witnessJournalProviderContracted, true);
  assert.equal(activation.gates.notebookProviderContractAccepted, true);
  assert.equal(activation.gates.unofficialNotebookLmAutomationAccepted, true);
  assert.equal(activation.gates.enterpriseAccountProvisioned, true);
  assert.equal(activation.gates.currentSourceInventoryAdmitted, true);
  assert.equal(activation.gates.sourceLifecyclePolicyLiveActivated, true);
  assert.equal(activation.gates.signedNotebookProviderAgentCardDeployed, false);
  assert.equal(activation.gates.signedCustomerExplainerAgentCardDeployed, false);
  assert.equal(activation.gates.signedMathClimateVideoFaceImplemented, true);
  assert.equal(activation.gates.customerBearerArtifactIngressDeployed, false);
  assert.equal(activation.gates.signedAgentCardAndArtifactIngressDeployed, false);
  assert.equal(activation.evidence.sourceCount, 35);
  assert.deepEqual(activation.evidence.inventoryMutation, { added: 0, deleted: 0 });
  assert.match(activation.runtimeVerification.observed, /refused connection/u);
  assert.ok(activation.withheldWhileActive.includes("YouTube upload, scheduling, or publication"));
});
