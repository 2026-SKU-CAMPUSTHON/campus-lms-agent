import type {Source} from '../types.js';
export type ThreadState='open'|'awaiting_student'|'awaiting_professor'|'resolved';
export type HandoffReason='unclear_after_clarification'|'insufficient_evidence'|'judgment_uncertain'|'answer_not_grounded'|null;
export interface QAMessage {message_id:string;author_role:'student'|'assistant'|'professor';kind:'question'|'clarification'|'answer'|'followup';text:string;sources:Source[];created_at:string}
export interface QAError {code:string;message:string;retryable:boolean}
export interface QAThread {thread_id:string;week_id:string;student_name:string;state:ThreadState;clarification_count:number;processing_status:'idle'|'queued'|'processing'|'failed';version:number;messages:QAMessage[];error:QAError|null;handoff_reason:HandoffReason;created_at:string;updated_at:string}
export interface Passage {source:Source;text:string;score:number}
export interface Decision {model:string;clarity:{label:'clear'|'unclear';confidence:number;probabilities:{clear:number;unclear:number}};evidence:{label:'sufficient'|'insufficient';confidence:number;probabilities:{sufficient:number;insufficient:number}}}
export interface JudgeInput {messages:QAMessage[];passages:Passage[]}
export type Judge=(input:JudgeInput)=>Promise<Decision>;
export interface DecisionRecord {at:string;attempt:number;decision:Decision;source_ids:string[];route:'answer'|'clarify'|'handoff'}
export interface StoredThread extends QAThread {course_id:string;student_id:string;attempt_count:number;decisions:DecisionRecord[]}
export type QAGenerator=(input:JudgeInput & {mode:'answer'|'clarification'})=>Promise<{text:string;source_ids:string[]}>;
