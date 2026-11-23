import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createApp} from '../backend/app.js';
import {Repository,hash} from '../backend/database.js';
import {vault} from '../backend/security.js';
import {OAuthStateStore,OAUTH_STATE_TTL_MS} from '../backend/oauth-state-store.js';
import {GOOGLE_SCOPES} from '../backend/google-oauth.js';

const origin='https://app.pjhigienizacao.com.br',host=new URL(origin).host;
const callback=origin+'/api/google/callback',adsCallback=origin+'/api/integrations/google-ads/callback';
const encryptionKey=Buffer.alloc(32,7).toString('base64'); // disposable fixture only
if(process.argv[2]==='--other-process'){
  const repo=new Repository(process.argv[3]),store=new OAuthStateStore(repo,vault(repo.dir,encryptionKey,true));
  const attempt=store.claim({state:process.argv[4],session:{id:'fixture-session'},allowed:['google-calendar'],redirectURI:callback,clientId:'fixture-client'});
  store.complete(attempt,()=>repo.setConfig('child-completed',true));repo.close();process.exit(0);
}

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pj-oauth-state-'));
let system,server,port,cookie,csrf,mode='ok',exchanges=0;
const scopes=['openid','email',GOOGLE_SCOPES.calendar,GOOGLE_SCOPES.drive,GOOGLE_SCOPES.contacts].join(' ');
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
const fetcher=async(url,options)=>{
  if(String(url).startsWith('https://oauth2.googleapis.com/token')){
    exchanges++;const p=new URLSearchParams(options.body);
    assert.ok(p.get('code_verifier'),'PKCE required');
    assert.equal(p.get('redirect_uri'),p.get('client_id')==='ads-client'?adsCallback:callback);
    if(mode==='failure')return json({error:'invalid_grant'},400);
    if(mode==='slow')await new Promise(r=>setTimeout(r,50));
    return json({access_token:'fixture-access-'+exchanges,refresh_token:'fixture-refresh',expires_in:3600,scope:p.get('client_id')==='ads-client'?GOOGLE_SCOPES.ads:scopes});
  }
  if(String(url).startsWith('https://openidconnect.googleapis.com/'))return json({sub:'fixture-user',email:'test@example.invalid',email_verified:true});
  throw Error('Unexpected external request');
};
const options={origin,production:true,dataDir:dir,encryptionKey,fetcher,integrationFetcher:fetcher,
  // Reproduces the production configuration error. createApp must correct routing before consent.
  googleConfig:{clientId:'fixture-client',clientSecret:'fixture-secret',redirectURI:adsCallback},
  integrationConfig:{googleAds:{clientId:'ads-client',clientSecret:'fixture-secret',redirectURI:adsCallback}}};
