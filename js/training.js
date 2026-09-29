/** Solo training owns borrowed state; it never writes a save or joins a room. */
const TRAINING_LESSONS = [
  { id:'move', title:'移动与冲刺', body:'用 WASD 到达地面标记，途中按 Shift 冲刺。体力耗尽后，要等回满才能再次使用。', objective:'移动到标记，并完成一次冲刺。', actions:['move','sprint','reach-marker'], point:'move', key:'WASD / Shift' },
  { id:'flashlight', title:'手电与噪音', body:'按 F 切换手电，观察视野及左上角噪音灯。走得越急、枪声越多，越容易引起注意。', objective:'实际切换一次手电。', actions:['flashlight'], key:'F' },
  { id:'door', title:'打开舱门', body:'沿标记靠近舱门，按 E 打开。等门完全打开后再通过。', objective:'打开入口通往补给区的指定门。', actions:['door'], key:'E' },
  { id:'pickup', title:'打开箱子搜刮', body:'前往补给工作间，靠近箱子按 E。左边是背包、右边是箱子；点击训练零件后取出，也可以拖进背包。搜刮不暂停世界。', objective:'从指定箱子取出训练零件。', actions:['pickup'], point:'supply', key:'E / 点击取出' },
  { id:'backpack', title:'背包整理', body:'按 B 打开背包，把一件物品拖到另一空格，再按 B 关闭。右键或 R 可以旋转适合旋转的物品。', objective:'打开背包、成功移动或旋转物品、关闭背包。', actions:['bag-open','rearrange','bag-close'], key:'B / 拖拽' },
  { id:'oxygen', title:'快捷补氧', body:'本节将训练氧气设为 50。按 C 开始使用背包内氧气瓶，2 秒后消耗一瓶并恢复 50 点氧气。期间移速为 40，射击、近战、翻滚或技能会中断。', objective:'完成 2 秒使用，消耗背包中的一瓶氧气瓶。', actions:['oxygen'], key:'C' },
  { id:'medkit', title:'快捷急救', body:'本节将训练生命设为 60。按 H 使用背包中的急救包，2 秒后恢复 40 生命；期间移速 40。普通受伤不中断，倒地或晕眩取消且不消耗。', objective:'按 H 并完成 2 秒急救。', actions:['medkit'], key:'H' },
  { id:'shooting', title:'瞄准、射击与装填', body:'跟随标记进入射击舱。按住鼠标右键瞄准，左键命中训练靶，再按 R 完成装填。射空和只按 R 不算完成。', objective:'瞄准命中指定靶体，并完成一次装填。', actions:['aimed-hit','reload'], enemy:'shooting', key:'右键 + 左键 / R' },
  { id:'slots', title:'切换主副武器', body:'本次借用冲锋枪和手枪。按 2 使用副武器，再按 1 使用主武器。借用装备不会永久解锁。', objective:'分别切换到副武器和主武器。', actions:['switch-sidearm','switch-primary'], key:'1 / 2' },
  { id:'melee', title:'无声近战', body:'靠近指定训练靶，按 V 用刀命中。近战消耗体力，但不会增加噪音。', objective:'用近战实际命中指定靶体。', actions:['melee-hit'], enemy:'melee', key:'V' },
  { id:'roll', title:'翻滚闪避', body:'本次借用翻滚被动。按住移动方向，再按 Space 完成一次有位移的翻滚；翻滚期间有短暂无敌。', objective:'在空地上完成一次翻滚。', actions:['roll'], key:'移动 + Space' },
  { id:'flash', title:'使用主动技能', body:'按 T 将闪光弹投到指定靶体附近。落地后 1 秒爆炸，必须实际闪到目标；自己也可能被闪到。', objective:'用闪光弹使指定靶体晕眩。', actions:['target-stunned'], enemy:'flash', key:'T' },
  { id:'hunter', title:'Hunter 实战', body:'进入标记位置后出现一只普通 Hunter。保持距离并击杀它。正式任务可能出现特殊特性，本节没有随机特性。', objective:'避让并击杀这只 Hunter。', actions:['hunter-defeated'], enemy:'hunter', key:'瞄准 / 射击' },
  { id:'monster-down', title:'让 Nightmare 休眠', body:'进入观察舱。Nightmare 受到一次有效命中就会暂时休眠，但不会真正死亡。必要时使用闪光弹控制距离。', objective:'命中 Nightmare，使其进入休眠。', actions:['monster-dormant'], enemy:'monster', key:'射击 / T' },
  { id:'monster-wake', title:'观察 Nightmare 苏醒', body:'保持距离，等待训练目标的 40 秒休眠结束。它会换到远离玩家、视野外的其他舱室；正式简单／中等／困难休眠为 40／30／20 秒。阅读卡片时计时暂停。', objective:'在安全距离观察 Nightmare 恢复行动。', actions:['monster-awake'], enemy:'monster-wake', key:'保持距离' },
  { id:'heavy-wall', title:'引导 Heavy 撞墙', body:'前往冲撞场标记。Heavy 会蓄力 2 秒并锁定方向；及时横移或翻滚，让它撞到实体墙。未晕眩时普通攻击无效。', objective:'让 Heavy 实际冲撞墙壁并晕眩。', actions:['heavy-wall'], enemy:'heavy', key:'移动 / Space' },
  { id:'heavy-kill', title:'攻击装甲失效窗口', body:'Heavy 撞墙后有 3 秒装甲失效。现在开始练习，用借用武器击杀它；没打完就再次引导撞墙，闪光弹也能制造攻击窗口。', objective:'击杀已经练习过撞墙的 Heavy。', actions:['heavy-defeated'], enemy:'heavy-kill', key:'射击 / T' },
  { id:'map', title:'使用战术地图', body:'按 M 打开地图，用滚轮缩放或拖动，再按 M 或 Esc 关闭。接下来有两个固定教学终端，标记会引导你经过正确的门。', objective:'打开、实际缩放或拖动、关闭地图。', actions:['map-open','map-manipulated','map-close'], key:'M / 滚轮 / 拖动' },
  { id:'terminal-1', title:'启动第一个终端', body:'靠近冲撞场内的指定终端按 E，按屏幕上的 WASD 序列完成。出错可以重新尝试，不需要重做前面的课程。', objective:'完成第一个教学终端。', actions:['terminal'], terminal:'training-terminal-1', key:'E / WASD' },
  { id:'terminal-2', title:'全部终端与停电', body:'前往撤离控制舱完成第二个终端。全部完成后会闪灯、停电并解锁撤离；训练中不会因此刷新增援。正式地图有 3／4／5 个终端。', objective:'完成第二个终端并解锁撤离。', actions:['terminal'], terminal:'training-terminal-2', key:'E / WASD' },
  { id:'rescue', title:'呼叫救援并撤离', body:'在撤离点按 E 呼叫救援，抵达后站入标记范围。教程等待 8 秒；正式简单／中等／困难等待 20／40／60 秒。训练不带出物资、不发奖励，也不解锁进阶模式。', objective:'呼叫救援，等待 8 秒并完成登船。', actions:['extraction','returned'], point:'evac', key:'E / 等待' }
];

