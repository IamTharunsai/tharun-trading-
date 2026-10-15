# Dashboard data and remaining coverage

The dashboard previously substituted generated prices, stories, order-book prints, option contracts, sector figures and macroeconomic events when observations were absent. Those values could appear next to genuine account data. This repair removes that substitution and makes unavailable coverage visible.

## Read-only sources

| Surface | Evidence | Limits |
| --- | --- | --- |
| Crypto board and screener | Normalized CoinGecko assets, USD prices/volumes, provider update time | Top 20 market-cap assets, not a complete exchange universe; public feed may rate-limit |
| Crypto overview | CoinGecko global observations and Alternative.me sentiment | Separate observation times; missing values stay unknown, including a genuine zero sentiment index |
| Sector view | Alpaca IEX observations for eleven sector ETFs | ETF proxies, not sector capitalization or consolidated exchange coverage |
| Stock screener | Up to 40 configured universe symbols and actual provider snapshots | Names retained when available; unsupported factors, RSI and generated signals removed |
| Treasury curve | FRED per-tenor observations | Missing points remain gaps; spread requires matching dates; historical curves and recession probability unavailable |
| Macro indicators | FRED observed series, exact twelve-month inflation comparison | Series-specific dates; a fresh HTTP response does not mean a fresh economic observation |
| News | Existing authenticated stored-news endpoint | Uses its actual array and field names; no sample headlines, guessed sentiment or invented current timestamps |
| Market recap | Observed screener subset and ETF proxies | Unknown rows excluded from counts; crypto rolling 24-hour changes excluded from stock session breadth |

All requests use the configured authenticated backend client. Public provider requests have fixed origins, deadlines, response-size limits and no redirects. Feed reads coalesce and cache with bounded failure backoff. No trading settings, broker orders or database schema are changed.

## Honest unsupported states

Options-chain data, order-book depth, time and sales, economic events, central-bank calendars, earnings and exchange-wide breadth do not have verified provider contracts here. These surfaces show unavailable states or explicit HTTP 501 responses. They are not completed capabilities. Treasury historical curves and several screener factors are likewise absent.

The panel polling hook binds retained data to the current authentication identity and endpoint, aborts on changes, ignores late responses and prevents overlapping reads. A late 401 from an older identity cannot log out the current identity. This does not certify isolation of every other React Query cache elsewhere in the application.

Observation time, period-start time and response receipt time remain different fields. A daily bar timestamp does not establish when its last close was observed. Model confidence or sentiment is not a calibrated probability of profit.

## Verification scope

Offline checks cover missing/zero/nonfinite values, provider field normalization, dates, partial failures, request bounds, cache receipts, failure boundaries, source markup, unsupported states, nullable recap consumers, safe news links and stale-session identity matching. Providers are mocked, so these tests do not certify configured production accounts or live feed access. Installed compilation and contract tests also run in CI. Actual rendered browser checks and broader provider qualification remain separate release evidence.

This is a data-correctness repair. It does not claim the Rainlight city redesign, complete screen interaction coverage, live Polymarket operation, profitable strategies or a verified historical net-of-cost trading record.
