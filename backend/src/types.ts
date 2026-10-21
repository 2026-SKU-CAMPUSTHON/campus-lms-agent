export type Role = 'professor' | 'student';
export interface User { user_id: string; name: string }
export interface Course { course_id: string; title: string; role: Role }
export interface Week { week_id: string; course_id: string; week_no: number; title: string }
export interface Slide { slide_no: number; text: string }
export interface Extraction { total_slides: number; slides: Slide[] }
export interface Source { material_id: string; chunk_id: string; source_type: 'document'; slide_no: number; start_sec: null; end_sec: null }
export interface Option { option_id: string; text: string }
export interface PublicQuestion { question_id: string; prompt: string; options: Option[] }
export interface DraftQuestion extends PublicQuestion { correct_option_id: string; explanation: string; sources: Source[] }
export interface GeneratedQuestion { prompt: string; options: string[]; correct_index: number; explanation: string; slide_nos: number[] }
export interface QuizDraft { draft_id: string; week_id: string; questions: DraftQuestion[] }
export interface PublicQuiz { quiz_id: string; week_id: string; questions: PublicQuestion[] }
export interface AttemptResult { attempt_id: string; quiz_id: string; correct_count: number; total_count: number; wrong_questions: (DraftQuestion & {selected_option_id: string})[] }
export interface Job { job_id: string; status: 'queued' | 'processing' | 'completed' | 'failed'; result: {material_id?: string; draft_id?: string} | null; error: {code: string; message: string; retryable: boolean} | null }
export interface Material { material_id: string; course_id: string; week_id: string; name: string; slide_start: number; slide_end: number; original_visible_to_students: boolean; status: Job['status']; total_slides: number | null; slides: Slide[]; file_path: string }
export interface WeekContent { materials: Omit<Material, 'slides' | 'file_path'>[]; drafts: QuizDraft[]; quizzes: {quiz_id: string; draft_id: string; week_id: string; question_count: number}[] }
