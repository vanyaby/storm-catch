/* Fishing: rod you pick up, cast with an arc preview, reel by hand, tension ring on the reel, landing net. */
import { THREE, S, V, UP, TAU, clamp, lerp, smooth, rand, pick, damp, save, persist, lineStrength, reelMult, scene, rig, camera, renderer, boat,
  RAIL, DECK_SPOT, HOLSTER, SPECIES, LU, LURES, lureModel, tackleSlots, hotspot, wind, waveH, Mat, sfx, msg, label, fmtKg, splash, fly } from './core.js';
import { CANNON, world } from './physics.js';
import { items, registerTool, toHolster, HANDS, mainHand, offHand, buzzHand, addPiece, removeItem, handMatrixBoat, grabPiece } from './interact.js';
import { newFish, buildFish } from './voxel.js';

export const F={state:'ready',lure:V(),lureVel:V(),depth:0,charge:0,bite:null,fish:null,tension:0,drag:.65,slackT:0,breakT:0,landT:0,
  reel:0,rodSide:0,twitch:0,twitchV:0,bend:0,act:0,biteCheck:1,waterT:0,shock:0,slipAcc:0,clickAcc:0,swim:null,lureId:'spoon',hasLure:true,
  netted:null,dangle:null};

/* ---------- rod ---------- */
const knobMat=Mat(0x222222,{emissive:0x000000});
function buildRod(){
  const root=new THREE.Group();
  const cork=Mat(0xb58a5a,{roughness:.9}),blank=Mat(0x203036,{roughness:.4,metalness:.25}),metal=Mat(0xb9bdc1,{metalness:.8,roughness:.3});
  const handle=new THREE.Mesh(new THREE.CylinderGeometry(.019,.017,.46,7),cork);handle.position.y=.23;root.add(handle);
  const reel=new THREE.Group();reel.position.set(0,.36,-.07);root.add(reel);
  const stem=new THREE.Mesh(new THREE.BoxGeometry(.012,.03,.06),metal);stem.position.z=.035;reel.add(stem);
  const spool=new THREE.Mesh(new THREE.CylinderGeometry(.034,.034,.045,9),metal);spool.position.set(0,.03,-.005);reel.add(spool);
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.03,.026,.05,8),blank);body.position.set(0,-.015,-.005);reel.add(body);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.046,.006,6,24),new THREE.MeshBasicMaterial({color:0x4fd18b}));ring.rotation.x=Math.PI/2;ring.position.set(0,.03,-.005);reel.add(ring);
  const crank=new THREE.Group();crank.position.set(-.038,-.015,-.005);reel.add(crank);
  const arm=new THREE.Mesh(new THREE.BoxGeometry(.006,.006,.07),metal);arm.position.z=-.035;crank.add(arm);
  const knob=new THREE.Mesh(new THREE.CylinderGeometry(.011,.011,.03,6),knobMat);knob.rotation.z=Math.PI/2;knob.position.set(-.016,0,-.07);crank.add(knob);
  const knobHand=new THREE.Mesh(new THREE.BoxGeometry(.06,.04,.08),Mat(0xd4a24a,{roughness:.8}));knobHand.visible=false;knobHand.position.set(-.03,0,-.07);crank.add(knobHand);
  const segs=[];let parent=root;const N=6,SL=.36;
  for(let i=0;i<N;i++){const g=new THREE.Group();g.position.y=i===0?.46:SL;parent.add(g);
    const r0=.0105*(1-i/N)+.0024,r1=.0105*(1-(i+1)/N)+.0024;const m=new THREE.Mesh(new THREE.CylinderGeometry(r1,r0,SL,6),blank);m.position.y=SL/2;g.add(m);
    const gr=new THREE.Mesh(new THREE.TorusGeometry(.007+.007*(1-i/N),.0013,4,8),metal);gr.position.set(0,SL*.6,-(r0+.008));g.add(gr);segs.push(g);parent=g;}
  const tip=new THREE.Object3D();tip.position.y=SL;parent.add(tip);
  return {root,segs,tip,crank,knob,knobHand,ring,reel};
}
export const rod=buildRod();
export function setCrankSide(){const s=save.rodHand==='right'?-1:1;rod.crank.position.x=.038*s;rod.knob.position.x=.016*s;rod.knobHand.position.x=.03*s;}
setCrankSide();
export const rodItem=registerTool('rod',rod.root,b=>b.addShape(new CANNON.Box(new CANNON.Vec3(.025,1.25,.025)),new CANNON.Vec3(0,1.25,0)),.6,HOLSTER.rod,
  V(0,-.02,.16),new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2+.55,0,0)));

/* ---------- landing net ---------- */
function buildNet(){
  const g=new THREE.Group();const wood=Mat(0x8a6a45),ringM=Mat(0x9aa0a4,{metalness:.6,roughness:.4});
  const h=new THREE.Mesh(new THREE.CylinderGeometry(.016,.016,1.0,6),wood);h.position.y=.5;g.add(h);
  const hoop=new THREE.Mesh(new THREE.TorusGeometry(.22,.01,5,18),ringM);hoop.position.y=1.22;g.add(hoop);
  const bag=new THREE.Mesh(new THREE.ConeGeometry(.21,.38,10,1,true),new THREE.MeshStandardMaterial({color:0x3c5a5e,transparent:true,opacity:.55,side:THREE.DoubleSide,flatShading:true,wireframe:true}));
  bag.rotation.x=Math.PI/2;bag.position.set(0,1.22,-.19);g.add(bag);
  const content=new THREE.Group();content.position.set(0,1.22,-.14);g.add(content);
  return {root:g,hoop,content};
}
export const net=buildNet();
export const netItem=registerTool('net',net.root,b=>{b.addShape(new CANNON.Box(new CANNON.Vec3(.02,.5,.02)),new CANNON.Vec3(0,.5,0));b.addShape(new CANNON.Box(new CANNON.Vec3(.22,.22,.04)),new CANNON.Vec3(0,1.22,0));},.9,HOLSTER.net,
  V(0,-.02,.1),new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2+.25,0,0)));

