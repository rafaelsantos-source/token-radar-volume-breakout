// Volume Breakout Radar — the model for token-radar-01, attempt 6.
//
// Angle: volume breakout. A launch is worth most when capital is *arriving*,
// not merely parked. So this radar ranks pre-token protocols by a breakout
// score built from the snapshot's own figures: how much TVL the protocol
// holds, how fast that TVL moved in the last seven days, how long the
// protocol has run with no token, and how widely it is deployed. No protocol
// name is ever special-cased: the same function scores every row.
//
//   growth     = clamp(change_7d, -70, +100) per cent (null -> 0)
//   momentum   = 1 + 0.55 * growth / 100
//   maturity   = 0.6 + 0.4 * min(age_days, 1095) / 1095   (age unknown: 365)
//   breadth    = 1 + 0.03 * min(max(chains - 1, 0), 4)
//   tier       = growth >= p90 -> BREAKOUT x1.15
//              | growth >= p75 -> HEATING  x1.06
//              | otherwise     -> STEADY   x1.00
//   implied    = max(1, round(tvl_usd * 0.30 * momentum * maturity * breadth * tier))
//
// The p75/p90 cutoffs are computed from the pre-token cohort itself, so the
// tiers are relative to the market that week, not to a magic number. Extreme
// prints (one protocol shows +4,448% in seven days) are clamped to +100%:
// a data spike is not a breakout. Negative growth still counts, it just
// drags the momentum factor below 1.
//
// The board holds every watchlist slug plus every other pre-token protocol
// that passes the house's own screen (no wrapped/staked/bridged product, no
// bridge or exchange, no version-suffixed name). Protocols whose token
// already trades are kept apart and shown at the market's own values, never
// mixed into the ranked board.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_days: number;
  unknown_age_days: number;
  breakout_mult: number;
  heating_mult: number;
  breadth_step: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_weight: 0.55,
  growth_floor: -70,
  growth_cap: 100,
  maturity_floor: 0.6,
  maturity_days: 1095,
  unknown_age_days: 365,
  breakout_mult: 1.15,
  heating_mult: 1.06,
  breadth_step: 0.03,
};

/** One ranked board row: the gate's fields plus the display fields the page needs. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  tier: 'breakout' | 'heating' | 'steady';
  momentum: number;
  maturity: number;
  breadth: number;
  on_watchlist: boolean;
}

/** A live-token protocol, shown apart at the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number;
}

/** Everything the dashboard needs, serialised as data.js. */
export interface Radar {
  as_of: string;
  floor_usd: number;
  model: ModelConstants;
  growth_p75: number;
  growth_p90: number;
  board_size: number;
  watchlist_size: number;
  breakout_count: number;
  heating_count: number;
  rows: BoardRow[];
  live: LiveRow[];
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Whole days between the snapshot's as_of day and a protocol's listed_at day. */
export function ageDays(p: SnapshotProtocol, asOf: string): number {
  if (p.listed_at === null) return MODEL.unknown_age_days;
  const ms = Date.parse(asOf) - Date.parse(p.listed_at);
  if (!Number.isFinite(ms) || ms < 0) return MODEL.unknown_age_days;
  return Math.floor(ms / 86_400_000);
}

/** True when the snapshot records no token for the protocol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

/** The house's screen, re-applied to protocols below the watchlist floor:
 *  no wrapped/staked/bridged product, no bridge, no exchange, no versioned name. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIXES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];

export function passesScreen(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  const lower = p.name.toLowerCase();
  if (/\s(v2|v3|2\.0|3\.0)$/.test(p.name)) return false;
  if (/\bwrapped\b|\bstaked\b|\bstaking\b/.test(lower)) return false;
  if (EXCHANGE_PREFIXES.some((e) => lower.startsWith(e))) return false;
  return true;
}

/** Percentile of a sorted array, nearest-rank. */
function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = clamp(Math.ceil((q / 100) * sorted.length) - 1, 0, sorted.length - 1);
  return sorted[idx]!;
}

