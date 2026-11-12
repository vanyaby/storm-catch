/* Штормовой улов — game flow, input, VR session, HUD */
import { THREE, S, V, UP, TAU, clamp, lerp, smooth, rand, damp, fmtKg, save, persist, UPG, lineStrength, knifeMult, SPECIES, SP, LURES, LU,
  renderer, scene, camera, rig, boat, TABLE, ICE, fishRoot, hPlane, PLAYER, DECK_SPOT, HOLSTER, Mat, ui, msg, setHint, resetHint, tickMsg, vrMsg,
  sfx, audioInit, audioUpdate, AU, splash, label, updateParts, updateFloaters, updateBirds, updateEnv, updateAnims, clearAnims, fly, iceContent, bucketContent } from './core.js';
import { CANNON, world } from './physics.js';
import { M, newFish, buildFish, scrape, descale } from './voxel.js';
import { items, pieceItems, addPiece, removeItem, registerTool, toHolster, HANDS, mainHand, offHand, buzzHand, updateHand, syncItems, updateLinks,
  collect, processSplits, knifeSweep, markCut, releaseOrgan, toIce, toBucket, onTable, boatPos, mouse, mouseGrab, mouseRelease, updateMouseGrab, links, edgeMats, handMatrixBoat } from './interact.js';
import { F, rod, rodItem, net, netItem, setCrankSide, setLureModel, tieLure, rodToDesk, rodOffDesk, rodInHand, deskHand, updateDeskRod, deskCast,
  fishingVR, updateFishing, updateRodLine, tryHook, liftOrNet, resetFishing, crank, forceHook } from './fishing.js';

/* ---------- knife ---------- */
function buildKnife(){
  const g=new THREE.Group();
  const h=new THREE.Mesh(new THREE.BoxGeometry(.024,.026,.12),Mat(0x5a3a22));h.position.z=.065;g.add(h);
  for(const z of [.03,.1]){const r=new THREE.Mesh(new THREE.CylinderGeometry(.004,.004,.026,5),Mat(0xc9c9c9,{metalness:.8}));r.rotation.z=Math.PI/2;r.position.set(0,0,z);g.add(r);}
  const s=new THREE.Shape();s.moveTo(0,.011);s.lineTo(.19,.006);s.lineTo(.235,-.006);s.lineTo(.2,-.02);s.lineTo(0,-.022);s.lineTo(0,.011);
  const bg=new THREE.ExtrudeGeometry(s,{depth:.0025,bevelEnabled:false});bg.rotateY(Math.PI/2);bg.translate(-.0012,0,0);
  g.add(new THREE.Mesh(bg,Mat(0xd8dde0,{metalness:.85,roughness:.22})));return g;
}
const knife=buildKnife();
const knifeItem=registerTool('knife',knife,b=>b.addShape(new CANNON.Box(new CANNON.Vec3(.013,.02,.13)),new CANNON.Vec3(0,0,-.05)),.25,HOLSTER.knife,V(0,0,0),new THREE.Quaternion());
knifeItem.follow=true;   // the knife trails the hand when it meets resistance
function buildScaler(){
  const g=new THREE.Group();const h=new THREE.Mesh(new THREE.BoxGeometry(.024,.024,.12),Mat(0x2f6b73));h.position.z=.06;g.add(h);
  const head=new THREE.Mesh(new THREE.BoxGeometry(.034,.008,.09),Mat(0xb9bdc1,{metalness:.8,roughness:.3}));head.position.set(0,-.004,-.05);g.add(head);
  for(let i=0;i<6;i++){const t=new THREE.Mesh(new THREE.BoxGeometry(.034,.008,.004),Mat(0x8d9397,{metalness:.8,roughness:.4}));t.position.set(0,-.011,-.015-i*.014);g.add(t);}
  return g;
}
const scaler=buildScaler();
const scalerItem=registerTool('scaler',scaler,b=>b.addShape(new CANNON.Box(new CANNON.Vec3(.017,.012,.11)),new CANNON.Vec3(0,0,-.01)),.15,HOLSTER.scaler,V(0,0,0),new THREE.Quaternion());
const SC_PTS=[V(0,-.014,-.03),V(0,-.014,-.055),V(0,-.014,-.08)];
const KN_EDGE=[];for(let i=0;i<=10;i++){const z=-.012-i*.0215;KN_EDGE.push(V(0,z<-.19?-.02+(-.19-z)*.35:-.0205,z));}
const KNIFE_TIP=V(0,-.012,-.228);
/* whetstone on the table: draw the blade across it to sharpen */
const STONE=V(TABLE.x-.3,TABLE.top+.012,TABLE.z-.62);
{const st=new THREE.Mesh(new THREE.BoxGeometry(.06,.024,.18),Mat(0x6b6f74,{roughness:1}));st.position.copy(STONE);boat.add(st);
 const base=new THREE.Mesh(new THREE.BoxGeometry(.08,.012,.2),Mat(0x5a3a22));base.position.copy(STONE).add(V(0,-.016,0));boat.add(base);}
S.sharp=1;

/* ---------- state ---------- */
const board={mode:'v',hY:.05,loading:false};
const walk={off:V(),yaw:0,turnCd:0,aim:null};
let nineWave={warned:false,t:0,hit:false,endT:-1},homeArm=0;

/* ---------- tutorial (VR) ---------- */
const TUT=[
  {k:['rod'],t:'Возьмите удочку из держателя у борта: поднесите руку и зажмите боковую кнопку'},
  {k:['cast'],t:'Зажмите курок, махните удилищем к морю и отпустите курок. Жёлтая дуга показывает, куда полетит'},
  {k:['crank'],t:'Свободной рукой возьмитесь за ручку катушки (она подсветится) и крутите кистью'},
  {k:['hook'],t:'Ждите. Лёгкие толчки — рыба пробует. Сильный рывок — дёрните удилище вверх'},
  {k:['landing'],t:'Крутите катушку. Кольцо на катушке: зелёное — тяните, жёлтое — осторожно, красное — ослабьте правым стиком'},
  {k:['netted','unhooked'],t:'Маленькую рыбу поднимите рывком удилища и возьмите рукой. Большую — подсаком с крюка у борта'},
  {k:['table'],t:'Отнесите рыбу на стол. Нож лежит у края стола'},
  {k:['open'],t:'Вспорите брюхо: проведите кончиком ножа неглубоко вдоль живота'},
  {k:['organ'],t:'Возьмите потроха рукой и бросьте в ведро. Поднимите рыбу — они свесятся сами'},
  {k:['ice'],t:'Отрежьте голову, снимите филе вдоль хребта и положите в ледник. Нож плашмя по коже снимает кожу'},
];
S.fn.tut=key=>{const st=TUT[save.tutorial];if(!st||!st.k.includes(key))return;save.tutorial++;persist();sfx.coin();if(save.tutorial>=TUT.length)msg('Обучение пройдено','Удачной рыбалки!',2);};
S.fn.onIce=(it,ev)=>{if(it.vobj.kind==='fish')S.fn.tut('ice');};

