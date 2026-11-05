const {hashPassword,verifyPassword}=require('./security');
// Executado exclusivamente pelo operador no terminal do servidor, nunca por rota HTTP.
async function recoverMaster(pool,{email,password}){
 if(typeof email!=='string'||email.trim().length>254||!/^\S+@\S+\.\S+$/.test(email.trim())||typeof password!=='string'||password.length<16||password.length>128)throw new Error('Informe e-mail válido e senha de 16 a 128 caracteres.');
 const normalized=email.trim().toLowerCase(),encoded=await hashPassword(password),conn=await pool.getConnection();
 try{
  await conn.beginTransaction();
  const [[admin]]=await conn.execute('SELECT id,active FROM platform_admins WHERE email=? FOR UPDATE',[normalized]);
  if(!admin)throw new Error('Conta Master não encontrada para esse e-mail. Use scripts/check-master.sh; se não existir conta, execute scripts/create-master.sh.');
  await conn.execute('UPDATE platform_admins SET password_hash=?,active=1 WHERE id=?',[encoded,admin.id]);
  await conn.execute('DELETE FROM platform_sessions WHERE admin_id=?',[admin.id]);
  await conn.execute("INSERT INTO platform_audit(admin_id,action,entity_id,details) VALUES (?,'master_access_recovered',?,?)",[admin.id,String(admin.id),JSON.stringify({method:'server_terminal',previous_active:Number(admin.active)===1,sessions_revoked:true})]);
  const [[stored]]=await conn.execute('SELECT password_hash FROM platform_admins WHERE id=?',[admin.id]);
  if(!stored||!await verifyPassword(password,stored.password_hash))throw new Error('A senha gravada não passou na verificação. Recuperação revertida.');
  await conn.commit();return {id:admin.id};
 }catch(e){await conn.rollback();throw e;}finally{conn.release();}
}
module.exports={recoverMaster};
