export async function api<T>(path:string,init:RequestInit={}):Promise<T> {
  const headers=new Headers(init.headers);
  if(init.body && !(init.body instanceof FormData)) headers.set('Content-Type','application/json');
  const response=await fetch('/api'+path,{...init,headers,credentials:'same-origin'});
  if(!response.ok) {
    const body=await response.json().catch(()=>({message:'서버 응답을 읽지 못했습니다.'}));
    const error=new Error(body.message || '요청을 처리하지 못했습니다.') as Error & {status:number};error.status=response.status;throw error;
  }
  return response.status===204?undefined as T:response.json();
}
export function post<T>(path:string,body:unknown,key?:string) {return api<T>(path,{method:'POST',body:JSON.stringify(body),headers:key?{'Idempotency-Key':key}:{}})}
