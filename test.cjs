const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const server=spawn(process.execPath,['server.cjs'],{cwd:__dirname,env:{...process.env,PORT:'4176'},stdio:'pipe',windowsHide:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function api(action,data={}){const response=await fetch('http://localhost:4176/api/classroom',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...data})});return {code:response.status,...await response.json()};}
(async()=>{try{
 for(let i=0;i<40;i++){try{await fetch('http://localhost:4176/');break;}catch{await delay(100);}}
 const room=await api('create');assert.equal(room.code,200);assert.match(room.qr,/^data:image\/png;base64,/);
 const host={room:room.room,teacherToken:room.teacherToken};
 assert.equal((await api('join',{room:room.room})).code,400);
 assert.equal((await api('join',{room:room.room,name:'<script>'})).code,400);
 const student=await api('join',{room:room.room,name:'Анна'});assert.equal(student.number,1);assert.equal(student.name,'Анна');
 const player={room:room.room,playerToken:student.playerToken};
 const forbidden=await api('start',{...player,quiz:0});assert.equal(forbidden.code,403);
 assert.equal((await api('start',{...host,quiz:0})).code,200);
 let state=await api('status',player);assert.equal(state.phase,'open');assert.equal(state.question.correct,undefined);assert.equal(state.counts,undefined);const firstRound=state.round;
 assert.equal((await api('vote',{...player,round:firstRound,choice:1})).code,200);
 assert.equal((await api('vote',{...player,round:firstRound,choice:2})).code,409);
 assert.equal((await api('status',player)).own,1);
 assert.deepEqual((await api('status',host)).counts,[0,1,0,0]);
 assert.equal((await api('reveal',{...host,quiz:0})).code,200);
 state=await api('status',player);assert.equal(state.question.correct,1);
 assert.equal((await api('vote',{...player,round:firstRound,choice:0})).code,409);
 assert.equal((await api('start',{...host,quiz:0})).code,200);
 state=await api('status',player);assert.notEqual(state.round,firstRound);assert.equal(state.own,null);
 assert.equal((await api('vote',{...player,round:firstRound,choice:1})).code,409);
 const votes=await Promise.all([api('vote',{...player,round:state.round,choice:0}),api('vote',{...player,round:state.round,choice:3})]);assert.equal(votes.filter(x=>x.code===200).length,1);
 const presence=await api('status',host);assert.equal(presence.roster,undefined);assert.equal(presence.leaderboard,undefined);assert.equal((await api('status',player)).roster,undefined);
 for(let quiz=6;quiz<12;quiz++){assert.equal((await api('start',{...host,quiz})).code,200);const card=await api('status',player);assert.equal(card.question.kind,'card');assert.equal(card.question.options.length,4);assert.equal(card.question.correct,undefined);assert.equal((await api('vote',{...player,round:card.round,choice:0})).code,200);assert.equal((await api('reveal',{...host,quiz})).code,200);assert.equal(typeof (await api('status',player)).question.correct,'number');}
 const joins=await Promise.all(Array.from({length:20},(_,i)=>api('join',{room:room.room,name:'Участник '+i})));assert.equal(joins.filter(x=>x.code===200).length,18);assert.equal(joins.filter(x=>x.code===409).length,2);
 // Проверяем серверный дедлайн без ожидания минуты.
 const storePath=require('node:path').join(__dirname,'.local-rooms.json');const db=JSON.parse(fs.readFileSync(storePath));db[room.room].deadline=Date.now()-10;fs.writeFileSync(storePath,JSON.stringify(db));
 assert.equal((await api('start',{...host,quiz:0})).code,200);const current=await api('status',player);const db2=JSON.parse(fs.readFileSync(storePath));db2[room.room].deadline=Date.now()-10;Object.values(db2[room.room].players).forEach(p=>p.lastSeen=Date.now()-20000);fs.writeFileSync(storePath,JSON.stringify(db2));
 assert.equal((await api('status',host)).phase,'closed');assert.equal((await api('status',host)).roster,undefined);
 assert.equal((await api('vote',{room:room.room,playerToken:joins.find(x=>x.code===200).playerToken,round:state.round,choice:1})).code,409);
 assert.equal((await api('end',host)).code,200);assert.equal((await api('join',{room:room.room,name:'Анна'})).code,410);
 const results=await api('status',host);assert.equal(results.leaderboard.length,19);assert.deepEqual(results.leaderboard,(await api('status',player)).leaderboard);
 console.log(JSON.stringify({passed:true,checks:['required name','name validation','no live roster','final leaderboard','six warmup cards','QR generation','teacher access','hidden correct answer','one vote','aggregate counts','reveal','new round','stale vote rejection','concurrent votes','19 seats','deadline','end session']}));
 }finally{server.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
