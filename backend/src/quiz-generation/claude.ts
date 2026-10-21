import {runClaudeJson,type ClaudeOptions} from '../ai/claude-json.js';
import {prompt,questionSchema} from './prompt.js';
import {validateQuestions,type Generator} from './questions.js';
export function createClaudeGenerator(options:ClaudeOptions):Generator {
 return async(slides,count,previous=[])=>validateQuestions(await runClaudeJson(prompt(slides,count,previous),questionSchema(count),options),slides,count);
}
