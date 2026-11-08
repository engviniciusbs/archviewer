import type { AIResponse, LLMProvider } from '../types';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai' as const;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model ?? 'gpt-4o-mini';
  }

  async send(systemPrompt: string, userMessage: string): Promise<AIResponse> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${response.status} ${response.statusText}: ${error}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0]?.message?.content ?? '',
      model: data.model,
      tokensUsed: data.usage?.total_tokens,
    };
  }
}
