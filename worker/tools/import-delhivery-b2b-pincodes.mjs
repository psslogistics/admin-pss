import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const input = process.argv[2];
const remote = process.argv.includes("--remote");
if (!input) throw new Error("Usage: node tools/import-delhivery-b2b-pincodes.mjs <csv-path> [--remote]");
const parseCsv = (source) => {
  const rows = []; let row = []; let cell = ""; let quoted = false;
  for (let index = 0; index < source.length; index += 1) { const character = source[index]; const next = source[index + 1]; if (quoted && character === '"' && next === '"') { cell += '"'; index += 1; } else if (character === '"') quoted = !quoted; else if (!quoted && character === ",") { row.push(cell); cell = ""; } else if (!quoted && (character === "\n" || character === "\r")) { if (character === "\r" && next === "\n") index += 1; row.push(cell); if (row.some((value) => value.trim())) rows.push(row); row = []; cell = ""; } else cell += character; }
  if (cell || row.length) { row.push(cell); rows.push(row); } return rows;
};
const sql = (value) => `'${String(value ?? "").replaceAll("'", "''")}'`;
const rows = parseCsv(fs.readFileSync(input, "utf8"));
const records = rows.slice(1).map((row) => ({ pincode: String(row[1] ?? "").trim(), city: String(row[5] ?? "").trim(), state: String(row[6] ?? "").trim(), oda: String(row[7] ?? "").trim().toLowerCase() === "true" ? 1 : 0 })).filter((row) => /^\d{6}$/.test(row.pincode) && row.state);
const unique = [...new Map(records.map((row) => [row.pincode, row])).values()];
const wrangler = path.resolve("..", "node_modules", "wrangler", "bin", "wrangler.js");
const rowSql = (row) => `INSERT INTO delhivery_b2b_pincode_zones (pincode, facility_city, facility_state, oda, source_filename) VALUES (${sql(row.pincode)}, ${sql(row.city)}, ${sql(row.state)}, ${row.oda}, ${sql(path.basename(input))});`;
const chunkSize = 750;
for (let offset = 0; offset < unique.length; offset += chunkSize) {
  const chunk = unique.slice(offset, offset + chunkSize); const statements = [...(offset === 0 ? ["DELETE FROM delhivery_b2b_pincode_zones;"] : []), ...chunk.map(rowSql)];
  const temp = path.join(os.tmpdir(), `pss-b2b-pincodes-${Date.now()}-${offset}.sql`); fs.writeFileSync(temp, statements.join("\n"), "utf8");
  const args = [wrangler, "d1", "execute", "DB", ...(remote ? ["--remote"] : ["--local"]), `--file=${temp}`];
  const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd: process.cwd() });
  fs.rmSync(temp, { force: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Imported ${unique.length} Delhivery B2B pincodes from ${path.basename(input)}.`);
