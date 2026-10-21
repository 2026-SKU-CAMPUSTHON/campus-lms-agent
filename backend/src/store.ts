import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export const IDS = {
  professor: '10000000-0000-4000-8000-000000000001',
  student: '10000000-0000-4000-8000-000000000002',
  student2: '10000000-0000-4000-8000-000000000003',
  outsider: '10000000-0000-4000-8000-000000000004',
  course: '20000000-0000-4000-8000-000000000001',
  otherCourse: '20000000-0000-4000-8000-000000000002',
  week: '30000000-0000-4000-8000-000000000001',
  week2: '30000000-0000-4000-8000-000000000002',
};
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if(path !== ':memory:') mkdirSync(dirname(path), {recursive:true});
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS courses (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memberships (user_id TEXT REFERENCES users(id), course_id TEXT REFERENCES courses(id), role TEXT CHECK(role IN ('professor','student')), PRIMARY KEY(user_id,course_id));
      CREATE TABLE IF NOT EXISTS weeks (id TEXT PRIMARY KEY, course_id TEXT REFERENCES courses(id), week_no INTEGER, title TEXT);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, course_id TEXT REFERENCES courses(id), week_id TEXT REFERENCES weeks(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, course_id TEXT REFERENCES courses(id), week_id TEXT REFERENCES weeks(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS quizzes (id TEXT PRIMARY KEY, draft_id TEXT UNIQUE REFERENCES drafts(id), course_id TEXT REFERENCES courses(id), week_id TEXT REFERENCES weeks(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), quiz_id TEXT REFERENCES quizzes(id), data TEXT NOT NULL, UNIQUE(user_id,quiz_id));
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, course_id TEXT REFERENCES courses(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, course_id TEXT REFERENCES courses(id), week_id TEXT REFERENCES weeks(id), student_id TEXT REFERENCES users(id), data TEXT NOT NULL CHECK(json_extract(data,'$.clarification_count') BETWEEN 0 AND 1));
      CREATE INDEX IF NOT EXISTS threads_by_course_week_student ON threads(course_id,week_id,student_id);
      CREATE TABLE IF NOT EXISTS idempotency (user_id TEXT, route TEXT, key TEXT, fingerprint TEXT, status INTEGER, response TEXT, PRIMARY KEY(user_id,route,key));
    `);
    for(const [id,name] of [[IDS.professor,'교수 체험'],[IDS.student,'학생 가'],[IDS.student2,'학생 나'],[IDS.outsider,'다른 강의 학생']]) this.run('INSERT OR IGNORE INTO users VALUES (?,?)',id,name);
    this.run('INSERT OR IGNORE INTO courses VALUES (?,?)',IDS.course,'데이터베이스');
    this.run('INSERT OR IGNORE INTO courses VALUES (?,?)',IDS.otherCourse,'운영체제');
    for(const [user,course,role] of [[IDS.professor,IDS.course,'professor'],[IDS.student,IDS.course,'student'],[IDS.student2,IDS.course,'student'],[IDS.outsider,IDS.otherCourse,'student']]) this.run('INSERT OR IGNORE INTO memberships VALUES (?,?,?)',user,course,role);
    this.run('INSERT OR IGNORE INTO weeks VALUES (?,?,?,?)',IDS.week,IDS.course,1,'강의 자료로 복습하기');
    this.run('INSERT OR IGNORE INTO weeks VALUES (?,?,?,?)',IDS.week2,IDS.course,2,'두 번째 학습 주차');
  }
  run(sql:string,...args:SQLInputValue[]) { return this.db.prepare(sql).run(...args) }
  get<T>(sql:string,...args:SQLInputValue[]) { return this.db.prepare(sql).get(...args) as T | undefined }
  all<T>(sql:string,...args:SQLInputValue[]) { return this.db.prepare(sql).all(...args) as T[] }
  transaction<T>(fn:()=>T):T {
    this.db.exec('BEGIN IMMEDIATE');
    try {const result=fn();this.db.exec('COMMIT');return result} catch(error) {this.db.exec('ROLLBACK');throw error}
  }
}
