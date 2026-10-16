
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
async function withAuth(mock, run) {
 const dir=await mkdtemp(join(process.cwd(),'.onboarding-auth-test-'));
 globalThis.__onboardingSupabase=mock;
 const values=new Map();globalThis.sessionStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);sessionStorage[k]=v;},removeItem:k=>{values.delete(k);delete sessionStorage[k];}};
 globalThis.window={location:{origin:'https://matmoveent.vercel.app'}};
 try {
  const out=join(dir,'auth.mjs');await build({entryPoints:['src/services/authService.ts'],outfile:out,bundle:true,platform:'node',format:'esm',plugins:[{name:'auth-mock',setup(b){b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'supabase',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const supabase=globalThis.__onboardingSupabase;'}));}}]});
  await run(await import(pathToFileURL(out)),values);
 } finally {delete globalThis.__onboardingSupabase;delete globalThis.sessionStorage;delete globalThis.window;await rm(dir,{recursive:true,force:true});}
}
const user={id:'customer-1',email:'user@example.com',user_metadata:{phone:'+23276000000'}};
test('email confirmation does not fabricate a customer session or call account RPC',()=>withAuth({auth:{signUp:async input=>{assert.equal(input.options.data.phone,'+23276000000');return {data:{user,session:null},error:null};}},rpc(){throw Error('Must not call RPC');}},async auth=>{assert.equal(await auth.signUp(user.email,'76 000 000','password8'),null);}));
test('actual Google session without customer setup retains identity and requests phone/role, while drafts change owners',()=>withAuth({auth:{getSession:async()=>({data:{session:{user}}})},rpc:async name=>{assert.equal(name,'matmove_customer_me');return {data:null};}},async(auth,values)=>{
 sessionStorage.setItem('ob_owner_id','old-user');sessionStorage.setItem('ob_docs','foreign-upload');
 const current=await auth.getCustomerSession();assert.equal(current.user.id,user.id);assert.deepEqual(current.roles,[]);assert.equal(current.user.phone,'+23276000000');assert.equal(values.has('ob_docs'),false);
}));
test('saving selected role is persisted by trusted RPC and restores existing customer identity',()=>{let saved=false;return withAuth({auth:{getSession:async()=>({data:{session:{user}}})},rpc:async(name,args)=>{if(name==='matmove_save_customer_account'){assert.deepEqual(args,{p_role:'rider',p_phone:'+23276000000'});saved=true;return {data:{}};}assert.equal(saved,true);return {data:{user,roles:['rider'],kycStatus:'not_started'}};}},async auth=>{assert.equal((await auth.saveCustomerAccount('rider','76000000')).user.id,user.id);});});
test('RPC failure and administrative memberships fail closed instead of becoming riders',async()=>{
 await withAuth({auth:{getSession:async()=>({data:{session:{user}}})},rpc:async()=>({error:{message:'Permission denied'}})},async auth=>{await assert.rejects(()=>auth.getCustomerSession(),/Permission denied/);});
 await withAuth({auth:{getSession:async()=>({data:{session:{user}}})},rpc:async()=>({data:{user,roles:['admin']}})},async auth=>{await assert.rejects(()=>auth.getCustomerSession(),/cannot access/);});
});
test('Google redirect uses customer callback and email password is never passed to OAuth',()=>withAuth({auth:{signInWithOAuth:async input=>{assert.deepEqual(input,{provider:'google',options:{redirectTo:'https://matmoveent.vercel.app/auth/callback'}});return {};}}},async auth=>{await auth.signInWithGoogle();}));
test('KYC review uses one secured submission, has no wallet prerequisite, and exposes inline errors',async()=>{
 const src=await readFile('src/pages/OnboardingPages.tsx','utf8');const review=src.slice(src.indexOf('export function ReviewPage'),src.indexOf('export function SubmittedPage'));
 assert.match(review,/matmove_submit_customer_kyc/);assert.doesNotMatch(review,/\.upsert\(|alert\(|create-monime-wallet/);assert.match(review,/finally \{ setIsSubmitting\(false\)/);assert.match(src,/Skip KYC for now/);
});