async function start(){system=createApp(options);server=system.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));port=server.address().port;}
async function stop(){await new Promise(r=>server.close(r));system.repo.close();server=null;}
function request(url,body,extra={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path:url,method:body?'POST':'GET',headers:{Host:host,Origin:origin,'X-Forwarded-Proto':'https','Content-Type':'application/json',Cookie:cookie||'','X-CSRF-Token':csrf||'',...extra}},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,headers:res.headers,text,json:()=>JSON.parse(text)})});
    });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
  });
}
async function connect(purpose='calendar'){
  const r=await request(purpose==='google-ads'?'/api/integrations/google-ads/connect':'/api/google/connect',{purpose});
  assert.equal(r.status,200,r.text);const url=new URL(r.json().url);
  assert.equal(url.searchParams.get('redirect_uri'),purpose==='google-ads'?adsCallback:callback);
  return url.searchParams.get('state');
}
const route=(state,ads=false)=>(ads?'/api/integrations/google-ads/callback':'/api/google/callback')+'?state='+state+'&code=fixture-code';
const row=state=>system.repo.db.prepare('SELECT * FROM oauth_authorizations WHERE state_hash=?').get(hash(state));
async function success(state,ads=false){const r=await request(route(state,ads));assert.equal(r.status,302);assert.ok(r.headers.location.includes('connected'));assert.ok(r.headers.location.includes('settings=integrations#configuracoes'));assert.equal(row(state).status,'consumed');assert.ok(row(state).consumed_at);assert.equal(row(state).verifier,'');}
try{
  await start();
  const setup=await request('/api/setup',{password:'oauth-fixture-password-123'});
  assert.equal(setup.status,200);cookie=setup.headers['set-cookie'][0].split(';')[0];csrf=setup.json().csrf;
  const setCookie=setup.headers['set-cookie'][0];
  for(const flag of ['__Host-pj=','HttpOnly','Secure','SameSite=Lax','Path=/'])assert.ok(setCookie.includes(flag));assert.ok(!/Domain=/i.test(setCookie));
  // PJ is seeded but onboarding still requires explicit completion.
  if((await request('/api/session')).json().needsCompanySetup){const {settings}=await import('./test-company.mjs');assert.equal((await request('/api/onboarding',settings)).status,200);}
  const s1=await connect(),s2=await connect('drive');assert.notEqual(s1,s2);
  assert.equal(row(s1).expires-row(s1).created_at,OAUTH_STATE_TTL_MS);
  assert.notEqual(row(s1).verifier,new URL((await request('/api/google/connect',{})).json().url).searchParams.get('code_challenge'));
  const before=exchanges;
  // Exact original incident: Calendar/Drive state arrives at Ads callback. Must never be accepted there.
  assert.equal((await request(route(s1,true))).status,403);assert.equal(exchanges,before);assert.equal(row(s1).status,'pending');
  assert.equal((await request(route(s1),undefined,{Cookie:''})).status,401);
  await success(s1);await success(s2);
  await success(await connect('contacts'));
  let status=(await request('/api/google/status')).json();assert.equal(status.connected,true);for(const key of ['calendar','drive','contacts'])assert.equal(status.scopes[key],true);
  const replayBefore=exchanges;const replay=await request(route(s1));assert.ok(replay.headers.location.includes('google=error'));assert.equal(exchanges,replayBefore);
  // A different authenticated session cannot consume the first user's authorization.
  const wrongSession=await connect();
  assert.throws(()=>system.google.oauth.claim({state:wrongSession,session:{id:'other'},allowed:['google-calendar'],redirectURI:callback,clientId:'fixture-client'}),e=>e.code==='OAUTH_STATE_INVALID');
  assert.equal(row(wrongSession).status,'pending');await success(wrongSession);
  const expired=await connect();system.repo.db.prepare('UPDATE oauth_authorizations SET expires=? WHERE state_hash=?').run(Date.now(),hash(expired));
  assert.ok((await request(route(expired))).headers.location.includes('google=error'));assert.equal(row(expired).status,'pending');
  const a1=await connect('google-ads'),a2=await connect('google-ads');assert.notEqual(a1,a2);assert.equal(row(a1).status,'pending');
  await success(a1,true);assert.equal(row(a2).status,'pending');await success(a2,true);
  assert.equal(system.integrations.status('google-ads').authorized,true);
  // Ads requires explicit choice of an accessible account; preserve that product/security rule.
  system.repo.db.prepare('INSERT INTO integration_accounts VALUES (?,?,?,?,?)').run('google-ads',system.integrations.state('google-ads').connectionId,'123','',JSON.stringify({id:'123',name:'Fixture account',currency:'BRL',timezone:'America/Sao_Paulo',managerId:null}));
  await system.integrations.selectAccount('google-ads',{connectionId:system.integrations.state('google-ads').connectionId,accountId:'123'});
  assert.equal(system.integrations.status('google-ads').status,'connected');
  const pendingRestart=await connect();
  await stop();await start();await success(pendingRestart);
  assert.equal((await request('/api/google/status')).json().connected,true);
  assert.equal(system.integrations.status('google-ads').status,'connected');assert.equal(system.integrations.secret('google-ads').refreshToken,'fixture-refresh');
  // A genuine second Node process reads pending state from the same persistent database.
  const cross=system.google.oauth.create({integration:'google-calendar',session:{id:'fixture-session'},redirectURI:callback,clientId:'fixture-client'});
  const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--other-process',dir,cross.state],{encoding:'utf8',windowsHide:true});
  assert.equal(child.status,0,child.stderr);assert.equal(row(cross.state).status,'consumed');assert.equal(system.repo.config('child-completed'),true);
  // Concurrent duplicate callbacks: exactly one token exchange, even with another Repository connection.
  const race=await connect(),otherRepo=new Repository(dir),otherStore=new OAuthStateStore(otherRepo,vault(dir,encryptionKey,true));
  mode='slow';const raceBefore=exchanges,first=system.google.callback({state:race,code:'fixture-code'},system.repo.db.prepare('SELECT * FROM sessions LIMIT 1').get(),callback);
  assert.throws(()=>otherStore.claim({state:race,session:system.repo.db.prepare('SELECT * FROM sessions LIMIT 1').get(),allowed:['google-calendar'],redirectURI:callback,clientId:'fixture-client'}),e=>e.code==='OAUTH_STATE_INVALID');
  await first;otherRepo.close();mode='ok';assert.equal(exchanges,raceBefore+1);
  // Exchange failure preserves prior tokens and records a terminal failure, never a consumed success.
  const failed=await connect(),previous=system.google.connection();mode='failure';
  assert.ok((await request(route(failed))).headers.location.includes('google=error'));mode='ok';
  assert.equal(row(failed).status,'failed');assert.equal(row(failed).consumed_at,null);assert.deepEqual(system.google.connection(),previous);
  // Atomic persistence: token write + state consumption roll back together.
  const atomic=system.google.oauth.create({integration:'google-calendar',session:{id:'fixture-session'},redirectURI:callback,clientId:'fixture-client'});
  const attempt=system.google.oauth.claim({state:atomic.state,session:{id:'fixture-session'},allowed:['google-calendar'],redirectURI:callback,clientId:'fixture-client'});
  assert.throws(()=>system.google.oauth.complete(attempt,()=>{system.repo.setConfig('should-rollback',true);throw Error('fixture disk failure')}));
  assert.equal(system.repo.config('should-rollback'),null);assert.equal(row(atomic.state).status,'processing');system.google.oauth.fail(attempt);
  // Diagnostic output is strictly allowlisted, without secrets/state/code/session IDs.
  const logs=[],store=new OAuthStateStore(system.repo,vault(dir,encryptionKey,true),{diagnostics:true,logger:r=>logs.push(r)});
  const logged=store.create({integration:'google-drive',session:{id:'fixture-session'},redirectURI:callback,clientId:'fixture-client'});
  store.claim({state:logged.state,session:{id:'fixture-session'},allowed:['google-drive'],redirectURI:callback,clientId:'fixture-client',callbackURI:callback});
  const keys=['integration','stateCreated','stateFound','stateExpired','stateMatched','callbackHost','timestamp'].sort();
  for(const entry of logs)assert.deepEqual(Object.keys(entry).sort(),keys);
  assert.equal(logs[1].stateMatched,true);assert.equal(logs[1].callbackHost,host);assert.ok(!JSON.stringify(logs).includes(logged.state));
  await stop();await start();assert.equal((await request('/api/google/status')).json().connected,true);assert.equal(system.integrations.status('google-ads').status,'connected');
  console.log('PASS: PJ OAuth canonical callback, Calendar, Drive, Contacts, Ads, durable state/restart/second process, consecutive attempts, race, TTL, session/CSRF, replay, atomic tokens, failure, cookies and safe logs (Google responses simulated).');
}finally{if(server)await stop();assert.ok(dir.startsWith(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});}
