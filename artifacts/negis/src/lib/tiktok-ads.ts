const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

export async function fetchTikTokReport(
  advertiserId: string,
  accessToken: string,
  dateStart: string,
  dateEnd: string
) {
  const body = {
    advertiser_id: advertiserId,
    report_type: 'BASIC',
    dimensions: ['stat_time_day'],
    metrics: ['impressions', 'clicks', 'conversion', 'spend', 'ctr', 'cost_per_conversion'],
    data_level: 'AUCTION_ADVERTISER',
    start_date: dateStart,
    end_date: dateEnd,
    page_size: 100,
  };
  const response = await fetch(`${TIKTOK_API_BASE}/report/integrated/get/`, {
    method: 'POST',
    headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (data.code !== 0) throw new Error(data.message);
  const rows = data.data?.list || [];
  return rows.reduce(
    (acc: any, row: any) => ({
      impressions: acc.impressions + parseInt(row.metrics.impressions || '0'),
      clicks: acc.clicks + parseInt(row.metrics.clicks || '0'),
      leads: acc.leads + parseInt(row.metrics.conversion || '0'),
      spend: acc.spend + parseFloat(row.metrics.spend || '0'),
      ctr: parseFloat(row.metrics.ctr || '0'),
      cpl: parseFloat(row.metrics.cost_per_conversion || '0'),
    }),
    { impressions: 0, clicks: 0, leads: 0, spend: 0, ctr: 0, cpl: 0 }
  );
}

export async function fetchTikTokCampaigns(
  advertiserId: string,
  accessToken: string,
  dateStart: string,
  dateEnd: string
) {
  const body = {
    advertiser_id: advertiserId,
    report_type: 'BASIC',
    dimensions: ['campaign_id', 'campaign_name'],
    metrics: ['impressions', 'clicks', 'conversion', 'spend', 'ctr', 'cost_per_conversion'],
    data_level: 'AUCTION_CAMPAIGN',
    start_date: dateStart,
    end_date: dateEnd,
    page_size: 100,
  };
  const response = await fetch(`${TIKTOK_API_BASE}/report/integrated/get/`, {
    method: 'POST',
    headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (data.code !== 0) throw new Error(data.message);
  return data.data?.list || [];
}

export async function verifyTikTokAccount(advertiserId: string, accessToken: string) {
  const response = await fetch(
    `${TIKTOK_API_BASE}/advertiser/info/?advertiser_ids=["${advertiserId}"]`,
    { headers: { 'Access-Token': accessToken } }
  );
  const data = await response.json();
  if (data.code !== 0) throw new Error(data.message);
  const info = data.data?.list?.[0];
  return { name: info?.advertiser_name || advertiserId };
}
