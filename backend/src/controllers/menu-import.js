const {AdminError,transaction,success}=require('../platform-admin-http');
const {validateMenu,parseUpload,createExtractor}=require('../menu-import-ai');
function createMenuImportController(db,{extractor=createExtractor(),logger=console}={}){return {
 preview:async(req,res)=>{
  req.menuImportRunning=true;let file;try{file=await parseUpload(req);const extracted=await extractor(file),menu=validateMenu(extracted,{preview:true});success(res,{tenant_id:req.tenantId,...menu,requires_review:true,warnings:['Confira nomes, categorias e todos os preços antes de confirmar.',...(menu.categories.some(c=>c.products.some(p=>p.price===null))?['Preencha os preços ilegíveis antes de confirmar.']:[])],saved:false},'Prévia gerada. Nenhum produto foi cadastrado.');}finally{file?.bytes.fill(0);req.body=undefined;req.menuImportRunning=false;req.releaseMenuImport?.();}
 },
 confirm:async(req,res)=>{
  const menu=validateMenu(req.body);
  const data=await transaction(db,req,logger,async conn=>{
   // Serializa lotes da mesma loja e a suspensão pelo Master.
   const [[company]]=await conn.execute('SELECT id FROM companies WHERE id=? AND active=1 FOR UPDATE',[req.tenantId]);if(!company)throw new AdminError(403,'Loja indisponível.');
   return saveMenu(conn,req.tenantId,menu);
  });success(res,data,'Cardápio importado. Todos os itens foram gravados na mesma transação.',201);
 }
};}
async function saveMenu(conn,tenantId,menu){
 const categories=[];for(const [order,category]of menu.categories.entries()){
    const [created]=await conn.execute('INSERT INTO categories(company_id,name,sort_order,active) VALUES (?,?,?,1)',[tenantId,category.name,order]);const products=[];
    for(const product of category.products){const [item]=await conn.execute('INSERT INTO products(company_id,category_id,name,description,price,active) VALUES (?,?,?,?,?,1)',[tenantId,created.insertId,product.name,product.description,product.price]);products.push({id:item.insertId,name:product.name,price:product.price});}
    categories.push({id:created.insertId,name:category.name,products});
   }
   return {tenant_id:tenantId,categories,category_count:categories.length,product_count:menu.product_count};
}
module.exports={createMenuImportController,saveMenu};
