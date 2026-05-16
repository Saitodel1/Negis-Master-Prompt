const FB_API_BASE = 'https://graph.facebook.com/v18.0';

export async function fetchFacebookReport(
  accountId: string,
  accessToken: string,
  dateStart: string,
  dateEnd: string
) {
  const fields = ['impressions', 'clicks', 'actions', 'spend', 'ctr', 'cost_per_action_type'].join(',');
  const url = `${FB_API_BASE}/${accountId}/insights?fields=${fields}&time_range={"since":"${dateStart}","until":"${dateEnd}"}&access_token=${accessToken}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  const leads = data.data[0]?.actions?.find((a: any) => a.action_type === 'lead')?.value || 0;
  return {
    impressions: parseInt(data.data[0]?.impressions || '0'),
    clicks: parseInt(data.data[0]?.clicks || '0'),
    leads: parseInt(leads),
    spend: parseFloat(data.data[0]?.spend || '0'),
    ctr: parseFloat(data.data[0]?.ctr || '0'),
    cpl: parseInt(leads) > 0 ? parseFloat(data.data[0]?.spend || '0') / parseInt(leads) : 0,
  };
}

export async function fetchFacebookCampaigns(
  accountId: string,
  accessToken: string,
  dateStart: string,
  dateEnd: string
) {
  const fields = ['campaign_name', 'campaign_id', 'impressions', 'clicks', 'actions', 'spend', 'ctr'].join(',');
  const url = `${FB_API_BASE}/${accountId}/insights?fields=${fields}&level=campaign&time_range={"since":"${dateStart}","until":"${dateEnd}"}&access_token=${accessToken}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.data || [];
}

export async function verifyFacebookAccount(accountId: string, accessToken: string) {
  const url = `${FB_API_BASE}/${accountId}?fields=name,account_status&access_token=${accessToken}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return { name: data.name || accountId, status: data.account_status };
}
