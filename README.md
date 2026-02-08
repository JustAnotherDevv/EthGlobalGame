# Defi Pirates

A TypeScript monorepo for the ETHGlobal HackMoney hackathon project.

## Project Structure

This is a monorepo with two packages:

```
ethglobal-hackmoney/
├── packages/
│   ├── frontend/
│   └── backend/
├── package.json
└── tsconfig.json
```

## Getting Started

### Prerequisites

- Node.js 24+
- npm 8+

### Installation

Install all dependencies for both packages:

### Development

I used Claude code LLM and Antigravity to aid with building this project.

Request Yellow tokens:

```bash
curl -XPOST https://clearnet-sandbox.yellow.com/faucet/requestTokens \
  -H "Content-Type: application/json" \
  -d '{"userAddress":"<address>"}'
```

Run both frontend and backend concurrently:

````bash
npm run dev
- **Frontend** on http://localhost:5173 (Vite dev server)
- **Backend** on http://localhost:3001 (Express server)

Or run them individually:

```bash
npm run dev:frontend  # Frontend only
npm run dev:backend   # Backend only
````

### Building

Build both packages:

```bash
npm run build
```

Build individually:

```bash
npm run build:frontend
npm run build:backend
```

## Tech Stack

Yellow State Channels - backbone of entire game, all state transitions, player movement, resource collectin and wagers go through them.
