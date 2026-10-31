
import test from 'node:test';import assert from 'node:assert/strict';
import {HELP_ARTICLES,HELP_VERSION,helpTopics,searchMatMoveHelp} from '../shared/matmove-help.js';
const rider={role:'rider'},driver={role:'driver'},merchant={role:'merchant'};
test('customer roles get their own guides without Admin actions',()=>{
 for(const c of [rider,driver,merchant]){const topics=helpTopics(c);assert.ok(topics.length>=10);assert.ok(topics.some(a=>a.id==='kyc'));assert.ok(topics.some(a=>a.id==='games'));assert.ok(topics.every(a=>!a.id.startsWith('admin-')));}
 assert.ok(helpTopics(driver).some(a=>a.id==='radar'));assert.ok(!helpTopics(driver).some(a=>a.id==='ride'||a.id==='card'));assert.ok(helpTopics(merchant).some(a=>a.id==='business'));assert.ok(!helpTopics(rider).some(a=>a.id==='business'));
});
test('local search handles common terms and unknown or live-account questions honestly',()=>{
 assert.equal(searchMatMoveHelp('How do I top up?',rider).articles[0].id,'load');assert.equal(searchMatMoveHelp('where is my avatar',driver).articles[0].id,'profile');assert.match(searchMatMoveHelp('my balance',merchant).articles[0].answer,/cannot see or change/);assert.equal(searchMatMoveHelp('why is the moon green?',rider).kind,'fallback');assert.equal(searchMatMoveHelp('',rider).kind,'topics');assert.equal(searchMatMoveHelp('how do I verify identity',rider).articles[0].id,'kyc');
});
test('Admin Help follows exact grants; operational access does not confer owner hiring rights',()=>{
 const ctx={role:'admin',isActive:true,permissions:['kyc','games.entries']};assert.deepEqual(helpTopics(ctx).map(x=>x.id),['admin-kyc','admin-games-entries']);assert.equal(searchMatMoveHelp('staff invite',ctx).kind,'fallback');assert.equal(helpTopics({...ctx,isActive:false,isOwner:true}).length,0);assert.ok(helpTopics({role:'admin',isActive:true,isOwner:true}).length>=15);assert.equal(helpTopics({role:'admin',isActive:true,permissions:['staff']})[0].id,'admin-staff');assert.match(searchMatMoveHelp('invite staff',{role:'admin',isActive:true,permissions:['staff']}).articles[0].answer,/Only the verified super admin/);
});
test('all articles have unique IDs, a version and allowlisted local actions',()=>{
 assert.ok(HELP_VERSION);assert.equal(new Set(HELP_ARTICLES.map(a=>a.id)).size,HELP_ARTICLES.length);
 const destinations=new Set(['home','account','wallet','ride','radar','trips','shop','business','games','/dashboard','/dispatch','/kyc','/customers','/financials','/transactions','/payouts','/staff','/pricing','/logs',...['overview','players','entries','winnings','settings','recovery'].map(t=>`/games?tab=${t}`)]);
 for(const a of HELP_ARTICLES){assert.ok(destinations.has(a.action.destination));assert.ok(a.answer.length>50);}
});
test('sensitive strings are not echoed and guidance never promises a prize or payment',()=>{
 for(const q of ['my pin is 123456','card 4111111111111111','service role secret abc']){const r=searchMatMoveHelp(q,rider);assert.equal(r.kind,'privacy');assert.ok(!JSON.stringify(r).includes(q));}
 assert.match(searchMatMoveHelp('games win prize',rider).articles.find(a=>a.id==='games').answer,/No game guarantees a win/);assert.equal(searchMatMoveHelp('anything',{role:'super_admin',isActive:true,isOwner:true}).kind,'fallback');assert.equal(helpTopics(null).length,0);
});
