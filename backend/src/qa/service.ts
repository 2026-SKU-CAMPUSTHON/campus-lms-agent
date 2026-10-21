import {randomUUID} from 'node:crypto';
import type {Store} from '../store.js';
import type {Material,Role,User} from '../types.js';
import {HttpError} from '../errors.js';
import {retrieve} from '../retrieval/local-search.js';
import type {Decision,HandoffReason,Judge,QAGenerator,QAMessage,QAThread,StoredThread} from './types.js';
const now=()=>new Date().toISOString();
const message=(role:QAMessage['author_role'],kind:QAMessage['kind'],text:string):QAMessage=>({message_id:randomUUID(),author_role:role,kind,text,sources:[],created_at:now()});
export function routeDecision(decision:Decision,count:number,hasPassages:boolean,minimum:number):{route:'answer'|'clarify'|'handoff';reason:HandoffReason} {
 const clarity=decision.clarity,evidence=decision.evidence;
 if(clarity.confidence<minimum || clarity.probabilities[clarity.label]<minimum)return {route:'handoff',reason:'judgment_uncertain'};
 if(clarity.label==='unclear')return count===0?{route:'clarify',reason:null}:{route:'handoff',reason:'unclear_after_clarification'};
 if(evidence.confidence<minimum || evidence.probabilities[evidence.label]<minimum)return {route:'handoff',reason:'judgment_uncertain'};
 if(evidence.label==='insufficient'||!hasPassages)return {route:'handoff',reason:'insufficient_evidence'};
 return {route:'answer',reason:null};
}
export class QAService {
 private readonly active=new Set<Promise<void>>();
 constructor(private store:Store,private judge:Judge,private generate:QAGenerator,private minimum=0.75) {
  if(!Number.isFinite(minimum)||minimum<0.5||minimum>1)throw new Error('JEV_MIN_CONFIDENCE must be within [0.5,1]');
  for(const row of store.all<{data:string}>('SELECT data FROM threads')) {
   const thread=JSON.parse(row.data) as StoredThread;
   if(['queued','processing'].includes(thread.processing_status)) {thread.processing_status='failed';thread.error={code:'PROCESS_INTERRUPTED',message:'서버가 다시 시작되어 응답이 중단되었습니다. 다시 시도해 주세요.',retryable:true};thread.version++;this.save(thread)}
  }
 }
 get(id:string) {const row=this.store.get<{data:string}>('SELECT data FROM threads WHERE id=?',id);if(!row)throw new HttpError(404,'THREAD_NOT_FOUND','질문을 찾을 수 없습니다.');return JSON.parse(row.data) as StoredThread}
 public(thread:StoredThread):QAThread {const {course_id:_course,student_id:_student,attempt_count:_attempts,decisions:_decisions,...view}=thread;return view}
 list(course:string,week:string,user:string,role:Role) {
  const rows=role==='professor'?this.store.all<{data:string}>('SELECT data FROM threads WHERE course_id=? AND week_id=? ORDER BY rowid DESC LIMIT 100',course,week):this.store.all<{data:string}>('SELECT data FROM threads WHERE course_id=? AND week_id=? AND student_id=? ORDER BY rowid DESC LIMIT 100',course,week,user);
  return rows.map(row=>this.public(JSON.parse(row.data) as StoredThread));
 }
 private save(thread:StoredThread) {thread.updated_at=now();this.store.run('UPDATE threads SET data=? WHERE id=?',JSON.stringify(thread),thread.thread_id)}
 private checkVersion(thread:StoredThread,version:number) {
  if(thread.version!==version)throw new HttpError(409,'THREAD_CHANGED','질문 상태가 변경되었습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.');
  if(['queued','processing'].includes(thread.processing_status))throw new HttpError(409,'QA_PROCESSING','응답 처리 중입니다. 완료 후 다시 시도해 주세요.');
 }
 private checkCapacity() {if(this.store.get<{count:number}>("SELECT COUNT(*) AS count FROM threads WHERE json_extract(data,'$.processing_status') IN ('queued','processing')")!.count>=3)throw new HttpError(429,'QA_BUSY','다른 질문을 처리 중입니다. 잠시 뒤 다시 시도해 주세요.',true)}
 /** write methods run inside the route's idempotency transaction. */
 create(course:string,week:string,user:User,text:string) {
  this.checkCapacity();
  const thread:StoredThread={thread_id:randomUUID(),course_id:course,week_id:week,student_id:user.user_id,student_name:user.name,state:'open',clarification_count:0,processing_status:'queued',version:1,messages:[message('student','question',text)],error:null,handoff_reason:null,created_at:now(),updated_at:now(),attempt_count:0,decisions:[]};
  this.store.run('INSERT INTO threads VALUES (?,?,?,?,?)',thread.thread_id,course,week,user.user_id,JSON.stringify(thread));this.schedule(thread.thread_id,thread.version);return this.public(thread);
 }
 reply(id:string,role:Role,text:string,version:number) {
  const thread=this.get(id);this.checkVersion(thread,version);
  if(role==='professor') {
   if(thread.state!=='awaiting_professor')throw new HttpError(422,'QA_INVALID_STATE','교수님 답변 대기 중인 질문에만 답변할 수 있습니다.');
   thread.messages.push(message('professor','answer',text));thread.state='resolved';thread.error=null;thread.processing_status='idle';thread.version++;this.save(thread);return this.public(thread);
  }
  if(thread.state!=='awaiting_student' || thread.clarification_count!==1)throw new HttpError(422,'QA_INVALID_STATE','추가 질문에 답변을 기다리는 상태가 아닙니다.');
  this.checkCapacity();thread.messages.push(message('student','followup',text));thread.state='open';thread.processing_status='queued';thread.error=null;thread.version++;this.save(thread);this.schedule(id,thread.version);return this.public(thread);
 }
 retry(id:string,version:number) {
  const thread=this.get(id);this.checkVersion(thread,version);
  if(thread.processing_status!=='failed'||!thread.error?.retryable)throw new HttpError(422,'QA_RETRY_UNAVAILABLE','다시 시도할 수 있는 응답 오류가 없습니다.');
  this.checkCapacity();thread.processing_status='queued';thread.error=null;thread.version++;this.save(thread);this.schedule(id,thread.version);return this.public(thread);
 }
 private schedule(id:string,version:number) {
  const task=(async()=> {
   await new Promise<void>(resolve=>setImmediate(resolve));
   const thread=this.get(id);if(thread.version!==version || thread.processing_status!=='queued')return;
   thread.processing_status='processing';thread.attempt_count++;this.save(thread);
   try {
    const materials=this.store.all<{data:string}>('SELECT data FROM materials WHERE course_id=? AND week_id=?',thread.course_id,thread.week_id).map(row=>JSON.parse(row.data) as Material);
    const query=thread.messages.filter(m=>m.author_role==='student').reverse().map(m=>m.text).join('\n');
    const passages=retrieve(materials,thread.course_id,thread.week_id,query);
    const input={messages:thread.messages,passages};
    const decision=await this.judge(input);const selected=routeDecision(decision,thread.clarification_count,passages.length>0,this.minimum);
    thread.decisions.push({at:now(),attempt:thread.attempt_count,decision,source_ids:passages.map(p=>p.source.chunk_id),route:selected.route});
    if(selected.route==='handoff') {thread.state='awaiting_professor';thread.handoff_reason=selected.reason}
    else {
     const generated=await this.generate({...input,mode:selected.route==='clarify'?'clarification':'answer'});
     if(!generated.text.trim()||generated.text.length>4000)throw new HttpError(502,'INVALID_QA_RESPONSE','답변 형식을 확인하지 못했습니다.',true);
     const used=[...new Set(generated.source_ids)];
     if(used.some(id=>!passages.some(p=>p.source.chunk_id===id)))throw new HttpError(502,'INVALID_QA_SOURCE','답변 출처가 검색한 근거와 일치하지 않습니다.',true);
     if(selected.route==='clarify') {
      if(thread.clarification_count!==0 || used.length)throw new HttpError(502,'INVALID_CLARIFICATION','추가 질문을 확인하지 못했습니다.',true);
      thread.messages.push(message('assistant','clarification',generated.text));thread.clarification_count=1;thread.state='awaiting_student';
     } else if(!used.length) {thread.state='awaiting_professor';thread.handoff_reason='answer_not_grounded';thread.decisions.at(-1)!.route='handoff'}
     else {
      const answer=message('assistant','answer',generated.text);answer.sources=used.map(id=>passages.find(p=>p.source.chunk_id===id)!.source);thread.messages.push(answer);thread.state='resolved';
     }
    }
    // 모델을 기다리는 동안 달라진 상태에 오래된 응답을 덮어쓰지 않는다.
    this.store.transaction(()=> {const current=this.get(id);if(current.version!==version||current.processing_status!=='processing')return;thread.version++;thread.processing_status='idle';thread.error=null;this.save(thread)});
   } catch(error) {
    const known=error instanceof HttpError?error:new HttpError(502,'QA_PROCESS_FAILED','질문 응답을 처리하지 못했습니다. 다시 시도해 주세요.',true);
    this.store.transaction(()=> {const current=this.get(id);if(current.version!==version||current.processing_status!=='processing')return;current.decisions=thread.decisions;current.processing_status='failed';current.error={code:known.code,message:known.message,retryable:known.retryable};current.version++;this.save(current)});
   }
  })();
  this.active.add(task);void task.then(()=>this.active.delete(task),()=>this.active.delete(task));
 }
 async waitForJobs() {while(this.active.size)await Promise.all([...this.active])}
}
