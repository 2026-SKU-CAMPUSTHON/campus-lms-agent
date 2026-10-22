/** Network-free parser shared by the server and upload form. */
export function parseYouTubeUrl(input:string) {
 if(input.length>2048)throw new Error('YouTube 링크가 너무 깁니다.');
 let url:URL;try{url=new URL(input.trim())}catch{throw new Error('올바른 YouTube HTTPS 링크를 입력해 주세요.')}
 const hosts=['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be','www.youtu.be'];
 if(url.protocol!=='https:'||url.username||url.password||url.port||!hosts.includes(url.hostname))throw new Error('youtube.com 또는 youtu.be의 HTTPS 영상 링크만 지원합니다.');
 const short=url.hostname.endsWith('youtu.be');
 const id=short?url.pathname.slice(1):url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})$/)?.[1];
 if(!id||!/^[A-Za-z0-9_-]{11}$/.test(id)||url.searchParams.getAll('v').length>1)throw new Error('하나의 YouTube 영상 링크를 입력해 주세요. 재생목록만 있는 링크는 지원하지 않습니다.');
 const times=[...url.searchParams.getAll('t'),...url.searchParams.getAll('start'),...new URLSearchParams(url.hash.slice(1)).getAll('t')];
 if(times.length>1)throw new Error('시작 시간이 중복된 링크입니다. t 또는 start 하나만 사용해 주세요.');
 let start=0;
 if(times.length) {
  const value=times[0];
  if(/^\d+$/.test(value))start=Number(value);
  else {const parts=value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);if(!parts||!value)throw new Error('링크의 시작 시간 형식을 확인해 주세요.');start=Number(parts[1]||0)*3600+Number(parts[2]||0)*60+Number(parts[3]||0)}
  if(!Number.isSafeInteger(start)||start<0||start>=7200)throw new Error('시작 시간은 0~7199초로 입력해 주세요.');
 }
 return {video_id:id,url:`https://www.youtube.com/watch?v=${id}`,start_sec:start};
}
