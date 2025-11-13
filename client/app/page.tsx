"use client";
import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { saveAs } from "file-saver";

// 🏈 TEAM → COORDINATES (for weather)
const TEAM_LOCATIONS: Record<string, { lat: number; lon: number }> = {
  BUF: { lat: 42.9, lon: -78.8 },
  SEA: { lat: 47.6, lon: -122.3 },
  KC: { lat: 39.1, lon: -94.6 },
  DAL: { lat: 32.8, lon: -96.8 },
  GB: { lat: 44.5, lon: -88.0 },
  PHI: { lat: 39.9, lon: -75.2 },
  CHI: { lat: 41.9, lon: -87.6 },
  DEN: { lat: 39.7, lon: -105.0 },
  CLE: { lat: 41.5, lon: -81.7 },
  DET: { lat: 42.3, lon: -83.0 },
  MIA: { lat: 25.8, lon: -80.2 },
  NYJ: { lat: 40.8, lon: -74.1 },
  NYG: { lat: 40.8, lon: -74.1 },
  SF: { lat: 37.8, lon: -122.4 },
  MIN: { lat: 44.9, lon: -93.3 },
  NE: { lat: 42.1, lon: -71.2 },
  PIT: { lat: 40.4, lon: -80.0 },
  LAR: { lat: 34.0, lon: -118.3 },
  LV: { lat: 36.1, lon: -115.1 },
  ATL: { lat: 33.7, lon: -84.4 },
  TEN: { lat: 36.1, lon: -86.8 },
};

// 🧮 Predictive formula
const calculatePredictiveScore = (p: any) => {
  let base = 0;
  switch (p.position) {
    case "QB":
      base =
        p.passYards * 0.04 +
        p.passTDs * 4 -
        p.ints * 2 +
        p.rushYards * 0.1 +
        p.rzPass * 0.5;
      break;
    case "RB":
      base =
        p.rushYards * 0.1 +
        p.rec * 1 +
        p.targets * 0.3 +
        p.tds * 6 +
        p.rzTouches * 0.5;
      break;
    case "WR":
      base =
        p.tprr * 80 +
        p.airYards * 0.03 +
        p.ezTgts * 2.5 +
        p.catchable * 1.2 +
        p.ur * 0.05;
      break;
    case "TE":
      base =
        p.tprr * 70 +
        p.ezTgts * 3 +
        p.targets * 1.2 +
        p.rzSnap * 0.3 +
        p.ydsRoute * 1.2;
      break;
  }

  // Matchup adjustment
  if (p.matchup && p.matchup.toLowerCase().includes("@")) base *= 0.95;
  else base *= 1.05;

  // Weather modifier
  if (p.weather) {
    const { temp, wind, precip } = p.weather;
    if (precip > 2) {
      if (p.position === "QB" || p.position === "WR") base *= 0.9;
      if (p.position === "RB") base *= 1.1;
    }
    if (wind > 15 && (p.position === "QB" || p.position === "WR")) base *= 0.92;
    if (temp < 30 && p.position === "RB") base *= 1.05;
  }

  return parseFloat(base.toFixed(1));
};

const POSITION_FIELDS: Record<string, string[]> = {
  QB: ["passYards", "passTDs", "ints", "rushYards", "rzPass"],
  RB: ["rushYards", "rec", "targets", "tds", "rzTouches"],
  WR: ["tprr", "airYards", "catchable", "ezTgts", "ur"],
  TE: ["tprr", "targets", "ezTgts", "rzSnap", "ydsRoute"],
};

