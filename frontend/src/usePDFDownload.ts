import {useEffect,useRef,useState} from 'react';
/** Authenticated attachment download shared by professor and personal reports. */
export function usePDFDownload() {
 const [downloading,setDownloading]=useState(false),[downloadError,setDownloadError]=useState('');
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>active.current?.abort(),[]);
 async function download(url:string) {
  if(active.current)return;const controller=new AbortController();active.current=controller;setDownloading(true);setDownloadError('');
  try {
   const response=await fetch(url,{credentials:'same-origin',signal:controller.signal});
   if(!response.ok){const problem=await response.json().catch(()=>null);throw new Error(problem?.message||'PDF를 다운로드하지 못했습니다. 다시 시도해 주세요.')}
   if(!response.headers.get('Content-Type')?.includes('application/pdf'))throw new Error('PDF 응답을 확인하지 못했습니다. 다시 시도해 주세요.');
   const blob=await response.blob();if(controller.signal.aborted)return;
   const filename=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]||'campus-report.pdf';
   const objectURL=URL.createObjectURL(blob),link=document.createElement('a');link.href=objectURL;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(objectURL),10000);
  }catch(error){if(!controller.signal.aborted)setDownloadError(error instanceof Error?error.message:'PDF를 다운로드하지 못했습니다.')}
  finally{if(active.current===controller)active.current=null;if(!controller.signal.aborted)setDownloading(false)}
 }
 return {downloading,downloadError,clearDownloadError:()=>setDownloadError(''),download};
}
