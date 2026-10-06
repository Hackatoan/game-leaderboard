export interface LeaderboardRow { player: string; wins: number; losses: number; draws: number; games_played: number }
export interface AntiCheatOptions { pairWindowMs?: number; maxPerPair?: number; nameWindowMs?: number; maxPerName?: number; minDurationMs?: number }
export interface Options { gameId?: string; connectionString?: string; pool?: unknown; max?: number; antiCheat?: AntiCheatOptions; profanity?: boolean; scoreBounds?: { min?: number; max?: number; integer?: boolean }; log?: (...a: unknown[]) => void }
export interface Result { recorded: boolean; reason?: string }
export interface Leaderboard {
  GAME: string; cleanName(n: unknown): string; isProfane(n: string): boolean; safeName(n: string): string;
  recordResult(player: string, outcome: 'win' | 'loss' | 'draw', uid?: string | null): Promise<Result>;
  recordMatch(a: string, b: string, winner: string | null, uidA?: string | null, uidB?: string | null, meta?: { durationMs?: number }): Promise<Result>;
  claimNickname(nickname: string, uid: string, displayName?: string): Promise<{ ok: boolean; reason?: string }>;
  getLeaderboard(limit?: number): Promise<LeaderboardRow[]>;
  ensureScoreTable(): Promise<void>;
  recordScore(player: string, score: number, bounds?: { min?: number; max?: number; integer?: boolean }): Promise<Result>;
  getTopScores(limit?: number): Promise<{ player: string; best_score: string; plays: number }[]>;
}
declare function createLeaderboard(opts?: Options): Leaderboard;
export default createLeaderboard;
export { createLeaderboard };
export function cleanName(n: unknown): string;
export function isProfane(n: string): boolean;
export function safeName(n: string): string;
export function createGuard(o?: AntiCheatOptions & { now?: () => number }): any;
export function rateLimiter(o?: { windowMs?: number; max?: number }): (req: any, res: any, next: () => void) => void;
