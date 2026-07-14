export type AiProvider = 'openai' | 'anthropic' | 'deepseek';
export type AiJobType =
  | 'lead_summary'
  | 'next_best_action'
  | 'conversation_reply'
  | 'call_analysis'
  | 'automation_recommendation';

export const AI_PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Claude',
  deepseek: 'DeepSeek',
};

const OUTPUT_SCHEMA = `Return valid JSON only. Use this structure:
{
  "summary": "short factual summary",
  "insights": ["important fact"],
  "recommended_actions": [{"title":"action", "reason":"why", "priority":"normal|important|urgent"}],
  "requires_confirmation": true
}`;

export function buildAiPrompt(jobType: AiJobType, input: Record<string, unknown>) {
  const inputJson = JSON.stringify(input, null, 2).slice(0, 28_000);
  const shared = `You are Negis AI, an assistant inside a multi-tenant CRM.
You help employees prepare work, but you never perform irreversible actions.
Do not invent facts. If information is missing, say so explicitly.
Do not diagnose health conditions, make legal claims, expose confidential data, or send messages on behalf of a business.
All suggested CRM changes require a human confirmation.
${OUTPUT_SCHEMA}`;

  const instructions: Record<AiJobType, string> = {
    lead_summary: 'Summarize the customer history. Extract needs, paid and planned items, objections, open tasks and the next safe step.',
    next_best_action: 'Recommend the next best action for the customer based on the available history. Prefer a concrete, respectful action with a reason and deadline suggestion.',
    conversation_reply: 'Draft a concise reply for an employee. It must be polite, match the conversation language, avoid promises that are not confirmed, and ask one useful clarifying question when needed.',
    call_analysis: 'Analyze a call transcript. Extract intent, objections, commitments, missed questions, next step and a task proposal. Do not fabricate transcript details.',
    automation_recommendation: 'Evaluate whether an automation should be suggested. Return a trigger, conditions, action draft, risks and a human approval requirement. Never activate it automatically.',
  };

  return `${shared}\n\nTask: ${instructions[jobType]}\n\nCRM context:\n${inputJson}`;
}

export function providerSecret(provider: AiProvider) {
  const keyByProvider: Record<AiProvider, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
  };
  const key = Deno.env.get(keyByProvider[provider]);
  if (!key) throw new Error(`${keyByProvider[provider]} is not configured on the server`);
  return key;
}

export function defaultModel(provider: AiProvider) {
  const envByProvider: Record<AiProvider, string> = {
    openai: 'OPENAI_MODEL',
    anthropic: 'ANTHROPIC_MODEL',
    deepseek: 'DEEPSEEK_MODEL',
  };
  const fallback: Record<AiProvider, string> = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-sonnet-latest',
    deepseek: 'deepseek-chat',
  };
  return Deno.env.get(envByProvider[provider]) || fallback[provider];
}

export async function runProviderPrompt(provider: AiProvider, prompt: string, requestedModel?: string) {
  const model = requestedModel?.trim() || defaultModel(provider);
  const apiKey = providerSecret(provider);

  if (provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `Claude API error ${response.status}`);
    return {
      model,
      text: data?.content?.[0]?.text || '',
      usage: data?.usage || {},
    };
  }

  const endpoint = provider === 'deepseek'
    ? 'https://api.deepseek.com/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `${AI_PROVIDER_LABEL[provider]} API error ${response.status}`);
  return {
    model,
    text: data?.choices?.[0]?.message?.content || '',
    usage: data?.usage || {},
  };
}

export function parseAiJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { summary: text, insights: [], recommended_actions: [], requires_confirmation: true };
  }
}
