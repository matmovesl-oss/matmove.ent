import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
test('trip timeline records real future transitions, protects times and leaves legacy history unknown',async()=>{
 const pg=new PGlite({postgresqlconf:['shared_buffers=16MB','max_connections=10','work_mem=1MB']});try{
 await pg.exec("create role anon;create role authenticated;create role service_role;create table public.bookings(id integer primary key,status text);insert into bookings values(1,'completed'),(2,'pending_admin');");const sql=await readFile('docs/TRIP_TIMELINE_SETUP.sql','utf8');await pg.exec(sql);const row=async id=>(await pg.query('select * from bookings where id=$1',[id])).rows[0];assert.equal((await row(1)).completed_at,null);
 await pg.exec("update bookings set status='accepted',accepted_at='2099-01-01' where id=2");let r=await row(2);assert.ok(r.accepted_at);assert.ok(new Date(r.accepted_at).getUTCFullYear()<2099);const accepted=r.accepted_at;
 await pg.exec("update bookings set status='in_progress',accepted_at=null,started_at='2099-01-01' where id=2");r=await row(2);assert.deepEqual(r.accepted_at,accepted);assert.ok(r.started_at);const started=r.started_at;
 await pg.exec("update bookings set status='completed',started_at=null where id=2");r=await row(2);assert.deepEqual(r.started_at,started);assert.ok(r.completed_at);const complete=r.completed_at;await pg.exec(sql);await pg.exec("update bookings set accepted_at=null,started_at=null,completed_at=null where id=2");r=await row(2);assert.deepEqual([r.accepted_at,r.started_at,r.completed_at],[accepted,started,complete]);assert.equal((await row(1)).accepted_at,null);
 await pg.exec("insert into bookings(id,status,accepted_at) values(3,'pending','2099-01-01')");assert.equal((await row(3)).accepted_at,null);
 await pg.exec('set role authenticated');await assert.rejects(()=>pg.exec("update bookings set status='accepted' where id=3"),/permission denied/);
 }finally{await pg.close();}
});
