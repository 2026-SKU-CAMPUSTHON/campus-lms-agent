import {runCodexJson} from '../ai/codex-json.js';
import {validateQuestions,type Generator} from './questions.js';
import {prompt,questionSchema} from './prompt.js';
export {codexReady} from '../ai/codex-json.js';
export function createCodexGenerator(binary='codex',model?:string):Generator {
  return async(slides,count,previous=[])=>validateQuestions(await runCodexJson(prompt(slides,count,previous),questionSchema(count),{binary,model}),slides,count);
}
