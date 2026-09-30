import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const source = process.argv[2] ?? "C:\\Users\\gaura\\Downloads\\B2B_Pincode_List_pssbookscft10 b2bc_2026-08-24.csv";
const output = process.argv[3] ?? path.resolve(".wrangler/pincode-import.sql");
const sourceFilename = path.basename(source);
const datasetId = crypto.randomUUID();
const raw = fs.readFileSync(source, "utf8").replace(/^\uFEFF/, "");

function parseCsv(sourceText) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < sourceText.length; index += 1) {
    const character = sourceText[index];
    if (character === '"') {
      if (quoted && sourceText[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && sourceText[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); if (row.some((value) => value.trim())) rows.push(row); }
  return rows;
}

const [header, ...data] = parseCsv(raw);
const headerIndex = new Map(header.map((name, index) => [name.trim().replace(/^\uFEFF/, ""), index]));
const required = ["Pin", "Facility City", "Facility State", "ODA"];
for (const name of required) if (!headerIndex.has(name)) throw new Error(`Missing CSV column: ${name}`);
const dispatchIndex = headerIndex.get("Dispatch Center");
const fallbackState = (value) => ({ orissa: "Odisha", odisha: "Odisha", karnataka: "Karnataka" }[String(value).toLowerCase()] ?? String(value));
const rows = data.map((values, index) => {
  const pincode = String(values[headerIndex.get("Pin")] ?? "").trim();
  const dispatch = dispatchIndex === undefined ? "" : String(values[dispatchIndex] ?? "").trim();
  const fallback = dispatch.match(/^([^_(]+).*\(([^)]+)\)/);
  const city = String(values[headerIndex.get("Facility City")] ?? "").trim() || fallback?.[1]?.replaceAll("_", " ").trim() || "";
  const state = String(values[headerIndex.get("Facility State")] ?? "").trim() || fallbackState(fallback?.[2]?.trim() ?? "");
  const odaValue = String(values[headerIndex.get("ODA")] ?? "").trim();
  if (!/^\d{6}$/.test(pincode) || !city || !state || !/^(true|false|1|0|yes|no)?$/i.test(odaValue)) throw new Error(`Invalid row ${index + 2}`);
  return { pincode, city, state, oda: /^(true|1|yes)$/i.test(odaValue) ? 1 : 0 };
});
const unique = [...new Map(rows.map((row) => [row.pincode, row])).values()];
if (unique.length !== rows.length) throw new Error(`Duplicate pincode rows found: ${rows.length - unique.length}`);
const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sourceSha256 = crypto.createHash("sha256").update(Buffer.from(raw, "utf8")).digest("hex");
const sourceObjectKey = `data-imports/delhivery-b2b-pincode/${datasetId}/${sourceFilename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-160) || "source.csv"}`;
const statements = [
  `INSERT INTO delhivery_b2b_pincode_datasets (id, source_filename, source_object_key, source_sha256, expected_row_count, imported_row_count, status, uploaded_by_user_id) VALUES (${sql(datasetId)}, ${sql(sourceFilename)}, ${sql(sourceObjectKey)}, ${sql(sourceSha256)}, ${unique.length}, ${unique.length}, 'staging', 'bootstrap-import');`,
];
for (let start = 0; start < unique.length; start += 200) {
  const chunk = unique.slice(start, start + 200).map((row) => `(${sql(datasetId)}, ${sql(row.pincode)}, ${sql(row.city)}, ${sql(row.state)}, ${row.oda})`);
  statements.push(`INSERT INTO delhivery_b2b_pincode_dataset_rows (dataset_id, pincode, facility_city, facility_state, oda) VALUES\n${chunk.join(",\n")};`);
}
statements.push(
  "UPDATE delhivery_b2b_pincode_datasets SET status = 'retired', updated_at = CURRENT_TIMESTAMP WHERE status = 'active';",
  "DELETE FROM delhivery_b2b_pincode_zones;",
  `INSERT INTO delhivery_b2b_pincode_zones (pincode, facility_city, facility_state, oda, source_filename, updated_at) SELECT pincode, facility_city, facility_state, oda, ${sql(sourceFilename)}, CURRENT_TIMESTAMP FROM delhivery_b2b_pincode_dataset_rows WHERE dataset_id = ${sql(datasetId)};`,
  `UPDATE delhivery_b2b_pincode_datasets SET status = 'active', published_by_user_id = 'bootstrap-import', published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ${sql(datasetId)};`,
  "PRAGMA optimize;",
);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${statements.join("\n\n")}\n`, "utf8");
console.log(JSON.stringify({ datasetId, sourceFilename, sourceObjectKey, sourceSha256, rowCount: unique.length, output }, null, 2));
