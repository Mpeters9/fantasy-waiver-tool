"use client";
import React, { useEffect, useState } from "react";
import { saveAs } from "file-saver";

type Player = {
  id: number;
  name: string;
  position: string;
  team: string;
  opponent: string;
  weather?: string;
  impliedTotal?: number;
  defRank?: number;
  games: { week: number; points: number }[];
  waiverScore?: number;
  suggestedBid?: number;
};

export default function Home() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [week, setWeek] = useState<number>(11);
  const [mode, setMode] = useState<"WEEK" | "ROS">("WEEK");
  const [faabBudget, setFaabBudget] = useState<number>(100);
  const [defRanks, setDefRanks] = useState<Record<string, number>>({});

  // ✅ Load defensive ranks each Tuesday 9am or when app starts
  useEffect(() => {
    const loadDefRanks = async () => {
      try {
        const res = await fetch("https://api.fantasylife.com/v1/nfl/defense-rankings");
        const data = await res.json();
        const ranks: Record<string, number> = {};
        data?.rankings?.forEach((team: any) => {
          ranks[team.teamAbbr.toUpperCase()] = team.rank;
        });
        setDefRanks(ranks);
      } catch (err) {
        console.error("DEF rank fetch failed", err);
      }
    };
    loadDefRanks();

    const now = new Date();
    if (now.getDay() === 2 && now.getHours() >= 9) updateWeatherAll();
  }, []);

  const addPlayer = () => {
    setPlayers([
      ...players,
      {
        id: Date.now(),
        name: "",
        position: "",
        team: "",
        opponent: "",
        games: [],
      },
    ]);
  };

  const updatePlayer = (id: number, field: keyof Player, value: any) => {
    const updated = players.map((p) =>
      p.id === id ? { ...p, [field]: value } : p
    );
    setPlayers(updated);
    localStorage.setItem(`players-week-${week}`, JSON.stringify(updated));
  };

  const updateWeatherAll = async () => {
    const updated = await Promise.all(
      players.map(async (p) => {
        if (!p.team) return p;
        try {
          const res = await fetch(
            `https://gameday.weather.api/${p.team}?week=${week}`
          );
          const data = await res.json();
          return { ...p, weather: data.summary || "Clear" };
        } catch {
          return { ...p, weather: "N/A" };
        }
      })
    );
    setPlayers(updated);
  };

  const calculateWaiverScore = (p: Player): number => {
    const recentGames = p.games.slice(-3);
    const avgPoints =
      recentGames.reduce((sum, g) => sum + g.points, 0) /
      (recentGames.length || 1);
    let score = avgPoints;

    if (p.impliedTotal) score += p.impliedTotal * 0.2;
    if (p.defRank) score += (32 - p.defRank) * 0.3;
    if (p.weather && p.weather.toLowerCase().includes("rain")) score -= 1.5;

    return Math.round(score * 10) / 10;
  };

  const calculateSuggestedBid = (score: number): number => {
    const percent = Math.min(100, Math.max(0, (score / 25) * 100));
    const rawBid = (percent / 100) * faabBudget;
    return Math.round(rawBid);
  };

  useEffect(() => {
    const updated = players.map((p) => {
      // auto-fill DEF rank if missing
      let autoRank = p.defRank;
      if (!autoRank && p.opponent && defRanks[p.opponent.toUpperCase()]) {
        autoRank = defRanks[p.opponent.toUpperCase()];
      }

      const waiverScore = calculateWaiverScore({ ...p, defRank: autoRank });
      const suggestedBid = calculateSuggestedBid(waiverScore);

      return { ...p, defRank: autoRank, waiverScore, suggestedBid };
    });
    setPlayers(updated);
  }, [players.length, mode, faabBudget, defRanks]);

  const top3 = [...players]
    .sort((a, b) => (b.waiverScore ?? 0) - (a.waiverScore ?? 0))
    .slice(0, 3);

  const exportCSV = () => {
    const header = Object.keys(players[0] || {}).join(",");
    const rows = players.map((p) =>
      Object.values(p)
        .map((v) => JSON.stringify(v))
        .join(",")
    );
    const blob = new Blob([header + "\n" + rows.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    saveAs(blob, `week${week}_waiver_export.csv`);
  };

  const importCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const [headerLine, ...rows] = text.split("\n");
      const headers = headerLine.split(",");
      const imported = rows
        .filter(Boolean)
        .map((r) => {
          const values = r.split(",");
          return headers.reduce(
            (obj, key, i) => ({ ...obj, [key]: JSON.parse(values[i] || "null") }),
            {}
          ) as Player;
        });
      setPlayers(imported);
    };
    reader.readAsText(file);
  };

  return (
    <main className="p-6 bg-gray-950 min-h-screen text-gray-100">
      <h1 className="text-3xl font-bold mb-4">Fantasy Waiver Tool</h1>

      <div className="flex flex-wrap gap-4 mb-4 items-center">
        <div>
          <label>Week: </label>
          <input
            type="number"
            value={week}
            onChange={(e) => setWeek(Number(e.target.value))}
            className="bg-gray-800 p-1 rounded w-20"
          />
        </div>
        <div>
          <label>FAAB Budget: </label>
          <input
            type="number"
            value={faabBudget}
            onChange={(e) => setFaabBudget(Number(e.target.value))}
            className="bg-gray-800 p-1 rounded w-24"
          />
        </div>
        <button
          onClick={() => setMode(mode === "WEEK" ? "ROS" : "WEEK")}
          className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded"
        >
          Mode: {mode}
        </button>
        <button
          onClick={addPlayer}
          className="bg-green-600 hover:bg-green-700 px-3 py-1 rounded"
        >
          + Add Player
        </button>
        <button
          onClick={updateWeatherAll}
          className="bg-cyan-600 hover:bg-cyan-700 px-3 py-1 rounded"
        >
          Refresh Weather
        </button>
        <button
          onClick={exportCSV}
          className="bg-yellow-600 hover:bg-yellow-700 px-3 py-1 rounded"
        >
          Export CSV
        </button>
        <input
          type="file"
          accept=".csv"
          onChange={importCSV}
          className="text-sm"
        />
      </div>

      <table className="w-full text-left text-sm border border-gray-700 rounded-lg overflow-hidden">
        <thead className="bg-gray-800 text-gray-200">
          <tr>
            <th className="p-2">Name</th>
            <th>Pos</th>
            <th>Team</th>
            <th>Opp</th>
            <th>Weather</th>
            <th>Impl Tot</th>
            <th>DEF Rank</th>
            <th>3-Game Avg</th>
            <th>Score</th>
            <th>💰Bid ($)</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const isTop = top3.some((t) => t.id === p.id);
            const color = isTop
              ? top3[0].id === p.id
                ? "bg-green-800"
                : "bg-yellow-800"
              : "bg-gray-900";
            return (
              <tr key={p.id} className={`${color} border-b border-gray-800`}>
                <td>
                  <input
                    value={p.name}
                    onChange={(e) => updatePlayer(p.id, "name", e.target.value)}
                    className="bg-transparent outline-none w-full"
                  />
                </td>
                <td>
                  <input
                    value={p.position}
                    onChange={(e) =>
                      updatePlayer(p.id, "position", e.target.value)
                    }
                    className="bg-transparent outline-none w-16"
                  />
                </td>
                <td>
                  <input
                    value={p.team}
                    onChange={(e) => updatePlayer(p.id, "team", e.target.value)}
                    className="bg-transparent outline-none w-16"
                  />
                </td>
                <td>
                  <input
                    value={p.opponent}
                    onChange={(e) =>
                      updatePlayer(p.id, "opponent", e.target.value)
                    }
                    className="bg-transparent outline-none w-16"
                  />
                </td>
                <td>{p.weather || "-"}</td>
                <td>
                  <input
                    type="number"
                    value={p.impliedTotal || ""}
                    onChange={(e) =>
                      updatePlayer(p.id, "impliedTotal", Number(e.target.value))
                    }
                    className="bg-transparent outline-none w-16"
                  />
                </td>
                <td>{p.defRank || "-"}</td>
                <td>
                  <input
                    type="number"
                    value={
                      p.games.length
                        ? (
                            p.games.reduce((sum, g) => sum + g.points, 0) /
                            p.games.length
                          ).toFixed(1)
                        : ""
                    }
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      const newGames = [...(p.games || []), { week, points: val }];
                      updatePlayer(p.id, "games", newGames);
                    }}
                    className="bg-transparent outline-none w-16"
                  />
                </td>
                <td>{p.waiverScore ?? "-"}</td>
                <td>${p.suggestedBid ?? "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
