"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { saveAs } from "file-saver";
import { stadiumLocations } from "../src/lib/stadium";
import { fetchVegasImpliedTotal } from "../src/lib/odds";

type Player = {
  id: string;
  name: string;
  position: string;
  team: string;
  opponent: string;
  impliedTotal?: number;
  weather?: string;
  defRank?: number;
  stats: Record<string, number>;
  score?: number;
};

type ViewMode = "WEEK" | "ROS";

type DefRankStatus = "idle" | "loading" | "ready" | "error";

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

const numberFromInput = (value: string): number | undefined =>
  value === "" ? undefined : Number(value);

export default function Home() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [form, setForm] = useState<Partial<Player>>({ stats: {} });
  const [defRanks, setDefRanks] = useState<Record<string, number>>({});
  const [viewMode, setViewMode] = useState<ViewMode>("WEEK");
  const [defRankStatus, setDefRankStatus] = useState<DefRankStatus>("idle");
  const [persistHydrated, setPersistHydrated] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [autoFillNote, setAutoFillNote] = useState<string | null>(null);

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
        const ranks: Record<string, number> = {};
        json.data?.forEach((d: any) => (ranks[d.teamAbbr] = d.rank));
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
      let score = 0;

      Object.entries(st).forEach(([key, val]) => {
        if (key.includes("Routes")) score += val * 0.05;
        if (key.includes("TPRR")) score += val * 0.4;
        if (key.includes("Targets")) score += val * 0.3;
        if (key.includes("Catchable")) score += val * 0.1;
        if (key.includes("ADOT")) score += val * 0.05;
        if (key.includes("Air Yards")) score += val * 0.02;
        if (key.includes("EZ")) score += val * 0.4;
        if (key.includes("3rd/4th")) score += val * 0.25;
        if (key.includes("Play-Action")) score += val * 0.2;
        if (key.includes("Unrealized")) score += val * 0.01;
        if (key.includes("PPR")) score += val * 0.6;
        if (key.includes("PPR Rank")) score += (100 - val) * 0.2;
      });

      if (p.weather && p.weather.includes("% rain")) {
        const rain = Number(p.weather.split("%")?.[0].split("/").pop()?.trim());
        if (rain > 40) score *= 0.9;
      }

      if (p.defRank) score *= 1 - (p.defRank - 16) / 100;
      if (p.impliedTotal) score *= 1 + (p.impliedTotal - 22) / 100;

      if (viewMode === "ROS") {
        score = score * 0.8 + (p.stats?.["Fantasy PPG (Last 3)"] || 0) * 1.2;
      }

      return Number(score.toFixed(2));
    },
    [viewMode]
  );

  // --- recalc scores when view changes ---
  useEffect(() => {
    setPlayers((prev) => prev.map((p) => ({ ...p, score: calcScore(p) })));
  }, [calcScore]);

  // --- weather fetch ---
  async function fetchWeather(team: string): Promise<string> {
    const loc = stadiumLocations[team.toUpperCase()];
    if (!loc) return "N/A";
    try {
      const api = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&hourly=temperature_2m,precipitation_probability&forecast_days=1`;
      const res = await fetch(api);
      const json = await res.json();
      const tempC = json.hourly?.temperature_2m?.[12];
      const rain = json.hourly?.precipitation_probability?.[12];
      if (typeof tempC !== "number" || typeof rain !== "number") return "N/A";
      const tempF = Math.round((tempC * 9) / 5 + 32);
      return `${tempF}°F / ${rain}% rain`;
    } catch {
      return "N/A";
    }
  }

  const addPlayer = async () => {
    if (!form.name?.trim() || !form.position || !form.team?.trim() || !form.opponent?.trim()) {
      setFormError("Name, position, team, and opponent are required.");
      return;
    }

    setFormError(null);
    setIsAdding(true);
    setAutoFillNote(null);

    const team = form.team.trim().toUpperCase();
    const opponent = form.opponent.trim().toUpperCase();

    try {
      const [weather, autoImplied] = await Promise.all([
        fetchWeather(team),
        form.impliedTotal !== undefined ? Promise.resolve(form.impliedTotal) : fetchVegasImpliedTotal(team)
      ]);

      const impliedTotal =
        form.impliedTotal ?? (autoImplied !== null ? Number(autoImplied.toFixed(1)) : undefined) ?? DEFAULT_TEAM_TOTAL;

      if (!form.stats || Object.keys(form.stats).length === 0) {
        setFormError("Log at least one predictive stat for the player.");
        setIsAdding(false);
        return;
      }

      const defRank = defRanks[opponent] ?? DEFAULT_DEF_RANK;
      const newPlayer: Player = {
        id: createPlayerId(),
        name: form.name.trim(),
        position: form.position,
        team,
        opponent,
        weather,
        impliedTotal,
        defRank,
        stats: form.stats as Record<string, number>
      };

      newPlayer.score = calcScore(newPlayer);
      setPlayers((prev) => [...prev, newPlayer]);
      setForm({ stats: {} });

      if (!form.impliedTotal && autoImplied) {
        setAutoFillNote(`Auto-filled implied team total (${autoImplied.toFixed(1)}) from Vegas odds.`);
      } else if (!form.impliedTotal && autoImplied === null) {
        setAutoFillNote("Could not auto-fill implied team total — please review manually.");
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
      ["Name", "Pos", "Team", "Opp", "Weather", "Implied", "DEF", "Score"],
      ...players.map((p) => [
        p.name,
        p.position,
        p.team,
        p.opponent,
        p.weather,
        p.impliedTotal,
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

        <div className="grid gap-4 md:grid-cols-2">
          <input
            className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"
            placeholder="Player name"
            value={form.name || ""}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
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
          <input
            type="number"
            className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"
            placeholder="Implied team total (optional)"
            value={form.impliedTotal ?? ""}
            onChange={(e) => setForm({ ...form, impliedTotal: numberFromInput(e.target.value) })}
          />
          <div className="rounded-xl border border-dashed border-white/15 bg-black/10 px-4 py-3 text-sm text-blue-100/80">
            {defRankStatus === "ready"
              ? "Defense ranks synced"
              : defRankStatus === "loading"
              ? "Syncing defense ranks…"
              : "Using league-average defense rank"}
          </div>
        </div>

        {predictiveStats.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            {predictiveStats.map((stat) => (
              <input
                key={stat}
                type="number"
                className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm"
                placeholder={stat}
                value={(form.stats?.[stat] as number) ?? ""}
                onChange={(e) => updateStat(stat, e.target.value)}
              />
            ))}
          </div>
        )}

        <button
          className="w-full rounded-2xl bg-blue-500 px-4 py-3 text-center text-lg font-semibold text-black transition disabled:opacity-40"
          onClick={addPlayer}
          disabled={isAdding}
        >
          {isAdding ? "Saving player…" : "Add player"}
        </button>
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
                <th className="px-3 py-2">DEF</th>
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedPlayers.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-blue-100/70">
                    No players tracked yet. Add a player above to see ranked recommendations.
                  </td>
                </tr>
              )}
              {sortedPlayers.map((player, index) => (
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
                  <td className="px-3 py-3">{player.defRank ?? "-"}</td>
                  <td className="px-3 py-3 font-semibold">{player.score ?? "-"}</td>
                  <td className="px-3 py-3 text-center">
                    <button
                      className="rounded-full border border-white/20 px-3 py-1 text-xs text-red-200 hover:bg-red-500/10"
                      onClick={() => removePlayer(player.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