/* ---------- line, lure, arc preview ---------- */
const lineGeo=new THREE.BufferGeometry();const LINE_N=24;lineGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(LINE_N*3),3));
const fishLine=new THREE.Line(lineGeo,new THREE.LineBasicMaterial({color:0xf3efe2,transparent:true,opacity:.85}));fishLine.frustumCulled=false;scene.add(fishLine);
const lure=new THREE.Group();scene.add(lure);let lureMesh=null;
export function setLureModel(id){if(lureMesh)lure.remove(lureMesh);lureMesh=id?lureModel(LU[id]):null;if(lureMesh)lure.add(lureMesh);}
setLureModel(F.lureId);
const ARC_N=40;const arcGeo=new THREE.BufferGeometry();arcGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(ARC_N*3),3));
const arc=new THREE.Points(arcGeo,new THREE.PointsMaterial({color:0xf2d38a,size:.05,transparent:true,opacity:.85,depthWrite:false}));arc.frustumCulled=false;arc.visible=false;scene.add(arc);
const ringMark=new THREE.Mesh(new THREE.RingGeometry(.35,.45,20),new THREE.MeshBasicMaterial({color:0xf2d38a,transparent:true,opacity:.7,side:THREE.DoubleSide,depthWrite:false}));ringMark.rotation.x=-Math.PI/2;ringMark.visible=false;scene.add(ringMark);
/* desktop rod mount */
export const deskHand=new THREE.Group();rig.add(deskHand);deskHand.position.set(.26,1.2,-.28);
const deskMount=new THREE.Group();deskMount.rotation.x=-Math.PI/2;deskMount.position.set(0,0,.22);deskHand.add(deskMount);
export function rodToDesk(){if(rod.root.parent!==deskMount){if(rodItem.body.world)world.removeBody(rodItem.body);if(rodItem.heldBy){rodItem.heldBy.held=null;rodItem.heldBy=null;}deskMount.add(rod.root);rod.root.position.set(0,0,0);rod.root.quaternion.identity();rodItem.inHolster=false;rodItem.desk=true;}}
export function rodOffDesk(){if(rodItem.desk){rodItem.desk=false;toHolster(rodItem);}}
export const rodInHand=()=>!!(rodItem.heldBy||rodItem.desk);
const rodHand=()=>rodItem.heldBy&&rodItem.heldBy!==true?rodItem.heldBy:null;

