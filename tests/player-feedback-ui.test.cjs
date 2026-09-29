const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
function element(){return {children:[],dataset:{},style:{},attributes:{},events:{},classList:{toggle(){},add(){},remove(){}},
 append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);},replaceChildren(...children){this.children=children;},
 setAttribute(key,value){this.attributes[key]=String(value);},addEventListener(name,fn){this.events[name]=fn;}};}
function fixture(){const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const categories=['weapons','ammo','supplies','skills','passives'];
 const buttons=categories.map(category=>Object.assign(element(),{dataset:{shopCategory:category}}));
 const panels=categories.map(category=>Object.assign(element(),{dataset:{shopPanel:category}}));
 const doc={getElementById:get,createElement:element,querySelector:()=>null,querySelectorAll:selector=>selector==='[data-shop-category]'?buttons:selector==='[data-shop-panel]'?panels:[]};
 const ctx=vm.createContext({window:{addEventListener(){},switchTab:()=>{}},document:doc,Map,Date});
 for(const f of ['config','inventory','rewards','entities','game','ui','menu'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',f+'.js'),'utf8'),ctx);
 const classes=vm.runInContext('({Game,Player,SafehouseMenu,UIManager,Config})',ctx);return{...classes,ctx,doc,get,buttons,panels};}
test('shop categories make supplies directly accessible and weapon purchases use actual game economics',()=>{
 const f=fixture(),g=Object.create(f.Game.prototype);g.player=new f.Player();g.state={money:10000,running:false,coop:{},selectedDifficulty:'easy'};
 g.ui={};for(const key of ['_save','updateMoneyUI','updateLoadoutUI','updateAmmoDepotUI','_notifyTransaction'])g[key]=()=>{};
 const menu=Object.create(f.SafehouseMenu.prototype);menu.game=g;g.menu=menu;
 menu.selectShopCategory('supplies');assert.equal(f.get('ammoSectionOxygen').hidden,false);assert.equal(f.get('ammoSectionPurchase').hidden,true);
 assert.equal(f.buttons.find(b=>b.dataset.shopCategory==='supplies').attributes['aria-selected'],'true');
 menu.selectAmmoSection('transfer');assert.equal(f.get('ammoSectionTransfer').hidden,false);assert.equal(f.get('ammoSectionOxygen').hidden,true);
 const buy=menu.shopCards.get('weapon:smg').button;buy.events.click();assert.equal(g.state.money,5750);assert.equal(g.player.armory.ownedWeapons.smg,true);
 assert.equal(g.player.armory.loadout.primary,null);assert.equal(buy.disabled,true);
});
test('LOADOUT locked abilities open the matching shop instead of buying in place',()=>{
 const f=fixture(),armory=f.Player.createDefaultArmory(),ui=Object.create(f.UIManager.prototype),selected=[];
 ui.loadoutLockNote=element();ui.abilityCatalogs={skill:element(),passive:element()};ui.abilityCards={skill:{},passive:{}};
 ui.setCurrencyValue=()=>{};f.ctx.window.menu={openShop:category=>selected.push(category)};
 ui.updateAbilities({armory,skillReadyAt:0},{money:0,elapsed:0,coop:{}});
 const button=ui.abilityCards.skill.flashbang.purchase;assert.equal(button.disabled,false);button.events.click();
 assert.deepEqual(selected,['skills']);assert.equal(armory.ownedSkills.flashbang,false);
});
test('page has unique IDs, working reward and supply hooks, and referenced new art',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(new Set(ids).size,ids.length);
 for(const id of ['openRewardsButton','claimDailyRewardButton','shopWeaponsCatalog','shopSkillsCatalog','shopPassivesCatalog','purchaseMedkitButton','lootContainerGrid','pauseCrewList','rewardSettlementRows','hudMedkitCount'])assert.ok(ids.includes(id),id);
 for(const file of ['medkit.png','loot-crate.png']){const bytes=fs.readFileSync(path.join(__dirname,'../resources/images',file));assert.equal(bytes.subarray(1,4).toString(),'PNG');}
});

test('Nightmare threat status considers every active enemy and does not label an active chase disengaged',()=>{
 const {UIManager}=fixture();assert.equal(typeof UIManager.nightmareThreat,'function');
 assert.equal(UIManager.nightmareThreat([{active:true,alerted:false},{active:true,alerted:true}]).text,'已锁定');
 assert.equal(UIManager.nightmareThreat([{active:true,alerted:true,recoverTimer:30},{active:true,alerted:false,recoverTimer:40}]).text,'休眠中');
 assert.equal(UIManager.nightmareThreat([]).text,'未知');
});

test('menu refresh keeps locked weapons navigable to the shop even with zero credits',()=>{
 const f=fixture(),g=Object.create(f.Game.prototype);g.player=new f.Player();g.state={money:0,running:false,transitioning:false,selectedDifficulty:'easy',coop:{running:false},storageOverflowItems:[]};
 g.ui={setCurrencyValue(){},loadoutCards:{},loadoutPurchaseButtons:{smg:element()},ammoPurchaseAmount:{value:100},ammoPurchaseButton:element()};
 g.getAmmoLossWarning=()=>'';g.getMenuPreviewMap=()=>({enemyTypes:['hunter']});g.updateEquipmentUI=()=>{};
 f.doc.querySelector=()=>element();const menu=Object.create(f.SafehouseMenu.prototype);menu.game=g;
 menu.updateSelection=menu.updateLobby=menu.resizeGrids=()=>{};
 menu.refresh();assert.equal(g.ui.loadoutPurchaseButtons.smg.disabled,false);assert.equal(g.ui.loadoutPurchaseButtons.smg.textContent,'前往商店');
});

test('latency labels distinguish host-local, measured peer and unknown rather than inventing zero',()=>{
 const {UIManager}=fixture();const coop={role:'host',members:[{id:'p2',connected:true}],latencies:{}};
 assert.equal(UIManager.formatLatency(coop,'host'),'本机');assert.equal(UIManager.formatLatency(coop,'p2'),'—');
 coop.latencies.p2=87;assert.equal(UIManager.formatLatency(coop,'p2'),'87 ms');
 coop.members[0].connected=false;assert.equal(UIManager.formatLatency(coop,'p2'),'—');
 coop.role='guest';assert.equal(UIManager.formatLatency(coop,'host'),'房主端');
});
