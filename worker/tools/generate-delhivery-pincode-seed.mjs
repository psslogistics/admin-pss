import fs from "node:fs";
import path from "node:path";

const source = process.argv[2] ?? "C:\\Users\\gaura\\Downloads\\B2B_Pincode_List_pssbookscft10 b2bc_2026-08-24.csv";
const output = process.argv[3] ?? path.resolve("worker/migrations/20260930_z_delhivery_b2b_pincode_seed.sql");

const sql = (value) => `'${String(value ?? "").replaceAll("'", "''")}'`;
const lines = fs.readFileSync(source, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/);
const parseCsv = (line) => {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"' && quoted) { current += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (character === "," && !quoted) { values.push(current); current = ""; continue; }
    current += character;
  }
  values.push(current);
  return values;
};

const [header, ...data] = lines.map(parseCsv);
const index = new Map(header.map((name, position) => [name.trim(), position]));
const required = ["Pin", "Facility City", "Facility State", "ODA"];
for (const name of required) if (!index.has(name)) throw new Error(`Missing CSV column: ${name}`);
const rows = data.map((values) => ({
  pincode: values[index.get("Pin")].trim(),
  city: values[index.get("Facility City")].trim(),
  state: values[index.get("Facility State")].trim(),
  oda: /^(true|1|yes)$/i.test(values[index.get("ODA")].trim()) ? 1 : 0,
})).filter((row) => /^\d{6}$/.test(row.pincode) && row.city && row.state);
const unique = [...new Map(rows.map((row) => [row.pincode, row])).values()];
const statements = [
  "-- Generated from the supplied Delhivery B2B pincode list. Do not hand-edit; regenerate when the source card changes.",
  "DELETE FROM delhivery_b2b_pincode_zones;",
];
for (let start = 0; start < unique.length; start += 200) {
  const chunk = unique.slice(start, start + 200).map((row) => `(${sql(row.pincode)}, ${sql(row.city)}, ${sql(row.state)}, ${row.oda}, 'B2B_Pincode_List_pssbookscft10 b2bc_2026-08-24.csv', CURRENT_TIMESTAMP)`);
  statements.push(`INSERT INTO delhivery_b2b_pincode_zones (pincode, facility_city, facility_state, oda, source_filename, updated_at) VALUES\n${chunk.join(",\n")};`);
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${statements.join("\n\n")}\n`, "utf8");
console.log(`Generated ${unique.length} pincode rows at ${output}`);
