const crypto=require('node:crypto');
const QRCode=require('qrcode');
const quizzes=require('../quizzes.json');
const TTL=21600;
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const token=()=>crypto.randomBytes(24).toString('hex');
class AppError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const fail=(message,status)=>{throw new AppError(message,status);};
// Redis в продакшене: атомарные записи, общий state между инстансами, TTL.
async function redis(command){const url=process.env.UPSTASH_REDIS_REST_URL||process.env.KV_REST_API_URL;const secret=process.env.UPSTASH_REDIS_REST_TOKEN||process.env.KV_REST_API_TOKEN;if(!url||!secret)fail('Для онлайн-комнат подключите Redis в настройках проекта Vercel.',503);const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(8000)});if(!r.ok)fail('Хранилище ответов временно недоступно.',503);const x=await r.json();if(x.error)throw Error('Redis command failed');return x.result;}
const local=()=>!process.env.VERCEL&&process.env.CLASSROOM_LOCAL==='1';
const fs=require('node:fs');const path=require('node:path');
const localPath=path.join(__dirname,'..','.local-rooms.json');
function localDB(){try{return JSON.parse(fs.readFileSync(localPath,'utf8'));}catch{return {};}}
// Локальная очередь предотвращает гонки read/modify/write; production использует Lua.
let queue=Promise.resolve();
function transaction(fn){const next=queue.then(async()=>{const db=localDB();for(const k of Object.keys(db))if(db[k].expires<Date.now())delete db[k];const result=await fn(db);fs.writeFileSync(localPath,JSON.stringify(db));return result;});queue=next.catch(()=>{});return next;}
const roomKey=r=>'guild:'+r;
async function createRoom(room,state){if(local())return transaction(db=>{if(db[room])return false;db[room]={...state,expires:Date.now()+TTL*1000,players:{},answers:{}};return true;});return Boolean(await redis(['SET',roomKey(room),JSON.stringify(state),'EX',TTL,'NX']));}
async function getRoom(room){if(local())return transaction(db=>{const r=db[room];return r?{...r,players:undefined,answers:undefined}:null;});const r=await redis(['GET',roomKey(room)]);return r?JSON.parse(r):null;}
async function updateRoom(room,change){if(local())return transaction(db=>{if(!db[room])fail('Комната не найдена.',404);Object.assign(db[room],change);});return redis(['EVAL',`local raw=redis.call('GET',KEYS[1]);if not raw then return 0 end;local s=cjson.decode(raw);local c=cjson.decode(ARGV[1]);for k,v in pairs(c) do s[k]=v end;redis.call('SET',KEYS[1],cjson.encode(s),'KEEPTTL');return 1`,1,roomKey(room),JSON.stringify(change)]);}
async function joinRoom(room,playerToken,name){if(local())return transaction(db=>{const r=db[room];if(!r)fail('Комната не найдена.',404);if(r.phase==='ended')fail('Сессия завершена.',410);const count=Object.keys(r.players).length;if(count>=19)fail('Все 19 мест уже заняты.',409);r.players[digest(playerToken)]={number:count+1,name,lastSeen:Date.now()};return count+1;});const result=await redis(['EVAL',`local raw=redis.call('GET',KEYS[1]);if not raw then return -2 end;local s=cjson.decode(raw);if s.phase=='ended' then return -3 end;local n=redis.call('HLEN',KEYS[2]);if n>=19 then return -1 end;redis.call('HSET',KEYS[2],ARGV[1],cjson.encode({number=n+1,name=ARGV[3],lastSeen=tonumber(ARGV[4])}));redis.call('EXPIRE',KEYS[2],ARGV[2]);return n+1`,2,roomKey(room),roomKey(room)+':players',digest(playerToken),TTL,name,Date.now()]);if(result===-1)fail('Все 19 мест уже заняты.',409);if(result<0)fail('Сессия недоступна.',410);return result;}
async function playerNumber(room,playerToken){if(local())return transaction(db=>db[room]?.players[digest(playerToken)]?.number);const raw=await redis(['HGET',roomKey(room)+':players',digest(playerToken)]);return raw?JSON.parse(raw).number:null;}
async function touch(room,playerToken){const hash=digest(playerToken);if(local())return transaction(db=>{const p=db[room]?.players[hash];if(p)p.lastSeen=Date.now();});return redis(['EVAL',`local p=redis.call('HGET',KEYS[1],ARGV[1]);if not p then return 0 end;local v=cjson.decode(p);v.lastSeen=tonumber(ARGV[2]);redis.call('HSET',KEYS[1],ARGV[1],cjson.encode(v));return 1`,1,roomKey(room)+':players',hash,Date.now()]);}
async function roster(room,round){let people,answers;if(local()){({people,answers}=await transaction(db=>({people:db[room]?.players||{},answers:db[room]?.answers[round]||{}})));}else{const [p,a]=await Promise.all([redis(['HGETALL',roomKey(room)+':players']),redis(['HGETALL',roomKey(room)+':answers:'+round])]);people={};answers={};for(let i=0;i<p.length;i+=2)people[p[i]]=JSON.parse(p[i+1]);for(let i=0;i<a.length;i+=2)answers[a[i]]=Number(a[i+1]);}return Object.entries(people).map(([hash,p])=>({number:p.number,name:p.name,online:Date.now()-p.lastSeen<15000,answer:answers[hash]===undefined?null:answers[hash]})).sort((a,b)=>a.number-b.number);}
async function vote(room,playerToken,choice,round){if(local())return transaction(db=>{const r=db[room];if(!r||r.phase!=='open'||Date.now()>=r.deadline||r.round!==round)fail('Голосование закрыто или начался новый раунд.',409);const p=digest(playerToken);if(!r.players[p])fail('Войдите в комнату.',403);const a=r.answers[round]||(r.answers[round]={});if(a[p]!==undefined)fail('Ваш ответ уже принят.',409);a[p]=choice;return true;});const result=await redis(['EVAL',`local raw=redis.call('GET',KEYS[1]);if not raw then return -1 end;local s=cjson.decode(raw);local t=redis.call('TIME');local now=tonumber(t[1])*1000+tonumber(t[2])/1000;if s.phase~='open' or now>=s.deadline or s.round~=ARGV[3] then return -1 end;if redis.call('HEXISTS',KEYS[2],ARGV[1])==0 then return -2 end;local ok=redis.call('HSETNX',KEYS[3],ARGV[1],ARGV[2]);redis.call('EXPIRE',KEYS[3],ARGV[4]);return ok`,3,roomKey(room),roomKey(room)+':players',roomKey(room)+':answers:'+round,digest(playerToken),choice,round,TTL]);if(result===-2)fail('Войдите в комнату.',403);if(result===-1)fail('Голосование закрыто или начался новый раунд.',409);if(result===0)fail('Ваш ответ уже принят.',409);return true;}
async function readVotes(room,round,playerToken){if(local())return transaction(db=>{const r=db[room];return {players:Object.keys(r?.players||{}).length,answers:r?.answers[round]||{},own:r?.answers[round]?.[digest(playerToken||'')]};});const [players,raw,own]=await Promise.all([redis(['HLEN',roomKey(room)+':players']),redis(['HVALS',roomKey(room)+':answers:'+round]),playerToken?redis(['HGET',roomKey(room)+':answers:'+round,digest(playerToken)]):Promise.resolve(null)]);return {players,answers:raw||[],own:own===null?undefined:Number(own)};}
function publicQuiz(q,revealed){return q?{question:q.question,code:q.code,options:q.options,kind:q.kind||'quiz',number:q.number,...(revealed?{correct:q.correct,why:q.why}:{})}:null;}
async function handler(req,res){res.setHeader('Cache-Control','no-store');try{
 if(req.method!=='POST')fail('Используйте POST.',405);
 if(req.headers.origin){const origin=new URL(req.headers.origin);if(origin.host!==req.headers.host)fail('Запрос с другого сайта запрещён.',403);}
 const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
 const {action}=body;
 if(action==='create'){
  // Создание комнаты само по себе не публикует никакие данные преподавателя.
  const teacherToken=token();let room,state;let created=false;for(let i=0;i<5&&!created;i++){room=String(crypto.randomInt(100000,1000000));state={teacherHash:digest(teacherToken),quiz:-1,phase:'lobby',deadline:0,round:token().slice(0,12)};created=await createRoom(room,state);}if(!created)fail('Не удалось создать комнату. Повторите.',503);
  const proto=process.env.VERCEL?'https':req.socket?.encrypted?'https':'http';const origin=proto+'://'+req.headers.host;const joinUrl=origin+'/join.html?room='+room;return res.status(200).json({room,teacherToken,joinUrl,qr:await QRCode.toDataURL(joinUrl,{width:360,margin:3,errorCorrectionLevel:'M'})});
 }
 const room=String(body.room||'');if(!/^\d{6}$/.test(room))fail('Нужен шестизначный код комнаты.');
 const state=await getRoom(room);if(!state)fail('Комната не найдена или срок сессии истёк.',404);
 const isTeacher=typeof body.teacherToken==='string'&&digest(body.teacherToken)===state.teacherHash;
 if(['start','reveal','end'].includes(action)){
  if(!isTeacher)fail('Нужен доступ преподавателя.',403);
  if(state.phase==='ended')fail('Сессия завершена.',410);
  if(action==='end'){await updateRoom(room,{phase:'ended'});return res.status(200).json({ok:true});}
  const quiz=body.quiz;if(!Number.isInteger(quiz)||!quizzes[quiz])fail('Неизвестный квиз.');
  if(action==='start')await updateRoom(room,{quiz,phase:'open',deadline:Date.now()+25000,round:token().slice(0,12)});
  else {if(quiz!==state.quiz)fail('Сначала запустите этот квиз.',409);await updateRoom(room,{phase:'revealed'});}
  return res.status(200).json({ok:true});
 }
 if(action==='join'){const name=typeof body.name==='string'?body.name.trim().replace(/\s+/g,' '):'';if(name.length<2||name.length>40||/[\x00-\x1f<>]/.test(name))fail('Введите имя от 2 до 40 символов.');if(state.phase==='ended')fail('Сессия завершена.',410);const playerToken=token(),number=await joinRoom(room,playerToken,name);return res.status(200).json({playerToken,number,room,name});}
 if(!isTeacher&&(!body.playerToken||!await playerNumber(room,body.playerToken)))fail('Войдите в комнату.',403);
 if(action==='vote'){if(!Number.isInteger(body.choice)||body.choice<0||body.choice>3)fail('Выберите A, B, C или D.');if(typeof body.round!=='string')fail('Обновите текущий вопрос.');await vote(room,body.playerToken,body.choice,body.round);return res.status(200).json({ok:true});}
 if(action!=='status')fail('Неизвестное действие.');
 if(!isTeacher)await touch(room,body.playerToken);
 const votes=await readVotes(room,state.round,body.playerToken);const counts=[0,0,0,0];for(const v of Object.values(votes.answers))counts[Number(v)]++;
 const phase=state.phase==='open'&&Date.now()>=state.deadline?'closed':state.phase;
 return res.status(200).json({phase,quiz:state.quiz,round:state.round,deadline:state.deadline,serverNow:Date.now(),players:votes.players,...(isTeacher||phase==='revealed'?{counts}:{count:counts.reduce((a,b)=>a+b,0)}),roster:isTeacher?await roster(room,state.round):undefined,question:publicQuiz(quizzes[state.quiz],phase==='revealed'),own:votes.own===undefined?null:votes.own});
 }catch(error){res.status(error.status||500).json({error:error.status?error.message:'Временная ошибка сервера. Повторите запрос.'});}}
module.exports=handler;
