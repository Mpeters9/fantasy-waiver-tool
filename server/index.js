import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { promises as fsPromises } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve, isAbsolute } from "path";
import { createRequire } from "module";
import { buildDefenseRanksFromRaw } from "./logic/defense-ranks.js";

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require = createRequire(import.meta.url);
const stadiumLocations = require("./data/stadiums.json");
let defenseRanks = require("./data/defense-rankings.json");
const sampleNews = require("./data/news-sample.json");
const defenseFilePath = join(__dirname, "data", "defense-rankings.json");

const WEATHER_TTL_MS = 30 * 60 * 1000;
const SCOREBOARD_TTL_MS = 5 * 60 * 1000;
const SLEEPER_TTL_MS = 12 * 60 * 60 * 1000;
const NEWS_TTL_MS = 10 * 60 * 1000;
const DEFENSE_REFRESH_MS = 6 * 60 * 60 * 1000;

const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "PK", "DST", "DEF"]);

const weatherCache = new Map();
const scoreboardCache = { data: null, expiresAt: 0, dateKey: null, contexts: {}, matchupNews: [] };
const sleeperCache = { data: null, map: null, expiresAt: 0 };
const newsCache = { data: null, expiresAt: 0 };
let lastDefenseRefresh = 0;

const ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";
const FANTASYLIFE_NEWS_URL = "https://api.fantasylife.com/v2/news";
let defenseSourceWarningLogged = false;

async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Request failed for ${url} (${resp.status})`);
  }
  return resp.json();
}

const formatDateParam = (date) =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(
    2,
    "0"
  )}`;

function getUpcomingScoreboardDate() {
  const now = new Date();
  const utcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let delta = (7 - utcDate.getUTCDay()) % 7;
  if (delta === 0 && now.getUTCHours() >= 8) {
    delta = 7;
  }
  utcDate.setUTCDate(utcDate.getUTCDate() + delta);
  return formatDateParam(utcDate);
}

async function ensureScoreboardContexts() {
  if (scoreboardCache.contexts && Object.keys(scoreboardCache.contexts).length) return;
  try {
    await getScoreboard();
  } catch (err) {
    console.warn("Scoreboard fetch failed:", err.message);
  }
}

const getTeamOpponent = (abbr) => scoreboardCache.contexts?.[abbr]?.opponent || null;

function parseVegasForCompetition(comp) {
  if (!comp?.competitors?.length) return null;
  const odds = comp.odds?.[0] || {};
  const parsedTotal = Number(odds.overUnder);
  const total = Number.isFinite(parsedTotal) ? parsedTotal : 45;
  const detailTokens = (odds.details || "").split(" ").filter(Boolean);
  const favoredToken = detailTokens[0]?.toUpperCase();
  const detailSpreadToken = detailTokens[1] ?? detailTokens[detailTokens.length - 1];
  let detailSpread = parseFloat(detailSpreadToken);
  if (!Number.isFinite(detailSpread) && typeof odds.spread === "number") {
    detailSpread = Number(odds.spread);
  }
  if (!Number.isFinite(detailSpread)) {
    detailSpread = 0;
  }
  const absSpread = Math.abs(detailSpread);

  const home = comp.competitors.find((c) => c.homeAway === "home");
  const away = comp.competitors.find((c) => c.homeAway === "away");
  if (!home || !away) return null;
  const homeAbbr = home.team?.abbreviation?.toUpperCase();
  const awayAbbr = away.team?.abbreviation?.toUpperCase();

  let homeSpread = 0;
  let awaySpread = 0;
  if (favoredToken && absSpread) {
    if (favoredToken === homeAbbr) {
      homeSpread = -absSpread;
      awaySpread = absSpread;
    } else if (favoredToken === awayAbbr) {
      homeSpread = absSpread;
      awaySpread = -absSpread;
    } else {
      homeSpread = -absSpread;
      awaySpread = absSpread;
    }
  }

  const impliedHome = total / 2 - homeSpread / 2;
  const impliedAway = total / 2 + homeSpread / 2;

  const kickoff = comp.date || null;
  const venue = comp.venue?.fullName || comp.venue?.name || null;
  const broadcast = comp.broadcasts?.[0]?.names?.[0] || null;

  return {
    total,
    spread: Number(detailSpread.toFixed(1)),
    kickoff,
    venue,
    broadcast,
    home: {
      abbr: homeAbbr,
      implied: Number.isFinite(impliedHome) ? Number(impliedHome.toFixed(1)) : null,
      spread: Number(homeSpread.toFixed(1))
    },
    away: {
      abbr: awayAbbr,
      implied: Number.isFinite(impliedAway) ? Number(impliedAway.toFixed(1)) : null,
      spread: Number(awaySpread.toFixed(1))
    }
  };
}

