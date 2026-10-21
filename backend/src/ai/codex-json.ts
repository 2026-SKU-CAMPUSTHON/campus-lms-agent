import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HttpError} from '../errors.js';
export interface CodexOptions {binary?:string;model?:string}
function cliEnvironment() {
  const env={...process.env};
  // ChatGPT 로컬 로그인을 사용한다. 앱의 API 키를 CLI 자식 프로세스에 넘기지 않는다.
  for(const key of ['OPENAI_API_KEY','CODEX_API_KEY','GEMINI_API_KEY','TYPESAFE_API_KEY','SUPABASE_SERVICE_ROLE_KEY'])delete env[key];
  return env;
}
export function codexReady(binary='codex') {return spawnSync(binary,['login','status'],{timeout:5000,encoding:'utf8',env:cliEnvironment()}).status===0}
export async function runCodexJson(input:string,schema:Record<string,unknown>,options:CodexOptions={}):Promise<unknown> {
  const directory=await mkdtemp(join(tmpdir(),'campus-ai-'));
  try {
    const schemaPath=join(directory,'schema.json'),outputPath=join(directory,'result.json');
    await writeFile(schemaPath,JSON.stringify(schema),{mode:0o600});
    const args=['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--disable','shell_tool','--disable','unified_exec','--disable','multi_agent','-c','project_doc_max_bytes=0','-c','web_search="disabled"','--output-schema',schemaPath,'-o',outputPath,'--json'];
    if(options.model)args.push('--model',options.model);args.push('-');
    await new Promise<void>((resolve,reject)=> {
      const child=spawn(options.binary || 'codex',args,{cwd:directory,env:cliEnvironment(),stdio:['pipe','ignore','ignore']});
      let timedOut=false;
      const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL')},180000);
      child.once('error',()=>{clearTimeout(timer);reject(new HttpError(503,'CODEX_UNAVAILABLE','Codex CLI 설치와 로그인을 확인해 주세요.'))});
      child.once('close',code=>{clearTimeout(timer);if(code===0)resolve();else reject(new HttpError(502,timedOut?'CODEX_TIMEOUT':'CODEX_GENERATION_FAILED',timedOut?'Codex 응답 시간이 초과되었습니다. 다시 시도해 주세요.':'Codex 응답에 실패했습니다. 로그인·사용 한도·모델 설정을 확인해 주세요.',true))});
      child.stdin.on('error',()=>{});child.stdin.end(input);
    });
    const text=await readFile(outputPath,'utf8');
    if(text.length>300000)throw new HttpError(502,'INVALID_AI_RESPONSE','AI 응답이 허용 크기를 넘었습니다.',true);
    return JSON.parse(text);
  } catch(error) {
    if(error instanceof HttpError)throw error;
    throw new HttpError(502,'INVALID_AI_RESPONSE','AI 응답 형식을 읽지 못했습니다. 다시 시도해 주세요.',true);
  } finally {await rm(directory,{recursive:true,force:true})}
}