/* ---------- casting, bites, fight ---------- */
const railW=()=>boat.localToWorld(RAIL.clone());
export const tipW=(out=V())=>rod.tip.getWorldPosition(out);
const snapPoint=out=>{tipW(out);out.y-=.35;return out;};
export function tieLure(id){
  if(F.state!=='ready'){msg('Сначала смотайте леску','',1.2);return;}
  F.lureId=id;F.hasLure=true;setLureModel(id);sfx.tie();buzzHand('off',.4,40);msg(LU[id].name,'Привязана',1.1);
}
export function launchLure(dir,power,vel){
  tipW(F.lure);
  if(vel)F.lureVel.copy(vel);
  else{const D=5+power*36,v=Math.sqrt(D*9.8/.94)*.9,a=.6;F.lureVel.copy(dir).multiplyScalar(v*Math.cos(a));F.lureVel.y=v*Math.sin(a);}
  F.lureVel.addScaledVector(wind,S.storm*2.2);F.state='flying';sfx.whoosh();F.twitchV-=3;arc.visible=false;ringMark.visible=false;
  S.fn.tut?.('cast');
}
function speciesWeight(sp){
  if(S.storm<sp.storm[0])return 0;
  const d=F.depth;let fd=1;if(d<sp.depth[0])fd=Math.exp(-(sp.depth[0]-d)/5);else if(d>sp.depth[1])fd=Math.exp(-(d-sp.depth[1])/5);
  const L=LU[F.lureId];const fr=F.lureId==='bait'?1:clamp(1-Math.abs(F.act-sp.retrieve)*.9,.08,1);
  const near=F.lure.distanceTo(V(hotspot.pos.x,F.lure.y,hotspot.pos.z))<9&&S.storm<.82;
  let w=sp.w*fd*fr*(near?(sp.hot||1.3):1)*(L.mult[sp.id]??1);
  if(sp.id==='eel'&&S.flashT>-2.5)w*=2.5;if(sp.id==='tuna')w*=.6+S.storm;return w;
}
function startBite(){
  const cands=SPECIES.map(s=>[s,speciesWeight(s)]);const total=cands.reduce((a,c)=>a+c[1],0);
  if(total<=0||Math.random()>clamp(.07*total,0,.45))return;
  let r=Math.random()*total,sp=cands[0][0];for(const [s,w] of cands){if((r-=w)<=0){sp=s;break;}}
  let sizeT=Math.pow(Math.random(),1.6);if(Math.random()<.04)sizeT=1.2;
  const len=lerp(sp.len[0],sp.len[1],sizeT);const kg=Math.round(sp.k*len*len*len*100)/100;
  const B={sp,sizeT,len,kg,t:0,taps:[],strike:0,win:sp.window+.1,pull:null,hold:null,buzz:null,quit:false,tapI:0,struck:false};
  switch(sp.bite){
    case 'rapid':B.taps=[0,.16,.31,.47+rand(0,.2)];B.strike=B.taps[3]+.25+rand(0,.35);break;
    case 'double':B.taps=[0,.45+rand(0,.3)];B.strike=B.taps[1]+.5+rand(0,.45);B.quit=Math.random()<.15;break;
    case 'heavy':B.taps=[0];B.pull=[0,1.1];B.strike=1.2+rand(0,.5);break;
    case 'snag':B.hold=[0,1.6];B.strike=1.7+rand(0,.8);break;
    case 'hit':B.strike=.05;break;
    case 'buzz':B.buzz=[0,.9];B.strike=1+rand(0,.3);break;
  }
  F.bite=B;
}
function updateBite(dt){
  const B=F.bite;const prev=B.t;B.t+=dt;const inHand=rodInHand();
  while(B.tapI<B.taps.length&&B.t>=B.taps[B.tapI]){F.twitchV-=1.6;sfx.tap(.7);buzzHand('main',.35,40);B.tapI++;}
  let extra=0;
  if(B.pull&&B.t<B.strike)extra=.35*smooth(B.pull[0],B.pull[1],B.t);
  if(B.hold&&B.t<B.strike){extra=.45;if(Math.random()<dt*3)buzzHand('main',.2,30);}
  if(B.buzz&&B.t<B.strike){F.twitch+=rand(-.02,.02);if(Math.random()<dt*25){sfx.buzz();buzzHand('main',.25,20);}}
  F.bend=Math.max(F.bend,extra);
  if(prev<B.strike&&B.t>=B.strike){
    if(B.quit){F.bite=null;F.biteCheck=2;return;}
    B.struck=true;F.twitchV-=4.5;F.bend=.75;sfx.thump(.9);buzzHand('main',.9,120);
    if(!inHand){if(B.sp.str>=.5||Math.random()<.35){hookFish(true);return;}else msg('Клюёт! Удочка в держателе','Возьмите её',1.6);}
  }
  if(B.struck&&B.t>B.strike+B.win){F.bite=null;F.biteCheck=1.5;if(inHand)msg('Сорвалась','Подсекайте сразу после сильного рывка',1.8);}
}
export function tryHook(){
  const B=F.bite;
  if(!B){if(F.state==='water'){F.depth=Math.max(0,F.depth-1.2);F.act=Math.min(1,F.act+.4);F.twitchV+=2;}return;}
  if(B.t<B.strike-.06){if(Math.random()<.55){F.bite=null;F.biteCheck=2.5;msg('Рано!','Рыба почувствовала крючок и ушла',1.6);}else msg('Рано!','',1);return;}
  if(B.struck&&B.t<=B.strike+B.win)hookFish(false);
}
function hookFish(self){
  const B=F.bite;F.bite=null;const r=railW();const dx=F.lure.x-r.x,dz=F.lure.z-r.z;
  const fish={sp:B.sp,sizeT:B.sizeT,len:B.len,kg:B.kg,str:B.sp.str*(.7+.6*B.sizeT),dist:Math.max(4,Math.hypot(dx,dz)),lat:Math.atan2(dx,-dz),depth:F.depth,
    stamina:1,mode:'run',modeT:1.2,t:0,latV:0,jump:null,prefDepth:lerp(B.sp.depth[0],B.sp.depth[1],.5)};
  F.fish=fish;F.state='hooked';F.slackT=0;F.breakT=0;F.shock=.25;sfx.thump(1);buzzHand('main',1,150);
  msg(self?'Рыба засеклась сама!':'Есть!',self?'Скорее берите удочку':'Ведите рыбу, следите за кольцом на катушке',1.6);
  const rec=newFish(fish.sp,fish.len,fish.kg);const ob=buildFish(rec);const holder=new THREE.Group();const inner=new THREE.Group();
  if(fish.sp.fam!=='flat')inner.rotation.x=-Math.PI/2;inner.add(ob.g);holder.add(inner);holder.visible=false;scene.add(holder);F.swim={holder,ob};
  S.fn.tut?.('hook');
}
function loseFish(text,sub,lostLure){
  msg(text,sub,2.4);F.state='ready';F.fish=null;F.tension=0;
  if(F.swim){scene.remove(F.swim.holder);F.swim.ob.dispose();F.swim=null;}
  if(lostLure){F.hasLure=false;setLureModel(null);setTimeout(()=>msg('Приманка ушла с рыбой',renderer.xr.isPresenting?'Возьмите новую из ящика':'Привяжите новую: 1–5',2.2),2500);}
}
export function fishWorldPos(f,out){const r=railW();out.set(r.x+Math.sin(f.lat)*f.dist,0,r.z-Math.cos(f.lat)*f.dist);out.y=waveH(out.x,out.z)-f.depth;return out;}
function updateFight(dt){
  const f=F.fish,sp=f.sp;f.t+=dt;
  if(F.state==='landing'){
    f.dist=damp(f.dist,2.2,2,dt);f.depth=damp(f.depth,.05,3,dt);F.landT+=dt;F.tension=.22+.12*Math.abs(Math.sin(f.t*9));
    if(Math.random()<dt*4){const p=fishWorldPos(f,V());splash(p,6,2.2,.8);if(Math.random()<.3)sfx.splash(.4);}
    if(F.landT>14){f.stamina=Math.min(1,f.stamina+.22);F.state='hooked';f.mode='run';f.modeT=2;f.dist=8;msg('Ушла вглубь','Вымотайте её ещё раз',1.6);}
    return;
  }
  f.modeT-=dt;
  if(f.modeT<=0){const tired=f.stamina<.3;let m=(tired&&Math.random()<.6)?'rest':pick(sp.modes);f.mode=m;f.modeT=rand(1.2,2.8)*(m==='rest'?1.3:1);
    if(m==='run'||m==='jump')F.shock=.22;if(m==='jump')f.jump={t:0,dur:1.05,started:false};}
  const s=f.str*(.3+.7*f.stamina);let P=0;
  switch(f.mode){
    case 'run':P=s;f.latV+=((Math.sign(f.lat)||1)*.5-f.latV)*dt;f.depth=damp(f.depth,f.prefDepth,.4,dt);break;
    case 'zig':P=s*(.7+.3*Math.sin(f.t*7));f.latV=Math.sin(f.t*sp.agility*3.2)*1.2;break;
    case 'shake':P=s*(.45+.45*Math.abs(Math.sin(f.t*13)));if(Math.random()<dt*10)buzzHand('main',.4,25);break;
    case 'dive':P=s*.95;f.depth=Math.min(sp.depth[1]+6,f.depth+2.2*dt);break;
    case 'rest':P=s*.25;f.latV*=.95;break;
    case 'charge':P=-.15;f.dist=Math.max(3.6,f.dist-3.2*dt);f.depth=damp(f.depth,1,1,dt);break;
    case 'jump':
      if(f.depth>.4&&!f.jump.started){f.depth=Math.max(0,f.depth-6*dt);P=s*.8;}
      else{if(!f.jump.started){f.jump.started=true;splash(fishWorldPos(f,V()),18,4,1.2);sfx.splash(1.2);}
        f.jump.t+=dt;P=.02;if(f.jump.t>f.jump.dur){f.mode='run';f.modeT=1.4;F.shock=.3;f.depth=.8;splash(fishWorldPos(f,V()),22,4.5,1.3);sfx.splash(1.4);}}
      break;
  }
  f.lat=clamp(f.lat+f.latV*dt*1.6/Math.max(f.dist,5),-1.15,1.15);
  const reel=F.reel;const shock=F.shock>0?f.str*.5:0;F.shock-=dt;
  let demand=P+shock+reel*.4;if(P<0)demand=Math.max(0,reel*.55+P*1.2);
  const D=F.drag;let ten;
  if(demand>D){const slip=(demand-D)*9*dt;f.dist+=slip;F.slipAcc+=slip;ten=D;if(F.slipAcc>.22){F.slipAcc=0;sfx.ratchet();buzzHand('off',.3,20);}}
  else{ten=demand;if(reel>0){const k=1-.6*clamp(P/D,0,1);const g=reel*2.3*reelMult()*k*dt;if(f.depth>1&&f.mode!=='dive'){f.depth-=g*.55;f.dist-=g*.45;}else f.dist-=g;F.clickAcc+=g;}}
  if(f.mode==='jump'&&f.jump&&f.jump.started)ten=reel*.15;
  F.tension=damp(F.tension,ten,14,dt);
  if(F.clickAcc>.18&&!crank.held){F.clickAcc=0;sfx.click(.1);}
  const LS=lineStrength();
  if(F.tension>LS)F.breakT+=dt;else F.breakT=Math.max(0,F.breakT-dt);
  if(F.breakT>.22){sfx.snap();buzzHand('main',1,200);loseFish('Леска лопнула!','Кольцо было красным: ослабьте фрикцион',true);return;}
  if(F.tension<.06)F.slackT+=dt;else F.slackT=Math.max(0,F.slackT-dt*2);
  if(F.slackT>((f.mode==='jump'||f.mode==='shake')?1.0:2.4)){loseFish('Сошла','Леска провисла. Подматывайте, когда рыба идёт к вам');return;}
  if(f.dist+f.depth>150){sfx.snap();loseFish('Катушка пуста','Рыба смотала всю леску. Затяните фрикцион',true);return;}
  const opp=Math.abs(f.lat)>.12&&Math.abs(F.rodSide)>.25&&Math.sign(F.rodSide)!==Math.sign(f.lat);
  f.stamina=Math.max(0,f.stamina-dt/(sp.stam*1.6)*(.2+F.tension*1.2+(opp?.7:0)));
  F.bend=Math.max(F.bend,F.tension*.9);
  if(f.dist<4){
    if(f.stamina<.35){F.state='landing';F.landT=0;f.depth=Math.min(f.depth,1);
      const vr=renderer.xr.isPresenting;msg('Рыба у борта!',vr?(f.kg<=2.5?'Поднимите удилищем или подведите подсак':'Возьмите подсак у борта и подведите под рыбу'):'Резко мышь вверх или Пробел',2);S.fn.tut?.('landing');}
    else{f.dist=4;if(f.mode!=='run'){f.mode='run';f.modeT=2;F.shock=.3;msg('Рывок у борта!','Ещё не устала',1.2);}}
  }
  if(Math.random()<dt*(f.depth<1.5?3:0)){const p=fishWorldPos(f,V());p.y=waveH(p.x,p.z);splash(p,4,1.5,.6);}
}
/* fish leaves the water: the swim model becomes a real piece */
function takeFishOut(){
  const f=F.fish;F.state='ready';F.fish=null;F.tension=0;
  const sw=F.swim;F.swim=null;const ob=sw.ob;const w=new THREE.Vector3();sw.holder.getWorldPosition(w);
  ob.g.removeFromParent();scene.remove(sw.holder);ob.g.position.set(0,0,0);ob.g.quaternion.identity();
  const jr=save.journal[f.sp.id]||{n:0,best:0};const isRec=f.kg>jr.best;jr.n++;jr.best=Math.max(jr.best,f.kg);save.journal[f.sp.id]=jr;persist();
  const sub=fmtKg(f.kg)+' кг'+(isRec?' · рекорд!':'')+(f.sizeT>1?' · трофей':'');msg(f.sp.name,sub,2);
  sfx.splash(.8);splash(w,14,3,1);buzzHand('main',.8,120);
  return {ob,w,f,sub};
}
export function liftOrNet(){
  const f=F.fish;if(!f||F.state!=='landing')return;
  if(!renderer.xr.isPresenting){
    const {ob,w,f:ff,sub}=takeFishOut();scene.add(ob.g);ob.g.position.copy(w);
    const slot=DECK_SPOT.clone().add(V(rand(-.12,.12),.15,rand(-.15,.15)));
    fly(ob.g,boat,slot,{dur:1,arc:1.4,spin:6,endQ:new THREE.Quaternion().setFromAxisAngle(UP,Math.PI/2),onDone:()=>{addPiece(ob);sfx.slap();}});
    label(ff.sp.name,sub,boat.localToWorld(slot.clone()).add(V(0,.6,0)));return;
  }
  if(f.kg>2.5){msg('Тяжёлая','Удилищем не поднять. Возьмите подсак у борта слева',1.8);return;}
  // small fish: swings on the line under the rod tip until you take it
  const {ob}=takeFishOut();boat.add(ob.g);const tw=boat.worldToLocal(tipW(V()));ob.g.position.copy(tw).add(V(0,-.4,0));ob.g.quaternion.setFromEuler(new THREE.Euler(0,0,Math.PI/2));
  const it=addPiece(ob);const kin=new CANNON.Body({mass:0,type:CANNON.Body.KINEMATIC});kin.collisionResponse=false;kin.position.set(tw.x,tw.y,tw.z);world.addBody(kin);
  const head=V(ob.fish.d.L*.45,0,0);const piv=head.sub(it.com);
  const c=new CANNON.DistanceConstraint(it.body,kin,.35,60);world.addConstraint(c);
  F.dangle={it,kin,c};msg('Возьмите рыбу рукой','Она висит на леске',1.6);S.fn.tut?.('dangle');
}
function netCatch(){
  const {ob,f}=takeFishOut();net.content.add(ob.g);ob.g.position.set(0,0,0);ob.g.quaternion.setFromEuler(new THREE.Euler(0,Math.PI/2,0));
  const s=Math.min(1,.42/f.len);ob.g.scale.setScalar(1);F.netted={ob,scale:s};sfx.splash(1);buzzHand('off',.8,100);
  msg('В подсаке!','Достаньте рыбу рукой или переверните подсак над палубой',1.8);S.fn.tut?.('netted');
}
function releaseNetted(handIt){
  const n=F.netted;if(!n)return null;F.netted=null;const ob=n.ob;boat.attach(ob.g);const it=addPiece(ob);return it;
}
export const crank={held:false,hand:null,prevA:0,prevQ:null,acc:0,rate:0,angle:0};
function crankHandAngle(hp){const l=rod.crank.parent.worldToLocal(hp.clone()).sub(rod.crank.position);return Math.atan2(l.y,-l.z);}
/* hand grabs that belong to fishing: the reel handle and lures from the tackle box */
S.fn.handGrabSpecial=h=>{
  const hp=h.grip.getWorldPosition(V());
  const rh=rodHand();
  if(rh&&rh!==h&&save.reelMode==='hand'&&hp.distanceTo(rod.knob.getWorldPosition(V()))<.15){
    crank.held=true;crank.hand=h;h.crank=true;crank.prevA=crankHandAngle(hp);crank.prevQ=h.grip.getWorldQuaternion(new THREE.Quaternion());
    h.mitt&&(h.mitt.visible=false);rod.knobHand.visible=true;buzzHand(h===mainHand()?'main':'off',.3,30);S.fn.tut?.('crank');return true;}
  if(F.netted&&!(netItem.heldBy===h)){const b=new THREE.Box3().setFromObject(F.netted.ob.g).expandByScalar(.06);if(b.containsPoint(hp)){const it=releaseNetted();if(it){grabPiece(h,it);return true;}}}
  if(F.state==='ready'){
    const sp=snapPoint(V());let id=null;
    if(F.hasLure&&hp.distanceTo(sp)<.15){id=F.lureId;F.hasLure=false;setLureModel(null);}
    else for(const t of tackleSlots){if(hp.distanceTo(t.slot.getWorldPosition(V()))<.07){id=t.lure.id;break;}}
    if(id){const m=lureModel(LU[id]);m.name='heldLure';h.grip.add(m);m.position.set(0,-.02,-.05);h.heldLure=id;sfx.tie();return true;}
  }
  return false;
};
S.fn.onGrabPiece=(it,h)=>{
  if(F.dangle&&F.dangle.it===it){world.removeConstraint(F.dangle.c);world.removeBody(F.dangle.kin);F.dangle=null;msg('Снята с крючка','Несите на стол',1.2);S.fn.tut?.('unhooked');}
  if(F.netted&&F.netted.ob===it.vobj){F.netted=null;}
};
S.fn.onToolGrab=(it,h)=>{if(it===rodItem)S.fn.tut?.('rod');if(it===netItem)S.fn.tut?.('net');};
S.fn.onRelease=(it,h)=>{if(it===netItem&&F.netted){const n=releaseNetted();}};
function updateCrank(dt){
  const h=crank.hand;if(!crank.held||!h)return;
  const gp=h.src&&h.src.gamepad;const sq=!!(gp&&gp.buttons[1]&&gp.buttons[1].pressed);const hp=h.grip.getWorldPosition(V());
  if(!sq||!rodHand()||hp.distanceTo(rod.knob.getWorldPosition(V()))>.3){crank.held=false;h.crank=false;h.prevSq=sq;h.mitt&&(h.mitt.visible=true);rod.knobHand.visible=false;return;}
  const a=crankHandAngle(hp);let da=a-crank.prevA;if(da>Math.PI)da-=TAU;if(da<-Math.PI)da+=TAU;crank.prevA=a;
  const q=h.grip.getWorldQuaternion(new THREE.Quaternion());const dq=q.clone().multiply(crank.prevQ.clone().invert());crank.prevQ=q;
  const ax=V(1,0,0).applyQuaternion(rod.crank.parent.getWorldQuaternion(new THREE.Quaternion()));const proj=dq.x*ax.x+dq.y*ax.y+dq.z*ax.z;let tw=2*Math.atan2(proj,dq.w);if(tw>Math.PI)tw-=TAU;if(tw<-Math.PI)tw+=TAU;
  const d=Math.abs(da)>Math.abs(tw)?da:tw;crank.angle+=d;crank.rate=damp(crank.rate,Math.abs(d)/Math.max(dt,1e-3),10,dt);crank.acc+=Math.abs(d);
  if(crank.acc>Math.PI/4){crank.acc=0;sfx.click(.09);buzzHand(h===mainHand()?'main':'off',.18,8);}
}
function updateHeldLures(){
  for(const h of Object.values(HANDS)){if(!h||!h.heldLure)continue;const gp=h.src&&h.src.gamepad;const sq=!!(gp&&gp.buttons[1]&&gp.buttons[1].pressed);const hp=h.grip.getWorldPosition(V());
    const sp=snapPoint(V());
    if(F.state==='ready'&&!F.hasLure&&hp.distanceTo(sp)<.15){tieLure(h.heldLure);const m=h.grip.getObjectByName('heldLure');if(m)h.grip.remove(m);h.heldLure=null;continue;}
    if(!sq){const m=h.grip.getObjectByName('heldLure');if(m)h.grip.remove(m);h.heldLure=null;}}
}

