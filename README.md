# token-radar-volume-breakout

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rafaelsantos-source/token-radar-volume-breakout/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rafaelsantos-source/token-radar-volume-breakout/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Volume Breakout Radar — a token launch radar that ranks pre-token protocols by **arriving capital**, not parked TVL. Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

A launch is worth most when capital is arriving. The model is `implied = TVL × 0.30 × momentum × maturity × breadth × tier`, where momentum follows the protocol's seven-day TVL change (clamped to −70%…+100%, so a +4,448% print is a spike, not a breakout), maturity grows with days listed with no token, and the tier is the pre-token cohort's own distribution: BREAKOUT at or above its 90th percentile of seven-day growth, HEATING at or above the 75th. Every figure comes from the snapshot alone; no protocol name is special-cased. An implied value is this radar's own claim, never a prediction that a token will launch, or when.

The board covers all 40 watchlist protocols plus 147 early pre-token finds below the $50M floor that pass the house's own screen (no wrapped, staked or bridged product, no bridge, no exchange). Each row carries a six-step farm plan with costs and times. Live-token protocols are shown apart at the market's own values.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Then open `out/dashboard/index.html` in a browser. Node 22.18 or later, nothing to install.

---

<sub>Entered on [make.fun](https://make.fun/?ref=&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
