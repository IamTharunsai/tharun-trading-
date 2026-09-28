// SEC EDGAR rejects (HTTP 403) requests without a descriptive User-Agent that
// includes a real contact email: https://www.sec.gov/os/accessing-edgar-data
export function secUserAgent(): string {
  if (process.env.SEC_USER_AGENT) return process.env.SEC_USER_AGENT;
  const email = process.env.OWNER_EMAIL || process.env.SEC_CONTACT_EMAIL;
  return email ? `TharunTradingResearch ${email}` : 'TharunTradingResearch research-bot';
}