/* ---------- settings ---------- */
function segInit(attr,key,parse,cb){document.querySelectorAll(`[${attr}]`).forEach(b=>{const v=parse(b.getAttribute(attr));b.setAttribute('aria-pressed',String(v===save[key]));
  b.addEventListener('click',()=>{save[key]=v;persist();document.querySelectorAll(`[${attr}]`).forEach(x=>x.setAttribute('aria-pressed',String(x===b)));cb&&cb();});});}
segInit('data-reelmode','reelMode',String);segInit('data-rodhand','rodHand',String,()=>setCrankSide());segInit('data-move','move',String);segInit('data-detail','detail',String);
document.getElementById('bTut')?.addEventListener('click',()=>{save.tutorial=0;persist();msg('Обучение начнётся заново','',1.4);});
ui.bStart.addEventListener('click',()=>{audioInit();startTrip();});
ui.bView.addEventListener('click',()=>toggleView());ui.bIce.addEventListener('click',()=>clearBoard());ui.bHome.addEventListener('click',()=>goHome());ui.bMute.addEventListener('click',()=>toggleMute());
function toggleMute(){AU.muted=!AU.muted;ui.bMute.textContent=AU.muted?'Звук выкл · M':'Звук · M';}
if(navigator.xr&&navigator.xr.isSessionSupported){navigator.xr.isSessionSupported('immersive-vr').then(ok=>{if(ok)ui.bVR.hidden=false;}).catch(()=>{});}
ui.bVR.addEventListener('click',async()=>{
  audioInit();
  try{const s=await navigator.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor','bounded-floor']});await renderer.xr.setSession(s);
    rodOffDesk();if(!knifeItem.inHolster&&!knifeItem.heldBy)toHolster(knifeItem);knifeItem.desk=false;
    s.addEventListener('end',()=>{});if(S.gameState!=='sea')startTrip();
  }catch(e){ui.vrNote.textContent='VR в этом окне недоступен. Откройте игру по ссылке на GitHub Pages в браузере Quest.';}
});

/* ---------- VR controllers ---------- */
for(let i=0;i<2;i++){
  const ctl=renderer.xr.getController(i),grip=renderer.xr.getControllerGrip(i);rig.add(ctl,grip);
  const mitt=new THREE.Mesh(new THREE.BoxGeometry(.07,.045,.11),Mat(0xd4a24a,{roughness:.8}));mitt.position.z=.03;grip.add(mitt);
  const h={ctl,grip,mitt,src:null,held:null,prev:{a:false,b:false,x:false}};
  ctl.addEventListener('connected',e=>{h.src=e.data;HANDS[e.data.handedness==='left'?'left':'right']=h;h.name=e.data.handedness;});
  ctl.addEventListener('disconnected',()=>{for(const k in HANDS)if(HANDS[k]===h)HANDS[k]=null;});
}
const wristCanvas=document.createElement('canvas');wristCanvas.width=512;wristCanvas.height=320;
const wristTex=new THREE.CanvasTexture(wristCanvas);wristTex.colorSpace=THREE.SRGBColorSpace;
const wrist=new THREE.Mesh(new THREE.PlaneGeometry(.18,.1125),new THREE.MeshBasicMaterial({map:wristTex,transparent:true}));wrist.position.set(0,.05,.07);wrist.rotation.x=-1.0;
const panelCanvas=document.createElement('canvas');panelCanvas.width=1024;panelCanvas.height=640;
const panelTex=new THREE.CanvasTexture(panelCanvas);panelTex.colorSpace=THREE.SRGBColorSpace;
const vrPanel=new THREE.Mesh(new THREE.PlaneGeometry(1.6,1),new THREE.MeshBasicMaterial({map:panelTex,transparent:true,depthTest:false}));vrPanel.position.set(0,1.5,-1.4);vrPanel.renderOrder=20;vrPanel.visible=false;rig.add(vrPanel);
const tpMark=new THREE.Mesh(new THREE.RingGeometry(.18,.24,24),new THREE.MeshBasicMaterial({color:0x7fe0c0,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}));tpMark.rotation.x=-Math.PI/2;tpMark.visible=false;boat.add(tpMark);
const tpArcGeo=new THREE.BufferGeometry();tpArcGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(30*3),3));
const tpArc=new THREE.Points(tpArcGeo,new THREE.PointsMaterial({color:0x7fe0c0,size:.03}));tpArc.frustumCulled=false;tpArc.visible=false;scene.add(tpArc);

