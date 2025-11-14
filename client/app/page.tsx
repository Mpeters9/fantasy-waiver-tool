"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveAs } from "file-saver";
import { stadiumLocations } from "../src/lib/stadium";
import { fetchVegasContext, type VegasContext } from "../src/lib/odds";

type Player = {
  id: string;
  name: string;
  position: string;
  team: string;
  opponent: string;
  impliedTotal?: number;
  overUnder?: number | null;
  spread?: number | null;
  weather?: string;
  defRank?: number;
  stats: Record<string, number>;
  score?: number;
};

type ViewMode = "WEEK" | "ROS";

type DefRankStatus = "idle" | "loading" | "ready" | "error";

type DefenseRankEntry = {
  overall: number;
  QB: number;
  RB: number;
  WR: number;
  TE: number;
};

const STORAGE_KEY = "fantasy-waiver-tool-players";
const API_BASE_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:5000";
const DEFAULT_TEAM_TOTAL = 22;
const DEFAULT_DEF_RANK = 16;
const createPlayerId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// --- predictive stat fields per position ---
const PREDICTIVE_FIELDS: Record<string, string[]> = {
  QB: [
    "EPA per Play (Last 3)",
    "Completion % (Last 3)",
    "Pressure Rate Faced (Last 3)",
    "Play Action % (Last 3)",
    "Yards per Attempt (Last 3)",
    "Fantasy PPG (Last 3)"
  ],
  RB: [
    "Snap Share (Last 3)",
    "Routes (Last 3)",
    "Targets (Last 3)",
    "TPRR (Targets per Route Run)",
    "Yards per Route Run (Last 3)",
    "Red Zone Touches (Last 3)",
    "Fantasy PPG (Last 3)"
  ],
  WR: [
    "Routes (Last 3)",
    "TPRR (Targets per Route Run)",
    "Targets (Last 3)",
    "Catchable Targets (Last 3)",
    "ADOT (Last 3)",
    "Air Yards (Last 3)",
    "EZ Targets (Last 3)",
    "3rd/4th Down Targets (Last 3)",
    "Play-Action Targets (Last 3)",
    "Unrealized Air Yards (Last 3)",
    "PPR (Last 3)",
    "PPR Rank (Last 3)"
  ],
  TE: [
    "Routes (Last 3)",
    "TPRR (Targets per Route Run)",
    "Targets (Last 3)",
    "Catchable Targets (Last 3)",
    "Red Zone Targets (Last 3)",
    "3rd/4th Down Targets (Last 3)",
    "PPR (Last 3)",
    "PPR Rank (Last 3)"
  ]
};



type ScoreBucket = "opportunity" | "efficiency" | "leverage" | "production";

type StatRule = {
  keywords: string[];
  bucket: ScoreBucket;
  weight: number;
  normalize?: "percent" | "routes" | "yards";
  transform?: (value: number) => number;
};

const STAT_RULES: StatRule[] = [
  { keywords: ["targets per route run", "tprr"], bucket: "efficiency", weight: 55, normalize: "percent" },
  { keywords: ["yards per route run"], bucket: "efficiency", weight: 8, normalize: "yards" },
  { keywords: ["epa per play"], bucket: "efficiency", weight: 2.5 },
  { keywords: ["completion %"], bucket: "efficiency", weight: 1.2, normalize: "percent" },
  {
    keywords: ["pressure rate"],
    bucket: "efficiency",
    weight: 2,
    normalize: "percent",
    transform: (val) => 1 - val
  },
  { keywords: ["yards per attempt"], bucket: "efficiency", weight: 1.8 },
  { keywords: ["routes"], bucket: "opportunity", weight: 0.12, normalize: "routes" },
  { keywords: ["snap share"], bucket: "opportunity", weight: 0.45, normalize: "percent" },
  { keywords: ["targets (last"], bucket: "opportunity", weight: 0.35 },
  { keywords: ["catchable targets"], bucket: "efficiency", weight: 0.25 },
  { keywords: ["adot"], bucket: "efficiency", weight: 0.18 },
  { keywords: ["air yards"], bucket: "efficiency", weight: 0.06, normalize: "yards" },
  { keywords: ["unrealized air yards"], bucket: "opportunity", weight: 0.04, normalize: "yards" },
  { keywords: ["ez targets"], bucket: "leverage", weight: 0.9 },
  { keywords: ["red zone"], bucket: "leverage", weight: 0.7 },
  { keywords: ["3rd/4th"], bucket: "leverage", weight: 0.6 },
  { keywords: ["play-action"], bucket: "leverage", weight: 0.5 },
  { keywords: ["fantasy ppg"], bucket: "production", weight: 2.5 },
  { keywords: ["ppr (last"], bucket: "production", weight: 2.2 },
  {
    keywords: ["ppr rank"],
    bucket: "production",
    weight: 18,
    transform: (val) => Math.max(0, 1 - val / 100)
  }
];

