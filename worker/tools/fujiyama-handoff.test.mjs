import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const functions = source.slice(source.indexOf("async function waitForFujiyamaHandoff("), source.indexOf("async function handleProviderWebhook("));
const normalizer = source.slice(source.indexOf("async function normalizeFujiyamaBookingPayload("), source.indexOf("async function ensureDefaultClientPricing("));
const references = source.slice(source.indexOf("function findProviderReference("), source.indexOf("function findProviderUrls("));
const script = ts.transpileModule(`${normalizer}\n${references}\n${functions}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test("provider audit status writes use values permitted by production D1", () => {
  const allowed = new Set(["pending", "succeeded", "failed", "retrying"]);
  const writes = [...source.matchAll(/UPDATE integration_requests SET status = '([^']+)'/g)];
  assert.ok(writes.length > 0);
  for (const [, status] of writes) assert.ok(allowed.has(status), `Invalid integration request status: ${status}`);
});

test("a status response cannot replace the accepted manifest job with a trace ID", () => {
  const { context } = setup();
  const job = "2a3a2757-54f6-40c2-bc89-aa2f82f67669";
  const trace = "a6174649cedd51de:manifest-status:1795846918781";
  assert.equal(context.delhiveryManifestJobReference({ request_id: trace, data: { job_id: job } }), job);
  assert.equal(context.delhiveryManifestJobReference({ request_id: trace }, job, trace), job);
  assert.equal(context.delhiveryManifestJobReference({ request_id: trace }, undefined, trace), null);
});

function setup({ publish = true } = {}) {
  let elapsed = 0;
  const lookups = [];
  const logs = [];
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
    console: { log: (message) => logs.push(JSON.parse(message)) },
    FUJIYAMA_FORWARD_CLIENT_ID: "tenant",
    FUJIYAMA_REVERSE_CLIENT_ID: "reverse-tenant",
    compactDocument: () => null,
    pricingPincode: async (_env, pincode) => ({
      pincode,
      facility_city: pincode === "110001" ? "Delhi" : "Bengaluru",
      facility_state: pincode === "110001" ? "Delhi" : "Karnataka",
    }),
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
  return { context, env, lookups, logs, pdf, elapsed: () => elapsed };
}

test("waits through delayed LR/AWB and a later label callback, then includes both PDFs in the booking response", async () => {
  const { context, env, lookups, logs, pdf } = setup();
  const payload = {
    order_id: "FUJIYAMA-TEST-ONLY", invoice_number: "TEST-ONLY", description: "Solar equipment",
    origin: "New Delhi", destination: "Bengaluru", consignee: "TEST ONLY Consignee", payment_mode: "prepaid",
    origin_address: { name: "TEST ONLY Sender", line: "Building A, Synthetic Pickup Street", pincode: "110001", phone: "9999999999" },
    destination_address: { name: "TEST ONLY Consignee", line: "Building B, Synthetic Delivery Street", pincode: "560102", phone: "9999999999" },
    total_weight_kg: 25, pieces: 1, declared_value: 1000, length: 10, width: 10, height: 10, provider: "delhivery",
  };
  await context.normalizeFujiyamaBookingPayload(env, "tenant", payload);
  assert.equal(payload.origin_address.line, "Building A, Synthetic Pickup Street");
  assert.equal(payload.destination_address.pincode, "560102");
  assert.equal(payload.destination_address.city, "Bengaluru");
  assert.equal(payload.lane, "forward");
  const handoff = await context.waitForFujiyamaHandoff(env, "tenant", "shipment", "request", "courier-account", { aborted: false });
  assert.equal(handoff.handoff_status, "ready");
  assert.equal(handoff.lr_number, "123456");
  assert.equal(handoff.master_awb, "987654");
  assert.equal(lookups.length, 2);
  assert.ok(lookups.every(({ operation, payload }) => operation === "shipment_status" && payload.provider_booking_id === "manifest-job" && payload.provider_account_id === "courier-account"));
  const response = await context.fujiyamaBookingResponse(env, "tenant", JSON.stringify({ request_id: "request", data: handoff }), 201, {}, true);
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.data.documents.length, 2);
  for (const document of result.data.documents) assert.equal(document.body_base64, pdf.toString("base64"));
  assert.deepEqual(logs, [{
    event: "fujiyama_booking_handoff_response", request_id: "request", shipment_id: "shipment",
    initial_request: true, http_status: 201, has_lr: true, has_master_awb: true,
    inline_lr_pdf: true, inline_label_pdf: true,
  }]);
});

test("bounded wait preserves an unpublished shipment as pending", async () => {
  const { context, env, elapsed } = setup({ publish: false });
  const handoff = await context.waitForFujiyamaHandoff(env, "tenant", "shipment", "request", "courier-account", { aborted: false });
  assert.equal(handoff.handoff_status, "pending");
  assert.equal(elapsed(), 60_000);
});
