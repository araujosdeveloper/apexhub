const {AdminError,transaction,success}=require('../platform-admin-http');
const {validateGroups,decodeGroups}=require('../addons');
const {withImage}=require('../product-images');
const {syncOptions}=require('../menu-options');
function positiveId(value){if(typeof value!=='string'||! /^[1-9]\d{0,9}$/.test(value)||Number(value)>4294967295)throw new AdminError(400,'Identificador inválido.');return Number(value);}
function text(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max)throw new AdminError(400,`${label} inválido.`);return value.trim();}
function categoryInput(body){
 const name=text(body?.name,120,'Nome'),sort_order=body.sort_order??0,is_active=body.is_active??true;
 if(!Number.isSafeInteger(sort_order)||sort_order<0||sort_order>10000||typeof is_active!=='boolean')throw new AdminError(400,'Informe ordem de 0 a 10000 e is_active booleano.');return {name,sort_order,is_active};
}
function productInput(body){
 const name=text(body?.name,160,'Nome'),description=body.description??'',price=body.price,category_id=body.category_id,is_available=body.is_available??true;
 if(typeof description!=='string'||description.length>4000||typeof price!=='string'||!/^\d{1,6}(?:\.\d{1,2})?$/.test(price)||!Number.isSafeInteger(category_id)||category_id<1||category_id>4294967295||typeof is_available!=='boolean')throw new AdminError(400,'Confira descrição, preço decimal em texto, categoria e is_available booleano.');
 let image_url=body.image_url??null;
 if(image_url!==null){try{if(typeof image_url!=='string'||image_url.length>2048)throw Error();const url=new URL(image_url);if(url.protocol!=='https:'||url.username||url.password)throw Error();image_url=url.href;if(image_url.length>2048)throw Error();}catch{throw new AdminError(400,'image_url deve ser uma URL HTTPS sem credenciais ou null.');}}
 let groups;
 try{
  if(body.options!==undefined&&body.addon_groups!==undefined)throw Error('Informe options ou addon_groups, não ambos.');
  if(body.options!==undefined){if(!Array.isArray(body.options)||body.options.length>20)throw Error('Cadastre até 20 opções simples.');
   groups=body.options.length?[{id:'menu_extras',name:'Complementos',min:0,max:body.options.length,options:body.options.map((o,i)=>{if(!o||o.max_quantity!==undefined&&o.max_quantity!==1)throw Error('O checkout atual permite uma unidade de cada opcional por item (max_quantity=1).');return {id:'menu_option_'+(i+1),name:o.name,price:o.additional_price,active:o.is_active??true};})}]:[];
  }else groups=body.addon_groups??[];
  groups=validateGroups(groups);
 }catch(e){throw new AdminError(400,e.message);}
 return {name,description:description.trim(),price:Number(price).toFixed(2),category_id,image_url,is_available,groups};
}
function categoryView(row){return {id:row.id,tenant_id:row.company_id,name:row.name,sort_order:Number(row.sort_order),is_active:Boolean(Number(row.active)),created_at:row.created_at};}
function productView(row,context){const imaged=withImage(row,true,context);return {id:row.id,tenant_id:row.company_id,category_id:row.category_id,name:row.name,description:row.description||'',price:String(row.price),image_url:imaged.image_url,is_available:Boolean(Number(row.active)),created_at:row.created_at};}
function createTenantMenuController(db,logger=console){
 const run=(req,handler)=>transaction(db,req,logger,handler);
 const locked=async(conn,req,id)=>{const [[row]]=await conn.execute('SELECT id,active FROM products WHERE id=? AND company_id=? FOR UPDATE',[id,req.tenantId]);if(!row)throw new AdminError(404,'Produto não encontrado nesta loja.');return row;};
 return {
  list:async(req,res)=>{
   const data=await run(req,async conn=>{
    const [categories]=await conn.execute('SELECT id,company_id,name,sort_order,active,created_at FROM categories WHERE company_id=? ORDER BY sort_order,id',[req.tenantId]);
    const [products]=await conn.execute(`SELECT p.id,p.company_id,p.category_id,p.name,p.description,p.price,p.active,p.created_at,p.image_url,i.digest AS image_digest,a.config AS addon_config,a.version AS addon_version
     FROM products p JOIN categories c ON c.id=p.category_id AND c.company_id=p.company_id LEFT JOIN product_images i ON i.product_id=p.id LEFT JOIN product_addons a ON a.product_id=p.id WHERE p.company_id=? ORDER BY p.category_id,p.id`,[req.tenantId]);
    const [options]=await conn.execute(`SELECT CAST(o.id AS CHAR) AS id,o.tenant_id,o.product_id,o.option_key,o.group_key,o.name,o.additional_price,o.max_quantity,o.is_active,o.created_at FROM product_options o JOIN products p ON p.id=o.product_id AND p.company_id=o.tenant_id WHERE o.tenant_id=? ORDER BY o.product_id,o.id`,[req.tenantId]);
    const byProduct=new Map(),byCategory=new Map();for(const row of options){if(!byProduct.has(row.product_id))byProduct.set(row.product_id,[]);byProduct.get(row.product_id).push({...row,additional_price:String(row.additional_price),max_quantity:Number(row.max_quantity),is_active:Boolean(Number(row.is_active))});}
    for(const row of products){const product={...productView(row,req.auth.impersonation?req.auth.sid:null),options:byProduct.get(row.id)||[],addon_groups:decodeGroups(row.addon_config),addon_version:Number(row.addon_version||0)};if(!byCategory.has(row.category_id))byCategory.set(row.category_id,[]);byCategory.get(row.category_id).push(product);}
    return {tenant_id:req.tenantId,categories:categories.map(row=>({...categoryView(row),products:byCategory.get(row.id)||[]}))};
   });success(res,data,'Cardápio consultado.');
  },
  createCategory:async(req,res)=>{const input=categoryInput(req.body);const data=await run(req,async conn=>{const [result]=await conn.execute('INSERT INTO categories(company_id,name,sort_order,active) VALUES (?,?,?,?)',[req.tenantId,input.name,input.sort_order,input.is_active]);const [[row]]=await conn.execute('SELECT id,company_id,name,sort_order,active,created_at FROM categories WHERE id=? AND company_id=?',[result.insertId,req.tenantId]);return categoryView(row);});success(res,data,'Categoria criada.',201);},
  createProduct:async(req,res)=>{
   const input=productInput(req.body);const data=await run(req,async conn=>{
    const [[category]]=await conn.execute('SELECT id FROM categories WHERE id=? AND company_id=? AND active=1 FOR UPDATE',[input.category_id,req.tenantId]);if(!category)throw new AdminError(404,'Categoria indisponível nesta loja.');
    const [result]=await conn.execute('INSERT INTO products(company_id,category_id,name,description,price,image_url,active) VALUES (?,?,?,?,?,?,?)',[req.tenantId,input.category_id,input.name,input.description,input.price,input.image_url,input.is_available]);
    if(input.groups.length){await conn.execute('INSERT INTO product_addons(product_id,config,version) VALUES (?,?,1)',[result.insertId,JSON.stringify(input.groups)]);await syncOptions(conn,req.tenantId,result.insertId,input.groups);}
    const [[row]]=await conn.execute('SELECT id,company_id,category_id,name,description,price,image_url,active,created_at FROM products WHERE id=? AND company_id=?',[result.insertId,req.tenantId]);return {...productView(row),addon_groups:input.groups,addon_version:input.groups.length?1:0};
   });success(res,data,'Produto criado.',201);
  },
  availability:async(req,res)=>{
   const id=positiveId(req.params.id),value=req.body?.is_available;if(typeof value!=='boolean')throw new AdminError(400,'Informe is_available como true ou false.');
   const data=await run(req,async conn=>{await locked(conn,req,id);await conn.execute('UPDATE products SET active=? WHERE id=? AND company_id=?',[value,id,req.tenantId]);return {id,tenant_id:req.tenantId,is_available:value};});success(res,data,value?'Produto disponível.':'Produto esgotado.');
  },
  remove:async(req,res)=>{const id=positiveId(req.params.id);const data=await run(req,async conn=>{await locked(conn,req,id);await conn.execute('UPDATE products SET active=0 WHERE id=? AND company_id=?',[id,req.tenantId]);return {id,tenant_id:req.tenantId,is_available:false,deleted:false,deactivated:true};});success(res,data,'Produto desativado; histórico de pedidos preservado.');}
 };
}
module.exports={positiveId,categoryInput,productInput,createTenantMenuController};
