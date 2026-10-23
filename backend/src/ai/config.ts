export type Provider='claude'|'codex'|'openai'|'gemini';
export function generationConfig(env:NodeJS.ProcessEnv=process.env) {
 const provider=env.AI_PROVIDER || 'claude';
 if(!['claude','codex','openai','gemini'].includes(provider))throw new Error('AI_PROVIDER는 claude, codex, openai 또는 gemini여야 합니다.');
 return {provider:provider as Provider,codexBin:env.CODEX_BIN,apiKey:provider==='claude'?env.ANTHROPIC_API_KEY:provider==='openai'?env.OPENAI_API_KEY:provider==='gemini'?env.GEMINI_API_KEY:undefined,model:provider==='claude'?env.ANTHROPIC_MODEL:provider==='codex'?env.CODEX_MODEL:provider==='openai'?env.OPENAI_MODEL:env.GEMINI_MODEL};
}
