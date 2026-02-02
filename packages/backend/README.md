# Backend Package

Express.js backend for ETHGlobal HackMoney project.

## Getting Started

### Install Dependencies

From the root directory:
```bash
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and configure:
```bash
cp .env.example .env
```

### Development

Run the backend dev server:
```bash
npm run dev:backend
```

Or run both frontend and backend:
```bash
npm run dev
```

The server will start on `http://localhost:3001`

### API Endpoints

todo

## Building for Production

```bash
npm run build:backend
npm run start --workspace=@ethglobal-hackmoney/backend
```
