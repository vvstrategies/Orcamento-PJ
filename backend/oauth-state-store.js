import crypto from 'node:crypto';
import {fail,hash} from './database.js';

export const OAUTH_STATE_TTL_MS=20*60*1000;
const integrations=new Set(['google-calendar','google-drive','google-contacts','google-ads','meta-ads']);
const invalid=()=>Object.assign(fail(403,'Confirmação expirada ou inválida. Inicie novamente.'),{code:'OAUTH_STATE_INVALID'});

// SQLite is the source of truth. Every process must use the same persistent DATA_DIR.
export class OAuthStateStore {
  constructor(repo,vault,{diagnostics=false,logger=entry=>console.info(JSON.stringify(entry)),clock=Date.now}={}){
    Object.assign(this,{repo,vault,diagnostics,logger,clock});
    repo.db.exec(`CREATE TABLE IF NOT EXISTS oauth_authorizations (
      state_hash TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_id TEXT NOT NULL,
      integration TEXT NOT NULL, redirect_uri TEXT NOT NULL, client_id TEXT NOT NULL,
      verifier TEXT NOT NULL, created_at INTEGER NOT NULL, expires INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','processing','consumed','failed')),
      claim_id TEXT, consumed_at INTEGER);
      CREATE INDEX IF NOT EXISTS oauth_authorizations_pending ON oauth_authorizations(integration,status,expires);`);
  }
  user(){return this.repo.config('workspaceId')+':admin';}
  log(integration,fields,redirectURI){
    if(!this.diagnostics)return;
    let callbackHost='';try{callbackHost=new URL(redirectURI).host}catch{}
    // Explicit allowlist: never log request/query/error objects or any OAuth credential.
    try{this.logger({integration:integrations.has(integration)?integration:'google',stateCreated:fields.stateCreated===true,stateFound:fields.stateFound===true,stateExpired:fields.stateExpired===true,stateMatched:fields.stateMatched===true,callbackHost,timestamp:new Date(this.clock()).toISOString()})}catch{}
  }
  create({integration,session,redirectURI,clientId}){
    if(!session?.id||!integrations.has(integration))throw invalid();
    const state=crypto.randomBytes(32).toString('base64url'),verifier=crypto.randomBytes(48).toString('base64url'),now=this.clock();
    this.repo.transaction(()=>{
      this.repo.db.prepare('DELETE FROM oauth_authorizations WHERE expires<?').run(now-86400000);
      this.repo.db.prepare(`INSERT INTO oauth_authorizations
        (state_hash,session_id,user_id,integration,redirect_uri,client_id,verifier,created_at,expires,status)
        VALUES (?,?,?,?,?,?,?,?,?,'pending')`).run(hash(state),session.id,this.user(),integration,redirectURI||'',clientId||'',this.vault.seal(verifier),now,now+OAUTH_STATE_TTL_MS);
    });
    this.log(integration,{stateCreated:true},redirectURI);
    return {state,verifier};
  }
  claim({state,session,allowed,redirectURI,clientId,callbackURI}){
    const valid=typeof state==='string'&&/^[A-Za-z0-9_-]{43}$/.test(state);
    return this.repo.transaction(()=>{
      const row=valid?this.repo.db.prepare('SELECT * FROM oauth_authorizations WHERE state_hash=?').get(hash(state)):null;
      const expired=!!row&&row.expires<=this.clock();
      const matched=!!row&&!!session?.id&&row.session_id===session.id&&row.user_id===this.user()&&allowed.includes(row.integration)&&row.redirect_uri===(redirectURI||'')&&row.client_id===(clientId||'')&&(!callbackURI||row.redirect_uri===callbackURI);
      this.log(row&&allowed.includes(row.integration)?row.integration:allowed[0],{stateFound:!!row,stateExpired:expired,stateMatched:matched},callbackURI||redirectURI);
      if(!matched||expired||row.status!=='pending')throw invalid();
      const claimId=crypto.randomBytes(32).toString('hex');
      const result=this.repo.db.prepare("UPDATE oauth_authorizations SET status='processing',claim_id=? WHERE state_hash=? AND status='pending'").run(claimId,row.state_hash);
      if(result.changes!==1)throw invalid();
      return {...row,claim_id:claimId,verifier:this.vault.open(row.verifier)};
    });
  }
  complete(attempt,persistTokens){
    return this.repo.transaction(()=>{
      const row=this.repo.db.prepare("SELECT state_hash FROM oauth_authorizations WHERE state_hash=? AND claim_id=? AND status='processing'").get(attempt.state_hash,attempt.claim_id);
      if(!row)throw invalid();
      persistTokens();
      this.repo.db.prepare("UPDATE oauth_authorizations SET status='consumed',consumed_at=?,verifier='',claim_id=NULL WHERE state_hash=?").run(this.clock(),attempt.state_hash);
    });
  }
  fail(attempt){this.repo.db.prepare("UPDATE oauth_authorizations SET status='failed',verifier='',claim_id=NULL WHERE state_hash=? AND claim_id=? AND status='processing'").run(attempt.state_hash,attempt.claim_id);}
  pending(integration){return this.repo.db.prepare("SELECT expires FROM oauth_authorizations WHERE integration=? AND status='pending' AND expires>? ORDER BY expires DESC LIMIT 1").get(integration,this.clock());}
  cancel(allowed){for(const id of allowed)this.repo.db.prepare("UPDATE oauth_authorizations SET status='failed',verifier='',claim_id=NULL WHERE integration=? AND status IN ('pending','processing')").run(id);}
}
