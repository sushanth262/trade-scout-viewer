# my-scoutify — Trade Scout Viewer

A real-time trade task and transaction log viewer for the **earnings-trade** bot. Built with Next.js, Azure Cosmos DB, and an Aura-inspired design system.

## Features

- **Dashboard** — KPI metrics, status breakdown, and recent activity at a glance
- **Trade Log** — Filterable, paginated view of all trade executions and stop events
- **Signals** — Screened tickers with conviction, rating, insider data, and sentiment
- **Positions** — Open and closed position cards with P&L tracking
- **Activity Feed** — Chronological timeline grouped by date with event details
- **Cosmos DB** — Free-tier Azure Cosmos DB for persistent, queryable log storage
- **Ingest API** — POST endpoints to push `trades_log.jsonl` and `signals.json` data

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router, standalone output) |
| Language | TypeScript |
| Database | Azure Cosmos DB (free tier, SQL API) |
| Icons | Lucide React |
| Styling | CSS Modules with Aura-inspired design tokens |
| Deployment | Docker, Azure VM |

## Quick Start

```bash
# Install dependencies
npm install

# Set environment variables
cp .env.example .env.local
# Edit .env.local with your Cosmos DB credentials

# Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `COSMOS_ENDPOINT` | Azure Cosmos DB endpoint URL |
| `COSMOS_KEY` | Azure Cosmos DB primary key |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/trades` | List trades (filters: `ticker`, `status`, `event`, `source`, `from`, `to`) |
| POST | `/api/trades` | Ingest trade events (single or array) |
| GET | `/api/signals` | List signals (filters: `ticker`, `rating`, `conviction`, `sector`, `confirmed`) |
| POST | `/api/signals` | Ingest signal data (single or array) |
| GET | `/api/stats` | Dashboard aggregate metrics |

## Deployment

See [DEPLOY.md](DEPLOY.md) for full VM deployment instructions.

```bash
# Build and push Docker image
./deploy.sh --build

# Deploy to VM
./deploy.sh
```

## Project Structure

```
src/
├── app/
│   ├── api/          # Cosmos DB API routes (trades, signals, stats)
│   ├── trades/       # Trade log page
│   ├── signals/      # Signal screener page
│   ├── positions/    # Position tracker page
│   ├── activity/     # Activity timeline page
│   └── page.tsx      # Dashboard
├── components/
│   ├── layout/       # Sidebar, MobileNav
│   └── ui/           # Card, MetricCard, StatusChip, FilterBar, DataTable
├── lib/
│   ├── cosmos.ts     # Cosmos DB client and types
│   └── api.ts        # Client-side fetch helper
└── theme/
    └── tokens.ts     # Design tokens (colors, radius, shadows)
```
