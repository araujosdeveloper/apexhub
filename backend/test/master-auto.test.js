const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {EMAIL,buildProgram,saveResult}=require('../../scripts/setup-master-auto');
const security=require('../src/security');
test('Master automático: cria ou recupera somente email solicitado e confirma senha gravada antes de devolver credencial',async()=>{
 for(const exists of [false,true]){
  const password='A'.repeat(31)+'1',calls=[];let stored,active=0,ended=false,output;
  async function execute(sql,args){calls.push({sql,args});if(sql.startsWith('SELECT id FROM platform_admins'))return [exists?[{id:9}]:[]];if(sql.startsWith('SELECT id,active'))return [[{id:9,active}]];if(sql.startsWith('INSERT INTO platform_admins')){stored=args[2];active=1;return [{insertId:9}];}if(sql.startsWith('UPDATE platform_admins')){stored=args[0];active=1;return [{affectedRows:1}];}if(sql.startsWith('SELECT password_hash,active'))return [[{password_hash:stored,active}]];if(sql.startsWith('SELECT password_hash'))return [[{password_hash:stored}]];if(sql.startsWith('INSERT INTO platform_audit')||sql.startsWith('DELETE FROM platform_sessions'))return [{affectedRows:1}];throw new Error(sql);}
  const conn={execute,beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>{}};
  const db={execute,getConnection:async()=>conn,end:async()=>{ended=true;}};
  const context={require(name){if(name==='mysql2/promise')return {createPool:()=>db};assert.equal(name,'./src/security');return security;},process:{env:{},exitCode:0},console:{log(text){output=JSON.parse(text);},error(){assert.fail('Operação deveria concluir');}}};
  await vm.runInNewContext(buildProgram(password),context);
  assert.equal(output.email,EMAIL);assert.equal(output.password,password);assert.equal(output.success,true);assert.equal(await security.verifyPassword(password,stored),true);assert.equal(ended,true);assert.equal(calls.some(c=>c.sql&&/\busers\b|\bcompanies\b/.test(c.sql)),false);assert.equal(calls.filter(c=>c.sql?.startsWith('DELETE FROM platform_sessions')).length,exists?1:0);
 }
});
test('Master automático: arquivo de credenciais privado e nada exibido sem confirmação válida',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'apex-master-auto-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const output=[];
 for(const invalid of [null,{success:false},{success:true,id:1,email:'outro@example.com',password:'a'.repeat(32)}])assert.throws(()=>saveResult(invalid,root,text=>output.push(text)));
 assert.equal(output.length,0);assert.equal(fs.existsSync(path.join(root,'reports')),false);
 const file=saveResult({success:true,id:9,email:EMAIL,password:'a'.repeat(32)},root,text=>output.push(text));assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.statSync(path.dirname(file)).mode&0o777,0o700);assert.ok(fs.readFileSync(file,'utf8').includes(EMAIL));assert.ok(output[0].includes('CONFIGURADO E VERIFICADO'));
});
test('Master automático: gera senha aleatória de 32 caracteres sem aceitar credenciais fracas',()=>{
 assert.notEqual(buildProgram(),buildProgram());for(const value of ['curta','x'.repeat(31),'x'.repeat(33)])assert.throws(()=>buildProgram(value));
});
