/** CI-only container verification. Refuse real hostnames and never print sessions. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const origin='https://campus.example.test';
assert.equal(process.env.APP_ORIGIN,origin,'This smoke test only runs against the disposable CI site.');
const phase=process.argv[2];assert.ok(['seed','check'].includes(phase));
const call=async(path,{cookie,body,method='GET',status=200}={})=>{
 const headers={Origin:origin};if(cookie)headers.Cookie=cookie;
 if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';
 const response=await fetch('http://127.0.0.1:3000/api'+path,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
 assert.equal(response.status,status,`${method} ${path}`);return response;
};
if(phase==='seed') {
 assert.equal((await (await call('/auth/config')).json()).mode,'password');await call('/dev/accounts',{status:404});
 const login=await call('/auth/login',{method:'POST',body:{email:'teacher@example.test',password:'Container-only-password-2026'}});
 const cookie=login.headers.getSetCookie()[0].split(';')[0];assert.ok(cookie.startsWith('__Host-campus_session='));
 const [course]=await (await call('/courses',{cookie})).json();const [week]=await (await call(`/courses/${course.course_id}/weeks`,{cookie})).json();
 const receipt=await (await call(`/courses/${course.course_id}/invites`,{method:'POST',cookie,body:{role:'student'},status:201})).json();
 const signup=await call('/auth/register',{method:'POST',body:{email:'student@example.test',password:'Container-student-password-2026',name:'컨테이너 학생',invite_code:receipt.invite_code},status:201});
 const student=signup.headers.getSetCookie()[0].split(';')[0];
 const form=new FormData();form.append('source_type','document');form.append('slide_start','1');form.append('slide_end','2');form.append('original_visible_to_students','false');form.append('file',new Blob([readFileSync('/tmp/sample.pdf')],{type:'application/pdf'}),'sample.pdf');
 const material=await(await call(`/courses/${course.course_id}/weeks/${week.week_id}/materials`,{method:'POST',cookie,body:form,status:202})).json();
 let ready=false;for(let i=0;i<60;i++){const job=await(await call('/jobs/'+material.job_id,{cookie})).json();if(job.status==='completed'){ready=true;break}assert.notEqual(job.status,'failed');await new Promise(resolve=>setTimeout(resolve,500))}assert.ok(ready);
 writeFileSync('/data/container-smoke.json',JSON.stringify({cookie,student,course:course.course_id,material:material.material_id}),{mode:0o600});
}else {
 const {cookie,student,course,material}=JSON.parse(readFileSync('/data/container-smoke.json','utf8'));
 assert.equal((await(await call('/me',{cookie:student})).json()).name,'컨테이너 학생');
 assert.equal((await(await call('/courses',{cookie:student})).json())[0].course_id,course);
 await call(`/materials/${material}/original`,{cookie:student,status:403});await call(`/materials/${material}/original`,{cookie});
 const pdf=await call(`/courses/${course}/reports/wrong-answers/pdf`,{cookie:student});assert.ok(pdf.headers.get('Content-Type').includes('application/pdf'));assert.ok(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).equals(Buffer.from('%PDF-')));
 await call(`/courses/${course}/reports/pdf`,{cookie:student,status:403});
}
console.log(`PASS: production container ${phase}`);
