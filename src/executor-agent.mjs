import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGENT_CARD_WELL_KNOWN_PATH } from "@red-cup-engineering/a2a-services-section/a2a-client";
import { loadSignedAgentCard } from "@red-cup-engineering/a2a-services-section/agent-card-signing";

const ROOT = resolve(import.meta.dirname, "..");

// One A2A message in on the executor's stdin, one A2A response message out on its stdout.
function runExecutor(executor, message, timeoutMs) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [executor], { cwd: ROOT, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout.push(chunk); });
    child.stderr.on("data", (chunk) => { stderr.push(chunk); });
    child.stdin.on("error", (error) => { if (error.code !== "EPIPE") reject(error); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`executor refused with code ${code ?? "none"} signal ${signal ?? "none"}: ${Buffer.concat(stderr).toString("utf8")}`));
      try { accept(JSON.parse(Buffer.concat(stdout).toString("utf8"))); } catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify(message));
  });
}

/** The a2a-server options that serve one signed Agent Card and hand each message to one executor process. */
export async function executorAgentOptions(activationFile, executorFile) {
  const activation = JSON.parse(readFileSync(resolve(ROOT, "content/config", activationFile), "utf8"));
  const { card, jwks } = await loadSignedAgentCard({
    origin: activation.baseUrl,
    cardPath: resolve(ROOT, activation.agentCard),
    signingKeyPath: resolve(ROOT, activation.signingKeyDataPath),
    jwksPath: resolve(ROOT, activation.publicJwks),
    kid: activation.signingKid,
    algorithm: activation.algorithm,
  });
  const executor = resolve(ROOT, "src", executorFile);
  return { agentCard: card, jwks, host: activation.host, port: activation.port, agentCardPath: AGENT_CARD_WELL_KNOWN_PATH, handlers: { "message/send": (message) => runExecutor(executor, message, activation.timeoutMs) } };
}