/* where you can stand: inside the hull outline, minus the table, ice box, crates, wheelhouse and mast */
const OBST=[[.94,1.66,-1.05,.41],[1.0,1.56,.53,1.03],[-.74,-.26,-.64,-.2],[-2.65,-1.05,-.9,.9],[-3.0,-2.5,-.45,.45],[2.33,2.47,-.07,.07]];
function deckOK(x,z){
  const m=.12;if(x<-2.95||x>3.1)return false;
  const w=x<1.4?1.18:1.18*(1-Math.pow((x-1.4)/2.3,1.6));if(Math.abs(z)>w-.06)return false;
  for(const [a,b,c,d] of OBST)if(x>a-m&&x<b+m&&z>c-m&&z<d+m)return false;
  return true;
}
function headLocal(){const c=camera.position.clone();c.y=0;c.applyAxisAngle(UP,walk.yaw);return PLAYER.clone().add(walk.off).add(c);}
function tryMove(dx,dz){
  const h=headLocal();
  if(!deckOK(h.x,h.z)){const d0=Math.hypot(h.x-PLAYER.x,h.z-PLAYER.z),d1=Math.hypot(h.x+dx-PLAYER.x,h.z+dz-PLAYER.z);if(d1<d0||deckOK(h.x+dx,h.z+dz)){walk.off.x+=dx;walk.off.z+=dz;}return;}
  if(deckOK(h.x+dx,h.z+dz)){walk.off.x+=dx;walk.off.z+=dz;}
  else if(deckOK(h.x+dx,h.z))walk.off.x+=dx;       // slide along what is in the way
  else if(deckOK(h.x,h.z+dz))walk.off.z+=dz;
}
function vrLocomotion(dt){
  const L=HANDS.left,R=HANDS.right;const lg=L&&L.src&&L.src.gamepad,rg=R&&R.src&&R.src.gamepad;
  const ax=g=>g?[g.axes.length>3?g.axes[2]:g.axes[0]||0,g.axes.length>3?g.axes[3]:g.axes[1]||0]:[0,0];
  const [lx,ly]=ax(lg),[rx,ry]=ax(rg);
  if(save.move==='smooth'){
    if(Math.hypot(lx,ly)>.2){const fw=camera.getWorldDirection(V());fw.y=0;fw.normalize();const rt=V(-fw.z,0,fw.x);
      const mv=fw.multiplyScalar(-ly*1.4*dt).addScaledVector(rt,lx*1.4*dt);tryMove(mv.x,mv.z);}
  }else if(L){
    if(ly<-.6){
      const o=L.ctl.getWorldPosition(V()),d=V(0,0,-1).applyQuaternion(L.ctl.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(6);
      const pa=tpArcGeo.attributes.position;const p=o.clone();let hit=null;
      for(let i=0;i<30;i++){pa.setXYZ(i,p.x,p.y,p.z);if(!hit){d.y-=9.8*.04;p.addScaledVector(d,.04);if(p.y<=boat.position.y){hit=p.clone();}}}
      pa.needsUpdate=true;tpArc.visible=true;walk.aim=null;tpMark.visible=false;
      if(hit){const bl=boat.worldToLocal(hit.clone());if(deckOK(bl.x,bl.z)){walk.aim=bl;tpMark.position.set(bl.x,.02,bl.z);tpMark.visible=true;}}
    }else if(walk.aim&&Math.abs(ly)<.3){
      const c=camera.position.clone().applyAxisAngle(UP,walk.yaw);c.y=0;walk.off.copy(walk.aim).sub(PLAYER).sub(c);walk.off.y=0;walk.aim=null;tpMark.visible=false;tpArc.visible=false;sfx.whoosh();
    }else{tpArc.visible=false;if(!walk.aim)tpMark.visible=false;}
  }
  walk.turnCd-=dt;
  if(Math.abs(rx)>.7&&walk.turnCd<=0){walk.turnCd=.35;const d=-Math.sign(rx)*Math.PI/6;const c=camera.position.clone();c.y=0;
    const rc=c.clone().applyAxisAngle(UP,walk.yaw+d).sub(c.clone().applyAxisAngle(UP,walk.yaw));walk.off.sub(rc);walk.yaw+=d;}
  else if(Math.abs(rx)<.3&&Math.abs(ry)>.5)F.drag=clamp(F.drag-ry*dt*.5,.2,1.4);
}
function vrButtons(dt){
  // A/X: put everything on the table into the ice box. Hold Y/B: go home.
  for(const h of Object.values(HANDS)){if(!h||!h.src||!h.src.gamepad)continue;const g=h.src.gamepad;
    const a=!!(g.buttons[4]&&g.buttons[4].pressed),b=!!(g.buttons[5]&&g.buttons[5].pressed);
    if(S.gameState==='port'){if(a&&!h.prev.a)startTrip();h.prev.a=a;continue;}
    if(a&&!h.prev.a)clearBoard();h.prev.a=a;
    if(b){h.bHeld=(h.bHeld||0)+dt;if(h.bHeld>1.5){h.bHeld=-99;endTrip('home');}}else h.bHeld=0;}
}
/* knife cutting in VR */
let prevEdge=null,kPrevT=null;
const _km=new THREE.Matrix4(),_kp=V(),_kq=new THREE.Quaternion(),_ks=V();
function vrKnife(dt){
  const h=knifeItem.heldBy;if(!h){prevEdge=null;kPrevT=null;return;}
  const who=h===mainHand()?'main':'off';
  handMatrixBoat(h,_km).decompose(_kp,_kq,_ks);
  const handSp=kPrevT?_kp.distanceTo(kPrevT)/Math.max(dt,1e-3):0;(kPrevT=kPrevT||V()).copy(_kp);
  knife.quaternion.copy(_kq);knife.updateMatrixWorld(true);
  // what is the blade sitting in? meat slows it, bone stops it unless you strike
  const cur=KN_EDGE.map(p=>knife.localToWorld(p.clone()));const r0=edgeMats(cur);
  const chop=handSp>2.2||(save.knife>=2&&handSp>1.4);
  // sharpening: the blade drawn over the stone
  const midW=knife.localToWorld(V(0,-.02,-.12));const sl=boat.worldToLocal(midW.clone());
  if(Math.abs(sl.x-STONE.x)<.05&&Math.abs(sl.z-STONE.z)<.11&&Math.abs(sl.y-STONE.y)<.035&&handSp>.15){
    const was=S.sharp;S.sharp=Math.min(1,S.sharp+dt*.35);h.st=(h.st||0)-dt;if(h.st<=0){h.st=.12;sfx.sharpen();buzzHand(who,.3,40);splash(midW,2,.6,.08);}
    if(was<1&&S.sharp>=1)msg('Нож наточен','',1);}
  const d=_kp.clone().sub(knife.position);const lag=d.length();
  let vmax=1e9;
  if(r0.n&&!chop){
    if(r0.bone)vmax=.06;
    else{const f=Math.min(1,r0.n/cur.length*2.5);let base=(r0.hard>r0.soft?.3:.5)*knifeMult()*(.35+.65*S.sharp);
      // along the fish (with the grain) the blade glides, across it drags
      if(r0.it&&handSp>.05){const ax=V(1,0,0).applyQuaternion(r0.it.obj.getWorldQuaternion(new THREE.Quaternion()));const mv=d.clone().normalize();base*=lerp(.8,1.35,Math.abs(ax.dot(mv)));}
      vmax=lerp(2.5,base,f)*(1+lag*10);}
  }
  if(lag>.3){knife.position.copy(_kp);knife.updateMatrixWorld(true);prevEdge=null;return;}     // pulled free, no cut
  const stepMax=vmax*dt;if(lag>stepMax)knife.position.addScaledVector(d,stepMax/lag);else knife.position.copy(_kp);
  knife.updateMatrixWorld(true);
  if(r0.n&&lag>.004){h.kt=(h.kt||0)-dt;if(h.kt<=0){h.kt=.045;buzzHand(who,clamp(.18+lag*5+(r0.bone?.35:0)+(r0.hard?.1:0),0,1),45);}}
  const now=KN_EDGE.map(p=>knife.localToWorld(p.clone()));
  if(prevEdge){
    const sp=now[now.length-1].distanceTo(prevEdge[prevEdge.length-1])/Math.max(dt,1e-3);
    if(sp>.02){
      const nW=V(1,0,0).applyQuaternion(knife.getWorldQuaternion(new THREE.Quaternion()));const flat=Math.abs(nW.dot(UP))>.8;
      const r=knifeSweep(prevEdge,now,{flat,chop});
      if(r.removed)S.cutOnLine=!flat;
      if(r.bone>2&&!chop&&handSp>.25){sfx.bone();}
      if(chop&&r.removed>20){sfx.crunch();buzzHand(who,1,70);}
      if(r.removed)S.sharp=Math.max(.2,S.sharp-r.removed*2.5e-6-(chop?.004:0));
      if(S.sharp<.45&&!S.dullWarned){S.dullWarned=true;msg('Нож затупился','Проведите лезвием по точилу на столе',2);}
      if(S.sharp>.8)S.dullWarned=false;
    }
  }
  prevEdge=now;
}
/* scaler: rub it over the skin, scales fly off */
let scPrev=null;
function vrScaler(dt){
  const h=scalerItem.heldBy;if(!h){scPrev=null;return;}
  const pts=SC_PTS.map(p=>scaler.localToWorld(p.clone()));
  if(scPrev&&pts[1].distanceTo(scPrev)>.004){
    for(const it of pieceItems()){if(it.vobj.kind!=='fish')continue;const box=new THREE.Box3().setFromObject(it.obj).expandByScalar(.03);if(!box.containsPoint(pts[1]))continue;
      const n=descale(it.vobj,pts,.017);if(n){it.vobj.flushMeshes();splash(pts[1],Math.min(4,1+(n>>4)),.9,.12);sfx.click(.07);buzzHand(h===mainHand()?'main':'off',.3,18);}}
  }
  scPrev=pts[1].clone();
}

/* ---------- desktop input ---------- */
const ptr={ndc:new THREE.Vector2(),down:false,hist:[],flickCd:0};
const canvas=renderer.domElement;
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{
  audioInit();if(S.gameState!=='sea')return;try{canvas.setPointerCapture(e.pointerId);}catch(_){}
  updPtr(e);
  if(e.button===2){if(S.view==='sea')onFlick();else pieceAction(e.shiftKey?'bucket':'ice');return;}
  if(e.button!==0)return;ptr.down=true;
  if(S.view==='sea'&&F.state==='ready'){if(!F.hasLure)msg('Нет приманки','Выберите её клавишами 1–5',1.6);else{F.state='wind';F.charge=0;}}
  if(S.view==='table')deskCutStart(e);
});
addEventListener('pointerup',e=>{if(e.button!==0)return;ptr.down=false;if(F.state==='wind'&&!renderer.xr.isPresenting)deskCast();if(S.view==='table')deskCutEnd();});
addEventListener('pointermove',e=>{updPtr(e);const now=performance.now();ptr.hist.push({t:now,y:e.clientY});while(ptr.hist.length&&now-ptr.hist[0].t>130)ptr.hist.shift();
  if(ptr.hist.length>1&&ptr.flickCd<=0&&S.gameState==='sea'&&S.view==='sea'){const dy=ptr.hist[0].y-e.clientY;if(dy>innerHeight*.11){ptr.flickCd=.35;ptr.hist.length=0;onFlick();}}});
