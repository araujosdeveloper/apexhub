const {test}=require('node:test'),assert=require('node:assert/strict');
const {providerMeta,providerProblem}=require('../src/menu-ai-errors');
const {createExtractor}=require('../src/menu-import-ai');
const {diagnoseMenuAI}=require('../../scripts/check-menu-ai');
const vm=require('node:vm'),fs=require('node:fs');
const env={OPENAI_API_KEY:'test-key-not-real'},file={type:'image/png',bytes:Buffer.from('image')};
test('IA: classificação diferencia chave, créditos, modelo, permissão, contrato, arquivo e limite temporário',()=>{
 const cases=[[401,'invalid_api_key','invalid_key'],[429,'insufficient_quota','billing_limit'],[429,'project_spend_limit_exceeded','billing_limit'],[404,'model_not_found','model_unavailable'],[403,'permission_denied','permission_denied'],[400,'invalid_json_schema','request_configuration'],[400,'invalid_image','file_rejected'],[429,'rate_limit_exceeded','rate_limit'],[503,'server_is_overloaded','provider_unavailable']];for(const [http_status,code,reason]of cases)assert.equal(providerProblem({http_status,code}).reason,reason);
});
test('IA: resposta arbitrária não expõe mensagem, código desconhecido, cabeçalho ou parâmetro sensível',async()=>{
 const response=Response.json({error:{message:'API_KEY=SEGREDO documento do cliente',code:'SEGREDO',type:'invalid_request_error',param:'customer-secret'}},{status:400,headers:{'x-request-id':'API_KEY=SEGREDO'}});const meta=await providerMeta(response);assert.deepEqual(meta,{http_status:400,code:'invalid_request_error',parameter:null,request_id:null});assert.equal(JSON.stringify(meta).includes('SEGREDO'),false);assert.equal(providerProblem(meta).message.includes('SEGREDO'),false);
});
test('IA: erro de crédito gera mensagem útil e log sanitizado sem chave/conteúdo',async()=>{
 const logs=[],extract=createExtractor({env,logger:{error:line=>logs.push(line)},fetchImpl:async()=>Response.json({error:{code:'insufficient_quota',message:'private cardapio '+env.OPENAI_API_KEY}},{status:429,headers:{'x-request-id':'req_1234567890abcdef'}})});
 await assert.rejects(extract(file),error=>error.status===503&&error.message.includes('créditos'));assert.equal(logs.length,1);assert.equal(JSON.parse(logs[0]).reason,'billing_limit');assert.ok(logs[0].includes('req_1234567890abcdef'));assert.equal(logs[0].includes(env.OPENAI_API_KEY),false);assert.equal(logs[0].includes('cardapio'),false);
});
test('IA: corpos inválidos/grandes são limitados e falhas de rede distinguem timeout',async()=>{
 const meta=await providerMeta(new Response('x'.repeat(40000),{status:500}));assert.equal(meta.code,'unclassified');
 for(const [name,status]of [['TimeoutError',504],['TypeError',503]])await assert.rejects(createExtractor({env,logger:{error(){}},fetchImpl:async()=>{throw Object.assign(Error('private'),{name});}})(file),e=>e.status===status&&!e.message.includes('private'));
});
test('diagnóstico: ausência de chave não chama rede; chamada mínima não usa arquivo e não revela chave',async()=>{
 const output=[];let calls=0;
 assert.equal(await diagnoseMenuAI({env:{},report:s=>output.push(s),fetchImpl:async()=>{calls++;}}),false);assert.equal(calls,0);
 let sent;const ok=await diagnoseMenuAI({env,report:s=>output.push(s),fetchImpl:async(url,options)=>{sent={url,options};return Response.json({status:'completed'});}});assert.equal(ok,true);assert.equal(JSON.parse(sent.options.body).max_output_tokens,16);assert.equal(JSON.parse(sent.options.body).store,false);assert.equal(JSON.stringify(output).includes(env.OPENAI_API_KEY),false);
});
test('diagnóstico: código de crédito é mostrado com segurança e executa também via stdin',async()=>{
 const output=[],source='const menuAIErrorTools=(()=>{const module={exports:{}};'+fs.readFileSync(require.resolve('../src/menu-ai-errors'),'utf8')+';return module.exports;})();\n'+fs.readFileSync(require.resolve('../../scripts/check-menu-ai'),'utf8')+'\ndiagnoseMenuAI().then(ok=>{process.exitCode=ok?0:1;});';
 const processMock={env,exitCode:undefined},context={require,Buffer,AbortSignal,module:{exports:{}},process:processMock,console:{log:s=>output.push(s),error:s=>output.push(s)},fetch:async()=>Response.json({error:{code:'insufficient_quota',message:'private'}},{status:429})};vm.runInNewContext(source,context);for(let i=0;i<40;i++)await Promise.resolve();assert.equal(processMock.exitCode,1);assert.ok(output.join('').includes('billing_limit'));assert.equal(output.join('').includes('private'),false);
});
