#!/usr/bin/env bash
# Perguntas no terminal do host; Docker recebe apenas JSON por stdin, sem TTY.
set +x
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/live-backup-common.sh"
if [[ ! -t 0 || ! -t 1 ]]; then
 printf 'Execute em um terminal SSH interativo da VPS.\n' >&2
 exit 2
fi
backup_require
backup_release
master_terminal_state="$(stty -g <&0)"
master_cleanup() {
 stty "$master_terminal_state" <&0 2>/dev/null || true
 unset master_name master_email master_password master_confirmation
}
trap master_cleanup EXIT
trap 'printf "\nCriação cancelada.\n" >&2; exit 130' INT
trap 'exit 143' TERM
unset master_name master_email master_password master_confirmation
printf 'Criação da conta Master. A senha não mostra caracteres ao digitar.\n'
read -r -p 'Nome do administrador Master: ' master_name <&0
read -r -p 'E-mail Master: ' master_email <&0
read -r -s -p 'Senha de 16 a 128 caracteres (oculta; pressione Enter ao terminar): ' master_password <&0
printf '\n'
read -r -s -p 'Repita a senha (oculta; pressione Enter ao terminar): ' master_confirmation <&0
printf '\n'
if [[ "$master_password" != "$master_confirmation" ]]; then
 printf 'As senhas não coincidem. Nenhuma conta criada.\n' >&2
 exit 2
fi
# Nome/e-mail/senha não são argumentos de processo nem variáveis exportadas.
printf '%s\0' "$master_name" "$master_email" "$master_password" |
 node -e '
 let input=Buffer.alloc(0);
 process.stdin.on("data",chunk=>{input=Buffer.concat([input,chunk]);if(input.length>4096){console.error("Dados excedem o limite.");process.exit(2);}});
 process.stdin.on("end",()=>{const values=input.toString("utf8").split("\0");if(values.length!==4||values[3]!==""){process.exitCode=2;return;}const [name,email,password]=values;if(!name.trim()||name.length>120||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||password.length<16||password.length>128){console.error("Informe nome, e-mail válido e senha de 16 a 128 caracteres. Nenhuma conta criada.");process.exitCode=2;return;}process.stdout.write(JSON.stringify({name,email,password}));});
 ' |
 bash "$backup_release_dir/manage.sh" exec -T app node -e '
 const mysql=require("mysql2/promise");
 const {provisionMaster}=require("./src/provision-master");
 let text="";
 process.stdin.on("data",chunk=>{text+=chunk;if(Buffer.byteLength(text)>8192){console.error("Dados excedem o limite.");process.exit(2);}});
 process.stdin.on("end",async()=>{
  if(!text)return;
  let db;
  try{const input=JSON.parse(text);db=mysql.createPool({host:process.env.DB_HOST||"mysql",port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:1});const result=await provisionMaster(db,input);console.log("Conta Master criada. ID: "+result.id);}
  catch(e){console.error("Conta Master não criada: "+(e.code||e.message));process.exitCode=1;}
  finally{if(db)await db.end();}
 });
 '
printf 'Acesse: https://179.198.120.188/master-login.html\n'
