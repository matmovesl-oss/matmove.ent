
import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {build} from 'esbuild';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',admin='33333333-3333-4333-8333-333333333333';
const path=`${uid}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
const empty={user_id:uid,display_name:null,photo_path:null,version:0};
test('Profile presentation SQL preserves verified identity and money, enforces ownership and stale versions, and keeps uploads private',async t=>{
 const pg=new PGlite({postgresqlconf:['shared_buffers=16MB','max_connections=10','work_mem=1MB','maintenance_work_mem=8MB']});
 try{
  await pg.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table auth.users(id uuid primary key);insert into auth.users values('${uid}'),('${other}'),('${admin}');
   create table profiles(id uuid primary key references auth.users(id),role text,kyc_status text,full_name text,email text,phone text,kyc_rejection_reason text,kyc_reviewed_at timestamptz,kyc_reviewed_by uuid,kyc_review_version bigint default 1);
   insert into profiles(id,role,kyc_status,full_name,email,phone) values('${uid}','rider','approved','Verified Customer','verified@example.com','+23276000000'),('${other}','merchant','pending','Merchant','merchant@example.com','+23277000000'),('${admin}','admin','approved','Admin','admin@example.com','+23278000000');
   create table user_roles(profile_id uuid references profiles(id),role text);insert into user_roles values('${uid}','rider'),('${other}','merchant'),('${admin}','admin');
   create table wallets(user_id uuid,balance numeric,currency text);insert into wallets values('${uid}',42.50,'SLE');
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,primary key(bucket_id,name));
   create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
   alter table storage.objects enable row level security;grant usage on schema auth,storage,public to authenticated,anon;grant all on storage.objects to authenticated;grant select on storage.buckets to authenticated;
   create policy legacy_broad on storage.objects for all to authenticated using(true) with check(true);
  `);
  await pg.exec(await readFile('docs/PORTAL_HOME_SETUP.sql','utf8'));
  const kyc=await readFile('docs/KYC_REVIEW_LOCK_SETUP.sql','utf8');await pg.exec(kyc.slice(kyc.indexOf('create or replace function public.matmove_kyc_protect_identity()'),kyc.indexOf('create or replace function public.matmove_customer_kyc_draft()')));
  const sql=await readFile('docs/ACCOUNT_PROFILE_SETUP.sql','utf8');await pg.exec(sql);await pg.exec(sql);
  const session=async id=>{await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await pg.exec('set role authenticated');};
  const me=async()=> (await pg.query('select public.matmove_account_presentation_me() as value')).rows[0].value;
  const save=async(name,photo,version)=>(await pg.query('select public.matmove_save_account_presentation($1,$2,$3) as value',[name,photo,version])).rows[0].value;
  await t.test('approved users edit their display presentation without changing identity, approval or wallet balance',async()=>{
   await session(uid);assert.deepEqual(await me(),empty);
   const first=await save('Friendly name',null,0);assert.equal(first.version,1);assert.equal(first.display_name,'Friendly name');
   await assert.rejects(()=>save('Stale edit',null,0),/CONFLICT/);
   await pg.exec('reset role');const profile=(await pg.query('select * from profiles where id=$1',[uid])).rows[0];
   assert.equal(profile.full_name,'Verified Customer');assert.equal(profile.kyc_status,'approved');assert.equal(profile.role,'rider');
   assert.equal((await pg.query('select balance from wallets where user_id=$1',[uid])).rows[0].balance,'42.50');
   await assert.rejects(()=>pg.query("update profiles set full_name='Forged' where id=$1",[uid]),/LOCKED/);
  });
  await t.test('saving requires a real owned raster upload and accepts removal without deleting the stored object',async()=>{
   await session(uid);
   await assert.rejects(()=>save('Photo',`${other}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`,1),/own account/);
   await assert.rejects(()=>save('Photo',path,1),/upload has not been confirmed/);
   await pg.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['matmove-profile-photos',path,JSON.stringify({mimetype:'image/jpeg',size:1200})]);
   const photo=await save('Photo',path,1);assert.equal(photo.photo_path,path);assert.equal(photo.version,2);
   const removed=await save(null,null,2);assert.equal(removed.photo_path,null);assert.equal(removed.version,3);
   assert.equal((await pg.query('select count(*)::int n from storage.objects where name=$1',[path])).rows[0].n,1);
  });
  await t.test('restrictive storage policies contain old broad grants, and browser table writes and admin calls stay denied',async()=>{
   await session(other);assert.equal((await me()).version,0);
   assert.equal((await pg.query('select count(*)::int n from storage.objects where name=$1',[path])).rows[0].n,0);
   await assert.rejects(()=>pg.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['matmove-profile-photos',`${uid}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg`,'{}']),/row-level security/);
   await assert.rejects(()=>pg.query('select * from matmove_account_presentation'),/permission denied/);
   await assert.rejects(()=>pg.query('insert into matmove_account_presentation(user_id,display_name) values($1,$2)',[other,'Bypass']),/permission denied/);
   await session(uid);assert.equal((await pg.query('delete from storage.objects where name=$1 returning name',[path])).rows.length,0);
   await session(admin);await assert.rejects(me,/ACCESS/);
   await pg.exec('reset role;set role anon');await assert.rejects(me,/permission denied/);
  });
  await t.test('invalid image metadata and stale values fail before a profile mutation; reruns preserve the saved record',async()=>{
   await pg.exec('reset role');await pg.query('update storage.objects set metadata=$1 where name=$2',[JSON.stringify({mimetype:'image/svg+xml',size:1200}),path]);await session(uid);
   await assert.rejects(()=>save('Bad file',path,3),/upload has not been confirmed/);
   await pg.exec('reset role');await pg.query('update storage.objects set metadata=$1 where name=$2',[JSON.stringify({mimetype:'image/jpeg',size:2097153}),path]);await session(uid);
   await assert.rejects(()=>save('Too large',path,3),/2 MB/);await assert.rejects(()=>save('x'.repeat(61),null,3),/INVALID/);
   assert.equal((await me()).version,3);await pg.exec('reset role');await pg.exec(sql);await session(uid);assert.equal((await me()).version,3);
  });
 }finally{await pg.close();}
});