/** Score one pre-token protocol. Pure function of the snapshot's figures. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  p75: number,
  p90: number,
): Omit<BoardRow, 'rank' | 'farm_steps' | 'on_watchlist'> {
  const growth = clamp(p.change_7d ?? 0, MODEL.growth_floor, MODEL.growth_cap);
  const momentum = 1 + MODEL.growth_weight * (growth / 100);
  const age = ageDays(p, asOf);
  const maturity = MODEL.maturity_floor + (1 - MODEL.maturity_floor) * (Math.min(age, MODEL.maturity_days) / MODEL.maturity_days);
  const breadth = 1 + MODEL.breadth_step * Math.min(Math.max(p.chains.length - 1, 0), 4);
  const tier: BoardRow['tier'] = growth >= p90 ? 'breakout' : growth >= p75 ? 'heating' : 'steady';
  const tierMult = tier === 'breakout' ? MODEL.breakout_mult : tier === 'heating' ? MODEL.heating_mult : 1;
  const implied = Math.max(1, Math.round(p.tvl_usd * MODEL.base_multiple * momentum * maturity * breadth * tierMult));
  return {
    slug: p.slug,
    name: p.name,
    implied_value_usd: implied,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    age_days: age,
    tier,
    momentum,
    maturity,
    breadth,
  };
}

// ---------------------------------------------------------------- farm plans

type StepFn = (name: string, chain: string, chain2: string) => string;

function fill(tpl: string, name: string, chain: string, chain2: string): string {
  return tpl.replaceAll('{name}', name).replaceAll('{chain}', chain).replaceAll('{chain2}', chain2);
}

function family(steps: string[]): StepFn[] {
  return steps.map((s) => (name: string, chain: string, chain2: string) => fill(s, name, chain, chain2));
}

const DEX: StepFn[] = family([
  'Open {name} on {chain} and connect a fresh wallet you control; a first visit takes about 5 minutes and costs nothing until you transact.',
  'Swap $50 to $200 of a major asset (ETH or a stablecoin) into the pool\u2019s paired asset on {name}; expect $1 to $10 in network fees on {chain}.',
  'Add both assets as liquidity in {name}\u2019s main pool and keep the position receipt; the deposit confirms in 1 to 3 minutes.',
  'If {name} runs a points program, check the page shows your deposit and any points balance before you leave; screenshot it for your records.',
  'Return weekly and top the position up by $25 to $100, or rebalance if the pool drifts far from your entry ratio; each visit takes 10 to 20 minutes.',
  'When you exit, remove liquidity in one transaction ($1 to $10 on {chain}) and move the proceeds back to a major asset the same day.',
]);

const LENDING: StepFn[] = family([
  'Open {name} on {chain}, connect a wallet, and read the market page for the asset you plan to supply; setup takes about 10 minutes.',
  'Supply $100 to $500 of a major asset (ETH, wBTC or a stablecoin) as collateral; the deposit costs one transaction, roughly $1 to $10 on {chain}.',
  'Borrow no more than 40% of your collateral value, in a stablecoin, so a price swing does not liquidate you; the borrow is a second transaction.',
  'Put the borrowed stablecoins to work off-protocol (a savings vault or a second {name} market) and note the borrow rate you accepted.',
  'Check the health factor weekly and repay part of the loan if it falls under 1.5; each check takes 5 minutes, a repayment costs $1 to $10.',
  'To exit, repay the loan in full, then withdraw the collateral in one more transaction; keep $10 aside for gas on {chain} until you are done.',
]);

const YIELD: StepFn[] = family([
  'Open {name} on {chain} and read the vault list; pick the vault whose underlying asset you already hold, so no extra swap is needed.',
  'Deposit $100 to $500 into that vault in one transaction; expect $1 to $10 in gas on {chain} and confirmation in 1 to 3 minutes.',
  'Confirm the vault receipt token (or share balance) appears in your wallet before you close the page; note the vault address and your entry date.',
  'Leave the deposit compounding for at least 30 days; check the vault\u2019s yield and TVL weekly, which takes about 5 minutes per visit.',
  'If the vault\u2019s TVL falls more than 20% in a week, read its announcement channel before adding more; do not chase a falling vault.',
  'To exit, withdraw from the vault in one transaction, then swap the receipt token back to a stablecoin; budget $2 to $15 total in fees.',
]);

const DERIVATIVES: StepFn[] = family([
  'Open {name} on {chain} and connect a wallet; read the trading rules and the funding-rate page before depositing anything, about 15 minutes.',
  'Deposit $100 to $300 of collateral (a stablecoin) into your {name} margin account; the deposit is one transaction, $1 to $10 on {chain}.',
  'Open a small first position (no more than 2x leverage) in the market you follow most closely, and set a stop-loss at once; the trade takes minutes.',
  'Keep the position\u2019s notional under 25% of your deposited collateral so a wick does not liquidate you; check funding every day for the first week.',
  'Close or trim the position after 7 to 14 days, or sooner if it moves 20% against you; each close is one transaction, $1 to $10.',
  'Withdraw the remaining collateral to your wallet and record the trade (entry, exit, fees) in a note; repeat only with profits, never with fresh debt.',
]);

const CDP: StepFn[] = family([
  'Open {name} on {chain} and read the collateral list and the minimum collateral ratio; setup and reading take about 15 minutes.',
  'Lock $200 to $1,000 of accepted collateral (ETH or a liquid-staked asset) in a new vault; the lock is one transaction, $1 to $10 on {chain}.',
  'Mint stablecoins against it up to 40% of the collateral value, never more; minting is a second transaction and takes 1 to 3 minutes.',
  'Use the minted stablecoins for a productive purpose (a yield vault or paying down another loan) and write down the mint amount and date.',
  'Watch the collateral ratio weekly and top up collateral if it drifts toward the liquidation line; a top-up costs one transaction, $1 to $10.',
  'To close, repay the minted amount in full, then unlock the collateral; keep $10 aside for gas on {chain} until the vault shows zero debt.',
]);

const RWA: StepFn[] = family([
  'Open {name} on {chain} and read which real-world assets it tokenises and who can hold them; some offerings are restricted by region, so check first.',
  'Complete any identity check {name} requires before you can buy; this takes 10 to 30 minutes plus whatever review time the issuer states.',
  'Buy $100 to $500 of the tokenised asset in one transaction; expect $1 to $10 in network fees on {chain} and a receipt in your wallet.',
  'Confirm the holding and its stated yield or redemption terms on the {name} page, and save the offering document beside your transaction hash.',
  'Hold for at least 90 days to match the asset\u2019s own cycle; check the issuer\u2019s updates monthly, about 10 minutes per check.',
  'To exit, sell or redeem through {name}\u2019s own redemption flow (not a random DEX pool) and allow several days for settlement if the terms say so.',
]);

const VAULT: StepFn[] = family([
  'Open {name} on {chain} and read the curator or vault description; understand what strategy the vault runs before depositing, about 15 minutes.',
  'Deposit $100 to $500 of a major asset into the vault in one transaction; expect $1 to $10 in gas on {chain} and confirmation in 1 to 3 minutes.',
  'Confirm your vault shares appear in your wallet and note the vault\u2019s fee (performance fee and any withdrawal fee) from its page.',
  'Check the vault\u2019s allocation and returns weekly for the first month; each check takes about 5 minutes and needs no transaction.',
  'If the strategy changes (a new market or a new curator), re-read the vault page before adding funds; never add on an announcement alone.',
  'To exit, withdraw in one transaction and swap the returned assets back to a stablecoin; budget $2 to $15 in total fees on {chain}.',
]);

const GENERIC: StepFn[] = family([
  'Open {name} on {chain} and connect a wallet you control; read the protocol\u2019s docs page first, which takes about 15 minutes.',
  'Move $100 to $500 of a major asset (ETH or a stablecoin) onto {chain} using {name}\u2019s official bridge or deposit page; expect $2 to $10 in fees.',
  'Use the protocol\u2019s core action once (supply, swap, stake or deposit, whichever {name} is built for) with a small amount to learn the flow.',
  'Confirm the position shows in your wallet or on the {name} dashboard, and write down the transaction hash, the amount and the date.',
  'Return weekly for a month and repeat the core action in $25 to $100 steps; each visit takes 10 to 20 minutes including fees.',
  'To exit, reverse the position in one or two transactions and move the funds back to a stablecoin; keep $10 aside for gas on {chain}.',
]);

/** Pick the farm-plan family for a protocol's category. */
function familyFor(category: string | null): StepFn[] {
  switch (category) {
    case 'Dexs':
      return DEX;
    case 'Lending':
      return LENDING;
    case 'Yield':
    case 'Yield Aggregator':
      return YIELD;
    case 'Derivatives':
    case 'Basis Trading':
      return DERIVATIVES;
    case 'CDP':
      return CDP;
    case 'RWA':
      return RWA;
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
    case 'Staking Pool':
      return VAULT;
    default:
      return GENERIC;
  }
}