function updPtr(e){ptr.ndc.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);}
canvas.addEventListener('wheel',e=>{e.preventDefault();if(S.gameState!=='sea')return;
  if(S.view==='table'&&board.mode==='h'){board.hY=clamp(board.hY+(e.deltaY<0?.003:-.003),.002,.3);sfx.click(.08);}
  else setDrag(F.drag+(e.deltaY<0?.05:-.05));},{passive:false});
const MODES={v:'Рез насквозь',slit:'Надрез',h:'Рез плашмя',s:'Снять кожу',sc:'Чистить чешую'},NEXT={v:'slit',slit:'h',h:'s',s:'sc',sc:'v'};
addEventListener('keydown',e=>{
  if(S.gameState!=='sea'){if(e.code==='Enter'&&S.gameState==='port')startTrip();return;}
  if(e.repeat)return;
  if(/^Digit[1-5]$/.test(e.code)){tieLure(LURES[+e.code.slice(5)-1].id);return;}
  switch(e.code){
    case 'Space':e.preventDefault();onFlick();break;
    case 'KeyE':case 'Tab':e.preventDefault();toggleView();break;
    case 'KeyQ':clearBoard();break;
    case 'KeyF':flipPiece();break;
    case 'KeyG':pullOrgansDesk();break;
    case 'KeyX':board.mode=NEXT[board.mode];if(board.mode==='h')autoHeight();sfx.click(.2);resetHint();msg(MODES[board.mode],{v:'Ведите мышью через рыбу от края до края',slit:'Неглубоко, вдоль живота, чтобы вскрыть брюхо',h:'Колесо мыши меняет высоту',s:'Водите мышью по коже',sc:'Водите мышью по коже: чешуя слетает, кожа остаётся'}[board.mode],1.3);break;
    case 'KeyR':goHome();break;
    case 'KeyM':toggleMute();break;
    case 'BracketRight':case 'Equal':setDrag(F.drag+.05);break;
    case 'BracketLeft':case 'Minus':setDrag(F.drag-.05);break;
  }
});
function setDrag(v){F.drag=clamp(Math.round(v*100)/100,.2,1.4);sfx.click(.2);}
function onFlick(){if(S.gameState!=='sea'||S.view!=='sea')return;if(F.state==='water')tryHook();else if(F.state==='landing')liftOrNet();}
function toggleView(){
  if(S.gameState!=='sea'||renderer.xr.isPresenting)return;if(F.state==='wind')F.state='ready';
  S.view=S.view==='sea'?'table':'sea';
  if(S.view==='table'){rodOffDesk();if(knifeItem.inHolster){scene.attach(knife);knifeItem.inHolster=false;knifeItem.desk=true;}}
  else{rodToDesk();if(knifeItem.desk){knifeItem.desk=false;toHolster(knifeItem);}desk.drag=null;desk.line.visible=false;mouseRelease();}
  ui.bView.textContent=S.view==='sea'?'К столу · E':'К борту · E';resetHint();
}
function goHome(){if(S.gameState!=='sea')return;if(homeArm>0){homeArm=0;endTrip('home');return;}homeArm=3;msg('Возвращаемся в порт?','Нажмите R ещё раз',3);ui.bHome.classList.add('warn');}

