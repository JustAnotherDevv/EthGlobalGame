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

```bash
npm install
```

### Development

Run both frontend and backend concurrently:

```bash
npm run dev
```

This will start:
- **Frontend** on http://localhost:5173 (Vite dev server)
- **Backend** on http://localhost:3001 (Express server)

Or run them individually:

```bash
npm run dev:frontend  # Frontend only
npm run dev:backend   # Backend only
```

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

todo
