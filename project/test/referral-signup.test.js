import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {readFile,mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',code='MM123456ABCDEF';
async function fixture(fn){
 const dir=await mkdtemp(join(process.cwd(),'.referral-signup-')),out=join(dir,'auth.mjs');const old={window:globalThis.window,sessionStorage:globalThis.sessionStorage};const values=new Map(),calls=[];let user={id:uid,email:'new@example.com',created_at:new Date().toISOString(),user_metadata:{phone:'+23276000000'},app_metadata:{provider:'email'}},saved=false,handler=null;
 globalThis.window={location:{origin:'https://matmove.example'}};globalThis.sessionStorage={getItem:k=>values.get(k)||null,setItem(k,v){values.set(k,v);this[k]=v;},removeItem(k){values.delete(k);delete this[k];}};
 globalThis.__signupDb={auth:{getSession:async()=>({data:{session:{user}},error:null}),signUp:async input=>{calls.push({name:'authSignup',input});user={...user,user_metadata:{...input.options.data}};return{data:{session:{user}},error:null};},signInWithOAuth:async input=>{calls.push({name:'oauth',input});return{error:null};}},rpc:async(name,args)=>{calls.push({name,args});if(handler){const value=await handler(name,args);if(value!==undefined)return value;}if(name==='matmove_save_customer_account'){saved=true;return{data:{},error:null};}if(name==='matmove_customer_me')return{data:saved?{user:{id:user.id,email:user.email,phone:'+23276000000'},roles:['rider'],kycStatus:'not_started'}:null,error:null};if(name==='matmove_referral_register')return{data:{user_id:user.id,recorded:true,code:args.p_code},error:null};throw Error('Unexpected '+name);}};
 try{
  await build({stdin:{contents:`export * from './src/services/authService.ts';export * from './src/services/referralSignup.ts';`,resolveDir:process.cwd(),sourcefile:'referral-entry.ts'},tsconfig:'tsconfig.app.json',outfile:out,bundle:true,platform:'node',format:'esm',plugins:[{name:'signup-mock',setup(b){b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'db',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const supabase=globalThis.__signupDb;'}));}}]});
  const api=await import(pathToFileURL(out));await fn({api,values,calls,setUser:x=>user={...user,...x},setHandler:fn=>handler=fn,get user(){return user;}});
 }finally{for(const[k,v]of Object.entries(old)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}delete globalThis.__signupDb;await rm(dir,{recursive:true,force:true});}
}
test('email signup retains only its matching referral metadata and binds after trusted account setup',()=>fixture(async h=>{
 h.api.prepareReferralSignup(' mm123456abcdef ','email','New@example.com');await h.api.signUp('new@example.com','76000000','password8');const input=h.calls.find(c=>c.name==='authSignup').input;assert.equal(input.options.data.matmove_referral_code,code);assert.equal(input.options.data.phone,'+23276000000');assert.equal(h.calls.some(c=>c.name==='matmove_referral_register'),false);
 const session=await h.api.saveCustomerAccount('rider','76000000');await h.api.recordSignupReferral(uid);assert.equal(session.user.id,uid);const binding=h.calls.findIndex(c=>c.name==='matmove_referral_register'),setup=h.calls.findIndex(c=>c.name==='matmove_save_customer_account');assert.ok(binding>setup);assert.deepEqual(h.calls[binding].args,{p_code:code});assert.equal(h.api.referralSignupNotice(uid).state,'recorded');
}));
test('email confirmation in another tab restores the code from authenticated signup metadata',()=>fixture(async h=>{
 h.setUser({user_metadata:{phone:'+23276000000',matmove_referral_code:code}});await h.api.getCustomerSession();assert.equal(h.api.referralSignupNotice(uid).code,code);await h.api.saveCustomerAccount('rider','76000000');await h.api.recordSignupReferral(uid);assert.equal(h.api.referralSignupNotice(uid).state,'recorded');
}));
test('new Google identity captures the code without changing callback URLs or passing email/password to OAuth',()=>fixture(async h=>{
 h.api.prepareReferralSignup(code,'google');await h.api.signInWithGoogle();assert.deepEqual(h.calls[0].input,{provider:'google',options:{redirectTo:'https://matmove.example/auth/callback'}});h.setUser({app_metadata:{provider:'google'}});await h.api.getCustomerSession();assert.equal(h.api.referralSignupNotice(uid).code,code);
}));
test('an older Google identity cannot inherit a code left by someone starting a new signup',()=>fixture(async h=>{
 h.api.prepareReferralSignup(code,'google');h.setUser({created_at:new Date(Date.now()-86400000).toISOString(),app_metadata:{provider:'google'}});await h.api.getCustomerSession();assert.equal(h.api.referralSignupNotice(uid),null);assert.equal(h.values.has('matmove-referral-signup:v1'),false);
}));
test('a changed email does not attach a different signup attempt or leak it into a later identity',()=>fixture(async h=>{
 h.api.prepareReferralSignup(code,'email','someone@example.com');assert.deepEqual(h.api.emailReferralMetadata('new@example.com'),{});await h.api.getCustomerSession();assert.equal(h.api.referralSignupNotice(uid),null);assert.equal(h.values.has('matmove-referral-signup:v1'),false);
}));
test('paused or invalid referral responses do not undo account creation or fabricate a recorded reward',()=>fixture(async h=>{
 h.api.prepareReferralSignup(code,'email','new@example.com');await h.api.signUp('new@example.com','76000000','password8');h.setHandler(name=>name==='matmove_referral_register'?{data:null,error:{message:'PAUSED: Referral registration is not active yet.'}}:undefined);
 const session=await h.api.saveCustomerAccount('rider','76000000');await h.api.recordSignupReferral(uid);assert.equal(session.roles[0],'rider');assert.equal(h.api.referralSignupNotice(uid).state,'attention');assert.match(h.api.referralSignupNotice(uid).message,/PAUSED/);assert.equal(h.calls.some(c=>/transfer|payment|credit/.test(c.name)),false);
}));
test('lost response retries retain the same code and duplicate calls share one binding attempt',()=>fixture(async h=>{
 h.api.captureReferralIdentity({...h.user,user_metadata:{matmove_referral_code:code}});let resolve;h.setHandler(name=>name==='matmove_referral_register'?new Promise(r=>resolve=r):undefined);
 const a=h.api.recordSignupReferral(uid),b=h.api.recordSignupReferral(uid);assert.equal(a,b);await new Promise(r=>setImmediate(r));resolve({data:null,error:{message:'Response lost'}});await a;assert.equal(h.api.referralSignupNotice(uid).state,'attention');h.setHandler(null);await h.api.recordSignupReferral(uid);const binds=h.calls.filter(c=>c.name==='matmove_referral_register');assert.equal(binds.length,2);assert.deepEqual(binds[0].args,binds[1].args);assert.equal(h.api.referralSignupNotice(uid).state,'recorded');
}));
test('switching signed-in customers prevents binding another customer’s retained code',()=>fixture(async h=>{
 h.api.captureReferralIdentity({...h.user,user_metadata:{matmove_referral_code:code}});h.setUser({id:other,email:'other@example.com',user_metadata:{}});await h.api.recordSignupReferral(uid);assert.equal(h.calls.some(c=>c.name==='matmove_referral_register'),false);assert.equal(h.api.referralSignupNotice(other),null);assert.equal(h.api.referralSignupNotice(uid).state,'pending');
}));
test('continuing without waiting is explicit and does not pretend to cancel an uncertain server attribution',()=>fixture(async h=>{
 h.api.captureReferralIdentity({...h.user,user_metadata:{matmove_referral_code:code}});h.api.acknowledgeReferralNotice(uid);const notice=await h.api.recordSignupReferral(uid);assert.equal(notice.acknowledged,true);assert.equal(notice.state,'pending');assert.equal(h.calls.length,0);
}));
test('invalid receipts stay unconfirmed; empty optional codes do not require functioning browser storage',()=>fixture(async h=>{
 assert.throws(()=>h.api.normalizeReferralCode('123'),/remove it/);h.api.captureReferralIdentity({...h.user,user_metadata:{matmove_referral_code:code}});h.setHandler(name=>name==='matmove_referral_register'?{data:{user_id:other,recorded:true,code},error:null}:undefined);await h.api.recordSignupReferral(uid);assert.equal(h.api.referralSignupNotice(uid).state,'attention');
 globalThis.sessionStorage={getItem(){throw Error('blocked');},removeItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};assert.doesNotThrow(()=>h.api.prepareReferralSignup('','email'));assert.throws(()=>h.api.prepareReferralSignup(code,'email','new@example.com'),/browser could not retain/);
}));
test('signup and KYC UI expose optional code removal, safe retry and a deliberate continue choice',async()=>{
 const auth=await readFile('src/pages/AuthPages.tsx','utf8'),onboarding=await readFile('src/pages/OnboardingPages.tsx','utf8');assert.match(auth,/Signup referral code/);assert.match(auth,/Remove referral code/);assert.match(auth,/get\('ref'\)/);assert.match(auth,/prepareReferralSignup\(referral,'email',email\)/);assert.match(onboarding,/Continue without waiting for referral/);assert.match(onboarding,/Retry referral code/);assert.match(onboarding,/ReferralSignupNotice key=\{userId\}/);assert.ok(onboarding.includes('matmove_submit_customer_kyc'));assert.ok(onboarding.includes('Verified identity — locked'));assert.ok(onboarding.includes('Skip KYC for now'));
});