/* desktop knife: drag a line on the board */
const desk={drag:null,line:null};
{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));desk.line=new THREE.Line(g,new THREE.LineBasicMaterial({color:0xd0a54c,depthTest:false,transparent:true}));desk.line.renderOrder=16;desk.line.visible=false;desk.line.frustumCulled=false;scene.add(desk.line);}
const raycaster=new THREE.Raycaster();
const boardTopY=()=>fishRoot.getWorldPosition(V()).y;
function boardPointer(){raycaster.setFromCamera(ptr.ndc,camera);const y=boardTopY()+(board.mode==='h'?board.hY:.02);const t=(y-raycaster.ray.origin.y)/raycaster.ray.direction.y;if(!(t>0))return null;return raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction,t);}
function pieceMeshes(){const a=[];for(const it of pieceItems())it.obj.traverse(o=>{if(o.isMesh){o.userData.it=it;a.push(o);}});return a;}
function hitUnderCursor(){raycaster.setFromCamera(ptr.ndc,camera);return raycaster.intersectObjects(pieceMeshes(),false)[0]||null;}
function deskCutStart(e){
  if(e&&e.ctrlKey){const h=hitUnderCursor();if(h)mouseGrab(h.object.userData.it,h.point);return;}
  if(board.mode==='s'||board.mode==='sc')return;const p=boardPointer();if(p)desk.drag={a:p,b:p.clone(),na:ptr.ndc.clone(),nb:ptr.ndc.clone()};
}
function deskCutEnd(){
  if(mouse.it){mouseRelease();setTimeout(autoHeight,600);return;}
  const d=desk.drag;desk.drag=null;desk.line.visible=false;if(!d)return;
  const seg=d.b.clone().sub(d.a);seg.y=0;if(seg.length()<.02)return;
  const up=V(0,1,0),top=boardTopY();
  if(board.mode==='v'){
    const at=d.a.clone().setY(top+.35),ab=d.a.clone().setY(top-.004),bt=d.b.clone().setY(top+.35),bb=d.b.clone().setY(top-.004);
    const r=knifeSweep([at,ab],[bt,bb],{chop:true,kerf:.55});if(r.removed)sfx.chop();
  }else if(board.mode==='h'){
    const perp=V(-seg.z,0,seg.x).normalize().multiplyScalar(.5);const y=top+board.hY;
    const a1=d.a.clone().setY(y).sub(perp),a2=d.a.clone().setY(y).add(perp),b1=d.b.clone().setY(y).sub(perp),b2=d.b.clone().setY(y).add(perp);
    const r=knifeSweep([a1,a2],[b1,b2],{chop:false,kerf:.55});if(r.bone)sfx.bone();
  }else if(board.mode==='slit'){
    // a shallow cut exactly along the fish surface under the cursor path
    const meshes=pieceMeshes();const pts=[];const N=Math.max(10,Math.ceil(d.na.distanceTo(d.nb)/.01));const nd=new THREE.Vector2();
    for(let i=0;i<=N;i++){nd.lerpVectors(d.na,d.nb,i/N);raycaster.setFromCamera(nd,camera);const h=raycaster.intersectObjects(meshes,false)[0];pts.push(h?h.point.clone():null);}
    const dir=raycaster.ray.direction.clone();
    for(let i=0;i<N;i++){const p0=pts[i],p1=pts[i+1];if(!p0||!p1||p0.distanceTo(p1)>.05)continue;
      knifeSweep([p0.clone().addScaledVector(dir,-.01),p0.clone().addScaledVector(dir,.045)],[p1.clone().addScaledVector(dir,-.01),p1.clone().addScaledVector(dir,.045)],{chop:false,kerf:.55});}
  }
}
function deskSkin(){
  if(S.view!=='table'||!ptr.down||mouse.it||(board.mode!=='s'&&board.mode!=='sc'))return;
  const h=hitUnderCursor();if(!h)return;const it=h.object.userData.it;
  if(board.mode==='s'){if(scrape(it.vobj,[h.point],.012)){markCut(it);S.cutSound=.6;}}
  else if(descale(it.vobj,[h.point],.016)){it.vobj.flushMeshes();splash(h.point,2,.8,.12);sfx.click(.06);}
}
function pieceAction(where){const h=hitUnderCursor();if(!h)return;const it=h.object.userData.it;if(where==='bucket')toBucket(it);else toIce(it);}
function pullOrgansDesk(){
  if(S.view!=='table')return;const h=hitUnderCursor();let it=h&&h.object.userData.it;
  if(!it||!it.vobj.organs.length)it=pieceItems().find(p=>p.vobj.organs.length&&p.vobj.open);
  if(!it){const closed=pieceItems().find(p=>p.vobj.organs.length);msg(closed?'Брюхо ещё закрыто':'Потрохов нет',closed?'Сначала надрежьте живот: X → «Надрез»':'',1.8);return;}
  if(!it.vobj.open){msg('Брюхо ещё закрыто','Надрежьте живот: X → «Надрез»',1.8);return;}
  for(const org of [...it.vobj.organs]){const o=releaseOrgan(it,org,false);if(o){o.body.position.y+=.08;o.body.velocity.set(rand(-.3,.3),.8,rand(-.6,-.2));}}
  sfx.squelch();msg('Потроха вынуты','Икру и печень трески — в лёд (ПКМ), остальное — в ведро',2);
}
function flipPiece(){
  if(S.view!=='table')return;let it=hitUnderCursor()?.object.userData.it;
  if(!it){let bv=0;for(const p of pieceItems().filter(onTable)){if(p.body.mass>bv){bv=p.body.mass;it=p;}}}
  if(!it)return;const q=new CANNON.Quaternion();q.setFromAxisAngle(new CANNON.Vec3(0,0,1),Math.PI);
  it.body.quaternion=q.mult(it.body.quaternion);it.body.position.y+=.06;it.body.velocity.setZero();it.body.angularVelocity.setZero();it.body.wakeUp();sfx.slap();setTimeout(autoHeight,600);
}
function autoHeight(){
  let best=null,bv=0;for(const p of pieceItems().filter(onTable)){if(p.vobj.kind!=='fish')continue;if(p.body.mass>bv){bv=p.body.mass;best=p;}}
  if(!best)return;const ob=best.vobj;ob.g.updateMatrixWorld(true);fishRoot.updateMatrixWorld(true);const inv=fishRoot.matrixWorld.clone().invert();
  let top=-1e9,anyBone=false,maxY=-1e9;const c=V();
  for(let z=0;z<ob.nz;z++)for(let y=0;y<ob.ny;y++)for(let x=0;x<ob.nx;x++){const m=ob.m[ob.idx(x,y,z)];if(!m)continue;ob.center(x,y,z,c);c.applyMatrix4(ob.g.matrixWorld).applyMatrix4(inv);
    if(c.y>maxY)maxY=c.y;if(m===M.BONE){anyBone=true;if(c.y>top)top=c.y;}}
  board.hY=clamp(anyBone?top+ob.vs*.9:maxY*.5,.002,.3);
}
function updateDeskKnife(){
  hPlane.visible=S.view==='table'&&!renderer.xr.isPresenting&&board.mode==='h';hPlane.position.y=board.hY;
  if(S.view!=='table'||renderer.xr.isPresenting)return;
  if(mouse.it){raycaster.setFromCamera(ptr.ndc,camera);const t=(mouse.lift-raycaster.ray.origin.y)/raycaster.ray.direction.y;if(t>0)mouse.target.copy(boat.worldToLocal(raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction,t)));return;}
  const p=boardPointer();
  if(desk.drag&&p){desk.drag.b.copy(p);desk.drag.nb.copy(ptr.ndc);const pa=desk.line.geometry.attributes.position;pa.setXYZ(0,desk.drag.a.x,desk.drag.a.y+.005,desk.drag.a.z);pa.setXYZ(1,p.x,p.y+.005,p.z);pa.needsUpdate=true;desk.line.visible=true;}
  if(p&&knifeItem.desk){
    const dir=desk.drag?desk.drag.b.clone().sub(desk.drag.a):V(1,0,0);dir.y=0;const yaw=dir.lengthSq()>1e-5?Math.atan2(-dir.x,-dir.z):-Math.PI/2;
    const q=new THREE.Quaternion().setFromEuler(board.mode==='v'||board.mode==='slit'?new THREE.Euler(-.5,yaw+.25,0,'YXZ'):new THREE.Euler(-.08,yaw+.25,Math.PI/2,'YXZ'));
    knife.quaternion.copy(q);let base=p.clone();
    if(board.mode==='s'||board.mode==='sc'){const h=hitUnderCursor();if(h)base=h.point.clone();base.y+=ptr.down?.004:.04;knife.position.copy(base).sub(V(0,0,-.12).applyQuaternion(q));}
    else{if(!desk.drag)base.y+=.05;knife.position.copy(base).sub(KNIFE_TIP.clone().applyQuaternion(q));}
  }
  deskSkin();
}
/* desktop: the next fish lying on deck is carried to the table */
function loadBoard(it){
  board.loading=true;const ob=it.vobj;removeItem(it);
  fly(ob.g,boat,V(TABLE.x,TABLE.top+ob.fish.d.wmax+.06,TABLE.z),{dur:.7,arc:.35,endQ:new THREE.Quaternion().setFromAxisAngle(UP,Math.PI/2),onDone:()=>{board.loading=false;addPiece(ob);setTimeout(autoHeight,500);
    if(S.view==='table')msg(ob.fish.sp.name+' на доске','X — режим ножа: насквозь, надрез, плашмя, кожа',2);}});
}
function clearBoard(){
  if(S.gameState!=='sea')return;const t=pieceItems().filter(p=>onTable(p)&&!p.heldBy);
  if(!t.length){const w=pieceItems().find(p=>!p.heldBy);if(w)toIce(w);return;}
  for(const it of t)if(items.includes(it))toIce(it);
}

