import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const functions = source.slice(source.indexOf("async function waitForFujiyamaHandoff("), source.indexOf("async function handleProviderWebhook("));
const script = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function setup({ publish = true } = {}) {
  let elapsed = 0;
  const lookups = [];
  const pdf = Buffer.from("%PDF-1.4\nfixture");
  const documents = ["lr-copy", "label"].map((kind) => ({
    id: kind, name: `delhivery-${kind}-123456.pdf`, content_type: "application/pdf", size: pdf.length,
  }));
  const env = {
    DB: { prepare: () => ({ bind: (id, shipmentId, clientId) => ({
      first: async () => shipmentId === "shipment" && clientId === "tenant" ? { object_key: id } : null,
    }) }) },
    FILES: { get: async () => ({ size: pdf.length, arrayBuffer: async () => Uint8Array.from(pdf).buffer }) },
  };
  let references = false;
  let labelStarted;
  const context = vm.createContext({
    Date: { now: () => elapsed },
    setTimeout: (callback, delay) => { elapsed += delay; callback(); },
    fujiyamaHandoff: async () => {
      const ready = labelStarted !== undefined && elapsed >= labelStarted + 4500;
      return {
        id: "shipment", provider_booking_id: "manifest-job",
        lr_number: references ? "123456" : null, master_awb: references ? "987654" : null,
        handoff_status: ready ? "ready" : "pending", documents: ready ? documents : [],
      };
    },
    safeProviderRequest: async (_env, provider, operation, payload) => {
      lookups.push({ provider, operation, payload });
      references = publish && lookups.length >= 2;
    },
    ensureFujiyamaHandoffDocuments: async () => { labelStarted ??= elapsed; },
    documentSignatureMatches: (_type, bytes) => Buffer.from(bytes).subarray(0, 5).toString() === "%PDF-",
    providerBytesToBase64: (bytes) => Buffer.from(bytes).toString("base64"),
    json: (body, status) => Response.json(body, { status }),
    Response,
  });
  vm.runInContext(script, context);
  return { context, env, lookups, pdf, elapsed: () => elapsed };
}

test("waits through delayed LR/AWB and a later label callback, then includes both PDFs in the booking response", async () => {
  const { context, env, lookups, pdf } = setup();
  const handoff = await context.waitForFujiyamaHandoff(env, "tenant", "shipment", "request", "courier-account", { aborted: false });
  assert.equal(handoff.handoff_status, "ready");
  assert.equal(handoff.lr_number, "123456");
  assert.equal(handoff.master_awb, "987654");
  assert.equal(lookups.length, 2);
  assert.ok(lookups.every(({ operation, payload }) => operation === "shipment_status" && payload.provider_booking_id === "manifest-job" && payload.provider_account_id === "courier-account"));
  const response = await context.fujiyamaBookingResponse(env, "tenant", JSON.stringify({ data: handoff }), 201, {});
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.data.documents.length, 2);
  for (const document of result.data.documents) assert.equal(document.body_base64, pdf.toString("base64"));
});

test("bounded wait preserves an unpublished shipment as pending", async () => {
  const { context, env, elapsed } = setup({ publish: false });
  const handoff = await context.waitForFujiyamaHandoff(env, "tenant", "shipment", "request", "courier-account", { aborted: false });
  assert.equal(handoff.handoff_status, "pending");
  assert.equal(elapsed(), 60_000);
});
