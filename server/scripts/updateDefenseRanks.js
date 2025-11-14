import { fileURLToPath } from "url";
import { dirname, join, resolve, isAbsolute } from "path";
import fs from "fs/promises";
import fetch from "node-fetch";
import { buildDefenseRanksFromRaw } from "../logic/defense-ranks.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OUTPUT_PATH = join(__dirname, "..", "data", "defense-rankings.json");
const SOURCE_ARG = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const SOURCE = SOURCE_ARG || process.env.DEFENSE_RANKINGS_SOURCE || "";

async function updateDefenseRanks() {
  if (!SOURCE) {
    throw new Error(
      "No defense ranking source provided.\n" +
        "Pass a URL or file path as an argument, or set DEFENSE_RANKINGS_SOURCE."
    );
  }
  console.log("Fetching defense rankings from:", SOURCE);
  let raw;
  if (/^https?:\/\//i.test(SOURCE)) {
    const res = await fetch(SOURCE);
    if (!res.ok) {
      throw new Error(`Defense source request failed with status ${res.status}`);
    }
    raw = await res.text();
  } else {
    const inputPath = isAbsolute(SOURCE) ? SOURCE : resolve(process.cwd(), SOURCE);
    raw = await fs.readFile(inputPath, "utf8");
  }

  const ranks = buildDefenseRanksFromRaw(raw);
  if (!ranks.length) {
    throw new Error("Provided source did not include any rankings.");
  }

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(ranks, null, 2));
  console.log(`Updated ${ranks.length} defense rankings in ${OUTPUT_PATH}`);
}

updateDefenseRanks().catch((err) => {
  console.error("Failed to update defense rankings:", err);
  process.exit(1);
});