/* ---------- trip flow ---------- */
function clearGroup(g){while(g.children.length)g.remove(g.children[0]);}
function startTrip(){
  S.gameState='sea';S.tripT=0;S.storm=0;S.view='sea';walk.off.set(0,0,0);walk.yaw=0;
  ui.start.hidden=true;ui.port.hidden=true;ui.hud.hidden=false;vrPanel.visible=false;
  resetFishing();clearAnims();
  for(const it of pieceItems()){removeItem(it);it.obj.removeFromParent();it.vobj.dispose();}
  S.products.length=0;clearGroup(iceContent);clearGroup(bucketContent);board.loading=false;
  nineWave={warned:false,t:0,hit:false,endT:-1};
  if(renderer.xr.isPresenting){for(const t of [rodItem,netItem,knifeItem,scalerItem])if(!t.heldBy)toHolster(t);rodItem.desk=false;}
  else{rodToDesk();if(knifeItem.desk){knifeItem.desk=false;toHolster(knifeItem);}if(!netItem.heldBy)toHolster(netItem);}
  ui.bView.textContent='К столу · E';save.trips++;persist();
  msg('Отдать швартовы!','Тихая вода. Над косяком кружат чайки',2.6);resetHint();
}
function endTrip(reason){
  if(S.gameState!=='sea')return;S.gameState='port';ptr.down=false;
  if(reason!=='wave'){for(const it of pieceItems()){const ev=evaluateSafe(it);if(ev&&!ev.waste)S.products.push({sp:it.vobj.fish.sp,kg:ev.kg,kind:ev.kind+', с палубы',value:ev.value*.7});}}
  for(const it of pieceItems()){removeItem(it);it.obj.removeFromParent();}
  resetFishing();
  const total=S.products.reduce((a,p)=>a+p.value,0);save.money+=Math.round(total);persist();if(total>0)sfx.coin();
  renderPort(reason,total);ui.hud.hidden=true;ui.port.hidden=false;if(renderer.xr.isPresenting)drawVRPanel(reason,total);
}
import { evaluate } from './voxel.js';
function evaluateSafe(it){try{return evaluate(it.vobj);}catch(e){return null;}}
function groupedProducts(){const m=new Map();for(const p of S.products){const k=p.sp.id+'|'+p.kind;const g=m.get(k)||{sp:p.sp,kind:p.kind,n:0,kg:0,value:0};g.n++;g.kg+=p.kg;g.value+=p.value;m.set(k,g);}return [...m.values()].sort((a,b)=>b.value-a.value);}
function hintFor(s){return{mackerel:'стаи под чайками, блесна или воблер',perch:'средняя глубина, джиг',cod:'дайте джигу или донке лечь на дно',halibut:'донка на самом дне, когда начнёт штормить',tuna:'край шторма, воблер на быстрой проводке',eel:'сердце шторма, светящийся твистер'}[s.id];}
function renderPort(reason,total){
  const rows=groupedProducts().map(p=>`<tr><td>${p.sp.name}</td><td>${p.kind}</td><td class="num">${p.n}</td><td class="num">${fmtKg(p.kg)}</td><td class="num">${Math.round(p.value)}</td></tr>`).join('');
  const head=reason==='wave'?'Девятый вал смыл палубу':'Причал';
  const sub=reason==='wave'?'Всё, что лежало на палубе и столе, ушло за борт. Ледник уцелел.':S.products.length?'Улов взвешен и продан.':'Сегодня море ничего не дало. Бывает.';
  const jr=SPECIES.map(s=>{const j=save.journal[s.id];const c='#'+new THREE.Color(s.back).getHexString();
    return `<div class="jcard${j?'':' unk'}"><span class="sw" style="background:${j?c:'rgba(239,230,210,.2)'}"></span><b>${j?s.name:'Неизвестный вид'}</b><span>${j?`поймано ${j.n} · рекорд ${fmtKg(j.best)} кг`:hintFor(s)}</span></div>`;}).join('');
  const shop=Object.entries(UPG).map(([k,u])=>{const lvl=save[k],next=lvl+1,max=next>=u.vals.length;
    return `<div class="shopitem"><div><b>${u.name}</b><span class="pips">${u.vals.map((_,i)=>`<i class="${i<=lvl?'on':''}"></i>`).join('')}</span><p>${u.desc[lvl]}${max?'':`. Дальше: ${u.desc[next].toLowerCase()}`}</p></div>
      <button class="btn ghost" data-buy="${k}" type="button" ${max||save.money<u.cost[next]?'disabled':''}>${max?'Куплено':u.cost[next]+' монет'}</button></div>`;}).join('');
  ui.portCard.innerHTML=`<span class="eyebrow">Вылазка №${save.trips}</span><h1>${head}</h1><p class="lead">${sub}</p>
    ${S.products.length?`<div class="tablewrap"><table><thead><tr><th>Рыба</th><th>Что сдано</th><th class="num">Шт</th><th class="num">Кг</th><th class="num">Монет</th></tr></thead><tbody>${rows}</tbody></table></div>`:''}
    <div class="total"><span>Выручка <span class="big">${Math.round(total)}</span></span><span>В кассе: <b>${save.money}</b> монет</span></div>
    <h2>Лавка снастей</h2><div class="shop">${shop}</div><h2>Журнал видов</h2><div class="journal">${jr}</div>
    <div class="row"><button class="btn" id="bAgain" type="button">Выйти в море снова</button><span class="note">или Enter</span></div>`;
  ui.portCard.querySelectorAll('[data-buy]').forEach(b=>b.addEventListener('click',()=>{const k=b.dataset.buy,u=UPG[k],n=save[k]+1;if(save.money>=u.cost[n]){save.money-=u.cost[n];save[k]=n;persist();sfx.coin();renderPort(reason,total);}}));
  document.getElementById('bAgain').addEventListener('click',()=>startTrip());
}
function drawVRPanel(reason,total){
  const g=panelCanvas.getContext('2d');g.clearRect(0,0,1024,640);g.fillStyle='rgba(19,34,41,.94)';g.beginPath();g.roundRect(0,0,1024,640,36);g.fill();
  g.fillStyle='#d0a54c';g.font='600 30px "Golos Text",sans-serif';g.fillText('ВЫЛАЗКА №'+save.trips,60,80);
  g.fillStyle='#efe6d2';g.font='700 64px "Unbounded","Golos Text",sans-serif';g.fillText(reason==='wave'?'Девятый вал':'Причал',60,160);
  g.font='500 34px "Golos Text",sans-serif';let y=230;for(const p of groupedProducts().slice(0,7)){g.fillText(`${p.sp.name} · ${p.kind} ×${p.n} · ${Math.round(p.value)}`,60,y);y+=44;}
  g.fillStyle='#d0a54c';g.font='700 46px "Golos Text",sans-serif';g.fillText(`Выручка ${Math.round(total)} · в кассе ${save.money}`,60,560);
  g.fillStyle='#b3ab98';g.font='500 28px "Golos Text",sans-serif';g.fillText('Кнопка A или X: снова в море. Снасти покупаются в обычном окне',60,610);
  panelTex.needsUpdate=true;vrPanel.visible=true;
}
function stormEvents(dt){
  if(S.gameState!=='sea')return;
  if(!stormEvents.e1&&S.storm>.33){stormEvents.e1=true;msg('Край шторма','Небо свинцовое. Пошёл тунец',2.6);}
  if(!stormEvents.e2&&S.storm>.68){stormEvents.e2=true;msg('Сердце шторма','При молниях к поверхности поднимается грозовой угорь',3);}
  if(S.storm>=1){
    if(!nineWave.warned){nineWave.warned=true;nineWave.t=25;msg('Идёт девятый вал!','Уходите домой. Ледник уцелеет, палубу смоет',4);}
    else if(!nineWave.hit){nineWave.t-=dt;if(nineWave.t<=0){nineWave.hit=true;sfx.wave();S.shake=1.2;splash(boat.localToWorld(V(0,1.2,-1.4)),60,7,2);
      for(const it of pieceItems()){if(it.heldBy)continue;removeItem(it);fly(it.obj,scene,boat.localToWorld(V(rand(-2,2),-1,rand(-6,-3))),{dur:1.1,arc:1.2,spin:6,keepParent:true,onDone:()=>it.obj.removeFromParent()});}
      msg('Девятый вал!','Палубу смыло',2.5);nineWave.endT=3.5;}}
    else if(nineWave.endT>0){nineWave.endT-=dt;if(nineWave.endT<=0)endTrip('wave');}
  }
}

