# Evidence-backed research notes

The old `/api/market/ai-deep-dive` endpoint could return the same bullish note for
every asset when Gemini was missing, failed or returned empty text. That note
included invented conviction, technical indicators, fundamentals, targets and
portfolio sizing. Its provider prompt also requested exact execution parameters
without supplying actual market or account observations.

The endpoint now requires owner access and accepts only a bounded symbol and
`stock` or `crypto` class. It reads the exact stock symbol from Alpaca IEX or an
unambiguous asset in the existing top-twenty CoinGecko feed. Quotes retain exchange
observation time, daily-bar period start and server receipt time separately.
Missing or corrupt evidence returns an explicit error before any model request.
A symbol outside the crypto feed's coverage is unavailable, not a guessed coin.

Only normalized price, change and volume observations reach the configured shared
completion router. The request asks for a structured research interpretation;
each observation must reference a fact ID actually supplied. Missing, partial,
malformed or otherwise rejected provider completions cannot become a successful
static recommendation. The existing completion router validates terminal finish
states; this endpoint also validates its own bounded strict JSON domain schema.

The compatibility `analysis` string separates source observations from explicitly
unverified model interpretation and missing evidence. The response includes
`facts`, `interpretation`, `interpretationVerified:false`,
`status:research_only` and `tradingAuthority:false`. It does not establish a
calibrated forecast, profitable strategy or executable order. A schema-valid
interpretation can still be wrong; fact-reference validation does not prove the
model's reasoning or prevent all unsupported qualitative claims.

One accepted note is allowed per process at a time, and a process-local owner
limiter allows five requests per fifteen minutes. These are abuse bounds, not a
persistent multi-instance dollar budget. Restart resets the limiter; provider
spending controls and a shared usage ledger remain separate work. Client close
or the absolute request deadline aborts the completion signal. Quote reads have
their existing eight-second transport bound. No broker, portfolio mutation,
order submission or automatic trading entry point is introduced.

The new dedicated CI workflow explicitly typechecks source and both new test
suites, then runs typed mocked tests in a network-disabled, read-only,
resource-bounded container. Dependency preparation happens separately. Local
target execution was not performed. A passing exact-head job is required before
claiming runtime validation; fixture providers do not prove live credentials,
feed coverage, model accuracy or production behavior.

## Implementation references

- [Express 4 routing](https://expressjs.com/en/4x/api/#router)
- [express-rate-limit configuration](https://express-rate-limit.mintlify.app/reference/configuration#limit)
- [Node 20 abort deadlines](https://nodejs.org/docs/latest-v20.x/api/globals.html#static-method-abortsignaltimeoutdelay)
- [Alpaca stock snapshots](https://docs.alpaca.markets/us/reference/stocksnapshots-1)
