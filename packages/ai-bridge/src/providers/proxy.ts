import type { AIResponse, LLMProvider } from '../types';

export class ProxyProvider implements LLMProvider {
  readonly name = 'proxy' as const;
  private proxyUrl: string;
  private apiKey?: string;

  constructor(proxyUrl: string, apiKey?: string) {
    this.proxyUrl = proxyUrl;
    this.apiKey = apiKey;
  }

  async send(systemPrompt: string, userMessage: string): Promise<AIResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(this.proxyUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ systemPrompt, userMessage }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${response.status} ${response.statusText}: ${error}`);
    }

    const data = await response.json();
    return {
      content: data.content ?? '',
      model: data.model ?? 'proxy',
      tokensUsed: data.tokensUsed,
    };
  }
}