/* ---------- per-frame ---------- */
const tipPrev=V(),tipVel=V(),tipVelS=V();let vrFlickCd=0,trigPrev=false;
export function fishingVR(dt){
  const rh=rodHand();tipW(V());
  const tp=tipW(V());tipVel.copy(tp).sub(tipPrev).divideScalar(Math.max(dt,1e-3));tipPrev.copy(tp);tipVelS.lerp(tipVel,.35);vrFlickCd-=dt;
  updateCrank(dt);updateHeldLures();
  F.reel=0;
  if(rh){
    const gp=rh.src&&rh.src.gamepad;const trig=!!(gp&&gp.buttons[0]&&gp.buttons[0].value>.5);
    if(save.reelMode==='hand')F.reel=crank.held?clamp(crank.rate/(TAU*1.5),0,1.2):0;
    else{const o=offHand();const og=o&&o.src&&o.src.gamepad;F.reel=og&&og.buttons[0]?og.buttons[0].value:0;}
    if(trig&&!trigPrev&&F.state==='ready'){if(!F.hasLure)msg('Нет приманки','Возьмите её из ящика с приманками',1.6);else{F.state='wind';F.charge=0;}}
    if(F.state==='wind'){
      // arc preview: where the lure would land if you let go now
      const sp=tipVelS.length();const v=tipVelS.clone().multiplyScalar(1.7);v.y=Math.max(v.y,sp*.5);v.clampLength(0,24);
      if(sp>1.2){const p=tp.clone(),vv=v.clone(),pa=arcGeo.attributes.position;let i=0,land=null;
        for(;i<ARC_N;i++){pa.setXYZ(i,p.x,p.y,p.z);for(let k=0;k<3;k++){vv.y-=9.8*.02;p.addScaledVector(vv,.02);}if(p.y<0){land=p.clone();break;}}
        for(let j=i;j<ARC_N;j++)pa.setXYZ(j,p.x,p.y,p.z);pa.needsUpdate=true;arc.visible=true;
        if(land){ringMark.position.set(land.x,waveH(land.x,land.z)+.05,land.z);ringMark.visible=true;}}
      else{arc.visible=false;ringMark.visible=false;}
      if(!trig){const sp2=tipVelS.length();if(sp2>1.2){const v2=tipVelS.clone().multiplyScalar(1.7);v2.y=Math.max(v2.y,sp2*.5);v2.clampLength(0,24);launchLure(null,0,v2);}
        else{F.state='ready';arc.visible=false;ringMark.visible=false;msg('Слабый замах','Зажмите курок, махните удилищем и отпустите курок на взмахе',1.8);}}
    }
    trigPrev=trig;
    if(tipVel.y>1.7&&vrFlickCd<=0){vrFlickCd=.4;if(F.state==='water')tryHook();else if(F.state==='landing')liftOrNet();}
    const d=V(0,1,0).applyQuaternion(rod.root.getWorldQuaternion(new THREE.Quaternion()));d.applyQuaternion(rig.getWorldQuaternion(new THREE.Quaternion()).invert());F.rodSide=clamp(Math.atan2(d.x,-d.z)/.6,-1,1);
  }else{trigPrev=false;if(F.state==='wind'){F.state='ready';arc.visible=false;ringMark.visible=false;}}
  // the landing net scoops a fish at the surface
  if(F.state==='landing'&&netItem.heldBy&&F.fish){const hc=net.hoop.getWorldPosition(V());const fp=fishWorldPos(F.fish,V());fp.y=waveH(fp.x,fp.z);if(hc.distanceTo(fp)<.55)netCatch();}
  // net turned over above the deck drops the fish
  if(F.netted){const up=V(0,1,0).applyQuaternion(net.hoop.getWorldQuaternion(new THREE.Quaternion()));const zdir=V(0,0,-1).applyQuaternion(net.root.getWorldQuaternion(new THREE.Quaternion()));
    if(zdir.y>.55||!netItem.heldBy&&!netItem.inHolster){releaseNetted();msg('Рыба на палубе','',1);}}
  if(F.dangle){const kp=boat.worldToLocal(tipW(V()));F.dangle.kin.position.set(kp.x,kp.y,kp.z);}
}
export function updateFishing(dt){
  const r=railW();
  F.twitchV+=(-60*F.twitch-7*F.twitchV)*dt;F.twitch+=F.twitchV*dt;F.bend=damp(F.bend,0,3,dt);
  switch(F.state){
    case 'wind':F.charge=Math.min(1,F.charge+dt/1.1);break;
    case 'flying':{F.lureVel.y-=9.8*dt;F.lure.addScaledVector(F.lureVel,dt);const h=waveH(F.lure.x,F.lure.z);
      if(F.lure.y<=h&&F.lureVel.y<0){const dist=Math.hypot(F.lure.x-r.x,F.lure.z-r.z);
        if(dist<3||F.lure.z>r.z+.3){F.state='ready';msg('Приманка упала у борта','Махните сильнее и в сторону моря',1.4);break;}
        F.state='water';F.depth=0;F.waterT=0;F.act=0;F.biteCheck=1.2;F.lure.y=h;sfx.splash(.5);splash(F.lure,8,2,.5);}
      break;}
    case 'water':{F.waterT+=dt;const L=LU[F.lureId];const dx=r.x-F.lure.x,dz=r.z-F.lure.z,dist=Math.hypot(dx,dz);
      if(F.reel>.05){const spd=(F.bite?1.2:3.4)*F.reel*reelMult();F.lure.x+=dx/dist*spd*dt;F.lure.z+=dz/dist*spd*dt;
        if(L.sink<0)F.depth=Math.min(L.maxD,F.depth+1.6*F.reel*dt);else F.depth=Math.max(0,F.depth-F.reel*1.6*dt);
        F.clickAcc+=spd*dt;if(F.clickAcc>.3&&!crank.held){F.clickAcc=0;sfx.click(.07);}}
      else{if(L.sink<0)F.depth=Math.max(0,F.depth+L.sink*dt);else F.depth=Math.min(L.maxD,F.depth+L.sink*dt);}
      F.lure.addScaledVector(wind,S.storm*.35*dt);F.lure.y=waveH(F.lure.x,F.lure.z);F.act=damp(F.act,F.reel>.2?1:0,1.2,dt);
      if(dist<2.6&&!F.bite){F.state='ready';break;}
      if(F.bite)updateBite(dt);else{F.biteCheck-=dt;if(F.biteCheck<=0&&F.waterT>1.5){F.biteCheck=.5;startBite();}}
      break;}
    case 'hooked':case 'landing':updateFight(dt);break;
  }
  if(F.swim&&F.fish){
    const f=F.fish,h=F.swim.holder;const showJump=f.mode==='jump'&&f.jump&&f.jump.started;
    h.visible=F.state==='landing'||showJump||f.depth<.9;fishWorldPos(f,h.position);
    if(showJump){const u=f.jump.t/f.jump.dur;h.position.y=waveH(h.position.x,h.position.z)+Math.sin(Math.PI*u)*(1.6+f.str);h.rotation.z=lerp(.9,-.9,u);}
    else{h.position.y=waveH(h.position.x,h.position.z)-Math.min(f.depth,.25)+(F.state==='landing'?.05:0);h.rotation.z=0;}
    const dirx=Math.sin(f.lat),dirz=-Math.cos(f.lat);h.rotation.y=Math.atan2(-dirz,dirx)+(f.mode==='charge'?Math.PI:0)+Math.sin(f.t*(F.state==='landing'?18:10))*(F.state==='landing'?.6:.25);
  }
}
/* desktop rod pose */
let rodEl=.7,rodYaw=0;const _dir=V(),_zero=V(),_m1=new THREE.Matrix4();
export function updateDeskRod(dt,ndc){
  const nx=ndc.x,ny=ndc.y;let el;const yaw=-nx*.7;
  switch(F.state){case 'wind':el=.6+F.charge*1.55;break;case 'flying':el=.3;break;case 'water':el=.35+ny*.25;break;case 'hooked':case 'landing':el=.6+ny*.45;break;default:el=.8+ny*.15;}
  rodEl=damp(rodEl,el+F.twitch,F.state==='flying'?20:9,dt);rodYaw=damp(rodYaw,yaw,8,dt);
  const ce=Math.cos(rodEl);_dir.set(-Math.sin(rodYaw)*ce,Math.sin(rodEl),-Math.cos(rodYaw)*ce);
  _m1.lookAt(_zero,_dir,UP);deskHand.quaternion.setFromRotationMatrix(_m1);F.rodSide=clamp(nx*1.5,-1,1);
}
export function deskCast(){const power=clamp(F.charge,.12,1);const dir=V(-Math.sin(rodYaw),0,-Math.cos(rodYaw)).applyQuaternion(rig.quaternion);dir.y=0;dir.normalize();launchLure(dir,power);}
/* rod bend, line, lure, tension ring */
const _axis=V(),_lt=V(),_tip=V(),_v1=V(),_q1=new THREE.Quaternion();
function lineTarget(out){
  if(F.state==='flying'||F.state==='water')return out.copy(F.lure);
  if((F.state==='hooked'||F.state==='landing')&&F.fish){fishWorldPos(F.fish,out);if(F.swim&&F.swim.holder.visible)out.copy(F.swim.holder.position);else out.y=waveH(out.x,out.z);return out;}
  if(F.dangle){return F.dangle.it.obj.localToWorld(V(F.dangle.it.vobj.fish.d.L*.45,0,0));}
  return snapPoint(out);
}
const ringCol=new THREE.Color();
export function updateRodLine(dt){
  tipW(_tip);lineTarget(_lt);
  const B=clamp(F.bend+Math.max(0,-F.twitch)*1.5+.03,0,1.35);
  const q=rod.root.getWorldQuaternion(_q1).invert();_axis.copy(_lt).sub(_tip).normalize().applyQuaternion(q);
  const ax=V(_axis.z,0,-_axis.x);const l=ax.length();const W=[.04,.08,.14,.2,.26,.28];
  for(let i=0;i<rod.segs.length;i++){if(l<1e-3)rod.segs[i].quaternion.identity();else rod.segs[i].quaternion.setFromAxisAngle(_v1.copy(ax).divideScalar(l),B*W[i]);}
  if(!crank.held)crank.angle-=F.reel*dt*14;rod.crank.rotation.x=crank.angle;
  tipW(_tip);const p=lineGeo.attributes.position;const dist=_tip.distanceTo(_lt);
  const sag=(F.state==='hooked'||F.state==='landing')?dist*.05*(1-clamp(F.tension*2.2,0,1))+.01:F.state==='ready'||F.state==='wind'?0:dist*.04+.05;
  for(let i=0;i<LINE_N;i++){const s=i/(LINE_N-1);_v1.lerpVectors(_tip,_lt,s);_v1.y-=sag*4*s*(1-s);p.setXYZ(i,_v1.x,_v1.y,_v1.z);}
  p.needsUpdate=true;
  lure.visible=F.hasLure&&!F.dangle&&F.state!=='hooked'&&F.state!=='landing'&&!(F.state==='water'&&F.depth>.3);
  lure.position.copy(_lt);lure.rotation.y+=dt*(F.state==='ready'?1.5:12);
  // tension ring: green ok, yellow ease off, red about to snap
  const fight=F.state==='hooked'||F.state==='landing';const t=fight?F.tension/lineStrength():0;
  ringCol.setHex(!fight?0x3a8f6a:t<.6?0x4fd18b:t<.85?0xf2c14e:0xe0473a);rod.ring.material.color.copy(ringCol);
  rod.ring.scale.setScalar(fight&&t>.85?1+.15*Math.abs(Math.sin(S.T*18)):1);
  knobMat.emissive.setHex(0);
  if(rodHand()&&save.reelMode==='hand'&&!crank.held){const o=Object.values(HANDS).find(h=>h&&h!==rodHand());if(o&&o.grip.getWorldPosition(V()).distanceTo(rod.knob.getWorldPosition(V()))<.15)knobMat.emissive.setHex(0x664018);}
}
export function forceHook(sp,len){F.state='water';F.lure.set(0,0,-10);F.bite={sp,sizeT:.5,len,kg:Math.round(sp.k*len**3*100)/100};hookFish(false);}
export function resetFishing(){
  Object.assign(F,{state:'ready',bite:null,fish:null,tension:0,depth:0,twitch:0,twitchV:0,bend:0});
  if(!F.hasLure){F.hasLure=true;setLureModel(F.lureId);}
  if(F.swim){scene.remove(F.swim.holder);F.swim=null;}
  if(F.dangle){world.removeConstraint(F.dangle.c);world.removeBody(F.dangle.kin);F.dangle=null;}
  if(F.netted){net.content.remove(F.netted.ob.g);F.netted=null;}
  arc.visible=false;ringMark.visible=false;
}
