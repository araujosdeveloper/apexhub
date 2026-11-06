const {createHash,randomUUID}=require('node:crypto');
const {AdminError,transaction,success,lockMaster}=require('../platform-admin-http');
const {validateMenu,parseUpload,createExtractor,importTenantId}=require('../menu-import-ai');
const {saveMenu}=require('./menu-import');
async function target(conn,id,lock=false){const [[row]]=await conn.execute('SELECT id,name,active FROM companies WHERE id=?'+(lock?' FOR UPDATE':''),[id]);if(!row)throw new AdminError(404,'Loja não encontrada.');if(!Number(row.active))throw new AdminError(409,'A loja está suspensa. Ative-a antes de importar.');return row;}
function createMasterMenuImportController(db,{extractor,logger=console}={}){extractor??=createExtractor({logger});return {
 preview:async(req,res)=>{
  req.menuImportRunning=true;let file;
  try{
   file=await parseUpload(req,{master:true});const tenant=await target(db,file.tenantId);
   const menu=validateMenu(await extractor(file),{preview:true});
   await transaction(db,req,logger,async conn=>{await lockMaster(conn,req);await target(conn,tenant.id,true);await conn.execute("INSERT INTO platform_audit(admin_id,action,entity_id,details) VALUES (?,'menu_import_preview',?,?)",[req.master.id,String(tenant.id),JSON.stringify({file_type:file.type,category_count:menu.categories.length,product_count:menu.product_count})]);});
   success(res,{tenant_id:tenant.id,tenant_name:tenant.name,...menu,requires_review:true,saved:false,warnings:['Confira categorias, descrições e preços antes de salvar. Preços ilegíveis devem ser preenchidos.']},'Prévia gerada. Nenhum produto foi cadastrado.');
  }finally{file?.bytes.fill(0);req.body=undefined;req.menuImportRunning=false;req.releaseMenuImport?.();}
 },
 confirm:async(req,res)=>{
  const tenantId=importTenantId(req.body?.tenant_id),menu=validateMenu(req.body),importId=req.body.import_id??randomUUID();
  if(typeof importId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(importId))throw new AdminError(400,'Identificador da importação inválido.');
  const fingerprint=createHash('sha256').update(JSON.stringify(menu.categories)).digest('hex');
  const data=await transaction(db,req,logger,async conn=>{
   await lockMaster(conn,req);const tenant=await target(conn,tenantId,true);
   const [[previous]]=await conn.execute("SELECT details FROM platform_audit WHERE admin_id=? AND action='menu_import_confirmed' AND entity_id=? AND JSON_UNQUOTE(JSON_EXTRACT(details,'$.import_id'))=? ORDER BY id DESC LIMIT 1",[req.master.id,String(tenantId),importId]);
   if(previous){const receipt=typeof previous.details==='string'?JSON.parse(previous.details):previous.details;if(receipt.fingerprint!==fingerprint)throw new AdminError(409,'Esta importação já foi salva com outro conteúdo. Gere uma nova prévia.');return {...receipt.result,replayed:true};}
   const saved=await saveMenu(conn,tenantId,menu),result={tenant_id:tenantId,tenant_name:tenant.name,import_id:importId,category_count:saved.category_count,product_count:saved.product_count,category_ids:saved.categories.map(c=>c.id),product_ids:saved.categories.flatMap(c=>c.products.map(p=>p.id))};
   await conn.execute("INSERT INTO platform_audit(admin_id,action,entity_id,details) VALUES (?,'menu_import_confirmed',?,?)",[req.master.id,String(tenantId),JSON.stringify({import_id:importId,fingerprint,result})]);return {...result,replayed:false};
  });success(res,data,data.replayed?'Esta importação já foi salva. Nenhum item duplicado.':'Cardápio salvo na loja e operação registrada em auditoria.',data.replayed?200:201);
 }
};}
module.exports={target,createMasterMenuImportController};
