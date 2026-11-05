const {test}=require('node:test');
const assert=require('node:assert/strict');
const {serve}=require('../test-support/http');
const {revision,publicUser,teamInput}=require('../src/team');
const {hashPassword}=require('../src/security');
const headers={Cookie:'delivery_session='+'a'.repeat(64),'Content-Type':'application/json'};
const account={id:3,company_id:7,name:'Ana',email:'ana@example.com',role:'operator',active:1,password_hash:'private-hash'};
const input={name:'Ana',email:'ana@example.com',role:'operator',active:true};
function fake({role='owner',target=account,fail=false,duplicate=false}={}){
 const calls=[];
 async function execute(sql,args){calls.push({sql,args});if(sql.includes('FROM sessions s JOIN users u ON u.id ='))return [[{id:1,company_id:7,role}]];
  if(sql.startsWith('SELECT COUNT'))return [[{total:1}]];
  if(sql.includes('FROM users WHERE company_id=? ORDER BY'))return [[target]];
  if(sql.includes('FOR UPDATE'))return [target?[target]:[]];
  if(sql.startsWith('UPDATE users')||sql.startsWith('INSERT INTO users')){if(duplicate)throw Object.assign(new Error(),{code:'ER_DUP_ENTRY'});if(fail)throw new Error('Falha');return [{affectedRows:1,insertId:3}];}
  if(sql.startsWith('DELETE s FROM sessions'))return [{affectedRows:2}];throw new Error(sql);
 }
 return {calls,execute,getConnection:async()=>({execute,beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release')})};
}
const put=body=>({method:'PUT',headers,body:JSON.stringify({...input,revision:revision(account),...body})});
test('equipe: valida dados, não permite novo dono e revisão não expõe senha/hash',()=>{
 assert.equal(teamInput({...input,email:' ANA@example.com ',password:'segura-123456'},true).email,'ana@example.com');
 for(const body of [null,[],{...input,role:'owner'},{...input,password:'curta'},{...input,active:1},{...input,email:'errado'}, {...input,name:' '.repeat(5)}])assert.throws(()=>teamInput(body,true));
 assert.equal(publicUser(account).password_hash,undefined);assert.match(publicUser(account).revision,/^[a-f0-9]{64}$/);assert.notEqual(revision(account),revision({...account,password_hash:'novo-hash'}));assert.notEqual(revision(account),revision({...account,active:0}));
});
test('equipe: somente dono consulta/cadastra/edita; ausência de sessão retorna401',async t=>{
 for(const role of ['operator','manager']){const db=fake({role}),r=await serve(t,db);assert.equal((await r('/api/admin/team')).status,401);assert.equal((await r('/api/admin/team',{headers})).status,403);assert.equal((await r('/api/admin/team',{method:'POST',headers,body:'{}'})).status,403);assert.equal((await r('/api/admin/team/3',put({}))).status,403);assert.equal(db.calls.some(c=>c==='begin'),false);}
});
test('equipe: lista isola loja, pagina e entrega somente campos públicos',async t=>{
 const db=fake(),r=await serve(t,db),response=await r('/api/admin/team?offset=50&company_id=999',{headers});assert.equal(response.status,200);const data=await response.json();assert.equal(data.company_id,7);assert.equal(data.users[0].password_hash,undefined);assert.equal(data.users[0].active,true);
 const query=db.calls.find(c=>c.sql?.includes('ORDER BY'));assert.deepEqual(query.args,[7]);assert.match(query.sql,/LIMIT 50 OFFSET 50/);assert.equal((await r('/api/admin/team?offset=-1',{headers})).status,400);
});
test('equipe: alteração compara revisão, trava a pessoa e revoga sessões na mesma transação',async t=>{
 const db=fake(),r=await serve(t,db);assert.equal((await r('/api/admin/team/3',put({role:'manager',active:false}))).status,200);const update=db.calls.find(c=>c.sql?.startsWith('UPDATE users'));assert.deepEqual(update.args,['Ana','ana@example.com','manager',false,3,7]);
 assert.deepEqual(db.calls.find(c=>c.sql?.startsWith('DELETE s')).args,[3,7]);assert.deepEqual(db.calls.slice(-2),['commit','release']);
});
test('equipe: dono protegido, revisão antiga e pessoa de outra loja não são alterados',async t=>{
 for(const [opts,path,body,expected]of [[{},'/api/admin/team/1',{},403],[{target:{...account,role:'owner'}},'/api/admin/team/3',{},403],[{target:null},'/api/admin/team/999',{},404],[{},'/api/admin/team/3',{revision:'0'.repeat(64)},409]]){const db=fake(opts),r=await serve(t,db);assert.equal((await r(path,put(body))).status,expected);assert.equal(db.calls.some(c=>c.sql?.startsWith('UPDATE users')),false);}
});
test('equipe: senhas novas recebem hash e falhas desfazem edição sem revogar sessão',async t=>{
 const db=fake(),r=await serve(t,db);assert.equal((await r('/api/admin/team/3',put({password:'nova-senha-123456'}))).status,200);const query=db.calls.find(c=>c.sql?.startsWith('UPDATE'));assert.match(query.args[4],/^scrypt:/);assert.doesNotMatch(query.args[4],/nova-senha/);
 for(const [opts,status]of [[{fail:true},500],[{duplicate:true},409]]){const failure=fake(opts),rr=await serve(t,failure);assert.equal((await rr('/api/admin/team/3',put({}))).status,status);assert.deepEqual(failure.calls.slice(-2),['rollback','release']);assert.equal(failure.calls.some(c=>c.sql?.startsWith('DELETE s')),false);}
});
test('equipe: criar usa empresa da sessão, hash de senha e não cria sessão para o funcionário',async t=>{
 const db=fake(),r=await serve(t,db);const response=await r('/api/admin/team',{method:'POST',headers,body:JSON.stringify({...input,company_id:999,password:'senha-equipe-1234'})});assert.equal(response.status,201);assert.equal(response.headers['set-cookie'],undefined);const insert=db.calls.find(c=>c.sql?.startsWith('INSERT INTO users'));assert.equal(insert.args[0],7);assert.match(insert.args[3],/^scrypt:/);assert.equal(insert.args[4],'operator');
});
test('login: senha alterada ou conta bloqueada entre conferência e sessão cancela login',async t=>{
 const hash=await hashPassword('senha-equipe-1234');for(const current of [null,{id:3,password_hash:'outro-hash'}]){
  const calls=[],execute=async(sql)=>{calls.push(sql);if(sql.includes('FOR UPDATE'))return [current?[current]:[]];if(sql.startsWith('SELECT u.id'))return [[{id:3,password_hash:hash}]];throw new Error(sql);};
  const r=await serve(t,{execute,getConnection:async()=>({execute,beginTransaction:async()=>{},commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release')})});
  const response=await r('/api/auth/login',{method:'POST',headers,body:JSON.stringify({email:'ana@example.com',password:'senha-equipe-1234'})});assert.equal(response.status,401);assert.equal(response.headers['set-cookie'],undefined);assert.deepEqual(calls.slice(-2),['rollback','release']);assert.equal(calls.some(sql=>sql.startsWith('INSERT')),false);
 }
});
