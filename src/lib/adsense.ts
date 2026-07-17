// Thin wrapper around the AdSense Management API v2's reports:generate
// endpoint. Requires an OAuth2 access token for a service/user account with
// access to the AdSense property; token acquisition is out of scope here and
// handled by the caller (the settlement script).

export interface EarningsPeriod {
  start: Date;
  end: Date;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function fetchAdsenseEarnings(
  period: EarningsPeriod,
  accessToken: string,
): Promise<number> {
  const accountId = process.env.ADSENSE_ACCOUNT_ID;
  if (!accountId) throw new Error("ADSENSE_ACCOUNT_ID is not configured");

  const url = new URL(
    `https://adsense.googleapis.com/v2/accounts/${accountId}/reports:generate`,
  );
  url.searchParams.set("dateRange", "CUSTOM");
  url.searchParams.set("startDate.year", String(period.start.getUTCFullYear()));
  url.searchParams.set("startDate.month", String(period.start.getUTCMonth() + 1));
  url.searchParams.set("startDate.day", String(period.start.getUTCDate()));
  url.searchParams.set("endDate.year", String(period.end.getUTCFullYear()));
  url.searchParams.set("endDate.month", String(period.end.getUTCMonth() + 1));
  url.searchParams.set("endDate.day", String(period.end.getUTCDate()));
  url.searchParams.set("metrics", "ESTIMATED_EARNINGS");

  console.log(`[adsense] fetching earnings for ${isoDate(period.start)}..${isoDate(period.end)}`);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`AdSense API error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { totals?: { cells?: { value?: string }[] } };
  const raw = json.totals?.cells?.[json.totals.cells.length - 1]?.value ?? "0";
  return parseFloat(raw);
}
