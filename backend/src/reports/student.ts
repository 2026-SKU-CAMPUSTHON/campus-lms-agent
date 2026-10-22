import type {Database} from '../database.js';
import type {AttemptResult,PublicQuiz,User,Week} from '../types.js';
import {HttpError} from '../errors.js';
import type {StudentWrongAttempt,StudentWrongMetrics,StudentWrongReport,StudentWrongWeek} from './types.js';
interface AttemptRow {data:string;quiz_data:string;quiz_id:string;week_id:string}
function metrics(attempts:StudentWrongAttempt[]):StudentWrongMetrics {
 const total_count=attempts.reduce((n,a)=>n+a.total_count,0),correct_count=attempts.reduce((n,a)=>n+a.correct_count,0);
 return {submission_count:attempts.length,total_count,correct_count,wrong_count:attempts.reduce((n,a)=>n+a.wrong_questions.length,0),correct_rate:total_count?correct_count/total_count:null};
}
/** Identity comes from the session; only persisted, completed submissions are read. */
export async function studentWrongReport(store:Database,course:string,weeks:Week[],user:User):Promise<StudentWrongReport> {
 const ids=weeks.map(w=>w.week_id),slots=ids.map(()=>'?').join(',');
 const rows=ids.length?(await store.all<AttemptRow>(`SELECT a.data,q.data AS quiz_data,q.id AS quiz_id,q.week_id FROM attempts a JOIN quizzes q ON q.id=a.quiz_id WHERE a.user_id=? AND q.course_id=? AND q.week_id IN (${slots}) ORDER BY a.rowid`,user.user_id,course,...ids)):[];
 const quizOrder=(await store.all<{id:string;week_id:string}>('SELECT id,week_id FROM quizzes WHERE course_id=? ORDER BY rowid',course));
 const result:StudentWrongWeek[]=weeks.map(week=> {
  const order=quizOrder.filter(q=>q.week_id===week.week_id);
  const attempts:StudentWrongAttempt[]=rows.filter(a=>a.week_id===week.week_id).map(row=> {
   const result=JSON.parse(row.data) as AttemptResult,quiz=JSON.parse(row.quiz_data) as PublicQuiz;
   const positions=new Map(quiz.questions.map((q,i)=>[q.question_id,i+1]));
   return {attempt_id:result.attempt_id,quiz_id:row.quiz_id,quiz_no:order.findIndex(q=>q.id===row.quiz_id)+1,total_count:result.total_count,correct_count:result.correct_count,wrong_questions:result.wrong_questions.map(q=>({question_id:q.question_id,question_no:positions.get(q.question_id)!,prompt:q.prompt,options:q.options.map(o=>({option_id:o.option_id,text:o.text})),selected_option_id:q.selected_option_id,correct_option_id:q.correct_option_id,explanation:q.explanation,sources:q.sources}))};
  });
  return {week_id:week.week_id,week_no:week.week_no,title:week.title,...metrics(attempts),attempts};
 });
 const summary=metrics(result.flatMap(w=>w.attempts));
 if(summary.submission_count>1000||summary.wrong_count>2000)throw new HttpError(422,'REPORT_TOO_LARGE','오답 레포트가 너무 큽니다. 주차를 나누어 조회해 주세요.');
 return {course_id:course,generated_at:new Date().toISOString(),student_name:user.name,summary,weeks:result};
}
