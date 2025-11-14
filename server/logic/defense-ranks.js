const DEFAULT_DEFENSE_RANK = 16;
const DEFAULT_WEIGHTS = {
  QB: 0.2,
  RB: 0.4,
  WR: 0.3,
  TE: 0.1
};
const POSITION_KEYS = ["QB", "RB", "WR", "TE"];

const TEAM_KEYS = [
  "teamAbbr",
  "team_abbr",
  "team",
  "abbr",
  "teamAbbreviation",
  "team_abbreviation",
  "teamAbbrev",
  "team_abbrev",
  "teamShort",
  "shortName"
];

const RANK_KEYS = {
  overall: ["overall", "overallRank", "overall_rank", "rank", "rankOverall", "rank_overall", "ovr"],
  qb: ["QB", "qb", "qbRank", "rankQB", "rank_qb"],
  rb: ["RB", "rb", "rbRank", "rankRB", "rank_rb"],
  wr: ["WR", "wr", "wrRank", "rankWR", "rank_wr"],
  te: ["TE", "te", "teRank", "rankTE", "rank_te"]
};

const ARRAY_CANDIDATE_KEYS = ["data", "results", "ranks", "rankings", "list"];

const parseWeight = (value, fallback) => {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
};

const resolveDefenseWeights = () => {
  const envWeights = {
    QB: parseWeight(process.env.DEFENSE_WEIGHT_QB, DEFAULT_WEIGHTS.QB),
    RB: parseWeight(process.env.DEFENSE_WEIGHT_RB, DEFAULT_WEIGHTS.RB),
    WR: parseWeight(process.env.DEFENSE_WEIGHT_WR, DEFAULT_WEIGHTS.WR),
    TE: parseWeight(process.env.DEFENSE_WEIGHT_TE, DEFAULT_WEIGHTS.TE)
  };
  const total = POSITION_KEYS.reduce((sum, key) => sum + envWeights[key], 0);
  if (total <= 0) {
    return { ...DEFAULT_WEIGHTS };
  }
  const normalized = {};
  POSITION_KEYS.forEach((key) => {
    normalized[key] = envWeights[key] / total;
  });
  return normalized;
};

const cachedWeights = resolveDefenseWeights();

function weightedOverall(ranks) {
  let totalWeight = 0;
  let sum = 0;
  POSITION_KEYS.forEach((key) => {
    const value = ranks[key];
    if (Number.isFinite(value)) {
      sum += value * cachedWeights[key];
      totalWeight += cachedWeights[key];
    }
  });
  if (totalWeight > 0) {
    return sum / totalWeight;
  }
  return DEFAULT_DEFENSE_RANK;
}

function coerceArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  for (const key of ARRAY_CANDIDATE_KEYS) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current.trim());
  return result;
}

export function parseDefenseCsv(text) {
  if (!text?.trim()) return [];
  const rows = text.trim().split(/\r?\n/).filter(Boolean);
  if (!rows.length) return [];
  const headers = splitCsvLine(rows.shift()).map((header) => header.trim());
  return rows.map((line) => {
    const values = splitCsvLine(line);
    const entry = {};
    headers.forEach((header, index) => {
      const key = header;
      entry[key] = values[index] ?? "";
      const lower = key.toLowerCase();
      if (!(lower in entry)) {
        entry[lower] = entry[key];
      }
    });
    return entry;
  });
}

function coercePayload(raw) {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      return coercePayload(JSON.parse(trimmed));
    } catch {
      return parseDefenseCsv(trimmed);
    }
  }
  return raw;
}

function pickValue(obj, possibleKeys) {
  if (!obj) return null;
  const lowerMap = new Map();
  Object.keys(obj).forEach((key) => {
    lowerMap.set(key.toLowerCase(), obj[key]);
  });
  for (const key of possibleKeys) {
    if (key in obj) {
      const value = obj[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    const lower = key.toLowerCase();
    if (lowerMap.has(lower)) {
      const value = lowerMap.get(lower);
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return null;
}

function pickTeamAbbr(item) {
  const direct = pickValue(item, TEAM_KEYS);
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (direct && typeof direct === "object") {
    const nested = pickValue(direct, ["abbr", "abbreviation", "team", "teamAbbr", "team_abbr"]);
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  if (item?.team && typeof item.team === "object") {
    const nested = pickValue(item.team, ["abbr", "abbreviation", "teamAbbr", "team_abbr"]);
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return null;
}

function pickRankNumber(item, keys, fallback) {
  for (const key of keys) {
    const value = item?.[key];
    const num = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
    if (Number.isFinite(num)) return num;
  }
  return fallback;
}

export function normalizeDefenseRanks(rawPayload) {
  const payload = coercePayload(rawPayload);
  const rows = coerceArray(payload);
  return rows
    .map((item) => {
      const teamAbbr = pickTeamAbbr(item);
      if (!teamAbbr) return null;
      const qb = pickRankNumber(item, RANK_KEYS.qb, DEFAULT_DEFENSE_RANK);
      const rb = pickRankNumber(item, RANK_KEYS.rb, DEFAULT_DEFENSE_RANK);
      const wr = pickRankNumber(item, RANK_KEYS.wr, DEFAULT_DEFENSE_RANK);
      const te = pickRankNumber(item, RANK_KEYS.te, DEFAULT_DEFENSE_RANK);
      const rawOverall = pickRankNumber(item, RANK_KEYS.overall, NaN);
      const overall = Number.isFinite(rawOverall) ? rawOverall : weightedOverall({ QB: qb, RB: rb, WR: wr, TE: te });
      return {
        teamAbbr: teamAbbr.toUpperCase(),
        overall,
        QB: qb,
        RB: rb,
        WR: wr,
        TE: te
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.overall - b.overall);
}

export function buildDefenseRanksFromRaw(rawPayload) {
  return normalizeDefenseRanks(rawPayload);
}
