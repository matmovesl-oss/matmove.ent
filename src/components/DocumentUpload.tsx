
import { useEffect, useRef, useState } from 'react';
import { UploadCloud, RefreshCw, CheckCircle2, Trash2, Camera } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { DocumentType, UploadedDocument } from '@/types';

type Props = {type:DocumentType;document:UploadedDocument|undefined;onUpload:(doc:UploadedDocument)=>void;onRemove:()=>void};
const bucket = () => supabase.storage.from('kyc-documents');
const extensions:Record<string,string> = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'};
export function isUploadedKyc(doc:UploadedDocument|undefined|null,userId?:string):doc is UploadedDocument & {id:string} {
  return !!doc && doc.status==='uploaded' && typeof doc.id==='string' && /^[0-9a-f-]{36}\/[A-Za-z0-9_./-]+$/i.test(doc.id) && !doc.id.includes('..') && (!userId||doc.id.startsWith(`${userId}/`));
}
export async function verifyKycDocument(doc:UploadedDocument|undefined|null,userId:string) {
  if(!isUploadedKyc(doc,userId))throw new Error('Upload each required document fully before continuing.');
  const {data,error}=await bucket().info(doc.id);
  if(error||!data||!Number.isFinite(Number(data.size))||Number(data.size)<=0)throw new Error('A document could not be verified in storage. Return to Documents and upload it again.');
  return doc.id;
}
export async function uploadKycFile(file:File,userId:string,type:DocumentType) {
  if(!extensions[file.type]||(type==='selfie'&&file.type==='application/pdf'))throw new Error('Choose a supported document or photo.');
  if(file.size<=0||file.size>10*1024*1024)throw new Error('Maximum upload size is 10 MB.');
  const path=`${userId}/${String(type).replace(/[^A-Za-z0-9_-]/g,'_')}-${crypto.randomUUID()}.${extensions[file.type]}`;
  const {error}=await bucket().upload(path,file,{upsert:false,cacheControl:'0',contentType:file.type});
  if(error)throw new Error(error.message);
  const next:UploadedDocument={id:path,type,fileName:file.name,fileSize:file.size,status:'uploaded',uploadProgress:100};
  await verifyKycDocument(next,userId);
  return next;
}
function remember(doc:UploadedDocument,userId:string) {
  if(!isUploadedKyc(doc,userId))return;
  const clean={id:doc.id,type:doc.type,fileName:doc.fileName,fileSize:doc.fileSize,status:'uploaded',uploadProgress:100};
  try {
    if(doc.type==='selfie')sessionStorage.setItem('ob_selfie',JSON.stringify(clean));
    else for(const key of ['ob_docs','ob_documents']) {
      let old:Record<string,unknown>={};try{old=JSON.parse(sessionStorage.getItem(key)||'{}')||{};}catch{/* Replace broken local metadata. */}
      sessionStorage.setItem(key,JSON.stringify({...old,[doc.type]:clean}));
    }
  }catch{/* The verified upload can still be submitted while this page is open. */}
}
export function DocumentUpload({type,document,onUpload,onRemove}:Props) {
  const {session}=useAuth();
  const userId=session?.user.id;
  const input=useRef<HTMLInputElement>(null);
  const lock=useRef(false),mounted=useRef(true);
  const callbacks=useRef({onUpload,onRemove});callbacks.current={onUpload,onRemove};
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState('');
  const current=userId&&isUploadedKyc(document,userId)?document:null;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    let live=true;setPreview('');
    if(current&&userId&&current.id.startsWith(`${userId}/`)&&current.fileName&&!current.fileName.toLowerCase().endsWith('.pdf'))void bucket().createSignedUrl(current.id,300).then(({data})=>{if(live&&data?.signedUrl)setPreview(data.signedUrl);});
    return()=>{live=false;};
  },[current?.id,userId]);
  async function upload(file:File) {
    if(lock.current)return;
    const previous=current;
    setError('');
    if(!userId){setError('Sign in again before uploading.');return;}
    if(!extensions[file.type]||(type==='selfie'&&file.type==='application/pdf')){setError(type==='selfie'?'Choose a JPG, PNG or WebP photo.':'Choose a JPG, PNG, WebP or PDF.');return;}
    if(file.size<=0||file.size>10*1024*1024){setError('Choose a file between 1 byte and 10 MB.');return;}
    lock.current=true;setBusy(true);
    callbacks.current.onUpload({id:null,type,fileName:file.name,fileSize:file.size,status:'uploading',uploadProgress:0});
    try {
      // A replacement never deletes the previous successfully uploaded document.
      const next=await uploadKycFile(file,userId,type);
      const {data:{session:active}}=await supabase.auth.getSession();
      if(active?.user.id!==userId)throw new Error('Your session changed. Sign in and upload again.');
      remember(next,userId);
      if(mounted.current)callbacks.current.onUpload(next);
    } catch(e) {
      if(mounted.current){setError((e instanceof Error?e.message:'Upload failed.')+' Your previous document was kept. Choose the file again to retry.');if(previous){remember(previous,userId);callbacks.current.onUpload(previous);}else callbacks.current.onRemove();}
    } finally {lock.current=false;if(mounted.current){setBusy(false);if(input.current)input.current.value='';}}
  }
  function remove() {
    if(lock.current)return;
    // Keep storage objects for existing profile references; removal here only changes this onboarding draft.
    try{if(type==='selfie')sessionStorage.removeItem('ob_selfie');else for(const key of ['ob_docs','ob_documents']){const old=JSON.parse(sessionStorage.getItem(key)||'{}');delete old[type];sessionStorage.setItem(key,JSON.stringify(old));}}catch{/* Parent state still updates. */}
    callbacks.current.onRemove();setError('');setPreview('');
  }
  return <div data-doc-type={type} className="space-y-3">
    <input ref={input} type="file" className="hidden" accept={type==='selfie'?'image/jpeg,image/png,image/webp':'image/jpeg,image/png,image/webp,application/pdf'} capture={type==='selfie'?'user':undefined} disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);}}/>
    {preview&&<img src={preview} alt={type==='selfie'?'Your uploaded selfie':'Your uploaded document'} className="mx-auto max-h-56 rounded-xl object-contain"/>}
    {busy?<p role="status" className="flex items-center justify-center gap-2 font-semibold text-blue-700"><RefreshCw size={20} className="animate-spin"/>Uploading and verifying… Keep this page open.</p>:current?<p className="flex items-center justify-center gap-2 break-all text-emerald-700"><CheckCircle2 size={20}/>{current.fileName} · Uploaded</p>:<p className="text-sm text-slate-500">{type==='selfie'?'Take or choose a clear photo of your face.':'Choose a clear photo or PDF.'} Maximum 10 MB.</p>}
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="flex flex-wrap justify-center gap-3">
      <button type="button" disabled={busy} onClick={()=>input.current?.click()} className="flex items-center gap-2 rounded-xl border bg-white px-4 py-3 font-bold disabled:opacity-50">{type==='selfie'?<Camera size={18}/>:<UploadCloud size={18}/>} {current?'Replace file':type==='selfie'?'Add selfie':'Choose file'}</button>
      {current&&<button type="button" disabled={busy} onClick={remove} className="flex items-center gap-2 rounded-xl border px-4 py-3 text-red-700 disabled:opacity-50"><Trash2 size={16}/>Remove from draft</button>}
    </div>
  </div>;
}
export function SelfieUpload(props:Omit<Props,'type'>) {return <DocumentUpload {...props} type="selfie"/>;}