function nodes(n){if(!n||typeof n!=='object')return[];if(Array.isArray(n))return n.flatMap(nodes);return[n,...nodes(n.props?.children)];}
function text(n){if(n==null||typeof n==='boolean')return'';if(typeof n!=='object')return String(n);if(Array.isArray(n))return n.map(text).join('');return text(n.props?.children);}
async function page(fn,{readError=null,record=empty,uploadError=null,signedError=null}={}){
 const dir=await mkdtemp(join(process.cwd(),'.profile-test-')),out=join(dir,'ui.mjs');
 const original={window:globalThis.window,document:globalThis.document,Image:globalThis.Image};
 const slots=[],effects=[],calls=[],events=new Map();let cursor=0,dirty=true,tree,unmounted=false,timer=0,currentUser=uid,saveReply=null;
 const changed=(a,b)=>!a||a.length!==b?.length||a.some((v,i)=>!Object.is(v,b[i]));
 globalThis.__profileHooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;dirty=true;}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useCallback(fn,deps){const i=cursor++;if(!(i in slots)||changed(slots[i].deps,deps))slots[i]={fn,deps};return slots[i].fn;},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||changed(old.deps,deps)){const s={deps,cleanup:old?.cleanup};slots[i]=s;effects.push(()=>{s.cleanup?.();s.cleanup=fn();});}}};
 globalThis.window={setTimeout:()=>++timer,clearTimeout(){},setInterval:()=>++timer,clearInterval(){},addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),dispatchEvent:event=>events.get(event.type)?.(event)};
 globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){},createElement:()=>({getContext:()=>({fillRect(){},drawImage(){}}),toBlob:cb=>cb(new Blob(['converted'],{type:'image/jpeg'}))})};
 globalThis.Image=class{naturalWidth=800;naturalHeight=600;set src(value){queueMicrotask(()=>this.onload());}};
 globalThis.__profileDb={auth:{getSession:async()=>({data:{session:{user:{id:currentUser}}},error:null})},rpc(name,args){calls.push({name,args});const q={abortSignal:()=>q,then:(yes,no)=>Promise.resolve().then(()=>{
  if(name==='matmove_account_presentation_me')return{data:record,error:readError};
  if(saveReply)return saveReply(args);
  record={user_id:uid,display_name:args.p_display_name,photo_path:args.p_photo_path,version:args.p_expected+1};return{data:record,error:null};
 }).then(yes,no)};return q;},storage:{from:bucket=>({upload:async(path,blob,options)=>{calls.push({name:'upload',bucket,path,blob,options});return uploadError?{data:null,error:uploadError}:{data:{path},error:null};},createSignedUrl:async(path,seconds)=>{calls.push({name:'signedUrl',path,seconds});return signedError?{data:null,error:signedError}:{data:{signedUrl:'https://storage.example/signed/profile.jpg'},error:null};}})}};
 try{
  await build({entryPoints:['src/components/AccountProfile.tsx'],tsconfig:'tsconfig.app.json',outfile:out,bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react/*','lucide-react'],plugins:[{name:'profile-mocks',setup(b){b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'mock'}));b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'db',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='hooks'?'export const {useState,useEffect,useRef,useCallback}=globalThis.__profileHooks;':'export const supabase=globalThis.__profileDb;'}));}}]});
  const module=await import(pathToFileURL(out));
  function render(){cursor=0;dirty=false;tree=module.default({userId:uid});while(effects.length)effects.shift()();}
  async function settle(){for(let n=0;n<14;n++){if(dirty&&!unmounted)render();await new Promise(r=>setImmediate(r));if(n>6&&!dirty)break;}}
  const button=label=>{const result=nodes(tree).find(n=>n.type==='button'&&text(n).trim()===label);assert.ok(result,`Missing ${label}: ${text(tree)}`);return result;};
  const h={calls,module,button,settle,get text(){return text(tree);},get nodes(){return nodes(tree);},setUser:id=>currentUser=id,setReply:fn=>saveReply=fn,async name(value){nodes(tree).find(n=>n.type==='input'&&n.props.type==='text').props.onChange({target:{value}});await settle();},async photo(type='image/png'){nodes(tree).find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[new File(['photo'],'photo.png',{type})],value:'photo.png'}});await settle();},async click(label){const b=button(label);assert.ok(!b.props.disabled);b.props.onClick();await settle();},unmount(){unmounted=true;for(const s of slots)s?.cleanup?.();}};
  await settle();await fn(h);
 }finally{if(!unmounted)for(const s of slots)s?.cleanup?.();for(const[k,v]of Object.entries(original)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}delete globalThis.__profileHooks;delete globalThis.__profileDb;await rm(dir,{recursive:true,force:true});}
}
test('Profile form saves the exact display fields and loaded version once without sending KYC or wallet fields',()=>page(async h=>{
 await h.name('New display name');const save=h.button('Save profile');save.props.onClick();save.props.onClick();await h.settle();
 const writes=h.calls.filter(c=>c.name==='matmove_save_account_presentation');assert.equal(writes.length,1);assert.deepEqual(writes[0].args,{p_display_name:'New display name',p_photo_path:null,p_expected:0});assert.match(h.text,/Profile saved/);
}));
test('Photo is decoded and converted, uploaded to an owned unique path, then saved only with the confirmed path',()=>page(async h=>{
 await h.photo();await h.click('Save profile');const upload=h.calls.find(c=>c.name==='upload');assert.equal(upload.bucket,'matmove-profile-photos');assert.ok(upload.path.startsWith(`${uid}/`));assert.ok(upload.path.endsWith('.jpg'));assert.equal(upload.blob.type,'image/jpeg');assert.equal(upload.options.upsert,false);
 const write=h.calls.find(c=>c.name==='matmove_save_account_presentation');assert.equal(write.args.p_photo_path,upload.path);assert.ok(h.calls.indexOf(upload)<h.calls.indexOf(write));
}));
test('Unsupported image and a changed identity prevent uploads or profile writes',()=>page(async h=>{
 await h.photo('image/svg+xml');assert.match(h.text,/Choose a JPG/);assert.ok(!h.calls.some(c=>c.name==='upload'));
 await h.name('Test');h.setUser(other);await h.click('Save profile');assert.match(h.text,/sign-in changed/);assert.ok(!h.calls.some(c=>c.name==='matmove_save_account_presentation'));
}));
test('A read error prevents editing and preserves a clear Reload action instead of fabricating an empty saved profile',()=>page(async h=>{
 assert.match(h.text,/offline/);assert.equal(h.button('Save profile').props.disabled,true);assert.equal(h.button('Reload saved profile').props.disabled,false);
},{readError:{message:'offline'}}));
test('Stale save errors preserve the draft and do not report success',()=>page(async h=>{
 await h.name('Keep my draft');h.setReply(()=>({data:null,error:{message:'CONFLICT: Profile changed'}}));await h.click('Save profile');assert.match(h.text,/CONFLICT/);assert.doesNotMatch(h.text,/Profile saved\./);assert.equal(h.nodes.find(n=>n.type==='input'&&n.props.type==='text').props.value,'Keep my draft');
}));
test('Profile response validation rejects cross-user photos, arbitrary URLs and malformed versions',()=>page(async h=>{
 assert.throws(()=>h.module.validatePresentation({...empty,photo_path:`${other}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`},uid),/could not be verified/);
 assert.throws(()=>h.module.validatePresentation({...empty,photo_path:'https://example.com/photo.jpg'},uid),/could not be verified/);
 assert.throws(()=>h.module.validatePresentation({...empty,version:-1},uid),/could not be verified/);
}));

test('Failed photo upload never saves a profile path or claims success',()=>page(async h=>{
 await h.photo();await h.click('Save profile');assert.match(h.text,/storage unavailable/);assert.ok(!h.calls.some(c=>c.name==='matmove_save_account_presentation'));assert.doesNotMatch(h.text,/Profile saved\./);
},{uploadError:{message:'storage unavailable'}}));
test('A missing saved photo remains removable instead of trapping the whole profile editor',()=>page(async h=>{
 assert.match(h.text,/saved photo could not be loaded/);assert.equal(h.button('Save profile').props.disabled,false);
 await h.click('Remove photo');await h.click('Save profile');assert.equal(h.calls.find(c=>c.name==='matmove_save_account_presentation').args.p_photo_path,null);
},{record:{...empty,photo_path:path,version:1},signedError:{message:'photo not found'}}));
test('A mismatched save receipt never reports the profile saved',()=>page(async h=>{
 await h.name('Display');h.setReply(()=>({data:{...empty,user_id:other,version:1},error:null}));await h.click('Save profile');assert.match(h.text,/could not be verified/);assert.doesNotMatch(h.text,/Profile saved\./);
}));