class TrainingSession {
  constructor(game) {
    this.game = game;
    this.steps = TRAINING_LESSONS;
    this.step = 0;
    this.target = null;
    this.activated = false;
    this.backup = {};
    for (const key of ['state','map','player','monster','nightmares','hunters','heavies','backpack','remoteBackpack','storageBackpack','defeatLedger','defeatNames','rewardMission',
      'remotePlayers','remotePlayer','selectedStorageIds','selectedPackIds','selectedItemId','storageNextId',
      'nextHunterSpawnIndex','_menuPreviewMaps']) this.backup[key] = game[key];
    this.config = { currentScale:Config.currentScale, WORLD_W:Config.WORLD_W, WORLD_H:Config.WORLD_H };
  }

  static loanArmory() {
    const armory = Player.createDefaultArmory();
    armory.ownedWeapons.smg = true;
    armory.loadout = { primary:'smg', sidearm:'pistol' };
    armory.activeSlot = 'primary';
    for (const id of ['smg','pistol']) armory.weaponAmmo[id] = { magazine:Config.weapons[id].maxAmmo, reserve:Config.weapons[id].initialReserve };
    armory.ownedSkills.flashbang = true;
    armory.equippedSkill = 'flashbang';
    armory.ownedPassives.roll = true;
    armory.equippedPassive = 'roll';
    return armory;
  }