/** Six concrete farm steps for a protocol, from its category and chains. */
export function farmSteps(p: SnapshotProtocol): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const chain2 = p.chains[1] ?? p.chains[0] ?? 'Ethereum';
  return familyFor(p.category).map((fn) => fn(p.name, chain, chain2));
}

// ---------------------------------------------------------------- build

/** Parse and minimally validate the snapshot JSON text. */
export function parseSnapshot(text: string): Snapshot {
  const doc = JSON.parse(text) as Snapshot;
  if (!Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return doc;
}

/** Build the ranked board and the radar payload for the dashboard. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const pre = snapshot.protocols.filter(isPreToken);
  const growths = pre
    .map((p) => p.change_7d)
    .filter((g): g is number => g !== null)
    .sort((a, b) => a - b);
  const p75 = percentile(growths, 75);
  const p90 = percentile(growths, 90);

  const watch = new Set(snapshot.watchlist);
  const scored = pre
    .filter((p) => watch.has(p.slug) || passesScreen(p))
    .map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, p75, p90) }));
  // Highest implied value first; ties break by TVL, then slug, so the run is deterministic.
  scored.sort((a, b) => b.s.implied_value_usd - a.s.implied_value_usd || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const board: BoardRow[] = scored.map((item, i) => ({
    ...item.s,
    rank: i + 1,
    farm_steps: farmSteps(item.p),
    on_watchlist: watch.has(item.p.slug),
  }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, 25)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd ?? 0,
    }));

  const radar: Radar = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    growth_p75: p75,
    growth_p90: p90,
    board_size: board.length,
    watchlist_size: snapshot.watchlist.length,
    breakout_count: board.filter((r) => r.tier === 'breakout').length,
    heating_count: board.filter((r) => r.tier === 'heating').length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The gate's own shape, checked before anything is written. Returns the first problem or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, the gate wants 100 to 4000`;
  const seen = new Set<string>();
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${row.slug} has rank ${row.rank}, expected ${i + 1}`;
    if (i > 0 && row.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `implied value rises at rank ${row.rank}`;
    }
    if (seen.has(row.slug)) return `duplicate slug ${row.slug}`;
    seen.add(row.slug);
    if (!snapshot.protocols.some((p) => p.slug === row.slug)) return `unknown slug ${row.slug}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `row ${row.slug} has a bad implied value`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    }
    for (const step of row.farm_steps) {
      const t = step.trim();
      if (t.length < 20 || t.length > 600) return `row ${row.slug} has a farm step of ${t.length} characters`;
    }
  }
  if (board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) {
    return 'every implied value is the same: not a ranking';
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data file: one global, no network, no imports. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
