import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpError } from '../errors.js';
import { validateQuestions, type Generator } from './questions.js';
import { prompt, questionSchema } from './prompt.js';
export function codexReady(binary='codex'):boolean {
  const result=spawnSync(binary,['login','status'],{timeout:5000,encoding:'utf8'});
  return result.status===0;
}
export function createCodexGenerator(binary='codex',model?:string):Generator {
  return async(slides,count,previous=[])=> {
    const directory=await mkdtemp(join(tmpdir(),'campus-quiz-'));
    try {
      const schemaPath=join(directory,'schema.json'),outputPath=join(directory,'result.json');
      await writeFile(schemaPath,JSON.stringify(questionSchema(count)),{mode:0o600});
      const args=['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--disable','shell_tool','--disable','unified_exec','--disable','multi_agent','-c','project_doc_max_bytes=0','-c','web_search="disabled"','--output-schema',schemaPath,'-o',outputPath,'--json'];
      if(model) args.push('--model',model);
      args.push('-');
      await new Promise<void>((resolve,reject)=> {
        // 고정된 실행 파일·인수만 사용한다. 학생 입력을 명령 문자열로 실행하지 않는다.
        const child=spawn(binary,args,{cwd:directory,stdio:['pipe','ignore','ignore']});
        let timedOut=false;
        const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL')},180000);
        child.once('error',()=>{clearTimeout(timer);reject(new HttpError(503,'CODEX_UNAVAILABLE','Codex CLI를 실행할 수 없습니다. 설치 경로와 로그인을 확인해 주세요.'))});
        child.once('close',code=>{clearTimeout(timer);if(code===0)resolve();else reject(new HttpError(502,timedOut?'CODEX_TIMEOUT':'CODEX_GENERATION_FAILED',timedOut?'Codex 생성 시간이 초과되었습니다. 범위나 문항 수를 줄여 주세요.':'Codex 문제 생성에 실패했습니다. 로그인·사용 한도·모델 설정을 확인해 주세요.',true))});
        child.stdin.on('error',()=>{});child.stdin.end(prompt(slides,count,previous));
      });
      const raw=await readFile(outputPath,'utf8');
      if(raw.length>300000) throw new HttpError(502,'INVALID_AI_RESPONSE','Codex 응답이 허용 크기를 넘었습니다.',true);
      return validateQuestions(JSON.parse(raw),slides,count);
    } catch(error) {
      if(error instanceof HttpError)throw error;
      throw new HttpError(502,'INVALID_AI_RESPONSE','Codex의 문제 응답을 읽지 못했습니다. 다시 생성해 주세요.',true);
    } finally {await rm(directory,{recursive:true,force:true})}
  };
}
