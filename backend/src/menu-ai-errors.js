// Apenas códigos conhecidos viram diagnóstico. Nunca exibir error.message do provedor.
const knownCodes=new Set(['invalid_api_key','insufficient_quota','billing_hard_limit_reached','credits_balance_insufficient','organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded','model_not_found','permission_denied','invalid_json_schema','unsupported_parameter','invalid_value','invalid_request_error','invalid_image','invalid_image_format','image_parse_error','invalid_file','file_parse_error','unsupported_file','rate_limit_exceeded','slow_down','server_is_overloaded','service_unavailable_error','server_error']);
async function providerMeta(response){
 let value=null;const reader=response.body?.getReader();
 if(reader){let size=0;const parts=[];try{while(true){const {done,value:part}=await reader.read();if(done)break;size+=part.length;if(size>32768){await reader.cancel();break;}parts.push(Buffer.from(part));}if(size<=32768)value=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{}finally{reader.releaseLock();}}
 const error=value?.error,code=knownCodes.has(error?.code)?error.code:knownCodes.has(error?.type)?error.type:'unclassified';
 const parameter=typeof error?.param==='string'&&/^(model|input(?:\.[0-9]+(?:\.content(?:\.[0-9]+)?)?)?|text\.format(?:\.[a-z_]+)*|max_output_tokens)$/.test(error.param)?error.param:null;
 const rawId=response.headers?.get('x-request-id'),request_id=/^req_[A-Za-z0-9_-]{8,100}$/.test(rawId||'')?rawId:null;
 return {http_status:response.status,code,parameter,request_id};
}
function providerProblem(meta){
 const {http_status:status,code,parameter}=meta;
 if(status===401||code==='invalid_api_key')return {reason:'invalid_key',status:503,message:'A chave da API OpenAI é inválida, foi revogada ou não autentica este projeto. Atualize-a pelo script de configuração.'};
 if(['insufficient_quota','billing_hard_limit_reached','credits_balance_insufficient','organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded'].includes(code))return {reason:'billing_limit',status:503,message:'A API OpenAI recusou a solicitação por falta de créditos ou limite de uso/gastos do projeto. Confira o faturamento e os limites da conta da API antes de tentar novamente.'};
 if(code==='model_not_found'||status===404)return {reason:'model_unavailable',status:503,message:'O modelo de IA configurado não foi encontrado ou não está disponível para esta chave/projeto. Confira o modelo e as permissões da conta.'};
 if(status===403||code==='permission_denied')return {reason:'permission_denied',status:503,message:'A chave/projeto OpenAI não tem permissão para esta operação. Confira as permissões e restrições do projeto da API.'};
 if(code==='invalid_json_schema'||parameter?.startsWith('text.format')||parameter==='max_output_tokens'||code==='unsupported_parameter')return {reason:'request_configuration',status:502,message:'A OpenAI recusou a configuração de extração. O suporte precisa conferir o contrato da API/modelo; não é necessário alterar o cardápio.'};
 if(status===429)return {reason:'rate_limit',status:503,message:'O limite temporário de requisições da OpenAI foi atingido. Aguarde antes de tentar novamente.'};
 if(status>=500)return {reason:'provider_unavailable',status:503,message:'A OpenAI está temporariamente indisponível. Tente novamente mais tarde.'};
 if(['invalid_image','invalid_image_format','image_parse_error','invalid_file','file_parse_error','unsupported_file'].includes(code))return {reason:'file_rejected',status:422,message:'A OpenAI não conseguiu ler o arquivo. Envie uma imagem JPEG/PNG nítida ou PDF sem proteção.'};
 return {reason:'request_rejected',status:502,message:'A OpenAI recusou o documento ou o formato da solicitação. Execute o diagnóstico de IA no servidor para identificar o código da recusa.'};
}
function logProviderProblem(logger,meta,problem){try{logger.error(JSON.stringify({level:'error',event:'menu_ai_provider_failed',...meta,reason:problem.reason}));}catch{}}
module.exports={providerMeta,providerProblem,logProviderProblem};
