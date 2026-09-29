const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const ctx=vm.createContext({window:{},EventTarget,TextEncoder,TextDecoder,Uint8Array,Date,Map,atob,btoa});vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/network.js'),'utf8'),ctx);
const Codec=vm.runInContext('typeof ReliableChunks === "undefined"?null:ReliableChunks',ctx);
test('large reconnect payloads split below 32KB and apply only after every chunk arrives',()=>{
 assert.ok(Codec,'reliable chunk codec exists');const payload={type:'rejoin-state',containers:Array.from({length:120},(_,id)=>({id,items:Array.from({length:5},(_,n)=>({id:`${id}:${n}`,name:'急救包回收物资'.repeat(24)}))}))};
 const parts=Codec.encode(payload,'transfer1');assert.ok(parts.length>1);assert.ok(parts.every(part=>new TextEncoder().encode(part).length<=32768));
 const decoder=new Codec();for(let i=parts.length-1;i>0;i--)assert.equal(decoder.accept(JSON.parse(parts[i])),null);
 assert.equal(JSON.stringify(decoder.accept(JSON.parse(parts[0]))),JSON.stringify(payload));
 assert.equal(decoder.accept(JSON.parse(parts[0])),null);
});
test('inconsistent, overbudget, duplicate chunks never produce a partial payload',()=>{
 assert.ok(Codec);const decoder=new Codec();
 for(const message of [{type:'reliable-chunk',id:'bad',count:99999,index:0,data:'e30='},
  {type:'reliable-chunk',id:'bad',count:2,index:-1,data:'e30='},
  {type:'reliable-chunk',id:'bad',count:2,index:0,data:'!!'}])assert.equal(decoder.accept(message),null);
 assert.equal(decoder.pending.size,0);
});
