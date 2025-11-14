// server/index.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Root
app.get("/", (req, res) => {
  res.send("Fantasy Waiver Tool server is running ✅");
});

// Simple in-memory cache helpers so we do not hammer upstream APIs.
const createCache = (ttlMs = 5 * 60 * 1000) => {
  let value = null;
  let expiresAt = 0;

  return {
    async get(loader) {
      if (value && expiresAt > Date.now()) {
        return value;
      }

      value = await loader();
      expiresAt = Date.now() + ttlMs;
      return value;
    },
    reset() {
      value = null;
      expiresAt = 0;
    }
  };
};

const defenseCache = createCache();
const scoreboardCache = createCache(2 * 60 * 1000); // scoreboard shifts often, keep cache shorter.

// ✅ Defense Rankings Proxy — avoids CORS
app.get("/api/defense-rankings", async (req, res) => {
  try {
    const data = await defenseCache.get(async () => {
      const resp = await fetch("https://api.fantasylife.com/v1/nfl/defense-rankings");
      if (!resp.ok) throw new Error(`FantasyLife responded ${resp.status}`);
      return resp.json();
    });

    res.json(data);
  } catch (err) {
    console.error("Error fetching DEF ranks:", err);
    res.status(500).json({ error: "Failed to fetch defense rankings" });
  }
});

// ✅ Optional test route
app.get("/api/test", (req, res) => {
  res.json({ message: "Server connection successful!" });
});

const ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

async function loadScoreboard() {
  return scoreboardCache.get(async () => {
    const resp = await fetch(ESPN_SCOREBOARD_URL);
    if (!resp.ok) throw new Error(`ESPN scoreboard request failed with ${resp.status}`);
    return resp.json();
  });
}

function extractImpliedTotal(event, teamAbbrev) {
  const competition = event?.competitions?.[0];
  if (!competition) return null;

  const home = competition.competitors?.find((c) => c.homeAway === "home");
  const away = competition.competitors?.find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const odds = competition.odds?.[0];
  const total = typeof odds?.overUnder === "number" ? odds.overUnder : 45;
  const spreadRaw = odds?.details ?? "0";
  const spread = Number.parseFloat(spreadRaw) || 0;

  const isHome = home.team?.abbreviation?.toUpperCase() === teamAbbrev;
  const impliedHome = total / 2 - spread / 2;
  const impliedAway = total / 2 + spread / 2;

  return {
    impliedTotal: Number((isHome ? impliedHome : impliedAway).toFixed(2)),
    opponent: isHome ? away.team?.abbreviation : home.team?.abbreviation,
    total,
    spread,
    oddsProvider: odds?.provider?.name || null,
  };
}

// ✅ Vegas implied team total proxy
app.get("/api/vegas-implied/:team", async (req, res) => {
  const team = req.params.team?.toUpperCase();
  if (!team) {
    return res.status(400).json({ error: "Team abbreviation is required" });
  }

  try {
    const scoreboard = await loadScoreboard();
    const event = scoreboard.events?.find((evt) =>
      evt?.competitions?.[0]?.competitors?.some(
        (comp) => comp?.team?.abbreviation?.toUpperCase() === team
      )
    );

    if (!event) {
      return res.status(404).json({ error: `No active event found for ${team}` });
    }

    const implied = extractImpliedTotal(event, team);
    if (!implied) {
      return res.status(502).json({ error: "Unable to calculate implied total" });
    }

    res.json({ team, ...implied, gameId: event.id });
  } catch (err) {
    console.error(`Error fetching implied total for ${req.params.team}:`, err);
    scoreboardCache.reset();
    res.status(500).json({ error: "Failed to fetch Vegas implied total" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