const POSITION_MULTIPLIERS: Record<string, number> = {
  QB: 1.08,
  RB: 1.04,
  WR: 1,
  TE: 0.92
};

const BUCKET_WEIGHTS: Record<ScoreBucket, number> = {
  opportunity: 28,
  efficiency: 30,
  leverage: 20,
  production: 26
};

const BUCKET_NORMALIZERS: Record<ScoreBucket, number> = {
  opportunity: 120,
  efficiency: 140,
  leverage: 80,
  production: 110
};

const POSITION_DEF_KEYS: Record<string, keyof DefenseRankEntry> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE"
};

const STAT_HINT_PATTERNS: Array<{ regex: RegExp; hint: string }> = [
  { regex: /%|Rate|TPRR|Share|Completion/i, hint: "Enter as a percentage (e.g., 28 for 28%)." },
  { regex: /EPA|PPG|PPR|Yards per Attempt|Yards per Route Run|ADOT/i, hint: "Enter as an average/decimal value." },
  { regex: /Rank/i, hint: "Enter the numerical rank (lower = better)." },
  {
    regex: /Routes|Targets|Touches|Snap|EZ|Red Zone|3rd|Play-Action|Pressure|Catchable|Air Yards|Unrealized/i,
    hint: "Enter the raw count from your sample window."
  }
];

