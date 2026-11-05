// Uso exclusivo no host da VPS. Senha somente em memória/stdin e cópia privada.
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {recoverMaster}=require('../backend/src/recover-master');
const {provisionMaster}=require('../backend/src/provision-master');
const EMAIL='araujosdeveloper@gmail.com';
function buildProgram(password=randomBytes(24).toString('base64url')){
 if(!/^[A-Za-z0-9_-]{32}$/.test(password))throw new Error('Senha automática inválida.');
 const input={name:'Administrador ApexHub',email:EMAIL,password};
 return `const mysql=require('mysql2/promise');
const {hashPassword,verifyPassword}=require('./src/security');
${recoverMaster.toString()}
${provisionMaster.toString()}
(async()=>{const input=${JSON.stringify(input)};const db=mysql.createPool({host:process.env.DB_HOST||'mysql',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:1});
try{const [[existing]]=await db.execute('SELECT id FROM platform_admins WHERE email=?',[input.email]);const result=existing?await recoverMaster(db,input):await provisionMaster(db,input);const [[saved]]=await db.execute('SELECT password_hash,active FROM platform_admins WHERE id=? AND email=?',[result.id,input.email]);if(!saved||Number(saved.active)!==1||!await verifyPassword(input.password,saved.password_hash))throw new Error('Não foi possível verificar o acesso gravado.');console.log(JSON.stringify({success:true,id:result.id,email:input.email,password:input.password}));}finally{await db.end();}})().catch(e=>{console.error('Acesso Master não configurado: '+(e.code||e.message));process.exitCode=1;});`;
}
function saveResult(data,root=path.resolve(__dirname,'..'),write=console.log){
 if(!data||data.success!==true||!Number.isSafeInteger(data.id)||data.id<1||data.email!==EMAIL||typeof data.password!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(data.password))throw new Error('O servidor não confirmou um acesso válido. Nenhuma credencial será exibida.');
 const reports=path.join(root,'reports');fs.mkdirSync(reports,{recursive:true});
 const directory=fs.mkdtempSync(path.join(reports,'master-access-'));fs.chmodSync(directory,0o700);
 const file=path.join(directory,'credentials.txt');
 const text='E-mail: '+data.email+'\nSenha: '+data.password+'\nLink: https://179.198.120.188/master-login.html\n';
 fs.writeFileSync(file,text,{flag:'wx',mode:0o600});
 write('ACESSO MASTER CONFIGURADO E VERIFICADO.');write(text);write('Cópia privada no servidor: '+file);
 return file;
}
if(require.main===module){
 if(process.argv[2]==='--program')process.stdout.write(buildProgram());
 else if(process.argv[2]==='--result'){
  let text='';process.stdin.on('data',chunk=>{text+=chunk;if(Buffer.byteLength(text)>8192){console.error('Resposta inválida.');process.exit(2);}});
  process.stdin.on('end',()=>{try{if(!text.trim())throw new Error('Não houve confirmação do servidor. Nenhuma credencial foi exibida.');saveResult(JSON.parse(text));}catch(e){console.error(e instanceof SyntaxError?'Resposta do servidor inválida. Nenhuma credencial foi exibida.':e.message);process.exitCode=1;}});
 }else{console.error('Use o comando bash scripts/setup-master-auto.sh.');process.exitCode=2;}
}
module.exports={EMAIL,buildProgram,saveResult};
