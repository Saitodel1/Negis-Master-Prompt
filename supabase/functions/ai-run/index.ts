import { assertClinicAccess, requireUser } from '../_shared/auth.ts';
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import {
  buildAiPrompt,
  parseAiJson,
  runProviderPrompt,
  type AiJobType,
  type AiProvider,
} from '../_shared/ai.ts';

const PROVIDERS = new Set<AiProvider>(['openai', 'anthropic', 'deepseek']);
const JOB_TYPES = new Set<AiJobType>([
  'lead_summary',
  'next_best_action',
  'conversation_reply',
  'call_analysis',
  'automation_recommendation',
]);

Deno.serve(async req => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
    const { supabase, user } = await requireUser(req);
    const body = await req.json();
    const clinicId = String(body.clinicId || '');
    const provider = String(body.provider || '') as AiProvider;
    const jobType = String(body.jobType || '') as AiJobType;
    const input = body.input && typeof body.input === 'object' ? body.input as Record<string, unknown> : {};
    const leadId = body.leadId ? String(body.leadId) : null;
    const requestedModel = body.model ? String(body.model) : undefined;

    if (!clinicId || !PROVIDERS.has(provider) || !JOB_TYPES.has(jobType)) {
      return jsonResponse({ error: 'clinicId, provider and jobType are required' }, { status: 400 });
    }
    await assertClinicAccess(supabase, user.id, clinicId);

    const { data: agent } = await supabase
      .from('agents')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('user_id', user.id)
      .maybeSingle();

    const prompt = buildAiPrompt(jobType, input);
    const { data: job, error: createError } = await supabase
      .from('ai_jobs')
      .insert({
        clinic_id: clinicId,
        lead_id: leadId,
        provider,
        job_type: jobType,
        status: 'running',
        input,
        requested_by: agent?.id || null,
      })
      .select('id')
      .single();
    if (createError) throw createError;

    try {
      const answer = await runProviderPrompt(provider, prompt, requestedModel);
      const output = parseAiJson(answer.text);
      await supabase
        .from('ai_jobs')
        .update({
          status: 'awaiting_confirmation',
          output: { ...output, model: answer.model, usage: answer.usage },
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      return jsonResponse({
        id: job.id,
        status: 'awaiting_confirmation',
        output,
        model: answer.model,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI provider request failed';
      await supabase
        .from('ai_jobs')
        .update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() })
        .eq('id', job.id);
      return jsonResponse({ error: message, jobId: job.id }, { status: 502 });
    }
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
});
