import type { GlobalSettings } from './globalSettings';

export type CopilotProvider = GlobalSettings['copilotProvider'];
export type CopilotConnection = { provider: CopilotProvider; model: string; apiKey: string; endpoint: string };

export function copilotConnection(settings: GlobalSettings): CopilotConnection {
  if (settings.copilotProvider === 'openai') return {
    provider: 'openai', model: settings.copilotOpenAiModel.trim(), apiKey: settings.copilotOpenAiApiKey.trim(),
    endpoint: 'https://api.openai.com/v1/chat/completions',
  };
  return { provider: 'deepseek', model: settings.copilotModel, apiKey: settings.copilotDeepSeekApiKey.trim(),
    endpoint: 'https://api.deepseek.com/chat/completions' };
}

export function copilotIsConfigured(settings: GlobalSettings): boolean {
  const connection = copilotConnection(settings);
  return !!connection.apiKey && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(connection.model);
}

export function chatCompletionBody(provider: CopilotProvider, body: Record<string, unknown>): Record<string, unknown> {
  if (provider === 'openai' && 'max_tokens' in body) {
    const { max_tokens, ...rest } = body;
    return { ...rest, max_completion_tokens: max_tokens };
  }
  return body;
}