  open() {
    const g = this.game;
    g.state = { ...this.backup.state, missionMode:'training', money:0, armory:TrainingSession.loanArmory(),
      inventory:[], remoteInventory:[], storageItems:[], storageOverflowItems:[], storageCapacity:100,
      selectedDifficulty:'easy', difficultyProfiles:g._sanitizeDifficultyProfiles(),
      menuMapSeeds:{ ...this.backup.state.menuMapSeeds }, coop:{ ...this.backup.state.coop, role:null, running:false, members:[] } };
    g.state.hunterSettings = g._buildDifficultySettings('easy');
    g.state.finalTerminalSettings = g._finalTerminalSettings();
    g.player = new Player(); g.monster = new Monster(); g.hunters = []; g.heavies = [];
    g.backpack = BackpackManager.fromType('field'); g.remoteBackpack = BackpackManager.fromType('field');
    g.remotePlayers = new Map(); g.remotePlayer = null;
    g.selectedStorageIds = new Set(); g.selectedPackIds = new Set(); g.selectedItemId = null;
    g._initializeStorage();
    g.reset(true);
    this.initialScrap=JSON.parse(JSON.stringify(g.map.containers.flatMap(box=>box.items)));
    this.initialContainers=JSON.parse(JSON.stringify(g.map.containers));
    for (let i=0;i<3;i++) g.backpack.place({ ...Config.consumables.oxygenCanister, id:`training-oxygen-${i+1}`,
      itemId:'oxygen-canister', name:'训练借用氧气瓶', value:0, rarity:'common', rot:0 });
    g.backpack.place({ ...Config.consumables.medkit, id:'training-loan-medkit',itemId:'medkit',name:'训练借用急救包',value:0,rarity:'common' });
    g.state.inventory = g.backpack.items;
    g.start(true);
  }

  get lesson() { return this.steps[this.step]; }
  get progress() { return this.game.state.tutorial?.progress || {}; }

  clearTransient() {
    const g = this.game;
    if (g._inventoryCloseTimer) clearTimeout(g._inventoryCloseTimer);
    g._inventoryCloseTimer = null;
    g._cancelItemDrag();
    g.loot?.close();
    Object.assign(g.state, { keys:{}, fireHeld:false, activeQte:null, inventoryOpen:false, inventoryClosing:false,
      fullMapOpen:false, fullMapClosing:false, fullMapDragging:false, stabilized:false,
      bulletTraces:[], impactParticles:[], flashbangs:[], flashBursts:[], muzzleFlashes:[], muzzleFlashTimer:0 });
    const overlay = document.getElementById('inventoryOverlay');
    if (overlay) { overlay.style.display='none'; overlay.classList.remove('is-open','is-closing'); }
    g.ui.hideQTE(); g.ui.setFullMapVisible?.(false); g._clearEnemyEffects();
  }

  prepare(index) {
    const g = this.game;
    const carry = ((this.steps[index]?.id === 'monster-wake' && this.lesson?.id === 'monster-down') ||
      (this.steps[index]?.id === 'heavy-kill' && this.lesson?.id === 'heavy-wall')) ? this.target : null;
    this.step = index;
    this.clearTransient();
    const position = { x:g.player.x, y:g.player.y, angle:g.player.angle };
    g.player.reset(g.map, TrainingSession.loanArmory(), 'primary');
    Object.assign(g.player, position);
    g.state.armory = g.player.armory;
    g.monster = new Monster(); g.monster.reset(g.map); g.monster.active=false;
    g.hunters=[]; g.heavies=[]; g.state.heavies=g.heavies;
    this.target=null; this.activated=false; this.rollStart=null; this.doorRequested=false;
    g.state.tutorial = { active:true, paused:true, step:index, progress:{}, steps:this.steps };
    this.ensurePrerequisites();
    this.createTarget(carry);
    this.checkpoint = this.capture();
    this.updateGoal();
    g.ui.showTutorialCard(this.lesson,index,this.steps.length);
    g.ui.updateSkillReadout?.(g.player,g.state);
    g.ui.updateWeaponReadout?.(g.player);
  }

