const {createHash}=require('node:crypto');
const {asyncRoute}=require('./auth');
const {hashPassword}=require('./security');
function revision(user){return createHash('sha256').update(JSON.stringify([user.id,user.company_id,user.name,user.email,user.role,Number(user.active),user.password_hash])).digest('hex');}
function publicUser(user){return {id:user.id,name:user.name,email:user.email,role:user.role,active:Number(user.active)===1,revision:revision(user)};}
function teamInput(body={},creating=false){
 if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Informe os dados do acesso.');
 if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>120||typeof body.email!=='string'||body.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())||!['manager','operator'].includes(body.role)||typeof body.active!=='boolean')throw new Error('Informe nome, e-mail, perfil de gerente/operador e disponibilidade.');
 const password=body.password;
 if((creating||password!==undefined)&&(typeof password!=='string'||password.length<12||password.length>128))throw new Error('A senha deve ter de 12 a 128 caracteres.');
 return {name:body.name.trim(),email:body.email.trim().toLowerCase(),role:body.role,active:body.active,...(password!==undefined?{password}:{})};
}
function installTeam(app,db,auth){
 const owner=(req,res,next)=>req.user.role==='owner'?next():res.status(403).json({error:'Somente o dono pode gerenciar a equipe.'});
 app.get('/api/admin/team',auth,owner,asyncRoute(async(req,res)=>{
  const offset=String(req.query.offset||'0');if(!/^\d{1,6}$/.test(offset)||Number(offset)>100000)return res.status(400).json({error:'Página inválida.'});
  const [[count]]=await db.execute('SELECT COUNT(*) AS total FROM users WHERE company_id=?',[req.user.company_id]);
  const [users]=await db.execute(`SELECT id,company_id,name,email,role,active,password_hash FROM users WHERE company_id=? ORDER BY role='owner' DESC,active DESC,name,id LIMIT 50 OFFSET ${Number(offset)}`,[req.user.company_id]);
  res.json({company_id:req.user.company_id,users:users.map(publicUser),total:Number(count.total),offset:Number(offset),limit:50});
 }));
 app.post('/api/admin/team',auth,owner,asyncRoute(async(req,res)=>{
  let input;try{input=teamInput(req.body,true);}catch(e){return res.status(400).json({error:e.message});}
  const hash=await hashPassword(input.password);
  try{const [result]=await db.execute('INSERT INTO users(company_id,name,email,password_hash,role,active) VALUES (?,?,?,?,?,?)',[req.user.company_id,input.name,input.email,hash,input.role,input.active]);res.status(201).json({id:result.insertId});}
  catch(e){if(e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'E-mail indisponível. Use outro endereço de acesso.'});throw e;}
 }));
 app.put('/api/admin/team/:id',auth,owner,asyncRoute(async(req,res)=>{
  let input;const id=Number(req.params.id),expected=req.body?.revision;
  try{input=teamInput(req.body);if(!Number.isSafeInteger(id)||id<1||typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))throw new Error('Cadastro ou versão inválidos. Atualize a lista.');}catch(e){return res.status(400).json({error:e.message});}
  if(id===req.user.id)return res.status(403).json({error:'A conta do dono é protegida nesta tela.'});
  const hash=input.password!==undefined?await hashPassword(input.password):null;
  const conn=await db.getConnection();
  try{
   await conn.beginTransaction();
   const [[user]]=await conn.execute('SELECT id,company_id,name,email,role,active,password_hash FROM users WHERE id=? AND company_id=? FOR UPDATE',[id,req.user.company_id]);
   if(!user){await conn.rollback();return res.status(404).json({error:'Pessoa não encontrada nesta loja.'});}
   if(user.role==='owner'){await conn.rollback();return res.status(403).json({error:'Contas de donos são protegidas nesta tela.'});}
   if(revision(user)!==expected){await conn.rollback();return res.status(409).json({error:'Este cadastro mudou. Atualize a lista antes de editar.'});}
   await conn.execute(`UPDATE users SET name=?,email=?,role=?,active=?${hash?',password_hash=?':''} WHERE id=? AND company_id=?`,[input.name,input.email,input.role,input.active,...(hash?[hash]:[]),id,req.user.company_id]);
   await conn.execute('DELETE s FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.id=? AND u.company_id=?',[id,req.user.company_id]);
   await conn.commit();res.json({ok:true,sessions_revoked:true});
  }catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'E-mail indisponível. Use outro endereço de acesso.'});throw e;}finally{conn.release();}
 }));
}
module.exports={revision,publicUser,teamInput,installTeam};
