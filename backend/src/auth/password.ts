import {randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
const derive=(password:string,salt:string)=>new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key)));
export async function hashPassword(password:string){const salt=randomBytes(16).toString('hex');return `scrypt-v1$${salt}$${(await derive(password,salt)).toString('hex')}`}
export async function verifyPassword(password:string,encoded:string){const [version,salt,digest]=encoded.split('$');if(version!=='scrypt-v1'||!salt||!digest)return false;const expected=Buffer.from(digest,'hex'),actual=await derive(password,salt);return expected.length===actual.length&&timingSafeEqual(expected,actual)}