  ensurePrerequisites() {
    const g=this.game, id=this.lesson.id;
    const original=this.initialScrap.find(item=>item.id==='training-part');
    if (id==='pickup') {
      const carried=g.backpack.items.find(item=>String(item.id).replace(/^carry:/,'')==='training-part');
      if (carried) g.backpack.removeItem(carried);
      g.map.containers=JSON.parse(JSON.stringify(this.initialContainers));g.loot?.reset();
    }
    if (id==='backpack' && !g.backpack.items.length) {
      g.backpack.place({ ...original, found:true, foundThisRun:false });
      const floor=g.map.scrap.find(item=>item.id==='training-part');if(floor)floor.found=true;
    }
    if (id==='oxygen') {
      g.player.oxygen=50;
      if (!g.backpack.items.some(item=>item.effect==='oxygen-50')) g.backpack.place({ ...Config.consumables.oxygenCanister,
        id:'training-lesson-oxygen',itemId:'oxygen-canister',name:'训练借用氧气瓶',value:0,rarity:'common',rot:0 });
    }
    if (id==='medkit') {
      g.player.health=60;
      if (!g.backpack.items.some(item=>item.effect==='health-40')) g.backpack.place({ ...Config.consumables.medkit,
        id:'training-lesson-medkit',itemId:'medkit',name:'训练借用急救包',value:0,rarity:'common',rot:0 });
    }
    g.state.inventory=g.backpack.items;
  }

  createTarget(carry = null) {
    const g = this.game, mode=this.lesson.enemy;
    if (!mode) return;
    const points=g.map.trainingPoints;
    if (mode.startsWith('monster')) {
      this.target=carry || new Monster();
      this.target.recoveryDuration=40;
      if (!carry) { this.target.reset(g.map); Object.assign(this.target,points.monsterSpawn,{active:false,alerted:true}); }
      g.monster=this.target; this.entryPoint=points.monsterEntry;
    } else if (mode.startsWith('heavy')) {
      this.target=carry || new Heavy(5);
      if (!carry) { this.target.reset(g.map,5); Object.assign(this.target,points.heavySpawn,{active:false,alerted:true}); }
      this.target.id='training-heavy';g.heavies=[this.target];g.state.heavies=g.heavies;
      this.entryPoint=points.heavyEntry;
    } else {
      const dummy=mode!=='hunter';
      this.target=new Hunter(0,dummy && mode==='shooting'?24:mode==='hunter'?2:1,()=>1);
      this.target.reset(g.map,dummy && mode==='shooting'?24:mode==='hunter'?2:1);
      Object.assign(this.target,dummy?points.target:points.hunterSpawn,{active:false,alerted:!dummy,trait:null,trainingDummy:dummy});
      g.hunters=[this.target];this.entryPoint=points.firing;
    }
    if (carry) this.activated=true;
  }

  capture() {
    const g=this.game;
    return { player:{x:g.player.x,y:g.player.y,angle:g.player.angle,oxygen:g.player.oxygen,health:g.player.health}, elapsed:g.state.elapsed,
      containers:JSON.parse(JSON.stringify(g.map.containers)),
      inventory:JSON.parse(JSON.stringify(g.backpack.items)), scrap:JSON.parse(JSON.stringify(g.map.scrap)),
      doors:g.map.doors.map(door=>({open:door.open,targetOpen:door.targetOpen,animationProgress:door.animationProgress,
        openDir:door.openDir,autoClosing:door.autoClosing,autoCloseTimer:door.autoCloseTimer})),
      solved:g.map.terminals.map(terminal=>terminal.solved), powerLossStartedAt:g.state.powerLossStartedAt,
      finalTerminalPressure:g.state.finalTerminalPressure,
      target:this.target?Object.fromEntries(['x','y','angle','hp','maxHp','active','dead','alerted','recoverTimer','shotCount',
        'phase','phaseTimer','stunTimer','chargeAngle','flashStunTimer'].map(key=>[key,this.target[key]])):null };
  }

