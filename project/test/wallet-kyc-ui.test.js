
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const user='11111111-1111-4111-8111-111111111111';
async function bundled(file,fn){
 const dir=await mkdtemp(join(process.cwd(),'.matmove-ui-test-'));
 try{const out=join(dir,'component.mjs');await build({entryPoints:[file],outfile:out,platform:'node',format:'esm',bundle:true,jsx:'automatic',external:['react','react/*','react-dom/*','lucide-react'],plugins:[{name:'test-session-storage',setup(b){b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'supabase',namespace:'mock'}));b.onResolve({filter:/^@\/context\/AuthContext$/},()=>({path:'auth',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='supabase'?'export const supabase=globalThis.__matmoveKycMock;':'export function useAuth(){return {session:{user:{id:"'+user+'"}}};}'}));}}]});await fn(await import(pathToFileURL(out)));}finally{delete globalThis.__matmoveKycMock;await rm(dir,{recursive:true,force:true});}
}
test('wallet cards hide amounts in rendered HTML by default and expose accessible eye and currency controls',()=>bundled('src/components/WalletCards.tsx',async module=>{
 const html=renderToStaticMarkup(React.createElement(module.default,{sleWallet:{monime_account_id:'fac-sle',balanceAvailable:true,balance:1234.56},usdWallet:{monime_account_id:'fac-usd',balanceAvailable:true,balance:789.12},refresh(){},refreshing:false,createUsd(){},creatingUsd:false}));
 assert.ok(!html.includes('1234.56'));assert.ok(!html.includes('789.12'));assert.match(html,/Show SLE balance/);assert.match(html,/Show USD balance/);assert.match(html,/Next wallet/);assert.match(html,/snap-mandatory/);assert.match(html,/Share wallet/);
}));
test('verified KYC paths belong to the signed-in user; uploading placeholders and filenames cannot be submitted',()=>bundled('src/components/DocumentUpload.tsx',async module=>{
 globalThis.__matmoveKycMock={storage:{from:()=>({info:async()=>({data:{size:1234},error:null})})}};
 // Imported component captures the global object; set its fields before loading in next test.
 const doc={id:`${user}/id_front-abc.jpg`,type:'id_front',fileName:'ID.jpg',fileSize:1234,status:'uploaded',uploadProgress:100};
 assert.equal(module.isUploadedKyc(doc,user),true);assert.equal(module.isUploadedKyc({...doc,id:'ID.jpg'},user),false);assert.equal(module.isUploadedKyc({...doc,status:'uploading'},user),false);assert.equal(module.isUploadedKyc(doc,'22222222-2222-4222-8222-222222222222'),false);
}));
test('KYC success requires upload AND storage confirmation, uses unique owned paths and never deletes an old object',async()=>{
 const calls=[];let missing=false;
 globalThis.__matmoveKycMock={storage:{from:()=>({upload:async(path,file,opts)=>{calls.push({op:'upload',path,opts});return {error:null};},info:async path=>{calls.push({op:'info',path});return missing?{data:null,error:{message:'not found'}}:{data:{size:1234},error:null};},remove:async()=>{throw new Error('Must not remove prior document');}})}};
 await bundled('src/components/DocumentUpload.tsx',async module=>{
 const file={type:'image/jpeg',name:'ID.jpg',size:1234};
 const a=await module.uploadKycFile(file,user,'identity_front');const b=await module.uploadKycFile(file,user,'identity_front');assert.notEqual(a.id,b.id);assert.ok(a.id.startsWith(user+'/'));assert.equal(a.status,'uploaded');assert.equal(calls[0].opts.upsert,false);assert.equal(calls[0].opts.contentType,'image/jpeg');
 missing=true;await assert.rejects(()=>module.uploadKycFile(file,user,'identity_front'),/could not be verified/);
 const count=calls.length;await assert.rejects(()=>module.uploadKycFile({...file,size:20*1024*1024},user,'identity_front'),/10 MB/);assert.equal(calls.length,count);
 });
});

test('storage SQL keeps private files readable only by their owner and prevents customer overwrite/delete',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const {readFile}=await import('node:fs/promises');const pg=new PGlite();
 try{
 await pg.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;
 grant usage on schema storage,auth to authenticated,anon;grant all on storage.objects to authenticated,anon;
 create policy old_broad_policy on storage.objects for all to authenticated,anon using(true) with check(true);`);
 const sql=await readFile(new URL('../docs/KYC_UPLOAD_RELIABILITY.sql',import.meta.url),'utf8');await pg.exec(sql);await pg.exec(sql);
 assert.equal((await pg.query("select public from storage.buckets where id='kyc-documents'")).rows[0].public,false);
 await pg.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${user}',false);`);
 await pg.query('insert into storage.objects values($1,$2)',['kyc-documents',`${user}/front.jpg`]);
 await assert.rejects(()=>pg.query('insert into storage.objects values($1,$2)',['kyc-documents','22222222-2222-4222-8222-222222222222/front.jpg']),/row-level security/);
 assert.equal((await pg.query('select * from storage.objects')).rows.length,1);
 assert.equal((await pg.query("update storage.objects set name='changed.jpg' returning *")).rows.length,0);
 assert.equal((await pg.query('delete from storage.objects returning *')).rows.length,0);
 await pg.exec("select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false)");assert.equal((await pg.query('select * from storage.objects')).rows.length,0);
 await pg.exec('reset role;set role anon');assert.equal((await pg.query('select * from storage.objects')).rows.length,0);
 }finally{await pg.close();}
});
