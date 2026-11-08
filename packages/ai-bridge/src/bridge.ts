import type { AIConfig, AIRequest, AIResponse, LLMProvider } from './types';
import { OpenAIProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { ProxyProvider } from './providers/proxy';
import { buildContext } from './context';

export class AIBridge {
  private provider: LLMProvider;
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
    this.provider = this.createProvider(config);
  }

  async ask(request: AIRequest): Promise<AIResponse> {
    const { systemPrompt, userMessage } = buildContext(request);

    try {
      return await this.provider.send(systemPrompt, userMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: '',
        model: this.config.model ?? 'unknown',
        error: `ERR: ${message}`,
      };
    }
  }

  updateConfig(config: Partial<AIConfig>): void {
    this.config = { ...this.config, ...config };
    this.provider = this.createProvider(this.config);
  }

  getProviderName(): string {
    return this.provider.name;
  }

  private createProvider(config: AIConfig): LLMProvider {
    switch (config.provider) {
      case 'openai':
        return new OpenAIProvider(config.apiKey ?? '', config.model);
      case 'anthropic':
        return new AnthropicProvider(config.apiKey ?? '', config.model);
      case 'proxy':
        return new ProxyProvider(config.proxyUrl ?? '', config.apiKey);
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }
}
