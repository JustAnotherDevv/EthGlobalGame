export const GRID_SIZE = 400;
export const HARVEST_DURATION_MS = parseInt(process.env.HARVEST_DURATION_MS || '3000', 10);
export const DIG_DURATION_MS = parseInt(process.env.DIG_DURATION_MS || '3000', 10);
export const CHEST_FIND_RADIUS = parseFloat(process.env.CHEST_FIND_RADIUS || '2.0');
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
export const GAME_TIMEOUT_MS = parseInt(process.env.GAME_TIMEOUT_MS || '1800000', 10);
export const POSITION_SEND_RATE_MS = 50;
export const SYNC_BROADCAST_RATE_MS = 100;
export const RESOURCE_COUNT = 200;
export const YELLOW_ASSET = 'ytest.usd';
export const MAX_SPEED = parseInt(process.env.MAX_SPEED || '40', 10);
export const SPEED_TOLERANCE = 1.5;
export const HARVEST_PROXIMITY = 5.0;
export const COUNTDOWN_MS = parseInt(process.env.COUNTDOWN_MS || '10000', 10);

// Upgrade tuning
export const BERRY_SPEED_BONUS = 0.08;         // +8% speed per berry
export const DIG_UPGRADE_STONE_COST = 5;        // stone needed per dig upgrade
export const DIG_UPGRADE_WOOD_COST = 5;         // wood needed per dig upgrade
export const DIG_UPGRADE_MULTIPLIER = 0.90;     // 10% faster per upgrade (stacks)
export const MAP_WOOD_COST = 50;                // wood needed for treasure map
export const MAP_REVEAL_RADIUS = 25;            // chest area hint radius