function buildTeamContexts(scoreboard) {
  const contexts = {};
  scoreboard?.events?.forEach((event) => {
    const comp = event?.competitions?.[0];
    const vegas = parseVegasForCompetition(comp);
    if (!vegas || !vegas.home?.abbr || !vegas.away?.abbr) return;
    const { total, kickoff, venue, broadcast } = vegas;
    const pushContext = (team, opponent) => {
      contexts[team.abbr] = {
        team: team.abbr,
        opponent: opponent.abbr,
        impliedTotal: team.implied,
        opponentImpliedTotal: opponent.implied,
        overUnder: Number(total.toFixed(1)),
        spread: team.spread,
        opponentSpread: opponent.spread,
        kickoff: kickoff || event.date || null,
        venue,
        broadcast
      };
    };
    pushContext(vegas.home, vegas.away);
    pushContext(vegas.away, vegas.home);
  });
  return contexts;
}

function buildMatchupNews(contexts) {
  return Object.values(contexts).map((ctx) => ({
    id: `${ctx.team}-${ctx.opponent}-${ctx.kickoff || Date.now()}`,
    team: ctx.team,
    headline: `${ctx.team} vs ${ctx.opponent} preview`,
    analysis: `Kickoff ${ctx.kickoff ? new Date(ctx.kickoff).toLocaleString() : "TBD"} ┬╖ O/U ${ctx.overUnder} ┬╖ Spread ${
      ctx.team
    } ${ctx.spread > 0 ? `+${ctx.spread}` : ctx.spread} ┬╖ Implied totals ${ctx.team} ${
      ctx.impliedTotal ?? "N/A"
    } vs ${ctx.opponent} ${ctx.opponentImpliedTotal ?? "N/A"}.`,
    createdAt: ctx.kickoff,
    source: "Matchup"
  }));
}

const HTTP_SOURCE_REGEX = /^https?:\/\//i;

async function loadDefenseRankSource(source) {
  if (!source) return null;
  if (HTTP_SOURCE_REGEX.test(source)) {
    const resp = await fetch(source);
    if (!resp.ok) {
      throw new Error(`Request failed for ${source} (${resp.status})`);
    }
    return resp.text();
  }
  let resolved = source;
  if (source.startsWith("file://")) {
    resolved = fileURLToPath(new URL(source));
  }
  const absolute = isAbsolute(resolved) ? resolved : resolve(process.cwd(), resolved);
  return fsPromises.readFile(absolute, "utf8");
}

async function refreshDefenseRanks(force = false) {
  const shouldRefresh = force || Date.now() - lastDefenseRefresh > DEFENSE_REFRESH_MS;
  if (!shouldRefresh) return false;

  const defenseSource = (process.env.DEFENSE_RANKINGS_SOURCE || "").trim();
  if (!defenseSource) {
    if (!defenseSourceWarningLogged) {
      console.warn(
        "Defense rank refresh skipped: no DEFENSE_RANKINGS_SOURCE configured. " +
          "Update server/data/defense-rankings.json manually or run `npm run defense:update -- <file-or-url>`."
      );
      defenseSourceWarningLogged = true;
    }
    return false;
  }

  try {
    const raw = await loadDefenseRankSource(defenseSource);
    if (!raw) {
      throw new Error("Defense rank source returned no data");
    }
    const ranks = buildDefenseRanksFromRaw(raw);
    if (!ranks.length) throw new Error("No defense ranks returned");
    defenseRanks = ranks;
    lastDefenseRefresh = Date.now();
    await fsPromises.writeFile(defenseFilePath, JSON.stringify(ranks, null, 2));
    console.log(`Defense ranks refreshed (${ranks.length} teams).`);
    return true;
  } catch (err) {
    console.warn("Defense rank refresh failed:", err.message);
    return false;
  }
}