/* ---------- HUD ---------- */
let hudT=0,wristT=0;
function updateHUD(dt){
  tickMsg(dt);if(homeArm>0){homeArm-=dt;if(homeArm<=0)ui.bHome.classList.remove('warn');}
  hudT-=dt;if(hudT>0||S.gameState!=='sea')return;hudT=.1;
  ui.stormFill.style.width=(S.storm*100)+'%';
  ui.stormTxt.textContent=S.storm<.33?'тихая вода':S.storm<.68?'край шторма':S.storm<1?'сердце шторма':'девятый вал';
  const val=S.products.reduce((a,p)=>a+p.value,0);const deckN=pieceItems().filter(p=>!onTable(p)&&p.vobj.kind==='fish').length;
  ui.catchTxt.textContent=`В леднике ${S.products.length} · ${Math.round(val)} монет`+(deckN?` · на палубе ${deckN}`:'');
  ui.lureTxt.innerHTML=`Снасть: <b>${F.hasLure?LU[F.lureId].name:'нет'}</b> · 1–5 сменить`;
  const fight=F.state==='hooked'||F.state==='landing';ui.gauges.classList.toggle('on',fight||F.state==='water');
  const Sc=1.4;ui.gFill.style.height=clamp(F.tension/Sc,0,1)*100+'%';
  const t=F.tension/lineStrength();ui.gFill.style.background=t>.85?'var(--danger)':t>.6?'var(--brass)':'var(--sea)';
  ui.gDragMk.style.bottom=(F.drag/Sc*100)+'%';ui.gBrkMk.style.bottom=(lineStrength()/Sc*100)+'%';
  ui.gTen.textContent=Math.round(F.tension*100)+'%';ui.gDrag.textContent=Math.round(F.drag*100)+'%';ui.gLine.textContent=F.state==='water'?`глуб. ${Math.round(F.depth)} м`:'';
  ui.gStam.style.width=(fight&&F.fish?F.fish.stamina*100:0)+'%';
  if(S.view==='table'){
    const any=pieceItems().some(onTable);
    if(any)setHint('t-'+board.mode,{v:'<b>Рез насквозь.</b> Проведите <kbd>ЛКМ</kbd> через рыбу от края до края. ',slit:'<b>Надрез.</b> Ведите <kbd>ЛКМ</kbd> вдоль живота, чтобы вскрыть брюхо. ',h:'<b>Рез плашмя</b> по жёлтой плоскости, <kbd>колесо</kbd> меняет высоту. ',s:'<b>Снять кожу.</b> Водите <kbd>ЛКМ</kbd> по коже. ',sc:'<b>Чистить чешую.</b> Водите <kbd>ЛКМ</kbd> по коже: чешуя слетает, кожа светлеет. '}[board.mode]+'<kbd>X</kbd> режим, <kbd>G</kbd> достать потроха, <kbd>F</kbd> перевернуть, <kbd>Ctrl</kbd>+мышь поднять, <kbd>ПКМ</kbd> в лёд, <kbd>Shift</kbd>+<kbd>ПКМ</kbd> в ведро');
    else setHint('t-empty',board.loading?'Рыба ложится на доску…':'Стол пуст. <kbd>E</kbd> к борту');return;
  }
  switch(F.state){
    case 'ready':setHint('ready'+F.hasLure,F.hasLure?'Зажмите <kbd>ЛКМ</kbd> для замаха, отпустите для заброса. <kbd>1–5</kbd> сменить приманку':'Приманки нет. Привяжите новую: <kbd>1–5</kbd>');break;
    case 'wind':setHint('wind','Отпустите, чтобы забросить');break;case 'flying':setHint('fly','');break;
    case 'water':setHint(F.bite?'bite':'water',F.bite?'<b>Клюёт…</b> После сильного рывка — мышь резко вверх или <kbd>Пробел</kbd>':'Держите <kbd>ЛКМ</kbd>, чтобы подматывать. <kbd>E</kbd> к столу');break;
    case 'hooked':setHint('hooked','Держите <kbd>ЛКМ</kbd>, чтобы выбирать. <kbd>Колесо</kbd> — фрикцион. Красная шкала — ослабьте');break;
    case 'landing':setHint('landing','<b>Рыба у борта!</b> Мышь вверх или <kbd>Пробел</kbd>');break;
  }
}
function drawWrist(dt){
  wristT-=dt;if(wristT>0||!renderer.xr.isPresenting)return;wristT=.2;
  const g=wristCanvas.getContext('2d');g.clearRect(0,0,512,320);g.fillStyle='rgba(12,22,27,.88)';g.beginPath();g.roundRect(0,0,512,320,26);g.fill();
  g.fillStyle='#b3ab98';g.font='500 24px "Golos Text",sans-serif';g.fillText('ШТОРМ',22,38);g.fillStyle='rgba(239,230,210,.15)';g.fillRect(120,22,370,14);g.fillStyle='#d0a54c';g.fillRect(120,22,370*S.storm,14);
  const fight=F.state==='hooked'||F.state==='landing';const t=fight?F.tension/lineStrength():0;
  g.fillStyle='#b3ab98';g.fillText('НАТЯЖ.',22,74);g.fillStyle='rgba(239,230,210,.15)';g.fillRect(120,58,370,14);g.fillStyle=t>.85?'#e0473a':t>.6?'#f2c14e':'#4fd18b';g.fillRect(120,58,370*clamp(t,0,1),14);
  g.fillStyle='#efe6d2';g.font='600 26px "Golos Text",sans-serif';g.fillText(`Фрикцион ${Math.round(F.drag*100)}% · ${F.hasLure?LU[F.lureId].name:'без приманки'}`,22,112);
  const tut=TUT[save.tutorial];let text,col='#d0a54c';
  if(vrMsg.t>0){text=vrMsg.text;}else if(tut){text='Шаг '+(save.tutorial+1)+'/'+TUT.length+'. '+tut.t;col='#7fe0c0';}else text=vrHint();
  g.fillStyle=col;g.font='600 26px "Golos Text",sans-serif';const words=text.split(' ');let line='',y=152;
  for(const w of words){if(g.measureText(line+w).width>468){g.fillText(line,22,y);y+=32;line='';if(y>312)break;}line+=w+' ';}if(y<=312)g.fillText(line,22,y);
  wristTex.needsUpdate=true;
}
function vrHint(){
  if(knifeItem.heldBy)return `Острота ножа ${Math.round(S.sharp*100)}%. Вдоль рыбы режет легче, поперёк туже. В кость упирается: рубите резким ударом. Точило — на столе`;
  if(scalerItem.heldBy)return 'Водите чешуечисткой по коже: чешуя слетает. Рыба без чешуи стоит дороже';
  switch(F.state){case 'ready':return rodInHand()?(F.hasLure?'Зажмите курок, махните и отпустите':'Возьмите приманку из ящика и поднесите к кончику удилища'):'Удочка в держателе у борта, подсак слева от неё, нож у стола';
    case 'water':return F.bite?'Клюёт! Ждите рывка и подсекайте вверх':'Крутите катушку свободной рукой. Без проводки приманка тонет';
    case 'hooked':return 'Крутите катушку. Правый стик вверх-вниз: фрикцион';case 'landing':return 'Подсак у борта или рывок удилищем для мелкой рыбы';default:return '';}
}

