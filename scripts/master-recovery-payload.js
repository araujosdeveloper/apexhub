// Gera o programa de recuperação somente em memória/stdin; nunca grava credenciais.
const {recoverMaster}=require('../backend/src/recover-master');
let data=Buffer.alloc(0);
process.stdin.on('data',chunk=>{data=Buffer.concat([data,chunk]);if(data.length>4096){console.error('Dados excedem o limite.');process.exit(2);}});
process.stdin.on('end',()=>{
 const values=data.toString('utf8').split('\0');
 if(values.length!==3||values[2]!==''){process.exitCode=2;return;}
 const [email,password]=values;
 if(email.length>254||!/^\S+@\S+\.\S+$/.test(email.trim())||password.length<16||password.length>128){console.error('Informe e-mail válido e senha de 16 a 128 caracteres. Nenhuma conta alterada.');process.exitCode=2;return;}
 // Função controlada do próprio projeto e entradas escapadas com JSON.stringify.
 // O container já tem security/mysql2; não é necessário rebuild da imagem.
 const program=`const mysql=require('mysql2/promise');
const {hashPassword,verifyPassword}=require('./src/security');
${recoverMaster.toString()}
(async()=>{const db=mysql.createPool({host:process.env.DB_HOST||'mysql',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:1});try{const result=await recoverMaster(db,${JSON.stringify({email,password})});console.log('SENHA MASTER REDEFINIDA E VERIFICADA. Conta: '+result.id);console.log('Entre com o e-mail informado e a nova senha.');}finally{await db.end();}})().catch(e=>{console.error('Recuperação não concluída: '+(e.code||e.message));process.exitCode=1;});`;
 process.stdout.write(program);
});
