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

### If `git pull` still refuses to run
Git will tell you exactly which files would be overwritten. When you see messages that name `client/app/layout.tsx`, `client/app/page.tsx`, `client/tailwind.config.js`, or an untracked `client/app/globals.css`, follow these steps:

1. **Inspect what changed locally**
   ```bash
   git status -sb
   git diff client/app/layout.tsx         # repeat for any other file in the warning
   ```
2. **Keep the edits** – stage and commit them before pulling:
   ```bash
   git add client/app/layout.tsx client/app/page.tsx client/tailwind.config.js client/app/globals.css
   git commit -m "WIP local tweaks"
   git pull origin main
   ```
   You can amend/squash that temporary commit later.
3. **Discard the edits** – reset tracked files and delete untracked ones:
   ```bash
   git checkout -- client/app/layout.tsx client/app/page.tsx client/tailwind.config.js
   rm client/app/globals.css
   git pull origin main
   ```
   Removing the untracked file is what clears the "would be overwritten" warning.
4. **Clean everything in one shot** – only if you truly want a pristine working tree:
   ```bash
   git reset --hard HEAD
   git clean -fd      # removes untracked files/folders such as client/app/globals.css
   git pull origin main
   ```
   This recreates the exact state of your last commit before fetching the latest updates.

### Automated repair helper
If you just want the repo to "work" again (aborting merges, backing up your work, cleaning the tree, and pulling `origin/main`)
run:

```bash
npm run git:repair
```

The script performs these steps safely on macOS/Linux/Windows:

1. Aborts any unfinished merge (`git merge --abort`).
2. Stashes all tracked + untracked edits under a timestamped label (so you can `git stash pop` afterward).
3. Hard-resets tracked files and removes untracked clutter.
4. Fetches and pulls the latest `origin/main`.

If you want to reapply the stashed work, run `git stash list` to find the `pull-repair-*` entry and then `git stash pop`.

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
