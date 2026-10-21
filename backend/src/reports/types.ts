import type {DraftQuestion,Week} from '../types.js';
import type {QAThread} from '../qa/types.js';
export interface QuizMetrics {
 eligible_student_count:number;participant_count:number;quiz_count:number;question_count:number;submission_count:number;
 participation_rate:number|null;correct_count:number;answer_count:number;correct_rate:number|null;
}
export interface ReportQuestion extends DraftQuestion {quiz_id:string;quiz_no:number;question_no:number;correct_count:number;answer_count:number;correct_rate:number|null}
export interface QuizWeekReport extends Week,QuizMetrics {questions:ReportQuestion[]}
export interface QuizReport {course_id:string;generated_at:string;summary:QuizMetrics;weeks:QuizWeekReport[]}
export interface QAMetrics {thread_count:number;questioning_student_count:number;open_count:number;awaiting_student_count:number;awaiting_professor_count:number;resolved_count:number;error_count:number;clarified_thread_count:number}
export interface QAWeekReport extends Week,QAMetrics {}
export interface QAReport {course_id:string;generated_at:string;summary:QAMetrics;weeks:QAWeekReport[];threads:QAThread[];page:number;page_size:number;total_count:number;page_count:number}
