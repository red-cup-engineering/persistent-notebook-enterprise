#!/usr/bin/env node
import { createA2aServerProcess } from "@red-cup-engineering/a2a-services-section/a2a-server";
import { executorAgentOptions } from "./executor-agent.mjs";
await createA2aServerProcess(await executorAgentOptions("video-agent.json", "video-a2a-executor.mjs"));
