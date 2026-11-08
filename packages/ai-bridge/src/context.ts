import type { AIRequest, GraphSummary } from './types';

const PROMPTS: Record<string, string> = {
  explain: `You are an expert software architect. Analyze the following file in the context of its project architecture.

Explain:
1. What this file does (purpose and responsibility)
2. Its role in the architecture (why it exists, what depends on it)
3. Any notable patterns or concerns

Be concise and direct. Use terminal-style formatting.`,

  refactor: `You are an expert software architect focused on code quality. Analyze the following file and its position in the dependency graph.

Suggest specific, actionable refactoring improvements:
1. Structure improvements
2. Dependency optimization (could imports be simplified?)
3. Potential code smells

Prioritize suggestions by impact. Be concise.`,

  issues: `You are a software architecture auditor. Analyze this file and its dependency context for potential issues:

1. Circular dependency risks
2. Tight coupling concerns
3. Single responsibility violations
4. Import organization issues

Flag severity: [HIGH] [MED] [LOW]. Be concise.`,

  custom: `You are an expert software architect. Answer the developer's question about this file in the context of its project architecture. Be concise and direct.`,
};

export function buildContext(request: AIRequest): {
  systemPrompt: string;
  userMessage: string;
} {
  const systemPrompt = PROMPTS[request.action] ?? PROMPTS.custom;

  const graphContext = formatGraphSummary(request.graphSummary);
  const customSection = request.action === 'custom' && request.customPrompt
    ? `\n\n## Developer's Question\n${request.customPrompt}`
    : '';

  const userMessage = `## File: ${request.filePath}

## Architecture Context
${graphContext}

## Source Code
\`\`\`
${request.fileContent}
\`\`\`${customSection}`;

  return { systemPrompt, userMessage };
}

function formatGraphSummary(summary: GraphSummary): string {
  return `- Project: ${summary.totalFiles} files, ${summary.totalEdges} dependency edges
- File: ${summary.selectedFile}
- Imports: ${summary.directImports.join(', ') || 'none'}
- Imported by: ${summary.importedBy.join(', ') || 'none (root/entry)'}
- Depth from root: ${summary.depthFromRoot}`;
}
