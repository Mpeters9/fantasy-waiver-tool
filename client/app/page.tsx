"use client";
import React, { useEffect, useState } from "react";
import { saveAs } from "file-saver";

type Player = {
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

// team → coords for weather
const TEAM_LOCATIONS: Record<string, { lat: number; lon: number }> = {
  KC: { lat: 39.0997, lon: -94.5786 },
  BUF: { lat: 42.8864, lon: -78.8784 },
  SF: { lat: 37.7749, lon: -122.4194 },
  DAL: { lat: 32.7767, lon: -96.797 },
  MIA: { lat: 25.7617, lon: -80.1918 },
  GB: { lat: 44.5192, lon: -88.0198 }
};

export default function Home() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [form, setForm] = useState<Partial<Player>>({ stats: {} });
  const [defRanks, setDefRanks] = useState<Record<string, number>>({});
  const [viewMode, setViewMode] = useState<"WEEK" | "ROS">("WEEK");

  // --- load defense ranks via proxy ---
  useEffect(() => {
    fetch("http://localhost:5000/api/defense-rankings")
      .then((res) => res.json())
      .then((json) => {
        const ranks: Record<string, number> = {};
        json.data?.forEach((d: any) => (ranks[d.teamAbbr] = d.rank));
        setDefRanks(ranks);
      })
      .catch(() => console.warn("DEF ranks unavailable, using defaults"));
  }, []);

  // --- weather fetch ---
  async function fetchWeather(team: string): Promise<string> {
    const loc = TEAM_LOCATIONS[team];
    if (!loc) return "N/A";
    try {
      const api = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&hourly=temperature_2m,precipitation_probability&forecast_days=1`;
      const res = await fetch(api);
      const json = await res.json();
      const temp = json.hourly.temperature_2m?.[12];
      const rain = json.hourly.precipitation_probability?.[12];
      return `${temp}°F / ${rain}% rain`;
    } catch {
      return "N/A";
    }
  }

  // --- predictive scoring ---
  function calcScore(p: Player): number {
    const st = p.stats;
    let s = 0;

    Object.entries(st).forEach(([key, val]) => {
      if (key.includes("Routes")) s += val * 0.05;
      if (key.includes("TPRR")) s += val * 0.4;
      if (key.includes("Targets")) s += val * 0.3;
      if (key.includes("Catchable")) s += val * 0.1;
      if (key.includes("ADOT")) s += val * 0.05;
      if (key.includes("Air Yards")) s += val * 0.02;
      if (key.includes("EZ")) s += val * 0.4;
      if (key.includes("3rd/4th")) s += val * 0.25;
      if (key.includes("Play-Action")) s += val * 0.2;
      if (key.includes("Unrealized")) s += val * 0.01;
      if (key.includes("PPR")) s += val * 0.6;
      if (key.includes("PPR Rank")) s += (100 - val) * 0.2;
    });

    if (p.weather && p.weather.includes("% rain")) {
      const rain = Number(p.weather.split("%")[0].split("/").pop()?.trim());
      if (rain > 40) s *= 0.9;
    }

    if (p.defRank) s *= 1 - (p.defRank - 16) / 100;
    if (p.impliedTotal) s *= 1 + (p.impliedTotal - 22) / 100;

    // ⚙️ view mode weighting
    if (viewMode === "ROS") s = s * 0.8 + (p.stats["Fantasy PPG (Last 3)"] || 0) * 1.2;

    return Number(s.toFixed(2));
  }

  const addPlayer = async () => {
    if (!form.name || !form.position || !form.team) return;
    const weather = await fetchWeather(form.team);
    const defRank = defRanks[form.opponent || ""] || 16;
    const newPlayer: Player = {
      name: form.name!,
      position: form.position!,
      team: form.team!,
      opponent: form.opponent!,
      weather,
      impliedTotal: form.impliedTotal || 22,
      defRank,
      stats: form.stats as Record<string, number>
    };
    newPlayer.score = calcScore(newPlayer);
    setPlayers([...players, newPlayer]);
    setForm({ stats: {} });
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

  const sorted = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
  const top3 = sorted.slice(0, 3).map((p) => p.name);

  return (
    <main className="p-6 max-w-5xl mx-auto text-white">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">
          Fantasy Waiver Predictor ({viewMode === "WEEK" ? "This Week" : "Rest of Season"})
        </h1>
        <select
          className="text-black border p-2 rounded"
          value={viewMode}
          onChange={(e) => setViewMode(e.target.value as "WEEK" | "ROS")}
        >
          <option value="WEEK">This Week</option>
          <option value="ROS">Rest of Season</option>
        </select>
      </div>

      {/* Player Entry */}
      <div className="bg-gray-800 p-4 rounded-lg space-y-2 mb-6">
        <input
          className="border p-2 w-full text-black"
          placeholder="Player Name"
          value={form.name || ""}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          className="border p-2 w-full text-black"
          placeholder="Team (e.g. KC)"
          value={form.team || ""}
          onChange={(e) => setForm({ ...form, team: e.target.value })}
        />
        <input
          className="border p-2 w-full text-black"
          placeholder="Opponent (e.g. BUF)"
          value={form.opponent || ""}
          onChange={(e) => setForm({ ...form, opponent: e.target.value })}
        />
        <select
          className="border p-2 w-full text-black"
          value={form.position || ""}
          onChange={(e) => setForm({ ...form, position: e.target.value, stats: {} })}
        >
          <option value="">Select Position</option>
          {Object.keys(PREDICTIVE_FIELDS).map((pos) => (
            <option key={pos}>{pos}</option>
          ))}
        </select>

        {form.position &&
          PREDICTIVE_FIELDS[form.position].map((stat) => (
            <input
              key={stat}
              type="number"
              className="border p-2 w-full text-black"
              placeholder={stat}
              value={(form.stats?.[stat] as number) || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  stats: { ...form.stats, [stat]: Number(e.target.value) }
                })
              }
            />
          ))}

        <input
          type="number"
          className="border p-2 w-full text-black"
          placeholder="Implied Team Total"
          value={form.impliedTotal || ""}
          onChange={(e) => setForm({ ...form, impliedTotal: Number(e.target.value) })}
        />

        <button
          className="bg-blue-600 text-white p-2 rounded w-full"
          onClick={addPlayer}
        >
          Add Player
        </button>
      </div>

      <table className="w-full border border-gray-700 text-sm">
        <thead className="bg-gray-900">
          <tr>
            <th>Name</th>
            <th>Pos</th>
            <th>Team</th>
            <th>Opp</th>
            <th>Weather</th>
            <th>Implied</th>
            <th>DEF</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => (
            <tr
              key={i}
              className={`border-b border-gray-800 ${
                top3.includes(p.name)
                  ? i === 0
                    ? "bg-green-800"
                    : "bg-green-700"
                  : ""
              }`}
            >
              <td>{p.name}</td>
              <td>{p.position}</td>
              <td>{p.team}</td>
              <td>{p.opponent}</td>
              <td>{p.weather}</td>
              <td>{p.impliedTotal}</td>
              <td>{p.defRank}</td>
              <td>{p.score}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <button
        className="bg-green-600 text-white p-2 rounded mt-4"
        onClick={exportCSV}
      >
        Download CSV ({viewMode})
      </button>
    </main>
  );
}
