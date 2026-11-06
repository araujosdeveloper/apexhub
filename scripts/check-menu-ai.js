// Pode ser enviado via stdin à imagem em produção, sem exigir rebuild prévio.
const menuErrorTools=typeof menuAIErrorTools==='undefined'?require('../backend/src/menu-ai-errors'):menuAIErrorTools;
async function diagnoseMenuAI({env=process.env,fetchImpl=globalThis.fetch,report=line=>console.log(line)}={}){
 if(!env.OPENAI_API_KEY){report('DIAGNÓSTICO: chave OpenAI ausente no aplicativo em execução. Configure scripts/configure-menu-ai.sh e publique a atualização.');return false;}
 const model=env.MENU_IMPORT_AI_MODEL||'gpt-4.1-mini';
 if(!/^[A-Za-z0-9._:-]{1,100}$/.test(model)||/^(sk-|sess-)/i.test(model)){report('DIAGNÓSTICO: nome do modelo inválido na configuração.');return false;}
 report('Diagnóstico OpenAI: chamada mínima sem arquivo de cliente (pode consumir poucos tokens).');
 let response;try{response=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),body:JSON.stringify({model,store:false,max_output_tokens:16,input:'Responda somente OK.'})});}catch{report('DIAGNÓSTICO: não foi possível conectar à API OpenAI dentro do prazo. Confira rede, DNS e saída HTTPS da VPS.');return false;}
 if(!response.ok){const meta=await menuErrorTools.providerMeta(response),problem=menuErrorTools.providerProblem(meta);report('DIAGNÓSTICO: '+problem.message);report(JSON.stringify({provider:'openai',...meta,reason:problem.reason}));return false;}
 await response.body?.cancel();report('DIAGNÓSTICO: a API aceitou a chave, o modelo e a chamada mínima. Se o arquivo continuar falhando, envie a nova mensagem do painel após publicar a correção de diagnóstico.');return true;
}
module.exports={diagnoseMenuAI};
if(require.main===module&&typeof menuAIErrorTools==='undefined')diagnoseMenuAI().then(ok=>{process.exitCode=ok?0:1;}).catch(()=>{console.error('Diagnóstico não concluído. Nenhum dado sensível foi exibido.');process.exitCode=1;});