const getStatHint = (stat: string) => {
  const match = STAT_HINT_PATTERNS.find((entry) => entry.regex.test(stat));
  return match ? match.hint : "Use your latest projection for this stat.";
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const normalizeStatValue = (value: number, mode?: StatRule["normalize"]) => {
  if (!Number.isFinite(value)) return 0;
  if (mode === "percent") {
    return value > 1 ? value / 100 : value;
  }
  if (mode === "routes") {
    return value / 10;
  }
  if (mode === "yards") {
    return value / 10;
  }
  return value;
};

const extractRainChance = (weather?: string) => {
  const match = weather?.match(/(\d+)\s*%/);
  return match ? Number(match[1]) : null;
};

const extractTempF = (weather?: string) => {
  const match = weather?.match(/(-?\d+)\s*F/i);
  return match ? Number(match[1]) : null;
};

const formatSpreadValue = (spread?: number | null) => {
  if (typeof spread !== "number") return "N/A";
  if (spread === 0) return "EVEN";
  return `${spread > 0 ? "+" : ""}${spread.toFixed(1)}`;
};

const formatOverUnder = (value?: number | null) => (typeof value === "number" ? value.toFixed(1) : "N/A");

const formatKickoffTime = (value?: string | null) => {
  if (!value) return "TBD";
  const date = new Date(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
};

const formatNewsTimestamp = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

const getDefenseTier = (rank?: number) => {
  if (typeof rank !== "number") return { label: "", className: "" };
  if (rank <= 8) return { label: "Tough", className: "bg-red-500/10 text-red-200" };
  if (rank <= 16) return { label: "Neutral", className: "bg-yellow-500/10 text-yellow-200" };
  return { label: "Soft", className: "bg-green-500/10 text-green-200" };
};

const numberFromInput = (value: string): number | undefined =>
  value === "" ? undefined : Number(value);

export default function Home() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [form, setForm] = useState<Partial<Player>>({ stats: {} });
  const [defRanks, setDefRanks] = useState<Record<string, DefenseRankEntry>>({});
  const [viewMode, setViewMode] = useState<ViewMode>("WEEK");
  const [defRankStatus, setDefRankStatus] = useState<DefRankStatus>("idle");
  const [persistHydrated, setPersistHydrated] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [autoFillNote, setAutoFillNote] = useState<string | null>(null);
  const [latestVegasContext, setLatestVegasContext] = useState<VegasContext | null>(null);
  const [playerLookupNote, setPlayerLookupNote] = useState<string | null>(null);
  const [playerSuggestions, setPlayerSuggestions] = useState<
    Array<{ id: string; fullName: string; team: string; position: string; opponent?: string | null }>
  >([]);
  const [teamNews, setTeamNews] = useState<
    Array<{ id: string; headline: string; analysis: string; createdAt: string | null }>
  >([]);
  const [trendingAdds, setTrendingAdds] = useState<
    Array<{ fullName: string; team: string; position: string; count: number }>
  >([]);
  const suppressLookupRef = useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // --- hydrate players from localStorage ---
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: Player[] = JSON.parse(stored).map((player: Player, idx: number) => ({
          ...player,
          id: player.id ?? `${player.name}-${idx}-${Date.now()}`
        }));
        setPlayers(parsed);
      }
    } catch (err) {
      console.warn("Failed to load saved players", err);
    } finally {
      setPersistHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!persistHydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(players));
  }, [players, persistHydrated]);

  useEffect(() => {
    const name = form.name?.trim() || "";
    if (suppressLookupRef.current) {
      suppressLookupRef.current = false;
      return;
    }
    if (name.length < 2) {
      setPlayerLookupNote(null);
      setPlayerSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/player-search?query=${encodeURIComponent(name)}&limit=6`,
          { signal: controller.signal }
        );
        if (!res.ok) return;
        const json = await res.json();
        const suggestions = (json?.data || []) as Array<{
          id: string;
          fullName: string;
          team: string;
          position: string;
          opponent?: string | null;
        }>;
        setPlayerSuggestions(suggestions);
        if (suggestions.length) {
          const top = suggestions[0];
          setPlayerLookupNote(`Detected ${top.fullName} (${top.position} - ${top.team}).`);
          setForm((prev) => {
            const next = { ...prev };
            if (!prev.position && top.position) next.position = top.position;
            if (!prev.team && top.team) next.team = top.team;
            return next;
          });
        } else {
          setPlayerLookupNote("No Sleeper match found for that name.");
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.warn("Player search failed", err);
        }
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [form.name]);

  useEffect(() => {
    const team = form.team?.trim().toUpperCase();
    if (!team || team.length < 2) {
      setTeamNews([]);
      return;
    }

    const controller = new AbortController();
    async function loadNews() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/news?team=${team}&limit=3`, { signal: controller.signal });
        if (!res.ok) return;
        const json = await res.json();
        setTeamNews(json?.data || []);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.warn("News fetch failed", err);
        }
      }
    }

    loadNews();
    return () => controller.abort();
  }, [form.team]);

  useEffect(() => {
    let cancelled = false;
    async function loadTrending() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/sleeper/trending?type=adds&limit=8`);
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) {
          setTrendingAdds(
            (json?.data || []).map((entry: any) => ({
              fullName: entry.fullName,
              team: entry.team,
              position: entry.position,
              count: entry.count
            }))
          );
        }
      } catch (err) {
        console.warn("Trending fetch failed", err);
      }
    }
    loadTrending();
    return () => {
      cancelled = true;
    };
  }, []);
  // --- load defense ranks via proxy ---
  useEffect(() => {
    const controller = new AbortController();
    async function loadDefRanks() {
      setDefRankStatus("loading");
      try {
        const res = await fetch(`${API_BASE_URL}/api/defense-rankings`, {
          signal: controller.signal
        });
        if (!res.ok) throw new Error("Failed to load DEF ranks");
        const json = await res.json();
        const ranks: Record<string, DefenseRankEntry> = {};
        json.data?.forEach((d: any) => {
          if (!d?.teamAbbr) return;
          ranks[d.teamAbbr] = {
            overall: Number(d.overall ?? d.rank ?? DEFAULT_DEF_RANK),
            QB: Number(d.QB ?? d.qb ?? d.overall ?? d.rank ?? DEFAULT_DEF_RANK),
            RB: Number(d.RB ?? d.rb ?? d.overall ?? d.rank ?? DEFAULT_DEF_RANK),
            WR: Number(d.WR ?? d.wr ?? d.overall ?? d.rank ?? DEFAULT_DEF_RANK),
            TE: Number(d.TE ?? d.te ?? d.overall ?? d.rank ?? DEFAULT_DEF_RANK)
          };
        });
        if (!Object.keys(ranks).length) throw new Error("No defense ranks returned");
        setDefRanks(ranks);
        setDefRankStatus("ready");
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        console.warn("DEF ranks unavailable, using defaults", err);
        setDefRankStatus("error");
      }
    }

    loadDefRanks();
    return () => controller.abort();
  }, []);

  const calcScore = useCallback(
    (p: Player): number => {
      const st = p.stats || {};
      const buckets: Record<ScoreBucket, number> = {
        opportunity: 0,
        efficiency: 0,
        leverage: 0,
        production: 0
      };

      Object.entries(st).forEach(([key, rawVal]) => {
        const val = Number(rawVal);
        if (!Number.isFinite(val)) return;
        const lowerKey = key.toLowerCase();

        for (const rule of STAT_RULES) {
          if (rule.keywords.some((keyword) => lowerKey.includes(keyword))) {
            const normalized = normalizeStatValue(val, rule.normalize);
            const derived = rule.transform ? rule.transform(normalized) : normalized;
            buckets[rule.bucket] += derived * rule.weight;
            break;
          }
        }
      });

      let score = (Object.keys(buckets) as ScoreBucket[]).reduce((total, bucketKey) => {
        const raw = buckets[bucketKey];
        const normalized = clamp(raw / BUCKET_NORMALIZERS[bucketKey], 0, 1);
        return total + normalized * BUCKET_WEIGHTS[bucketKey];
      }, 0);

      score *= POSITION_MULTIPLIERS[p.position] ?? 1;

      if (typeof p.impliedTotal === "number") {
        const delta = clamp((p.impliedTotal - DEFAULT_TEAM_TOTAL) / 14, -1, 1);
        score += delta * 8;
      }

      if (typeof p.overUnder === "number") {
        const delta = clamp((p.overUnder - 45) / 15, -1, 1);
        score += delta * 6;
      }

      if (typeof p.spread === "number") {
        const favBonus = clamp(-p.spread / 10, -1, 1);
        score += favBonus * 5;
      }

      if (typeof p.defRank === "number") {
        const delta = clamp((DEFAULT_DEF_RANK - p.defRank) / 10, -1, 1);
        score += delta * 6;
      }

      const rain = extractRainChance(p.weather);
      if (typeof rain === "number") {
        const penalty = rain > 70 ? 6 : rain > 40 ? 3 : 0;
        score -= penalty;
      }

      const tempF = extractTempF(p.weather);
      if (typeof tempF === "number") {
        if (tempF < 32) score -= 4;
        else if (tempF > 90) score -= 2;
      }

      if (viewMode === "ROS") {
        score = score * 0.8 + clamp(buckets.production / 80, 0, 1) * 20;
      }

      if (!Number.isFinite(score)) return 0;
      return Number(clamp(score, 0, 100).toFixed(1));
    },
    [viewMode]
  );

  // --- recalc scores when view changes ---
  useEffect(() => {
    setPlayers((prev) => prev.map((p) => ({ ...p, score: calcScore(p) })));
  }, [calcScore]);


  const formatWeatherSummary = (tempC: number, rain: number) => {
    const tempF = Math.round((tempC * 9) / 5 + 32);
    return `${tempF}F / ${Math.round(rain)}% rain`;
  };

  async function fetchDirectWeather(team: string) {
    const loc = stadiumLocations[team];
    if (!loc) return "N/A";

    try {
      const params = new URLSearchParams({
        latitude: String(loc.lat),
        longitude: String(loc.lon),
        hourly: "temperature_2m,precipitation_probability",
        forecast_days: "1",
        timezone: "auto"
      });
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
      if (!res.ok) throw new Error("OpenMeteo unavailable");
      const json = await res.json();
      const temps: number[] = json?.hourly?.temperature_2m ?? [];
      const precip: number[] = json?.hourly?.precipitation_probability ?? [];
      const sample = (series: number[]) =>
        typeof series?.[12] === "number" ? series[12] : typeof series?.[0] === "number" ? series[0] : null;
      const tempC = sample(temps);
      const rain = sample(precip);
      if (tempC === null || rain === null) return "N/A";
      return formatWeatherSummary(tempC, rain);
    } catch {
      return "N/A";
    }
  }

  // --- weather fetch ---
  async function fetchWeather(team: string): Promise<string> {
    const normalized = team.toUpperCase();
    if (!stadiumLocations[normalized]) return "N/A";

    try {
      const res = await fetch(`${API_BASE_URL}/api/weather?team=${normalized}`);
      if (res.ok) {
        const json = await res.json();
        if (json?.weather && json.weather !== "N/A") {
          return json.weather as string;
        }
      }
      throw new Error("Proxy weather unavailable");
    } catch {
      return fetchDirectWeather(normalized);
    }
  }
  const addPlayer = async () => {
    if (!form.name?.trim() || !form.position || !form.team?.trim() || !form.opponent?.trim()) {
      setFormError("Name, position, team, and opponent are required.");
      return;
    }
    if (defRankStatus !== "ready") {
      setFormError("Defense rankings are still syncing. Please wait a moment and try again.");
      return;
    }

    setFormError(null);
    setIsAdding(true);
    setAutoFillNote(null);

    const team = form.team.trim().toUpperCase();
    const opponent = form.opponent.trim().toUpperCase();

    const isEditing = Boolean(editingId);

    try {
      const [weather, vegasData] = await Promise.all([fetchWeather(team), fetchVegasContext(team)]);

      const impliedFromOdds = vegasData?.impliedTotal ?? null;
      const opponentImplied = vegasData?.opponentImpliedTotal ?? null;
      const impliedTotal = impliedFromOdds ?? DEFAULT_TEAM_TOTAL;
      const overUnder = typeof vegasData?.overUnder === "number" ? vegasData.overUnder : null;
      const spread = typeof vegasData?.spread === "number" ? vegasData.spread : null;

      if (!form.stats || Object.keys(form.stats).length === 0) {
        setFormError("Log at least one predictive stat for the player.");
        setIsAdding(false);
        return;
      }

      const defRank = getDefenseRankForPosition(opponent, form.position);
      if (!Number.isFinite(defRank)) {
        setFormError("Defense ranking for that opponent is unavailable. Try again soon.");
        setIsAdding(false);
        return;
      }
      const playerId = isEditing ? editingId! : createPlayerId();
      const newPlayer: Player = {
        id: playerId,
        name: form.name.trim(),
        position: form.position,
        team,
        opponent,
        weather,
        impliedTotal,
        overUnder,
        spread,
        defRank,
        stats: form.stats as Record<string, number>
      };

      newPlayer.score = calcScore(newPlayer);
      setPlayers((prev) =>
        isEditing ? prev.map((p) => (p.id === playerId ? newPlayer : p)) : [...prev, newPlayer]
      );
      setForm({ stats: {} });
      setEditingId(null);

      if (vegasData) {
        setLatestVegasContext({
          ...vegasData,
          opponent: form.opponent?.trim().toUpperCase() || vegasData.opponent
        });
      } else {
        setLatestVegasContext(null);
      }

      const contextBits: string[] = [];
      if (impliedFromOdds !== null) {
        contextBits.push(`${team} implied ${impliedFromOdds.toFixed(1)}`);
      }
      if (opponentImplied !== null) {
        const opponentLabel = form.opponent?.trim().toUpperCase() || vegasData?.opponent || "OPP";
        contextBits.push(`${opponentLabel} implied ${opponentImplied.toFixed(1)}`);
      }
      if (typeof overUnder === "number") {
        contextBits.push(`O/U ${formatOverUnder(overUnder)}`);
      }
      if (typeof spread === "number") {
        contextBits.push(`${team} ${formatSpreadValue(spread)}`);
      }

      if (contextBits.length) {
        const opponentLabel = form.opponent?.trim().toUpperCase() || vegasData?.opponent || "OPP";
        setAutoFillNote(`Vegas context vs ${opponentLabel}: ${contextBits.join(" | ")}`);
      } else if (impliedFromOdds === null) {
        setAutoFillNote("Could not auto-fill Vegas context -- please review manually.");
      } else {
        setAutoFillNote(null);
      }
    } catch (err) {
      console.error("Failed to add player", err);
      setFormError("Unable to fetch weather or Vegas data. Please try again.");
    } finally {
      setIsAdding(false);
    }
  };

  const exportCSV = () => {
    const rows = [
      ["Name", "Pos", "Team", "Opp", "Weather", "Implied", "O/U", "Spread", "DEF", "Score"],
      ...players.map((p) => [
        p.name,
        p.position,
        p.team,
        p.opponent,
        p.weather,
        p.impliedTotal,
        formatOverUnder(p.overUnder),
        formatSpreadValue(p.spread),
        p.defRank,
        p.score
      ])
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    saveAs(blob, `waiver_predictions_${viewMode}.csv`);
  };

  const removePlayer = (id: string) => setPlayers((prev) => prev.filter((p) => p.id !== id));
  const clearPlayers = () => setPlayers([]);

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => (b.score || 0) - (a.score || 0)),
    [players]
  );
  const highlightSet = useMemo(() => new Set(sortedPlayers.slice(0, 3).map((p) => p.id)), [sortedPlayers]);

  const averageScore = useMemo(() => {
    if (!players.length) return 0;
    const total = players.reduce((sum, p) => sum + (p.score || 0), 0);
    return Number((total / players.length).toFixed(2));
  }, [players]);

  const positionLeaders = useMemo(() => {
    const leaders: Record<string, Player> = {};
    sortedPlayers.forEach((player) => {
      if (!leaders[player.position]) {
        leaders[player.position] = player;
      }
    });
    return Object.values(leaders);
  }, [sortedPlayers]);

  const getDefenseRankForPosition = useCallback(
    (team: string, position?: string | null) => {
      const entry = defRanks[team];
      if (!entry) return DEFAULT_DEF_RANK;
      const key = position ? POSITION_DEF_KEYS[position.toUpperCase()] : undefined;
      if (key && typeof entry[key] === "number") {
        return entry[key];
      }
      return entry.overall ?? DEFAULT_DEF_RANK;
    },
    [defRanks]
  );

  const hasOpponent = Boolean(form.opponent?.trim());

  useEffect(() => {
    if (defRankStatus !== "ready") return;
    setPlayers((prev) =>
      prev.map((player) => {
        const nextDefRank = getDefenseRankForPosition(player.opponent, player.position);
        if (!Number.isFinite(nextDefRank) || nextDefRank === player.defRank) {
          return player;
        }
        const updated = { ...player, defRank: nextDefRank };
        updated.score = calcScore(updated);
        return updated;
      })
    );
  }, [defRankStatus, getDefenseRankForPosition, calcScore]);

  useEffect(() => {
    const team = form.team?.trim().toUpperCase();
    if (!team) {
      setLatestVegasContext(null);
      return;
    }
    let cancelled = false;
    async function loadContext() {
      try {
        const context = await fetchVegasContext(team);
        if (!context || cancelled) return;
        setLatestVegasContext(context);
        if (!hasOpponent && context.opponent) {
          setForm((prev) => ({ ...prev, opponent: context.opponent ?? prev.opponent }));
        }
      } catch (err) {
        if (!cancelled) {
          setLatestVegasContext(null);
        }
      }
    }

    loadContext();
    return () => {
      cancelled = true;
    };
  }, [form.team, hasOpponent]);

  const predictiveStats = form.position ? PREDICTIVE_FIELDS[form.position] : [];

  const updateStat = (stat: string, rawValue: string) => {
    setForm((prev) => {
      const stats = { ...(prev.stats || {}) };
      const nextValue = numberFromInput(rawValue);
      if (nextValue === undefined) {
        delete stats[stat];
      } else {
        stats[stat] = nextValue;
      }
      return { ...prev, stats };
    });
  };

  return (
    <main className="max-w-6xl mx-auto px-4 py-10 space-y-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="uppercase tracking-widest text-xs text-blue-200">Fantasy toolkit</p>
          <h1 className="text-4xl font-bold">Waiver Predictor</h1>
          <p className="text-sm text-blue-100/80">
            Blend predictive stats, Vegas implied totals, weather, and defensive matchups to rank priority adds.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-blue-100/80" htmlFor="view-mode">
            Projection window
          </label>
          <select
            id="view-mode"
            className="rounded-xl border border-white/10 bg-night-800 px-4 py-2 text-sm"
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as ViewMode)}
          >
            <option value="WEEK">This Week</option>
            <option value="ROS">Rest of Season</option>
          </select>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="glass-panel p-4">
          <p className="text-sm text-blue-100/70">Players tracked</p>
          <p className="text-4xl font-semibold">{players.length}</p>
          <p className="text-xs text-blue-100/60">Saved locally in your browser</p>
        </article>
        <article className="glass-panel p-4">
          <p className="text-sm text-blue-100/70">Average composite score</p>
          <p className="text-4xl font-semibold">{averageScore}</p>
          <p className="text-xs text-blue-100/60">Higher = stronger short-term outlook</p>
        </article>
        <article className="glass-panel p-4">
          <p className="text-sm text-blue-100/70">DEF ranks</p>
          <p className="text-2xl font-semibold capitalize">{defRankStatus === "ready" ? "Live" : defRankStatus}</p>
          <p className="text-xs text-blue-100/60">
            {defRankStatus === "error"
              ? "Falling back to league-average defenses"
              : "Powered by FantasyLife API"}
          </p>
        </article>
      </section>

      {!!trendingAdds.length && (
        <section className="glass-panel p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Sleeper trending adds (last 24h)</h3>
            <span className="text-xs uppercase tracking-widest text-blue-200">Signal boost</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {trendingAdds.map((player) => (
              <div key={`${player.fullName}-${player.team}`} className="rounded-lg border border-white/10 bg-black/20 p-3">
                <p className="text-sm font-semibold text-white">
                  {player.fullName} <span className="text-blue-200">({player.position})</span>
                </p>
                <p className="text-xs text-blue-100/80">
                  {player.team} · Adds {player.count.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="glass-panel p-6 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Add a player</h2>
            <p className="text-sm text-blue-100/80">
              Enter predictive metrics from your models or trusted sources, then let the tool weigh the context.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
              onClick={clearPlayers}
              disabled={!players.length}
            >
              Clear saved list
            </button>
            <button
              className="rounded-full bg-green-500/90 px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
              onClick={exportCSV}
              disabled={!players.length}
            >
              Download CSV
            </button>
          </div>
        </div>

        {formError && <p className="rounded-xl bg-red-500/20 px-4 py-2 text-sm text-red-200">{formError}</p>}
        {autoFillNote && <p className="rounded-xl bg-blue-500/10 px-4 py-2 text-sm text-blue-100">{autoFillNote}</p>}
        {playerLookupNote && (
          <p className="rounded-xl bg-purple-500/10 px-4 py-2 text-sm text-purple-100">{playerLookupNote}</p>
        )}
        {latestVegasContext && (
          <div className="rounded-xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-blue-100/80 space-y-1">
            <p className="text-xs uppercase tracking-widest text-blue-300">Latest Vegas snapshot</p>
            <p className="text-sm text-blue-100/90">
              {latestVegasContext.team || form.team?.trim().toUpperCase() || "TEAM"} implied{" "}
              {latestVegasContext.impliedTotal ?? "N/A"} -
              {" "}
              {latestVegasContext.opponent || form.opponent?.trim().toUpperCase() || "OPP"} implied{" "}
              {latestVegasContext.opponentImpliedTotal ?? "N/A"}
            </p>
            <p className="text-sm text-white">
              O/U {formatOverUnder(latestVegasContext.overUnder)} -{" "}
              {(latestVegasContext.team || form.team?.trim().toUpperCase() || "TEAM") +
                " " +
                formatSpreadValue(latestVegasContext.spread)}
              {latestVegasContext.opponent ? ` vs ${latestVegasContext.opponent}` : ""}
            </p>
            <p className="text-xs text-blue-200">
              Kickoff {formatKickoffTime(latestVegasContext.kickoff)}
              {latestVegasContext.venue ? ` - ${latestVegasContext.venue}` : ""}
              {latestVegasContext.broadcast ? ` - ${latestVegasContext.broadcast}` : ""}
            </p>
          </div>
        )}
        {teamNews.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-blue-100/80 space-y-2">
            <p className="text-xs uppercase tracking-widest text-blue-300">
              Latest {form.team?.trim().toUpperCase()} news
            </p>
            <ul className="space-y-1">
              {teamNews.map((item) => (
                <li key={item.id}>
                  <span className="font-semibold text-white">{item.headline}</span>
                  {item.createdAt && (
                    <span className="ml-2 text-xs text-blue-200">{formatNewsTimestamp(item.createdAt)}</span>
                  )}
                  <p className="text-xs text-blue-100/70">{item.analysis}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="relative">
            <input
              className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3"
              placeholder="Player name"
              value={form.name || ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            {playerSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 z-20 mt-1 rounded-xl border border-white/10 bg-night-800 shadow-xl">
                {playerSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm text-blue-100 hover:bg-white/10"
                    type="button"
                    onClick={() => {
                      suppressLookupRef.current = true;
                      setForm((prev) => ({
                        ...prev,
                        name: suggestion.fullName,
                        team: suggestion.team,
                        position: suggestion.position,
                        opponent:
                          prev.opponent && prev.opponent.trim().length > 0
                            ? prev.opponent
                            : suggestion.opponent || prev.opponent
                      }));
                      setPlayerSuggestions([]);
                      setPlayerLookupNote(`Using ${suggestion.fullName} (${suggestion.position} - ${suggestion.team}).`);
                    }}
                  >
                    <span className="font-semibold text-white">{suggestion.fullName}</span>
                    <span className="text-xs text-blue-200">
                      {suggestion.position} · {suggestion.team}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <select
            className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"
            value={form.position || ""}
            onChange={(e) => setForm({ ...form, position: e.target.value, stats: {} })}
          >
            <option value="">Position</option>
            {Object.keys(PREDICTIVE_FIELDS).map((pos) => (
              <option key={pos}>{pos}</option>
            ))}
          </select>
          <input
            className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"
            placeholder="Team (e.g. KC)"
            value={form.team || ""}
            onChange={(e) => setForm({ ...form, team: e.target.value })}
          />
          <input
            className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"
            placeholder="Opponent (e.g. BUF)"
            value={form.opponent || ""}
            onChange={(e) => setForm({ ...form, opponent: e.target.value })}
          />
          <div className="rounded-xl border border-dashed border-white/15 bg-black/10 px-4 py-3 text-sm text-blue-100/80">
            {defRankStatus === "ready"
              ? "Defense ranks synced"
              : defRankStatus === "loading"
              ? "Syncing defense ranks..."
              : "Using league-average defense rank"}
          </div>
        </div>

        {predictiveStats.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-blue-200">
              Stat entry guide
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {predictiveStats.map((stat) => (
                <label key={stat} className="flex flex-col gap-1 text-sm">
                  <input
                    type="number"
                    className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm"
                    placeholder={stat}
                    value={(form.stats?.[stat] as number) ?? ""}
                    onChange={(e) => updateStat(stat, e.target.value)}
                    title={getStatHint(stat)}
                  />
                  <span className="text-xs text-blue-100/60">{getStatHint(stat)}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            className="w-full rounded-2xl bg-blue-500 px-4 py-3 text-center text-lg font-semibold text-black transition disabled:opacity-40 sm:w-auto sm:flex-1"
            onClick={addPlayer}
            disabled={isAdding || defRankStatus !== "ready"}
          >
            {isAdding
              ? editingId
                ? "Updating player..."
                : "Saving player..."
              : defRankStatus !== "ready"
              ? "Syncing DEF ranks..."
              : editingId
              ? "Save changes"
              : "Add player"}
          </button>
          {editingId && (
            <button
              type="button"
              className="rounded-2xl border border-white/20 px-4 py-3 text-sm text-white/80 hover:bg-white/10"
              onClick={() => {
                setEditingId(null);
                setForm({ stats: {} });
                setAutoFillNote(null);
              }}
            >
              Cancel edit
            </button>
          )}
        </div>
      </section>

      <section className="glass-panel p-6 space-y-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Rankings board</h2>
            <p className="text-sm text-blue-100/80">Players are automatically sorted by the composite score.</p>
          </div>
          {!!positionLeaders.length && (
            <div className="flex flex-wrap gap-2 text-xs text-blue-100/80">
              {positionLeaders.map((leader) => (
                <span key={leader.id} className="rounded-full border border-white/15 px-3 py-1">
                  Top {leader.position}: {leader.name} ({leader.score})
                </span>
              ))}
            </div>
          )}
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="bg-white/5 text-left text-xs uppercase tracking-widest text-blue-100/70">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Pos</th>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">Opp</th>
                <th className="px-3 py-2">Weather</th>
                <th className="px-3 py-2">Implied</th>
                <th className="px-3 py-2">O/U</th>
                <th className="px-3 py-2">Spread</th>
                <th className="px-3 py-2">DEF</th>
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedPlayers.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-blue-100/70">
                    No players tracked yet. Add a player above to see ranked recommendations.
                  </td>
                </tr>
              )}
              {sortedPlayers.map((player, index) => {
                const tier = getDefenseTier(player.defRank);
                return (
                  <tr
                    key={player.id}
                    className={`border-b border-white/5 ${highlightSet.has(player.id) ? "bg-green-500/5" : ""}`}
                  >
                    <td className="px-3 py-3 font-semibold text-white">
                      <div className="text-base">{player.name}</div>
                      <div className="text-xs text-blue-100/60">#{index + 1} overall</div>
                    </td>
                    <td className="px-3 py-3">{player.position}</td>
                  <td className="px-3 py-3">{player.team}</td>
                  <td className="px-3 py-3">{player.opponent}</td>
                  <td className="px-3 py-3 text-blue-100/80">{player.weather || "N/A"}</td>
                  <td className="px-3 py-3">{player.impliedTotal ?? "-"}</td>
                  <td className="px-3 py-3">{formatOverUnder(player.overUnder)}</td>
                  <td className="px-3 py-3">
                    {player.spread !== null && player.spread !== undefined
                      ? `${player.team} ${formatSpreadValue(player.spread)}`
                      : "-"}
                  </td>
                  <td className="px-3 py-3">
                    {player.defRank ?? "-"}
                    {tier.label && (
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${tier.className}`}>{tier.label}</span>
                    )}
                  </td>
                    <td className="px-3 py-3 font-semibold">{player.score ?? "-"}</td>
                  <td className="px-3 py-3 text-center">
                    <button
                      className="mr-2 rounded-full border border-white/20 px-3 py-1 text-xs text-blue-200 hover:bg-white/10"
                      onClick={() => {
                        suppressLookupRef.current = true;
                        setForm({
                          name: player.name,
                          position: player.position,
                          team: player.team,
                          opponent: player.opponent,
                          weather: player.weather,
                          impliedTotal: player.impliedTotal,
                          overUnder: player.overUnder,
                          spread: player.spread,
                          stats: { ...(player.stats || {}) }
                        });
                        setEditingId(player.id);
                        setAutoFillNote(`Editing ${player.name}. Update fields and save.`);
                        setPlayerLookupNote(null);
                        setPlayerSuggestions([]);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-full border border-white/20 px-3 py-1 text-xs text-red-200 hover:bg-red-500/10"
                      onClick={() => removePlayer(player.id)}
                    >
                      Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

