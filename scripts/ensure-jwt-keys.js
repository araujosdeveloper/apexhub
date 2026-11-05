#!/usr/bin/env node
// Chaves persistentes privadas: nunca imprimir os valores nem passá-los por argv.
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
function ensureKeys(root){
 const file=path.join(root,'.env.jwt');
 try{const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,'JWT_TENANT_SECRET='+randomBytes(32).toString('hex')+'\nJWT_MASTER_SECRET='+randomBytes(32).toString('hex')+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}catch(e){if(e.code!=='EEXIST')throw e;}
 const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.mode&0o077)throw new Error('.env.jwt deve ser um arquivo privado com permissão 600.');
 const lines=fs.readFileSync(file,'utf8').trim().split('\n');if(lines.length!==2||!/^JWT_TENANT_SECRET=[a-f0-9]{64}$/.test(lines[0])||!/^JWT_MASTER_SECRET=[a-f0-9]{64}$/.test(lines[1])||lines[0].split('=')[1]===lines[1].split('=')[1])throw new Error('Configuração JWT existente inválida; não será sobrescrita.');
}
if(require.main===module){try{ensureKeys(path.resolve(__dirname,'..'));console.log('Chaves JWT privadas configuradas; valores preservados.');}catch(e){console.error('JWT não configurado: '+e.message);process.exitCode=1;}}
module.exports={ensureKeys};
