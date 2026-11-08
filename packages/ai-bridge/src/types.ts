export type ProviderType = 'openai' | 'anthropic' | 'proxy';

export interface AIConfig {
  provider: ProviderType;
  apiKey?: string;
  proxyUrl?: string;
  model?: string;
}

export interface GraphSummary {
  totalFiles: number;
  totalEdges: number;
  selectedFile: string;
  directImports: string[];
  importedBy: string[];
  depthFromRoot: number;
}

export interface AIRequest {
  action: 'explain' | 'refactor' | 'issues' | 'custom';
  graphSummary: GraphSummary;
  fileContent: string;
  filePath: string;
  customPrompt?: string;
}

export interface AIResponse {
  content: string;
  model: string;
  tokensUsed?: number;
  error?: string;
}

export interface LLMProvider {
  name: ProviderType;
  send(systemPrompt: string, userMessage: string): Promise<AIResponse>;
}