  retry(message='本节已重置，之前的课程仍然保留。') {
    if (!this.checkpoint) return;
    const g=this.game, checkpoint=this.checkpoint;
    this.clearTransient();
    g.player.reset(g.map,TrainingSession.loanArmory(),'primary');Object.assign(g.player,checkpoint.player);
    g.state.armory=g.player.armory;
    g.backpack.items=JSON.parse(JSON.stringify(checkpoint.inventory));g.state.inventory=g.backpack.items;
    g.map.scrap=JSON.parse(JSON.stringify(checkpoint.scrap));
    g.map.containers=JSON.parse(JSON.stringify(checkpoint.containers));g.loot?.reset();
    g.map.doors.forEach((door,index)=>Object.assign(door,checkpoint.doors[index]));
    g.map.terminals.forEach((terminal,index)=>{terminal.solved=checkpoint.solved[index];});
    Object.assign(g.state,{elapsed:checkpoint.elapsed,powerLossStartedAt:checkpoint.powerLossStartedAt,
      finalTerminalPressure:checkpoint.finalTerminalPressure,extractionCalled:false,rescueRemaining:0,rescueArrived:false});
    g.monster=new Monster();g.monster.reset(g.map);g.monster.active=false;g.hunters=[];g.heavies=[];g.state.heavies=g.heavies;
    this.target=null;this.activated=false;this.rollStart=null;this.doorRequested=false;
    this.createTarget();
    if (this.target && checkpoint.target) { Object.assign(this.target,checkpoint.target);this.activated=!!this.target.active; }
    g.state.tutorial={active:true,paused:true,step:this.step,progress:{},steps:this.steps};
    g.state.lastTime=performance.now();g.state.nextFrameAt=0;
    this.updateGoal();g.updateInventoryUI();g.ui.updateWeaponReadout?.(g.player);g.ui.updateSkillReadout?.(g.player,g.state);
    g.ui.updateTerminalsStatus?.(g.map.terminals);g.ui.showTutorialCard(this.lesson,this.step,this.steps.length);g.ui.showToast(message);
  }

  action(action, detail={}) {
    const g=this.game, tutorial=g.state.tutorial;
    if (!tutorial || tutorial.paused) return;
    const lesson=this.lesson;
    if (action==='roll-start') { this.rollStart={x:g.player.x,y:g.player.y};return; }
    if (!lesson.actions.includes(action)) return;
    if (action==='door') { if (detail.id!==g.map.trainingDoor.id) return;this.doorRequested=true;return; }
    if (action==='pickup' && String(detail.id)!=='training-part') return;
    if (action==='rearrange' && !detail.changed) return;
    if (['oxygen','medkit'].includes(action) && !(detail.after>detail.before && detail.consumed)) return;
    if (['aimed-hit','melee-hit'].includes(action) && (detail.target!==this.target || !detail.hit?.hit ||
        (action==='aimed-hit' && !detail.aiming))) return;
    if (action==='target-stunned' && (detail.target!==this.target || !(this.target.flashStunTimer>0))) return;
    if (action==='roll' && (!this.rollStart || Math.hypot(g.player.x-this.rollStart.x,g.player.y-this.rollStart.y)<40)) return;
    if (action==='terminal' && detail.id!==lesson.terminal) return;
    if (action==='heavy-wall' && detail.target!==this.target) return;
    if (action==='monster-awake' && detail.target!==this.target) return;
    tutorial.progress[action]=true;
  }

