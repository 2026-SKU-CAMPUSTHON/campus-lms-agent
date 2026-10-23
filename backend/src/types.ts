export type Role = 'professor' | 'student';
export interface User { user_id: string; name: string }
export interface Course { course_id: string; title: string; role: Role }
export interface Week { week_id: string; course_id: string; week_no: number; title: string }
export interface Slide { slide_no: number; text: string }
export interface Extraction { total_slides: number; slides: Slide[] }
export interface DocumentSource { material_id:string;chunk_id:string;source_type:'document';slide_no:number;start_sec:null;end_sec:null;material_name?:string }
export interface TranscriptSource {material_id:string;chunk_id:string;source_type:'transcript';slide_no:null;start_sec:number;end_sec:number;material_name:string;media_type:'audio'|'video';original_visible_to_students:boolean;origin?:'youtube'}
export type Source=DocumentSource|TranscriptSource;
export interface Option { option_id: string; text: string }
export interface PublicQuestion { question_id: string; prompt: string; options: Option[] }
export interface DraftQuestion extends PublicQuestion { correct_option_id: string; explanation: string; sources: Source[] }
export interface GeneratedQuestion { prompt: string; options: string[]; correct_index: number; explanation: string; slide_nos: number[] }
export interface QuizDraft { draft_id: string; week_id: string; version:number; questions: DraftQuestion[] }
export interface PublicQuiz { quiz_id: string; week_id: string; questions: PublicQuestion[] }
export interface AttemptResult { attempt_id: string; quiz_id: string; correct_count: number; total_count: number; wrong_questions: (DraftQuestion & {selected_option_id: string})[] }
export interface Job { job_id: string; status: 'queued' | 'processing' | 'completed' | 'failed'; result: {material_id?: string; draft_id?: string} | null; error: {code: string; message: string; retryable: boolean} | null }
export interface DocumentMaterial {source_type?:'document'; material_id: string; course_id: string; week_id: string; name: string; slide_start: number; slide_end: number; original_visible_to_students: boolean; status: Job['status']; total_slides: number | null; slides: Slide[]; file_path: string }
export interface TranscriptSegment {start_sec:number;end_sec:number;text:string}
export interface YouTubeOrigin {video_id:string;url:string;start_sec:number;end_sec:number|null;method:'captions'|'audio'|null;is_generated:boolean|null}
export interface MediaMaterial {material_id:string;course_id:string;week_id:string;name:string;source_type:'audio'|'video';original_visible_to_students:boolean;status:Job['status'];file_path:string;slide_start:null;slide_end:null;total_slides:null;slides:[];duration_sec:number|null;language:string|null;segments:TranscriptSegment[];job_id:string;error:Job['error'];youtube?:YouTubeOrigin}
export type Material=DocumentMaterial|MediaMaterial;
export function isDocument(material:Material):material is DocumentMaterial {return !material.source_type||material.source_type==='document'}
export type MediaSummary=Omit<MediaMaterial,'slides'|'segments'|'file_path'>;
export type MaterialSummary=Omit<DocumentMaterial,'slides'|'file_path'>|MediaSummary;
export interface WeekContent { materials: MaterialSummary[]; drafts: QuizDraft[]; quizzes: {quiz_id: string; draft_id: string; week_id: string; question_count: number}[] }
