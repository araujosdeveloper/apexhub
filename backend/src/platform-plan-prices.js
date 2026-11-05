// Valores mensais explícitos em BRL. Nunca deduzir MRR do faturamento das lojas.
const planCode=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{1,39}$/.test(value);
function planPrices(input=process.env.PLAN_PRICES_JSON){
 if(input===undefined||input==='')input={};
 try{if(typeof input==='string')input=JSON.parse(input);if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).length>100)throw new Error();
  const prices=Object.create(null);for(const [code,amount]of Object.entries(input)){if(!planCode(code)||typeof amount!=='string'||!/^\d{1,6}\.\d{2}$/.test(amount))throw new Error();prices[code]=BigInt(amount.replace('.',''));}return Object.freeze(prices);
 }catch{throw new Error('PLAN_PRICES_JSON deve conter até 100 planos com preços mensais em strings decimais BRL, por exemplo {"starter":"99.90"}.');}
}
function money(cents){return (cents/100n).toString()+'.'+(cents%100n).toString().padStart(2,'0');}
function estimatedMrr(rows,prices){let known=0n,missing=0n,total=0n;for(const row of rows){const count=BigInt(row.total);total+=count;if(Object.hasOwn(prices,row.plan_code))known+=prices[row.plan_code]*count;else missing+=count;}return {mrr_estimate:missing===0n?money(known):null,mrr_known_amount:money(known),mrr_missing_price_subscriptions:Number(missing),active_subscriptions:Number(total),plan_prices_configured:Object.keys(prices).length>0};}
module.exports={planCode,planPrices,money,estimatedMrr};
