import type {Database} from '../database.js';
import type {AttemptResult,DraftQuestion,Week} from '../types.js';
import type {QAThread,StoredThread,ThreadState} from '../qa/types.js';
import type {QuizMetrics,QuizReport,QuizWeekReport,QAMetrics,QAReport,ReportQuestion} from './types.js';
const fraction=(n:number,d:number)=>d?n/d:null;
function quizMetrics(eligible:number,quizzes:number,questions:number,participants:number,submissions:number,correct:number,answers:number):QuizMetrics {
 return {eligible_student_count:eligible,participant_count:participants,quiz_count:quizzes,question_count:questions,submission_count:submissions,participation_rate:quizzes?fraction(participants,eligible):null,correct_count:correct,answer_count:answers,correct_rate:fraction(correct,answers)};
}
interface QuizRow {id:string;week_id:string;data:string}
interface AttemptRow {user_id:string;quiz_id:string;data:string}
interface QAStat {week_id:string;student_id:string;state:ThreadState;processing_status:string;clarification_count:number}
function qaMetrics(rows:QAStat[]):QAMetrics {
 return {thread_count:rows.length,questioning_student_count:new Set(rows.map(r=>r.student_id)).size,open_count:rows.filter(r=>r.state==='open').length,awaiting_student_count:rows.filter(r=>r.state==='awaiting_student').length,awaiting_professor_count:rows.filter(r=>r.state==='awaiting_professor').length,resolved_count:rows.filter(r=>r.state==='resolved').length,error_count:rows.filter(r=>r.processing_status==='failed').length,clarified_thread_count:rows.filter(r=>r.clarification_count===1).length};
}
export class Reports {
 constructor(private store:Database,private viewThread:(thread:StoredThread)=>QAThread) {}
 async quizzes(course:string,weeks:Week[]):Promise<QuizReport> {
  const eligible=(await this.store.get<{count:number}>("SELECT COUNT(*) AS count FROM memberships WHERE course_id=? AND role='student'",course))!.count;
  const ids=weeks.map(w=>w.week_id),slots=ids.map(()=>'?').join(',');
  const quizzes=ids.length?(await this.store.all<QuizRow>(`SELECT id,week_id,data FROM quizzes WHERE course_id=? AND week_id IN (${slots}) ORDER BY rowid`,course,...ids)):[];
  // 현재 수강 학생의 제출만 사용해 참여율 분모와 집계 대상을 맞춘다.
  const attempts=ids.length?(await this.store.all<AttemptRow>(`SELECT a.user_id,a.quiz_id,a.data FROM attempts a JOIN quizzes q ON q.id=a.quiz_id JOIN memberships m ON m.user_id=a.user_id AND m.course_id=q.course_id AND m.role='student' WHERE q.course_id=? AND q.week_id IN (${slots})`,course,...ids)).map(a=>({...a,result:JSON.parse(a.data) as AttemptResult})):[];
  const participants=new Set(attempts.map(a=>a.user_id));
  const reports:QuizWeekReport[]=weeks.map(week=> {
   const weekQuizzes=quizzes.filter(q=>q.week_id===week.week_id),quizIds=new Set(weekQuizzes.map(q=>q.id));
   const submissions=attempts.filter(a=>quizIds.has(a.quiz_id));
   const questions:ReportQuestion[]=weekQuizzes.flatMap((row,quizIndex)=> {
    const quiz=JSON.parse(row.data) as {questions:DraftQuestion[]};
    const submitted=submissions.filter(a=>a.quiz_id===row.id);
    const wrong=new Map<string,number>();
    for(const a of submitted)for(const question of a.result.wrong_questions)wrong.set(question.question_id,(wrong.get(question.question_id)||0)+1);
    return quiz.questions.map((question,index)=> {
     const correct=submitted.length-(wrong.get(question.question_id)||0);
     return {...question,quiz_id:row.id,quiz_no:quizIndex+1,question_no:index+1,correct_count:correct,answer_count:submitted.length,correct_rate:fraction(correct,submitted.length)};
    });
   });
   return {...week,...quizMetrics(eligible,weekQuizzes.length,questions.length,new Set(submissions.map(a=>a.user_id)).size,submissions.length,submissions.reduce((sum,a)=>sum+a.result.correct_count,0),submissions.reduce((sum,a)=>sum+a.result.total_count,0)),questions};
  });
  return {course_id:course,generated_at:new Date().toISOString(),summary:quizMetrics(eligible,quizzes.length,reports.reduce((n,w)=>n+w.question_count,0),participants.size,attempts.length,attempts.reduce((n,a)=>n+a.result.correct_count,0),attempts.reduce((n,a)=>n+a.result.total_count,0)),weeks:reports};
 }
 async qa(course:string,weeks:Week[],page:number,pageSize:number):Promise<QAReport> {
  const ids=weeks.map(w=>w.week_id),slots=ids.map(()=>'?').join(',');
  const where=`course_id=? AND week_id IN (${slots})`;
  const stats=ids.length?(await this.store.all<QAStat>(`SELECT week_id,student_id,json_extract(data,'$.state') AS state,json_extract(data,'$.processing_status') AS processing_status,json_extract(data,'$.clarification_count') AS clarification_count FROM threads WHERE ${where}`,course,...ids)):[];
  const threads=ids.length?(await this.store.all<{data:string}>(`SELECT data FROM threads WHERE ${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`,course,...ids,pageSize,(page-1)*pageSize)).map(row=>this.viewThread(JSON.parse(row.data) as StoredThread)):[];
  return {course_id:course,generated_at:new Date().toISOString(),summary:qaMetrics(stats),weeks:weeks.map(week=>({...week,...qaMetrics(stats.filter(r=>r.week_id===week.week_id))})),threads,page,page_size:pageSize,total_count:stats.length,page_count:Math.ceil(stats.length/pageSize)};
 }
}
