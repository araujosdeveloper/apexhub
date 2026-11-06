// Perfil JWT deliberadamente restrito a HS256, sem seleção de algoritmos pelo cliente.
// Criptografia: HMAC SHA-256 e comparação constante do node:crypto (RFC 7515/8725).
const {createHmac,timingSafeEqual,randomBytes}=require('node:crypto');
const TTL=900,ISSUER='apexhub',roles={owner:'tenant_owner',manager:'tenant_manager',operator:'tenant_operator'};
class InvalidToken extends Error {constructor(){super('Token de acesso inválido ou expirado.');this.status=401;}}
function positiveId(value){return Number.isSafeInteger(value)&&value>0;}
function configuration(env=process.env,{required=false}={}){
 const tenant=env.JWT_TENANT_SECRET,master=env.JWT_MASTER_SECRET;
 if(!tenant&&!master&&!required)return null;
 if(!/^[a-f0-9]{64}$/.test(tenant||'')||!/^[a-f0-9]{64}$/.test(master||'')||tenant===master)throw new Error('Configure chaves JWT independentes de 256 bits para tenant e Master.');
 return Object.freeze({tenant:Buffer.from(tenant,'hex'),master:Buffer.from(master,'hex')});
}
function audience(scope){if(!['tenant','master'].includes(scope))throw new InvalidToken();return 'apexhub:'+scope;}
function signingKey(config,scope){if(!config)throw new InvalidToken();audience(scope);return config[scope];}
function issue(config,{scope,id,role,tenantId=null,sid,actorId=null},now=Math.floor(Date.now()/1000)){
 if(!positiveId(id)||!Number.isSafeInteger(now)||!/^[a-f0-9]{64}$/.test(sid||'')||
  (scope==='tenant'?(!positiveId(tenantId)||!Object.values(roles).includes(role)):(scope!=='master'||role!=='super_admin'||tenantId!==null)))throw new InvalidToken();
 const assisted=actorId!==null;if(assisted&&(scope!=='tenant'||role!=='tenant_owner'||!positiveId(actorId)))throw new InvalidToken();
 const header={alg:'HS256',typ:assisted?'apexhub-impersonation+jwt':'at+jwt'},payload={iss:ISSUER,aud:audience(scope),sub:scope+':'+id,role,tenant_id:tenantId,sid,jti:randomBytes(16).toString('hex'),iat:now,nbf:now,exp:now+(assisted?3600:TTL)};
 if(assisted){payload.aud='apexhub:impersonation';payload.act={sub:'master:'+actorId};payload.purpose='impersonation';}
 const unsigned=[header,payload].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
 return unsigned+'.'+createHmac('sha256',signingKey(config,scope)).update(unsigned).digest('base64url');
}
function decode(segment){if(!segment||!/^[A-Za-z0-9_-]+$/.test(segment))throw new InvalidToken();const bytes=Buffer.from(segment,'base64url');if(bytes.toString('base64url')!==segment)throw new InvalidToken();const obj=JSON.parse(bytes.toString('utf8'));if(!obj||Array.isArray(obj)||typeof obj!=='object')throw new InvalidToken();return obj;}
function verify(config,token,scope,now=Math.floor(Date.now()/1000),assisted=false){
 try{
  if(typeof token!=='string'||token.length>4096)throw new InvalidToken();const parts=token.split('.');if(parts.length!==3)throw new InvalidToken();
  const header=decode(parts[0]);if(header.alg!=='HS256'||header.typ!==(assisted?'apexhub-impersonation+jwt':'at+jwt')||Object.keys(header).length!==2||!/^[A-Za-z0-9_-]{43}$/.test(parts[2]))throw new InvalidToken();
  const signature=Buffer.from(parts[2],'base64url'),expected=createHmac('sha256',signingKey(config,scope)).update(parts[0]+'.'+parts[1]).digest();
  if(signature.toString('base64url')!==parts[2]||signature.length!==expected.length||!timingSafeEqual(signature,expected))throw new InvalidToken();
  const p=decode(parts[1]);
  if(p.iss!==ISSUER||p.aud!==(assisted?'apexhub:impersonation':audience(scope))||typeof p.sub!=='string'||!new RegExp('^'+scope+':[1-9][0-9]*$').test(p.sub)||!positiveId(Number(p.sub.split(':')[1]))||
   typeof p.sid!=='string'||!/^[a-f0-9]{64}$/.test(p.sid)||typeof p.jti!=='string'||!/^[a-f0-9]{32}$/.test(p.jti)||
   ![p.iat,p.nbf,p.exp].every(Number.isSafeInteger)||p.iat<0||p.nbf!==p.iat||p.exp-p.iat!==(assisted?3600:TTL)||p.iat>now+5||p.nbf>now+5||p.exp<=now||
   (scope==='tenant'?(!positiveId(p.tenant_id)||!Object.values(roles).includes(p.role)):(p.role!=='super_admin'||p.tenant_id!==null)))throw new InvalidToken();
  if(assisted){if(scope!=='tenant'||p.role!=='tenant_owner'||p.purpose!=='impersonation'||!p.act||Array.isArray(p.act)||Object.keys(p.act).length!==1||typeof p.act.sub!=='string'||!/^master:[1-9][0-9]*$/.test(p.act.sub)||!positiveId(Number(p.act.sub.split(':')[1])))throw new InvalidToken();}
  else if(p.act!==undefined||p.purpose!==undefined)throw new InvalidToken();
  return Object.freeze(p);
 }catch{throw new InvalidToken();}
}
const verifyImpersonation=(config,token,now)=>verify(config,token,'tenant',now,true);
module.exports={verifyImpersonation,TTL,ISSUER,roles,InvalidToken,positiveId,configuration,issue,verify};