const Page = () => {
  const [players, setPlayers] = useState<any[]>([]);
  const [newPlayer, setNewPlayer] = useState<any>({
    name: "",
    position: "WR",
    matchup: "",
  });
  const [weatherCache, setWeatherCache] = useState<any>({});

  const fetchWeather = async (abbr: string) => {
    const loc = TEAM_LOCATIONS[abbr];
    if (!loc) return null;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=temperature_2m_max,precipitation_sum,windspeed_10m_max&timezone=America/New_York`;
    const res = await fetch(url);
    const data = await res.json();
    return {
      temp: data.daily.temperature_2m_max[0],
      precip: data.daily.precipitation_sum[0],
      wind: data.daily.windspeed_10m_max[0],
    };
  };

  const addPlayer = async () => {
    let weather = null;
    const match = newPlayer.matchup?.match(/[A-Z]{2,3}$/);
    if (match) {
      const abbr = match[0];
      if (!weatherCache[abbr]) {
        const w = await fetchWeather(abbr);
        setWeatherCache((prev: any) => ({ ...prev, [abbr]: w }));
        weather = w;
      } else weather = weatherCache[abbr];
    }

    const player = { ...newPlayer, weather };
    player.predicted = calculatePredictiveScore(player);

    setPlayers((prev) => [...prev, player]);
    setNewPlayer({ name: "", position: "WR", matchup: "" });
  };

  const handleInput = (field: string, value: any) => {
    setNewPlayer((prev: any) => ({ ...prev, [field]: value }));
  };

  const exportCSV = () => {
    const csv = [
      ["Name", "Position", "Matchup", "Predicted"],
      ...players.map((p) => [p.name, p.position, p.matchup, p.predicted]),
    ]
      .map((r) => r.join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    saveAs(blob, "predictions.csv");
  };

  const top3 = [...players].sort((a, b) => b.predicted - a.predicted).slice(0, 3);
  const positionFields = POSITION_FIELDS[newPlayer.position] || [];

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-gray-100 flex flex-col items-center px-4 py-8">
      <motion.h1
        className="text-4xl font-bold mb-6 text-blue-400"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        Fantasy Waiver Predictive Tool
      </motion.h1>

      <div className="w-full max-w-4xl bg-gray-800 p-6 rounded-2xl shadow-lg mb-8">
        <div className="grid md:grid-cols-3 gap-4">
          <input
            placeholder="Player Name"
            value={newPlayer.name}
            onChange={(e) => handleInput("name", e.target.value)}
            className="p-2 rounded bg-gray-700 text-white border border-gray-600"
          />
          <select
            value={newPlayer.position}
            onChange={(e) => handleInput("position", e.target.value)}
            className="p-2 rounded bg-gray-700 text-white border border-gray-600"
          >
            <option>QB</option>
            <option>RB</option>
            <option>WR</option>
            <option>TE</option>
          </select>
          <input
            placeholder="Matchup (e.g. @BUF)"
            value={newPlayer.matchup}
            onChange={(e) => handleInput("matchup", e.target.value)}
            className="p-2 rounded bg-gray-700 text-white border border-gray-600"
          />
        </div>

        <div className="grid md:grid-cols-3 gap-4 mt-4">
          {positionFields.map((field) => (
            <input
              key={field}
              placeholder={field}
              type="number"
              onChange={(e) =>
                handleInput(field, parseFloat(e.target.value) || 0)
              }
              className="p-2 rounded bg-gray-700 text-white border border-gray-600"
            />
          ))}
        </div>

        <button
          onClick={addPlayer}
          className="mt-6 w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 rounded-lg transition"
        >
          Add Player
        </button>
      </div>

      <div className="w-full max-w-4xl bg-gray-800 rounded-2xl p-6 shadow-xl">
        <h2 className="text-2xl font-semibold text-blue-400 mb-4">Predictions</h2>
        {players.length === 0 ? (
          <p className="text-gray-400 text-center">No players added yet.</p>
        ) : (
          <div className="grid gap-2">
            {players.map((p, i) => (
              <div
                key={i}
                className={`p-3 rounded-lg ${
                  top3.includes(p) ? "bg-blue-700" : "bg-gray-700"
                }`}
              >
                <strong>{p.name}</strong> ({p.position}) — {p.matchup}{" "}
                <span className="float-right text-blue-300 font-bold">
                  {p.predicted} pts
                </span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={exportCSV}
          className="mt-6 w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-2 rounded-lg transition"
        >
          Export CSV
        </button>
      </div>
    </main>
  );
};

export default Page;
