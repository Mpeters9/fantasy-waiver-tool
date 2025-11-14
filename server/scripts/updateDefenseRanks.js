import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs/promises";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OUTPUT_PATH = join(__dirname, "..", "data", "defense-rankings.json");
const API_URL =
  process.env.FANTASY_LIFE_DEFENSE_API ||
  "https://api.fantasylife.com/v1/nfl/defense-rankings";

async function updateDefenseRanks() {
  console.log("Fetching defense rankings from:", API_URL);
  const res = await fetch(API_URL);
  if (!res.ok) {
    throw new Error(`FantasyLife request failed with status ${res.status}`);
  }

  const json = await res.json();

  const getRank = (item, keys, fallback) => {
    for (const key of keys) {
      const value = item?.[key];
      if (value === 0 || value === "0") return 0;
      const num = Number(value);
      if (Number.isFinite(num)) return num;
    }
    return fallback;
  };

  const ranks = (json?.data || json || [])
    .map((item) => {
      const teamAbbr = item.teamAbbr || item.team || item.team_abbr;
      const overall = getRank(item, ["rank", "overallRank", "overall"], 16);
      const qb = getRank(item, ["qbRank", "rankQB", "qb"], overall);
      const rb = getRank(item, ["rbRank", "rankRB", "rb"], overall);
      const wr = getRank(item, ["wrRank", "rankWR", "wr"], overall);
      const te = getRank(item, ["teRank", "rankTE", "te"], overall);
      return { teamAbbr, overall, QB: qb, RB: rb, WR: wr, TE: te };
    })
    .filter((item) => item.teamAbbr)
    .sort((a, b) => a.overall - b.overall);

  if (!ranks.length) {
    throw new Error("FantasyLife response did not include any rankings.");
  }

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(ranks, null, 2));
  console.log(`Updated ${ranks.length} defense rankings in ${OUTPUT_PATH}`);
}

updateDefenseRanks().catch((err) => {
  console.error("Failed to update defense rankings:", err);
  process.exit(1);
});
