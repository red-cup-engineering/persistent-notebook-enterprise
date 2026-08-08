import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const agent = JSON.parse(readFileSync(new URL("../content/config/explainer-agent.json", import.meta.url), "utf8"));
const exchange = JSON.parse(readFileSync(new URL("../content/config/artifact-exchange.json", import.meta.url), "utf8"));
const a2aUnit = readFileSync(new URL("../content/deployment/systemd-user/emsweb-persistent-notebook-explainer-a2a.service", import.meta.url), "utf8");
const artifactUnit = readFileSync(new URL("../content/deployment/systemd-user/emsweb-persistent-notebook-artifacts.service", import.meta.url), "utf8");

test("the notebook runtime exposes separate signed A2A and bearer artifact loopback faces", () => {
  assert.equal(agent.host, "127.0.0.1"); assert.equal(agent.port, 18437);
  assert.equal(exchange.host, "127.0.0.1"); assert.equal(exchange.port, 18438);
  assert.notEqual(agent.port, exchange.port);
  assert.match(agent.signingKeyDataPath, /^data\/credentials\//u);
  assert.ok(agent.authorityWithheld.includes("youtube-publication"));
  assert.ok(exchange.authorityWithheld.includes("unauthenticated-read"));
});

test("the explainer can append only to its data while credentials and account custody stay read-only", () => {
  assert.match(a2aUnit, /^ReadWritePaths=.*\/persistent-notebook-enterprise\/data$/mu);
  assert.match(a2aUnit, /^InaccessiblePaths=.*\/youtube-channel-enterprise$/mu);
  assert.match(a2aUnit, /^ReadOnlyPaths=.*\/data\/credentials .*\/data\/evm\/keystores$/mu);
  assert.match(a2aUnit, /^Environment=PERSISTENT_NOTEBOOK_SETTLEMENT_ACCOUNT=eip155:31337:0x[a-f0-9]{40}$/mu);
  assert.match(a2aUnit, /^Environment=NOTEBOOKLM_AGENT_CARD_NI=ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/mu);
  assert.doesNotMatch(a2aUnit, /PRIVATE_KEY|PASSWORD|YOUTUBE|OAUTH/u);
  assert.match(artifactUnit, /^ProtectHome=read-only$/mu);
  assert.doesNotMatch(artifactUnit, /ReadWritePaths|WitnessJournal|SETTLEMENT|PRIVATE_KEY/u);
});
