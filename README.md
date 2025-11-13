# Fantasy Waiver Tool

A lightweight stack (Next.js client + Express proxy) for ranking waiver-wire targets with predictive inputs, weather context, opponent strength, and Vegas implied totals.

## Features
- **Glass dashboard UI** that persists every player in `localStorage` and surfaces composite scores, positional leaders, and CSV export.
- **Weather, defensive ranks, and Vegas totals** are fetched automatically via the bundled Express proxy so the browser never trips over CORS limits.
- **Form validation + helpful system notes** ensure you log the key metrics (routes, targets, PPR, etc.) before players are added.

## Prerequisites
- Node.js 18+
- npm 10+

## Opening the project in VS Code
1. **Clone or update the repo**
   ```bash
   git clone https://github.com/Mpeters9/fantasy-waiver-tool.git
   cd fantasy-waiver-tool
   ```
   If you already have a local copy, sync it before launching VS Code:
   ```bash
   git pull origin main
   ```
2. **Launch VS Code from the project root**
   ```bash
   code .
   ```
   VS Code will detect both the `client` and `server` folders as workspaces. Accept any prompts to install recommended extensi
   ons.
3. **Handling "local changes would be overwritten" errors**
   - Either **commit** your edits (`git add -A && git commit -m "Your message"`), or
   - **Stash** them temporarily:
     ```bash
     git stash push --include-untracked
     git pull origin main
     git stash pop   # re-apply your changes after updating
     ```
   This mirrors the guidance surfaced by the VS Code Git log you shared and lets you safely pull the remote updates before co
   ntinuing work.

## Running the stack locally
1. **Start the API proxy**
   ```bash
   cd server
   npm install   # first-time setup; skip if node_modules already exist
   npm start
   ```
2. **Start the Next.js client**
   ```bash
   cd client
   npm install   # optional if node_modules already exist
   npm run dev
   ```
3. Open `http://localhost:3000` in your browser. The client points at the proxy via `NEXT_PUBLIC_SERVER_URL` (defaults to `http://localhost:5000`). If you host the proxy somewhere else, create `client/.env.local` with:
   ```env
   NEXT_PUBLIC_SERVER_URL=https://your-proxy.example.com
   ```

## Useful endpoints
| Route | Description |
| --- | --- |
| `GET /api/defense-rankings` | Cached FantasyLife defensive matchup data |
| `GET /api/vegas-implied/:team` | Cached ESPN scoreboard scraper that returns the implied total for the requested team |
| `GET /api/test` | Simple health check |

## Troubleshooting
- **`next: not found` on Linux containers** – the repository currently checks in a Windows `node_modules` folder. Reinstalling dependencies inside *your own clone* (`rm -rf client/node_modules && npm install`) will regenerate Linux-friendly binaries, but be mindful this will touch a tracked tree if you are working directly in this repo.
- **Implied totals return `N/A`** – ensure the server proxy is running; the client will fall back to the default team total (22 points) if the API route is unreachable.
