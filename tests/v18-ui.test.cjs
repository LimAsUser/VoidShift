const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){const nodes=new Map(),node=key=>{if(!nodes.has(key))nodes.set(key,{textContent:'',value:'',checked:false,dataset:{},classList:{toggle(){}},setAttribute(){}});return nodes.get(key);};
 const c={window:{addEventListener(){},game:{canSelectMission:(_s,d)=>d!=='hard',advancedUnlockHint:()=> '需要资格通关'}},document:{querySelector:node,getElementById:node,querySelectorAll:()=>[]}};
 for(const f of ['config','ui','menu','game'])vm.runInNewContext(fs.readFileSync(`js/${f}.js`,'utf8'),c);
 return{...vm.runInNewContext('({Config,UIManager,SafehouseMenu,Game})',c),node,c};}
test('settings display saved volume and hint preference without changing gameplay progress',()=>{
 const {UIManager,node}=setup(),ui=Object.create(UIManager.prototype);assert.equal(typeof ui.updatePreferences,'function');
 ui.updatePreferences({masterVolume:25,ambientVolume:40,hideInteractionHints:true});
 assert.equal(node('masterVolume').value,'25');assert.equal(node('ambientVolume').value,'40');assert.equal(node('hideInteractionHints').checked,true);
});
test('profile renders true defeat totals separately from per-difficulty results',()=>{
 const {UIManager,node}=setup(),ui=Object.create(UIManager.prototype);ui.updatePersonalRecords({easy:{success:2,failure:3},defeats:{hunter:21,monster:9,heavy:4},advancedUnlocked:false});
 assert.equal(node('[data-defeats="hunter"]').textContent,'21');assert.equal(node('[data-defeats="monster"]').textContent,'9');assert.match(node('advancedUnlockStatus').textContent,/未解锁/);
});
test('locked hard choice is disabled and a locked map cannot become selected draft',()=>{
 const {UIManager,SafehouseMenu,node}=setup(),ui=Object.create(UIManager.prototype);ui.difficultyButtons={hard:node('hard'),medium:node('medium')};
 ui.updateDifficultyPreset('medium');assert.equal(ui.difficultyButtons.hard.disabled,true);
 const menu=Object.create(SafehouseMenu.prototype);menu.game={state:{coop:{}},canSelectMission:scale=>scale!=='large'};menu.mapDraft={scale:'medium'};menu._refreshMapDialog=()=>{};
 assert.equal(menu.selectDraftMapScale('large'),false);assert.equal(menu.mapDraft.scale,'medium');
});
