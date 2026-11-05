#!/usr/bin/env bash
# Diagnóstico somente de leitura. Não mostra contas, hashes, senhas ou tokens.
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/live-backup-common.sh"
if [[ -t 0 && -t 1 ]]; then
 printf 'Terminal interativo: SIM\n'
else
 printf 'Terminal interativo: NÃO (a criação de conta exige um terminal SSH interativo).\n'
fi
backup_require
backup_release
bash "$backup_release_dir/manage.sh" exec -T app node <<'NODE'
const mysql=require('mysql2/promise');
(async()=>{
 const db=await mysql.createConnection({host:process.env.DB_HOST||'mysql',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
 try{
  const [[row]]=await db.execute('SELECT COUNT(*) AS total,COALESCE(SUM(active=1),0) AS active FROM platform_admins');
  const total=Number(row.total),active=Number(row.active);
  console.log('Contas Master cadastradas: '+total);
  console.log('Contas Master ativas: '+active);
  if(!total)console.log('RESULTADO: nenhuma conta Master foi criada. Execute scripts/create-master.sh em terminal interativo.');
  else if(!active)console.log('RESULTADO: existem contas Master, mas nenhuma está ativa. É necessário recuperar o acesso administrativo.');
  else console.log('RESULTADO: existe conta Master ativa. Use o e-mail e a senha definidos para ela; a conta do lojista é independente. Se a senha não for aceita, será necessária a recuperação da conta.');
 }finally{await db.end();}
})().catch(e=>{console.error('Verificação não concluída: '+(e.code||e.name));process.exitCode=1;});
NODE
