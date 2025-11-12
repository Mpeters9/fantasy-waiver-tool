import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB, pool } from './db/index.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 5000;

connectDB();

// 🧠 Add new player manually
app.post('/api/waivers', async (req, res) => {
  const { player_name, position, team, waiver_score, week } = req.body;
  if (!player_name || !position || !team || !waiver_score || !week) {
    return res.status(400).json({ error: 'All fields required' });
  }

  try {
    const query = `
      INSERT INTO waiver_rankings (player_name, position, team, waiver_score, week)
      VALUES ($1, $2, $3, $4, $5) RETURNING *;
    `;
    const values = [player_name, position, team, waiver_score, week];
    const result = await pool.query(query, values);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error adding player:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// 🧾 Get all players for current week
app.get('/api/waivers', async (req, res) => {
  const week = parseInt(req.query.week) || 11;
  try {
    const result = await pool.query(
      'SELECT * FROM waiver_rankings WHERE week = $1 ORDER BY waiver_score DESC',
      [week]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch error:', err.message);
    res.status(500).json([]);
  }
});

// ❌ Delete a player
app.delete('/api/waivers/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM waiver_rankings WHERE id = $1 RETURNING *', [
      req.params.id,
    ]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Delete error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
