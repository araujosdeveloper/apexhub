const {hashPassword}=require('./security');
async function provisionMaster(pool,{name,email,password}){
 if(typeof name!=='string'||!name.trim()||name.length>120||typeof email!=='string'||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||typeof password!=='string'||password.length<16||password.length>128)throw new Error('Informe nome, e-mail e senha de 16 a 128 caracteres válidos.');
 const encoded=await hashPassword(password),conn=await pool.getConnection();
 try{await conn.beginTransaction();const [result]=await conn.execute('INSERT INTO platform_admins(name,email,password_hash) VALUES (?,?,?)',[name.trim(),email.trim().toLowerCase(),encoded]);await conn.execute("INSERT INTO platform_audit(admin_id,action,entity_id,details) VALUES (?,'master_created',?,'{}')",[result.insertId,String(result.insertId)]);await conn.commit();return {id:result.insertId};}catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY')throw new Error('E-mail Master já cadastrado. Nenhuma conta foi alterada.');throw e;}finally{conn.release();}
}
module.exports={provisionMaster};
