import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { z } from 'zod';
import { HttpError } from '../errors.js';
import type { Extraction } from '../types.js';
const exec=promisify(execFile);
const schema=z.object({total_slides:z.number().int().positive(),slides:z.array(z.object({slide_no:z.number().int().positive(),text:z.string()})).min(1)});
export async function extractDocument(file:string,start:number,end:number,root:string):Promise<Extraction> {
  try {
    const {stdout}=await exec(process.env.PYTHON_BIN || 'python3',[resolve(root,'worker/document_extract.py'),file,String(start),String(end)],{timeout:30000,maxBuffer:2*1024*1024});
    return schema.parse(JSON.parse(stdout));
  } catch(error) {
    let message='문서 파일을 읽을 수 없습니다.';
    if(error && typeof error==='object' && 'stdout' in error) {
      try {message=JSON.parse(String(error.stdout)).error} catch {message='문서 추출이 끝나지 않았습니다. 파일과 Python 설정을 확인해 주세요.'}
    }
    throw new HttpError(422,'DOCUMENT_EXTRACTION_FAILED',message);
  }
}