/* ---------- desktop camera ---------- */
let viewBlend=0;const camSea=V(0,1.62,0),qSea=new THREE.Quaternion(),qTable=new THREE.Quaternion(),camTable=V();const _m1=new THREE.Matrix4();
function updateCamera(dt){
  if(renderer.xr.isPresenting)return;
  viewBlend=damp(viewBlend,S.view==='table'?1:0,6,dt);
  const nx=S.gameState==='sea'?ptr.ndc.x:Math.sin(S.T*.1)*.3,ny=S.gameState==='sea'?ptr.ndc.y:0;
  qSea.setFromEuler(new THREE.Euler(-.07+ny*.08,-nx*.2,0,'YXZ'));
  let L=.5;for(const it of pieceItems())if(onTable(it))L=Math.max(L,it.vobj.fish.len*.8);
  const tgt=V(TABLE.x,TABLE.top+.05,TABLE.z+.12).sub(PLAYER);const dir=V(-.72,.66,.12).normalize();camTable.copy(tgt).addScaledVector(dir,.4+.5*L);
  _m1.lookAt(camTable,tgt,UP);qTable.setFromRotationMatrix(_m1);
  camera.position.lerpVectors(camSea,camTable,viewBlend);camera.quaternion.slerpQuaternions(qSea,qTable,viewBlend);
  if(S.shake>0)camera.position.x+=Math.sin(S.T*50)*S.shake*.01;
  deskHand.visible=viewBlend<.5;
}

/* ---------- freshness, desktop table loading, tutorial "on the table" ---------- */
function updateDeck(dt){
  const seen=new Set();for(const it of pieceItems())seen.add(it.vobj.fish);for(const f of seen)f.fresh=Math.max(0,f.fresh-dt/300);
  if(!renderer.xr.isPresenting&&S.gameState==='sea'&&!board.loading&&!mouse.it&&!pieceItems().some(p=>onTable(p)&&p.vobj.kind==='fish')){
    const w=pieceItems().find(p=>p.vobj.kind==='fish'&&!p.vobj.cut&&!onTable(p)&&p.body.position.y<.4&&p.body.sleepState===CANNON.Body.SLEEPING);if(w)loadBoard(w);
  }
  if(renderer.xr.isPresenting&&pieceItems().some(p=>p.vobj.kind==='fish'&&onTable(p)&&!p.heldBy))S.fn.tut('table');
}

/* ---------- main loop ---------- */
const clock=new THREE.Clock();let stepDt=0;
function frame(){
  const dt=stepDt||Math.min(clock.getDelta(),.05);S.T+=dt;ptr.flickCd-=dt;
  updateEnv(dt);
  boat.updateMatrixWorld(true);
  rig.position.copy(boat.localToWorld(PLAYER.clone().add(walk.off)));rig.quaternion.setFromAxisAngle(UP,walk.yaw);
  if(S.shake>0)S.shake-=dt;
  const vr=renderer.xr.isPresenting;
  if(vr){
    if(HANDS.left&&wrist.parent!==HANDS.left.grip)HANDS.left.grip.add(wrist);
    if(S.gameState==='sea'){vrLocomotion(dt);for(const k of ['left','right']){const h=HANDS[k];if(h)updateHand(h,dt,h.src&&h.src.gamepad);}fishingVR(dt);vrKnife(dt);vrScaler(dt);}
    vrButtons(dt);
  }else{
    F.reel=S.gameState==='sea'&&S.view==='sea'&&ptr.down&&F.state!=='wind'&&F.state!=='ready'?1:0;
    if(S.view==='sea'&&rodItem.desk)updateDeskRod(dt,ptr.ndc);
  }
  if(S.gameState==='sea'){updateFishing(dt);updateDeck(dt);updateDeskKnife();stormEvents(dt);}
  updateMouseGrab(dt);
  world.step(1/60,dt,4);syncItems();updateLinks();collect(dt);processSplits(dt);
  updateCamera(dt);updateRodLine(dt);updateAnims(dt);updateParts(dt);updateFloaters(dt);updateBirds(dt);
  audioUpdate(dt,(F.state==='hooked')?F.tension/lineStrength():0);updateHUD(dt);drawWrist(dt);
  renderer.render(scene,camera);
}
rodToDesk();
renderer.setAnimationLoop(frame);
window.__game={scalerItem,scaler,vrScaler,deckOK,walk,descale,forceHook,liftOrNet,THREE,CANNON,S,F,camera,scene,boat,fishRoot,rig,HANDS,updateHand,vrKnife,fishingVR,knife,rod,net,board,items,pieceItems,world,save,mouse,links,knifeItem,rodItem,netItem,
  startTrip,endTrip,toIce,toBucket,knifeSweep,evaluate,autoHeight,
  step:n=>{stepDt=1/30;for(let i=0;i<n;i++)frame();stepDt=0;},
  spawnDeck:(id,L)=>{const sp=SP[id];const len=L||lerp(sp.len[0],sp.len[1],.5);const f=newFish(sp,len,Math.round(sp.k*len**3*100)/100);const ob=buildFish(f);boat.add(ob.g);ob.g.position.copy(DECK_SPOT).add(V(0,.15,0));ob.g.quaternion.setFromAxisAngle(UP,Math.PI/2);return addPiece(ob);}};
