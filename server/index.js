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

// ✅ Defense Rankings Proxy — avoids CORS
app.get("/api/defense-rankings", async (req, res) => {
  try {
    const resp = await fetch("https://api.fantasylife.com/v1/nfl/defense-rankings");
    const data = await resp.json();
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
