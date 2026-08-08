#!/usr/bin/env node
import servicesFromEnvironment from "./notebooklm-provider-client.mjs";
import { contentId, notebookIdentity } from "./notebook.mjs";
const operation=contentId({type:"PersistentNotebookInitialInventoryObservation",notebook:notebookIdentity().id,policy:"observe-only",version:1});
try{const result=await servicesFromEnvironment().observeInventory(operation);process.stdout.write(`${JSON.stringify(result)}\n`);}catch(error){process.stderr.write(`${JSON.stringify({type:"PersistentNotebookInventoryObservationRefusal",operation,code:error.code??"inventory-observation-failed",message:error.message})}\n`);process.exitCode=2;}