  tick() {
    const g=this.game, tutorial=g.state.tutorial;
    if (!tutorial || tutorial.paused || !g.state.running) return;
    if (g.player.health<=0 || g.player.oxygen<=0) { this.retry('训练中断：已恢复本节起点与补给。');return; }
    const progress=tutorial.progress, id=this.lesson.id;
    if (id==='move' && Math.hypot(g.player.x-g.map.trainingPoints.move.x,g.player.y-g.map.trainingPoints.move.y)<28) progress['reach-marker']=true;
    if (id==='door' && this.doorRequested && g.map.trainingDoor.open) progress.door=true;
    if (id==='oxygen' && !progress.oxygen) g.player.oxygen=50;
    if (id==='medkit' && !progress.medkit) g.player.health=60;
    if (this.target && !this.activated && Math.hypot(g.player.x-this.entryPoint.x,g.player.y-this.entryPoint.y)<52) {
      this.target.active=true;this.activated=true;
    }
    if (id==='hunter' && this.target?.dead) progress['hunter-defeated']=true;
    if (id==='monster-down' && this.target?.recoverTimer>0) progress['monster-dormant']=true;
    if (id==='heavy-wall' && this.target?.dead) {this.retry('先练习引导撞墙；目标和弹药已恢复。');return;}
    if (id==='heavy-kill' && this.target?.dead) progress['heavy-defeated']=true;
    if (this.lesson.actions.every(action=>progress[action]) && this.step<this.steps.length-1) this.prepare(this.step+1);
    this.updateGoal();
  }

  canUseTerminal(terminal) { return !this.game.state.tutorial?.paused && terminal.id===this.lesson.terminal; }

  updateGoal() {
    const g=this.game, lesson=this.lesson;
    if (!lesson) return;
    let point=g.player, kind='marker', label=lesson.objective;
    if (lesson.point) point=g.map.trainingPoints[lesson.point];
    if (lesson.id==='door') {const door=g.map.trainingDoor;point={x:(door.p1.x+door.p2.x)/2,y:(door.p1.y+door.p2.y)/2};kind='door';}
    if (lesson.id==='pickup') {point=g.map.containers.find(box=>box.id==='training-crate')||point;kind='pickup';}
    if (this.target) {point=this.activated?this.target:this.entryPoint;kind=this.activated?'target':'marker';label=this.activated?lesson.objective:'进入训练标记，准备当前目标';}
    if (lesson.terminal) {point=g.map.terminals.find(terminal=>terminal.id===lesson.terminal);kind='terminal';}
    if (lesson.id==='rescue') kind='evac';
    if (!point) return;
    let goal={x:point.x,y:point.y,label,kind,key:lesson.key};
    const from=getNavigationRoom(g.map,g.player.x,g.player.y), to=getNavigationRoom(g.map,point.x,point.y);
    if (from && to && from!==to) {
      const path=bfsRoomPath(from,to), door=path[0]?.door;
      if (door) goal={x:(door.p1.x+door.p2.x)/2,y:(door.p1.y+door.p2.y)/2,
        label:`经过此门前往：${to.title || lesson.title}`,kind:'door',key:door.open?'WASD':'E'};
    }
    g.state.trainingGoal=goal;
  }

  finish(success) {
    if (!success) {this.retry('训练中断：只需重试当前课程。');return;}
    const g=this.game;
    if (this.lesson.id!=='rescue' || !g.state.rescueArrived || g.map.terminals.some(terminal=>!terminal.solved)) return;
    const summary={completed:this.steps.length,total:this.steps.length,elapsedSeconds:g.state.elapsed};
    this.exit();g.ui.showTrainingComplete?.(summary);
  }

  exit() {
    const g=this.game;
    this.clearTransient();
    if (g.state.descentTimer) clearTimeout(g.state.descentTimer);
    g.state.running=false;g.audio.stopMissionAudio?.();g.ui.hideDescentTransition();g.ui.hideTutorial();g.ui.setPauseMenuVisible?.(false);
    document.body.classList.remove('in-dive');
    for (const [key,value] of Object.entries(this.backup)) g[key]=value;
    Object.assign(Config,this.config);
    g.state.keys={};g.state.fireHeld=false;g.trainingSession=null;
    g._bindBackpackInventories();
    g.loot?.reset();
    g.ui.updateResetState();
    g.ui.updateFpsCap?.(g.state.fpsCap);g.ui.updateCorpseLimit?.(g.state.corpseLimit);
    g.updateMoneyUI();g.updateStorageUI();g.updateLoadoutUI();g.updateDifficultyUI();g.updateHunterSettingsUI();
    g.updateTutorialAvailability();g.updateCoopUI();g.ui.updateTrainingGoal?.(g.player,null);g.handleResize();
  }
}
