'use client';
import { useState, useEffect } from 'react';

/**
 * Fantasy Waiver Tool – Predictive Stats + Quality-of-Life Enhancements
 */

export default function Home() {
  const [players, setPlayers] = useState<any[]>([]);
  const [week, setWeek] = useState<number>(11);
  const [sortMode, setSortMode] = useState<'WEEK' | 'ROS'>('WEEK');

  const [form, setForm] = useState<any>({
    player_name: '',
    position: '',
    team: '',
    home_team: '',
    weather: '',
    implied_total: '',
    waiver_score_week: '',
    waiver_score_ros: '',
    stats: {},
  });

  const stadiums: Record<string, { lat: number; lon: number }> = {
    BUF: { lat: 42.7738, lon: -78.7869 },
    MIA: { lat: 25.958, lon: -80.2389 },
    GB: { lat: 44.5013, lon: -88.0622 },
    DAL: { lat: 32.7473, lon: -97.0945 },
    KC: { lat: 39.0489, lon: -94.484 },
    PHI: { lat: 39.9012, lon: -75.1674 },
    DET: { lat: 42.3389, lon: -83.0458 },
    LV: { lat: 36.0908, lon: -115.183 },
    LA: { lat: 33.9535, lon: -118.3393 },
  };

  /** --- Weather + Implied --- **/
  const fetchWeather = async (team: string) => {
    const loc = stadiums[team.toUpperCase()];
    if (!loc) return setForm((f: any) => ({ ...f, weather: 'N/A' }));
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&hourly=temperature_2m,wind_speed_10m,precipitation_probability&forecast_days=7`
      );
      const data = await res.json();
      const i = Math.min(84, data.hourly.temperature_2m.length - 1);
      const temp = data.hourly.temperature_2m[i];
      const wind = data.hourly.wind_speed_10m[i];
      const precip = data.hourly.precipitation_probability[i];
      let score = 10;
      if (temp < 30 || temp > 90) score -= 2;
      if (wind > 15) score -= 2;
      if (precip > 50) score -= 3;
      setForm((f: any) => ({ ...f, weather: Math.max(score, 0).toFixed(1) }));
    } catch {
      setForm((f: any) => ({ ...f, weather: 'N/A' }));
    }
  };

  const fetchImplied = async (team: string) => {
    try {
      const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
      const data = await res.json();
      const game = data.events.find((g: any) =>
        g.competitions[0].competitors.some((c: any) => c.team.abbreviation === team.toUpperCase())
      );
      if (!game) throw new Error('No game');
      const odds = game.competitions[0].odds?.[0];
      const total = Number(odds.overUnder);
      const fav = odds.details?.includes(team.toUpperCase());
      const implied = fav ? total * 0.55 : total * 0.45;
      setForm((f: any) => ({ ...f, implied_total: implied.toFixed(1) }));
    } catch {
      setForm((f: any) => ({ ...f, implied_total: '' }));
    }
  };

  useEffect(() => {
    if (form.home_team) {
      fetchWeather(form.home_team);
      fetchImplied(form.home_team);
    }
  }, [form.home_team]);

  /** --- Local save/load --- **/
  useEffect(() => {
    const saved = localStorage.getItem(`waivers_week_${week}`);
    if (saved) setPlayers(JSON.parse(saved));
  }, [week]);
  useEffect(() => {
    localStorage.setItem(`waivers_week_${week}`, JSON.stringify(players));
  }, [players, week]);

  /** --- Scoring --- **/
  const s = (v: any) => Number(v) || 0;
  const calcScore = (type: 'WEEK' | 'ROS') => {
    const w = s(form.weather);
    const it = s(form.implied_total);
    const st = form.stats;
    let base = 0;
    const shortWeight = type === 'WEEK' ? 0.7 : 0.3;
    // simple aggregate example using prior predictive metrics
    if (form.position.match(/WR|TE/)) {
      base =
        (s(st.routes3) * 0.05 +
          s(st.targets3) * 0.3 +
          s(st.receptions3) * 0.5 +
          s(st.yards3) * 0.1 +
          s(st.td3) * 6 +
          s(st.tprr3) * 0.4) *
          shortWeight +
        (s(st.routesS) * 0.05 +
          s(st.targetsS) * 0.3 +
          s(st.receptionsS) * 0.5 +
          s(st.yardsS) * 0.1 +
          s(st.tdS) * 6 +
          s(st.tprrS) * 0.4) *
          (1 - shortWeight);
    }
    if (form.position === 'RB') {
      base =
        (s(st.snap3) * 0.1 +
          s(st.rushAtt3) * 0.2 +
          s(st.targets3) * 0.3 +
          s(st.receptions3) * 0.5 +
          s(st.tprr3) * 0.3 +
          s(st.td3) * 6) *
          shortWeight +
        (s(st.snapS) * 0.1 +
          s(st.rushAttS) * 0.2 +
          s(st.targetsS) * 0.3 +
          s(st.receptionsS) * 0.5 +
          s(st.tprrS) * 0.3 +
          s(st.tdS) * 6) *
          (1 - shortWeight);
    }
    if (form.position === 'QB') {
      base =
        (s(st.passYds3) * 0.04 + s(st.passTD3) * 4 + s(st.rushYds3) * 0.1 + s(st.rushTD3) * 6 - s(st.turnovers3) * 2) *
          shortWeight +
        (s(st.passYdsS) * 0.04 + s(st.passTDS) * 4 + s(st.rushYdsS) * 0.1 + s(st.rushTDS) * 6 - s(st.turnoversS) * 2) *
          (1 - shortWeight);
    }
    return (base + w * 0.4 + it * 0.3).toFixed(1);
  };

  const handleSubmit = (e: any) => {
    e.preventDefault();
    const weekScore = calcScore('WEEK');
    const rosScore = calcScore('ROS');
    const newPlayer = { ...form, waiver_score_week: weekScore, waiver_score_ros: rosScore, id: Date.now(), week };
    setPlayers((prev) => [...prev, newPlayer]);
    setForm({
      player_name: '',
      position: '',
      team: '',
      home_team: '',
      weather: '',
      implied_total: '',
      waiver_score_week: '',
      waiver_score_ros: '',
      stats: {},
    });
  };

  /** --- CSV export --- **/
  const exportCSV = () => {
    const rows = [
      ['Player', 'Pos', 'Team', 'Weather', 'Implied', 'Weekly', 'ROS'],
      ...players.map((p) => [
        p.player_name,
        p.position,
        p.team,
        p.weather,
        p.implied_total,
        p.waiver_score_week,
        p.waiver_score_ros,
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `waivers_week${week}.csv`;
    link.click();
  };

  const colorByPos = (pos: string) =>
    pos === 'QB'
      ? 'bg-blue-900/30'
      : pos === 'RB'
      ? 'bg-red-900/30'
      : pos === 'WR'
      ? 'bg-yellow-900/30'
      : pos === 'TE'
      ? 'bg-purple-900/30'
      : pos === 'DEF'
      ? 'bg-gray-800/60'
      : pos === 'K'
      ? 'bg-teal-900/30'
      : '';

  const sortedPlayers = [...players].sort((a, b) =>
    sortMode === 'WEEK'
      ? b.waiver_score_week - a.waiver_score_week
      : b.waiver_score_ros - a.waiver_score_ros
  );

  /** --- render minimal fields for demo --- **/
  const renderStats = () => (
    <>
      <input
        className="p-2 rounded text-black"
        placeholder="routes3"
        onChange={(e) =>
          setForm({ ...form, stats: { ...form.stats, routes3: Number(e.target.value) } })
        }
      />
      <input
        className="p-2 rounded text-black"
        placeholder="targets3"
        onChange={(e) =>
          setForm({ ...form, stats: { ...form.stats, targets3: Number(e.target.value) } })
        }
      />
      <input
        className="p-2 rounded text-black"
        placeholder="td3"
        onChange={(e) =>
          setForm({ ...form, stats: { ...form.stats, td3: Number(e.target.value) } })
        }
      />
    </>
  );

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <h1 className="text-3xl font-bold text-center mb-6">
        🏈 Fantasy Waiver Predictor — Week {week}
      </h1>

      <div className="flex justify-center gap-3 mb-6">
        <select
          className="p-2 rounded text-black"
          value={week}
          onChange={(e) => setWeek(Number(e.target.value))}
        >
          {Array.from({ length: 18 }, (_, i) => i + 1).map((wk) => (
            <option key={wk} value={wk}>
              Week {wk}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="bg-indigo-600 px-3 py-2 rounded hover:bg-indigo-700"
          onClick={() => setSortMode(sortMode === 'WEEK' ? 'ROS' : 'WEEK')}
        >
          Sort by {sortMode === 'WEEK' ? 'ROS' : 'Weekly'}
        </button>
        <button
          type="button"
          className="bg-green-600 px-3 py-2 rounded hover:bg-green-700"
          onClick={exportCSV}
        >
          Download CSV
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 max-w-4xl mx-auto mb-8"
      >
        <div className="flex flex-wrap gap-3 justify-center">
          <input
            className="p-2 rounded text-black"
            placeholder="Player Name"
            value={form.player_name}
            onChange={(e) => setForm({ ...form, player_name: e.target.value })}
          />
          <input
            className="p-2 rounded text-black"
            placeholder="Position"
            value={form.position}
            onChange={(e) => setForm({ ...form, position: e.target.value })}
          />
          <input
            className="p-2 rounded text-black"
            placeholder="Team"
            value={form.team}
            onChange={(e) => setForm({ ...form, team: e.target.value })}
          />
          <input
            className="p-2 rounded text-black"
            placeholder="Home Team"
            value={form.home_team}
            onChange={(e) => setForm({ ...form, home_team: e.target.value })}
          />
        </div>

        <div className="flex flex-wrap gap-3 justify-center">{renderStats()}</div>

        <button
          type="submit"
          className="bg-blue-600 px-4 py-2 rounded hover:bg-blue-700 transition self-center mt-4"
        >
          Add Player
        </button>
      </form>

      {sortedPlayers.length ? (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-gray-700 text-gray-300">
              <th className="p-3">#</th>
              <th className="p-3">Player</th>
              <th className="p-3">Pos</th>
              <th className="p-3">Team</th>
              <th className="p-3 text-blue-400">Weekly</th>
              <th className="p-3 text-green-400">ROS</th>
            </tr>
          </thead>
          <tbody>
            {sortedPlayers.map((p, i) => (
              <tr
                key={p.id}
                className={`border-b border-gray-800 hover:bg-gray-800 transition ${colorByPos(
                  p.position
                )}`}
              >
                <td className="p-3">{i + 1}</td>
                <td className="p-3 font-semibold">{p.player_name}</td>
                <td className="p-3">{p.position}</td>
                <td className="p-3">{p.team}</td>
                <td className="p-3 font-semibold text-blue-400">{p.waiver_score_week}</td>
                <td className="p-3 font-semibold text-green-400">{p.waiver_score_ros}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-center text-gray-400">No players saved for Week {week}.</p>
      )}
    </main>
  );
}