async function lookupWeather(team) {
  const cached = weatherCache.get(team);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const loc = stadiumLocations[team];
  if (!loc) {
    throw new Error("Unknown team");
  }

  const params = new URLSearchParams({
    latitude: String(loc.lat),
    longitude: String(loc.lon),
    hourly: "temperature_2m,precipitation_probability",
    forecast_days: "1",
    timezone: "auto"
  });

  const data = await fetchJSON(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  const temps = data?.hourly?.temperature_2m;
  const precip = data?.hourly?.precipitation_probability;
  const tempC =
    Array.isArray(temps) && typeof temps[12] === "number"
      ? temps[12]
      : Array.isArray(temps) && typeof temps[0] === "number"
      ? temps[0]
      : null;
  const rain =
    Array.isArray(precip) && typeof precip[12] === "number"
      ? precip[12]
      : Array.isArray(precip) && typeof precip[0] === "number"
      ? precip[0]
      : null;

  if (tempC === null || rain === null) {
    throw new Error("Incomplete weather data");
  }

  const tempF = Math.round((tempC * 9) / 5 + 32);
  const summary = `${tempF}F / ${Math.round(rain)}% rain`;
  weatherCache.set(team, { value: summary, expiresAt: Date.now() + WEATHER_TTL_MS });
  return summary;
}

async function getScoreboard() {
  const targetDate = getUpcomingScoreboardDate();
  if (scoreboardCache.data && scoreboardCache.expiresAt > Date.now() && scoreboardCache.dateKey === targetDate) {
    return scoreboardCache.data;
  }
  const data = await fetchJSON(`${ESPN_SCOREBOARD_URL}?dates=${targetDate}`);
  scoreboardCache.data = data;
  scoreboardCache.expiresAt = Date.now() + SCOREBOARD_TTL_MS;
  scoreboardCache.dateKey = targetDate;
  scoreboardCache.contexts = buildTeamContexts(data);
  scoreboardCache.matchupNews = buildMatchupNews(scoreboardCache.contexts);
  return data;
}

function computeVegasContext(teamAbbrev, scoreboard) {
  const normalized = teamAbbrev.toUpperCase();
  if (scoreboardCache.contexts[normalized]) {
    return scoreboardCache.contexts[normalized];
  }
  const contexts = buildTeamContexts(scoreboard);
  if (Object.keys(contexts).length) {
    scoreboardCache.contexts = contexts;
    scoreboardCache.matchupNews = buildMatchupNews(contexts);
  }
  return contexts[normalized] || null;
}

async function getSleeperPlayers() {
  if (sleeperCache.data && sleeperCache.expiresAt > Date.now()) {
    return sleeperCache;
  }

  const raw = await fetchJSON(SLEEPER_PLAYERS_URL);
  const list = [];
  const map = {};

  for (const [id, player] of Object.entries(raw)) {
    const fullName = player.full_name || `${player.first_name || ""} ${player.last_name || ""}`.trim();
    const team = player.team ? player.team.toUpperCase() : null;
    const rawPosition = player.position || "";
    const position = rawPosition.toUpperCase();
    if (!fullName || !team || !position || !FANTASY_POSITIONS.has(position)) continue;
    const trimmed = {
      id,
      fullName,
      team,
      position,
      searchKey: fullName.toLowerCase(),
      lastNameKey: (player.last_name || "").toLowerCase()
    };
    list.push(trimmed);
    map[id] = trimmed;
  }

  sleeperCache.data = list;
  sleeperCache.map = map;
  sleeperCache.expiresAt = Date.now() + SLEEPER_TTL_MS;
  return sleeperCache;
}

async function fetchEspnNews() {
  const data = await fetchJSON("https://site.api.espn.com/apis/site/v2/sports/football/nfl/news");
  const articles = data?.articles || [];
  const flattened = [];
  for (const article of articles) {
    const headline = article.headline || article.title || "";
    if (!headline) continue;
    const created = article.published ?? article.lastModified ?? article.updated ?? null;
    const description = article.description || article.summary || article.story || "";
    const teams =
      article?.team?.abbreviation
        ? [article.team.abbreviation]
        : Array.isArray(article.teams)
        ? article.teams.map((t) => t.abbreviation).filter(Boolean)
        : [];
    if (!teams.length) {
      flattened.push({
        id: article.id || `${headline}-${created || Date.now()}`,
        headline,
        analysis: description,
        team: null,
        player: null,
        createdAt: created,
        source: "ESPN"
      });
      continue;
    }
    teams.forEach((abbr) =>
      flattened.push({
        id: `${article.id || headline}-${abbr}`,
        headline,
        analysis: description,
        team: abbr.toUpperCase(),
        player: null,
        createdAt: created,
        source: "ESPN"
      })
    );
  }
  return flattened;
}

async function getFantasyNews() {
  if (newsCache.data && newsCache.expiresAt > Date.now()) {
    return newsCache.data;
  }

  try {
    const espnNews = await fetchEspnNews();
    if (espnNews.length) {
      newsCache.data = espnNews;
      newsCache.expiresAt = Date.now() + NEWS_TTL_MS;
      return espnNews;
    }
    throw new Error("No ESPN news available");
  } catch (err) {
    console.warn("ESPN news fetch failed:", err.message);
  }

  try {
    const resp = await fetchJSON(FANTASYLIFE_NEWS_URL);
    const items = resp?.data || resp?.news || [];
    const sanitized = items.map((item) => ({
      id: item.id || item.newsId,
      headline: item.title || item.headline || "",
      analysis: item.body || item.analysis || "",
      team: item.teamAbbr || item.team || null,
      player: item.playerName || item.player || null,
      createdAt: item.created || item.updated || item.timestamp || null,
      source: item.source || "FantasyLife"
    }));
    newsCache.data = sanitized;
    newsCache.expiresAt = Date.now() + NEWS_TTL_MS;
    return sanitized;
  } catch (err) {
    console.warn("FantasyLife news fetch failed:", err.message);
  }

  newsCache.data = sampleNews;
  newsCache.expiresAt = Date.now() + NEWS_TTL_MS;
  return sampleNews;
}

function rankPlayerMatches(players, query, limit = 5) {
  const needle = query.toLowerCase();
  const parts = needle.split(/\s+/).filter(Boolean);
  const scored = players
    .map((player) => {
      let score = 0;
      if (player.searchKey === needle) score = 5;
      else if (player.searchKey.startsWith(needle)) score = 4;
      else if (player.lastNameKey.startsWith(needle)) score = 3;
      else if (player.searchKey.includes(needle)) score = 2;
      else if (parts.some((part) => part && player.searchKey.includes(part))) score = 1;
      return { player, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored;
}

function pickBestPlayerMatch(players, query) {
  const matches = rankPlayerMatches(players, query, 1);
  return matches.length ? matches[0].player : null;
}

app.get("/", (req, res) => {
  res.send("Fantasy Waiver Tool server is running.");
});

app.get("/api/defense-rankings", async (req, res) => {
  await refreshDefenseRanks();
  res.json({ data: defenseRanks, source: "cache" });
});

app.get("/api/weather", async (req, res) => {
  const team = String(req.query.team || "").toUpperCase();
  if (!team) {
    return res.status(400).json({ error: "team query parameter is required" });
  }
  if (!stadiumLocations[team]) {
    return res.status(404).json({ error: "Unknown team abbreviation" });
  }

  try {
    const weather = await lookupWeather(team);
    res.json({ team, weather });
  } catch (err) {
    console.error(`Error fetching weather for ${team}:`, err);
    res.status(500).json({ error: "Failed to fetch weather" });
  }
});

app.get("/api/vegas-context", async (req, res) => {
  const team = String(req.query.team || "").toUpperCase();
  if (!team) {
    return res.status(400).json({ error: "team query parameter is required" });
  }

  try {
    const scoreboard = await getScoreboard();
    const context = computeVegasContext(team, scoreboard);
    if (!context) {
      return res.status(404).json({ error: "No upcoming game found for that team." });
    }
    res.json(context);
  } catch (err) {
    console.error(`Error fetching vegas context for ${team}:`, err);
    res.status(500).json({ error: "Failed to fetch vegas context" });
  }
});

app.get("/api/player-lookup", async (req, res) => {
  const name = String(req.query.name || "").trim();
  if (!name) {
    return res.status(400).json({ error: "name query parameter is required" });
  }

  try {
    const { data: players } = await getSleeperPlayers();
    const bestMatch = pickBestPlayerMatch(players, name);
    if (!bestMatch) {
      return res.json({ match: null });
    }
    await ensureScoreboardContexts();
    const opponent = getTeamOpponent(bestMatch.team);

    res.json({
      match: {
        id: bestMatch.id,
        fullName: bestMatch.fullName,
        team: bestMatch.team,
        position: bestMatch.position,
        opponent: opponent || null
      }
    });
  } catch (err) {
    console.error(`Player lookup failed for ${name}:`, err);
    res.status(500).json({ error: "Player lookup failed" });
  }
});

app.get("/api/player-search", async (req, res) => {
  const query = String(req.query.query || "").trim();
  const limit = Math.min(Number(req.query.limit) || 6, 12);
  if (!query) {
    return res.json({ data: [] });
  }

  try {
    const { data: players } = await getSleeperPlayers();
    const matches = rankPlayerMatches(players, query, limit).map((entry) => ({
      id: entry.player.id,
      fullName: entry.player.fullName,
      team: entry.player.team,
      position: entry.player.position,
      score: entry.score
    }));
    await ensureScoreboardContexts();
    const withOpponents = matches.map((match) => ({
      ...match,
      opponent: getTeamOpponent(match.team) || null
    }));
    res.json({ data: withOpponents });
  } catch (err) {
    console.error("Player search failed:", err);
    res.status(500).json({ error: "Player search failed" });
  }
});

app.get("/api/sleeper/trending", async (req, res) => {
  const type = req.query.type === "drops" ? "drops" : "adds";
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const lookback = Math.min(Number(req.query.hours) || 24, 72);

  try {
    const url = `https://api.sleeper.app/v1/players/nfl/trending/${type}?lookback_hours=${lookback}&limit=${limit}`;
    const trending = await fetchJSON(url);
    const { map } = await getSleeperPlayers();
    await ensureScoreboardContexts();
    const enriched = trending
      .map((entry) => {
        const base = map[entry.player_id];
        if (!base) return null;
        return {
          playerId: entry.player_id,
          count: entry.count,
          type,
          ...base,
          opponent: getTeamOpponent(base.team) || null
        };
      })
      .filter((entry) => entry?.fullName && FANTASY_POSITIONS.has(entry.position));
    res.json({ data: enriched });
  } catch (err) {
    console.error("Sleeper trending fetch failed:", err);
    res.status(500).json({ error: "Failed to fetch trending players" });
  }
});

app.get("/api/news", async (req, res) => {
  const team = String(req.query.team || "").toUpperCase();
  const limit = Math.min(Number(req.query.limit) || 5, 20);

  try {
    await getScoreboard();
    const matchupEntries = (scoreboardCache.matchupNews || []).filter((item) =>
      team ? item.team === team : true
    );
    if (matchupEntries.length) {
      return res.json({ data: matchupEntries.slice(0, limit) });
    }
  } catch (err) {
    console.warn("Matchup news unavailable:", err.message);
  }

  try {
    const news = await getFantasyNews();
    const filtered = news.filter((item) => (!team ? true : item.team === team)).slice(0, limit);
    if (!filtered.length) {
      throw new Error("No remote news found");
    }
    res.json({ data: filtered });
  } catch (err) {
    console.warn("FantasyLife news fetch failed, using bundled notes:", err.message);
    let fallback = sampleNews.filter((item) => (!team ? true : item.team === team)).slice(0, limit);
    if (!fallback.length && team) {
      fallback = sampleNews.slice(0, limit);
    }
    res.json({ data: fallback });
  }
});

app.post("/api/admin/refresh-defense", async (req, res) => {
  const ok = await refreshDefenseRanks(true);
  if (!ok) {
    return res.status(500).json({ error: "Unable to refresh defense rankings" });
  }
  res.json({ data: defenseRanks, source: "forced-refresh" });
});

app.get("/api/test", (req, res) => {
  res.json({ message: "Server connection successful!" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  refreshDefenseRanks(true);
  ensureScoreboardContexts();
  setInterval(() => refreshDefenseRanks(), DEFENSE_REFRESH_MS).unref();
  setInterval(() => getScoreboard().catch((err) => console.warn("Scoreboard refresh failed:", err.message)), SCOREBOARD_TTL_MS).unref();
});
