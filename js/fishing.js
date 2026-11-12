/* Fishing, physical: a springy rod with inertia, a rope-like line, bail + finger casting,
   a reel that loads up under strain, and a hooked fish that is a body moving in the water. */
import { THREE, S, V, UP, TAU, clamp, lerp, smooth, rand, pick, damp, save, persist, lineStrength, reelMult, scene, rig, camera, renderer, boat,
  RAIL, DECK_SPOT, HOLSTER, SPECIES, LU, LURES, lureModel, tackleSlots, hotspot, wind, waveH, Mat, sfx, msg, label, fmtKg, splash, fly } from './core.js';
import { CANNON, world } from './physics.js';
import { items, registerTool, toHolster, HANDS, mainHand, offHand, addPiece, removeItem, handMatrixBoat, grabPiece, snapToHand } from './interact.js';
import { newFish, buildFish } from './voxel.js';
import { hapPulse, hapCont, hapBoth } from './haptics.js';
import { buildHand, setCurls, POSES } from './hands.js';

export const F={state:'ready',lure:V(),lureVel:V(),depth:0,charge:0,bite:null,fish:null,tension:0,drag:.65,slackT:0,breakT:0,landT:0,
  reel:0,twitchV:0,act:0,biteCheck:1,waterT:0,slipAcc:0,clickAcc:0,swim:null,lureId:'spoon',hasLure:true,
  netted:null,dangle:null,line:0,bail:'closed',feather:false,pres:.3,pauseT:0,pauseBonus:0,hops:0,hopT:99,bottom:30,wobT:0,lureHold:null};

/* ---------- rod with a bail arm on the reel ---------- */
const knobMat=Mat(0x222222,{emissive:0x000000});
function buildRod(){
  const root=new THREE.Group();
  const cork=Mat(0xb58a5a,{roughness:.9}),blank=Mat(0x203036,{roughness:.4,metalness:.25}),metal=Mat(0xb9bdc1,{metalness:.8,roughness:.3});
  const handle=new THREE.Mesh(new THREE.CylinderGeometry(.019,.017,.46,7),cork);handle.position.y=.23;root.add(handle);
  const reel=new THREE.Group();reel.position.set(0,.36,-.07);root.add(reel);
  const stem=new THREE.Mesh(new THREE.BoxGeometry(.012,.03,.06),metal);stem.position.z=.035;reel.add(stem);
  const spool=new THREE.Group();spool.position.set(0,.03,-.005);reel.add(spool);
  spool.add(new THREE.Mesh(new THREE.CylinderGeometry(.034,.034,.045,9),metal));
  const lineWrap=new THREE.Mesh(new THREE.CylinderGeometry(.031,.031,.03,12),Mat(0xe9e4d4,{roughness:.6}));spool.add(lineWrap);
  const dragKnob=new THREE.Mesh(new THREE.CylinderGeometry(.014,.014,.014,8),Mat(0xb33a2c));dragKnob.position.y=.03;spool.add(dragKnob);
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.03,.026,.05,8),blank);body.position.set(0,-.015,-.005);reel.add(body);
  const bail=new THREE.Group();bail.position.set(0,.03,-.005);reel.add(bail);
  const arm=new THREE.Mesh(new THREE.TorusGeometry(.04,.0025,4,14,Math.PI),metal);arm.rotation.y=Math.PI/2;bail.add(arm);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.046,.006,6,24),new THREE.MeshBasicMaterial({color:0x4fd18b}));ring.rotation.x=Math.PI/2;ring.position.set(0,.03,-.005);reel.add(ring);
  const crank=new THREE.Group();crank.position.set(-.038,-.015,-.005);reel.add(crank);
  const carm=new THREE.Mesh(new THREE.BoxGeometry(.006,.006,.07),metal);carm.position.z=-.035;crank.add(carm);
  const knob=new THREE.Mesh(new THREE.CylinderGeometry(.011,.011,.03,6),knobMat);knob.rotation.z=Math.PI/2;knob.position.set(-.016,0,-.07);crank.add(knob);
  const khm=buildHand();setCurls(khm,POSES.crank);const knobHand=khm.root;knobHand.visible=false;knobHand.position.set(-.03,.05,-.07);knobHand.rotation.x=-Math.PI/2;knobHand.scale.setScalar(.95);crank.add(knobHand);
  const segs=[];let parent=root;const N=6,SL=.36;
  for(let i=0;i<N;i++){const g=new THREE.Group();g.position.y=i===0?.46:SL;parent.add(g);
    const r0=.0105*(1-i/N)+.0024,r1=.0105*(1-(i+1)/N)+.0024;const m=new THREE.Mesh(new THREE.CylinderGeometry(r1,r0,SL,6),blank);m.position.y=SL/2;g.add(m);
    const gr=new THREE.Mesh(new THREE.TorusGeometry(.007+.007*(1-i/N),.0013,4,8),metal);gr.position.set(0,SL*.6,-(r0+.008));g.add(gr);segs.push(g);parent=g;}
  const tip=new THREE.Object3D();tip.position.y=SL;parent.add(tip);
  return {root,segs,tip,crank,knob,knobHand,ring,reel,bail,spool,dragKnob};
}
export const rod=buildRod();
export function setCrankSide(){const s=save.rodHand==='right'?-1:1;rod.crank.position.x=.038*s;rod.knob.position.x=.016*s;rod.knobHand.position.x=.03*s;rod.knobHand.scale.x=.95*s;}
setCrankSide();
export const rodItem=registerTool('rod',rod.root,b=>b.addShape(new CANNON.Box(new CANNON.Vec3(.025,1.25,.025)),new CANNON.Vec3(0,1.25,0)),.6,HOLSTER.rod,
  V(0,-.02,.16),new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2+.55,0,0)));
rodItem.seg=.9;

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
netItem.seg=1.0;

/* ---------- line (verlet rope), lure, arc preview ---------- */
const ROPE_N=34;
const rope={p:[],o:[],ok:false};for(let i=0;i<ROPE_N;i++){rope.p.push(V());rope.o.push(V());}
const lineGeo=new THREE.BufferGeometry();lineGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(ROPE_N*3),3));
const fishLine=new THREE.Line(lineGeo,new THREE.LineBasicMaterial({color:0xf3efe2,transparent:true,opacity:.85}));fishLine.frustumCulled=false;scene.add(fishLine);
const lure=new THREE.Group();scene.add(lure);let lureMesh=null;
const clip=new THREE.Mesh(new THREE.TorusGeometry(.012,.0028,5,10),Mat(0xb9bdc1,{metalness:.8,roughness:.3}));clip.visible=false;scene.add(clip);
export function setLureModel(id){if(lureMesh)lure.remove(lureMesh);lureMesh=id?lureModel(LU[id]):null;if(lureMesh){lureMesh.position.y=-.03;lure.add(lureMesh);}}
setLureModel(F.lureId);
const ARC_N=40;const arcGeo=new THREE.BufferGeometry();arcGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(ARC_N*3),3));
const arc=new THREE.Points(arcGeo,new THREE.PointsMaterial({color:0xf2d38a,size:.05,transparent:true,opacity:.85,depthWrite:false}));arc.frustumCulled=false;arc.visible=false;scene.add(arc);
const ringMark=new THREE.Mesh(new THREE.RingGeometry(.35,.45,20),new THREE.MeshBasicMaterial({color:0xf2d38a,transparent:true,opacity:.7,side:THREE.DoubleSide,depthWrite:false}));ringMark.rotation.x=-Math.PI/2;ringMark.visible=false;scene.add(ringMark);
export const deskHand=new THREE.Group();rig.add(deskHand);deskHand.position.set(.26,1.2,-.28);
const deskMount=new THREE.Group();deskMount.rotation.x=-Math.PI/2;deskMount.position.set(0,0,.22);deskHand.add(deskMount);
export function rodToDesk(){if(rod.root.parent!==deskMount){if(rodItem.body.world)world.removeBody(rodItem.body);if(rodItem.heldBy){rodItem.heldBy.held=null;rodItem.heldBy=null;}deskMount.add(rod.root);rod.root.position.set(0,0,0);rod.root.quaternion.identity();rodItem.inHolster=false;rodItem.desk=true;}}
export function rodOffDesk(){if(rodItem.desk){rodItem.desk=false;toHolster(rodItem);}}
export const rodInHand=()=>!!(rodItem.heldBy||rodItem.desk);
const rodHand=()=>rodItem.heldBy&&rodItem.heldBy!==true?rodItem.heldBy:null;
const freeHand=()=>{const r=rodHand();return r?(r===HANDS.left?HANDS.right:HANDS.left):offHand();};
const railW=()=>boat.localToWorld(RAIL.clone());
export const tipW=(out=V())=>rod.tip.getWorldPosition(out);
const snapPoint=out=>{tipW(out);out.y-=.35;return out;};
function setBail(open){if((F.bail==='open')===open)return;F.bail=open?'open':'closed';sfx.tie();hapPulse(rodHand(),.35,25);}

export function tieLure(id){
  if(F.state!=='ready'){msg('Сначала смотайте леску','',1.2);return;}
  F.lureId=id;F.hasLure=true;setLureModel(id);sfx.tie();hapPulse(freeHand(),.4,40);msg(LU[id].name,'Привязана',1.1);
}
export function launchLure(dir,power,vel){
  tipW(F.lure);
  if(vel)F.lureVel.copy(vel);
  else{const D=5+power*36,v=Math.sqrt(D*9.8/.94)*.9,a=.6;F.lureVel.copy(dir).multiplyScalar(v*Math.cos(a));F.lureVel.y=v*Math.sin(a);}
  if(vel)F.lureVel.multiplyScalar(lerp(.86,1.14,smooth(9,60,LU[F.lureId].mass)));
  F.lureVel.addScaledVector(wind,S.storm*2.2);F.state='flying';F.line=.4;F.bail='open';F.feather=false;sfx.whoosh();bend.kick(-1.2);arc.visible=false;ringMark.visible=false;
  S.fn.tut?.('cast');
}

/* ---------- bites ---------- */
function speciesWeight(sp){
  if(S.storm<sp.storm[0])return 0;
  const d=F.depth;let fd=1;if(d<sp.depth[0])fd=Math.exp(-(sp.depth[0]-d)/5);else if(d>sp.depth[1])fd=Math.exp(-(d-sp.depth[1])/5);
  const L=LU[F.lureId];const fr=clamp(.25+.75*F.pres,.08,1)*(L.still?1:clamp(1-Math.abs(F.act-sp.retrieve)*.45,.4,1));
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
let biteLoad=0;
function updateBite(dt){
  const B=F.bite;const prev=B.t;B.t+=dt;const inHand=rodInHand();
  while(B.tapI<B.taps.length&&B.t>=B.taps[B.tapI]){bend.kick(.5);sfx.tap(.7);hapPulse(rodHand(),.35,40);B.tapI++;}
  biteLoad=0;
  if(B.pull&&B.t<B.strike)biteLoad=.35*smooth(B.pull[0],B.pull[1],B.t);
  if(B.hold&&B.t<B.strike){biteLoad=.45;if(Math.random()<dt*3)hapPulse(rodHand(),.2,30);}
  if(B.buzz&&B.t<B.strike){if(Math.random()<dt*25){bend.kick(rand(-.15,.15));sfx.buzz();hapPulse(rodHand(),.25,20);}}
  if(prev<B.strike&&B.t>=B.strike){
    if(B.quit){F.bite=null;F.biteCheck=2;return;}
    B.struck=true;bend.kick(1.3);sfx.thump(.9);hapPulse(rodHand(),.9,120);
    if(F.bail==='open'){msg('Рыба берёт леску!','Дужка открыта: проверните катушку, чтобы закрыть её, и подсекайте',2);}
    if(!inHand){if(B.sp.str>=.5||Math.random()<.35){hookFish(true);return;}else msg('Клюёт! Удочка в держателе','Возьмите её',1.6);}
  }
  if(B.struck&&B.t>B.strike+B.win+(F.bail==='open'?1.2:0)){F.bite=null;F.biteCheck=1.5;biteLoad=0;if(inHand)msg('Сорвалась','Подсекайте сразу после сильного рывка',1.8);}
}
export function tryHook(){
  const B=F.bite;
  if(F.bail==='open'&&F.state==='water'){msg('Дужка открыта','Сначала проверните катушку, чтобы её закрыть',1.4);return;}
  if(!B){if(F.state==='water'){F.depth=Math.max(0,F.depth-(LU[F.lureId].hop?2.4:1.2));F.act=Math.min(1,F.act+.4);F.hops++;F.hopT=0;bend.kick(-.6);hapPulse(rodHand(),.3,30);}return;}
  if(B.t<B.strike-.06){if(Math.random()<.55){F.bite=null;F.biteCheck=2.5;msg('Рано!','Рыба почувствовала крючок и ушла',1.6);}else msg('Рано!','',1);return;}
  if(B.struck&&B.t<=B.strike+B.win+.6)hookFish(false);
}

/* ---------- what the rod hand feels from the fish (a signature per way of swimming) ---------- */
function fishHaptics(dt,f){
  const rh=rodHand();if(!rh)return;const tn=clamp(F.tension/lineStrength(),0,1.3);
  if(F.state==='landing'){hapCont(rh,.18+.1*Math.abs(Math.sin(f.t*9)));return;}
  if(f.air)return;                                              // airborne: nothing on the line
  if(F.tension<.05)return;                                      // slack line is silence: reel in
  hapCont(rh,.05+.5*Math.min(1,tn));                            // steady hum that follows the strain
  f.hapAcc=(f.hapAcc||0);
  if(f.mode==='zig'||f.mode==='shake'){f.hapAcc+=dt*(f.mode==='shake'?14:10);while(f.hapAcc>=1){f.hapAcc-=1;hapPulse(rh,.22+.35*tn,18);}}
  else if(f.mode==='dive'||f.sp.str>=.6){f.hapAcc+=dt*2.6;while(f.hapAcc>=1){f.hapAcc-=1;hapPulse(rh,.55+.3*tn,80);}}
  else if(f.mode==='run')hapCont(rh,.12+.35*tn);
  else f.hapAcc=0;
}
/* ---------- the hooked fish: a body in the water ---------- */
function hookFish(self){
  const B=F.bite;F.bite=null;biteLoad=0;const r=railW();
  const pos=F.lure.clone();pos.y=waveH(pos.x,pos.z)-F.depth;
  const fish={sp:B.sp,sizeT:B.sizeT,len:B.len,kg:B.kg,str:B.sp.str*(.7+.6*B.sizeT),pos,vel:V(),stamina:1,mode:'run',modeT:1.2,t:0,side:Math.random()<.5?-1:1,
    air:false,prefDepth:lerp(B.sp.depth[0],B.sp.depth[1],.5),mass:.7+B.kg/15};
  F.fish=fish;F.state='hooked';F.slackT=0;F.breakT=0;F.line=Math.max(F.line,tipW(V()).distanceTo(pos)*.98);F.bail='closed';
  sfx.thump(1);hapPulse(rodHand(),1,150);bend.kick(1.6);
  msg(self?'Рыба засеклась сама!':'Есть!',self?'Скорее берите удочку':'Держите удилище вверх, следите за кольцом на катушке',1.8);
  const rec=newFish(fish.sp,fish.len,fish.kg);const ob=buildFish(rec);const holder=new THREE.Group();const inner=new THREE.Group();
  if(fish.sp.fam!=='flat')inner.rotation.x=-Math.PI/2;inner.add(ob.g);holder.add(inner);holder.visible=false;scene.add(holder);F.swim={holder,ob};
  S.fn.tut?.('hook');
}
function loseFish(text,sub,lostLure){
  msg(text,sub,2.4);F.state='ready';F.fish=null;F.tension=0;F.line=.4;
  if(F.swim){scene.remove(F.swim.holder);F.swim.ob.dispose();F.swim=null;}
  if(lostLure){F.hasLure=false;setLureModel(null);setTimeout(()=>msg('Приманка ушла с рыбой',renderer.xr.isPresenting?'Возьмите новую из ящика':'Привяжите новую: 1–5',2.2),2500);}
}
export function fishWorldPos(f,out){return out.copy(f.pos);}
const _a=V(),_d=V(),_aw=V(),_pp=V(),_tt=V();
function fishSwimDir(f,away,perp){
  switch(f.mode){
    case 'run':return _d.copy(away).addScaledVector(perp,f.side*.8).setY((f.pos.y<-f.prefDepth?.25:-.25)).normalize();
    case 'zig':return _d.copy(away).multiplyScalar(.4).addScaledVector(perp,Math.sign(Math.sin(f.t*f.sp.agility*3))).setY(0).normalize();
    case 'shake':return _d.set(rand(-1,1),rand(-.3,.3),rand(-1,1)).addScaledVector(away,.5).normalize();
    case 'dive':return _d.copy(away).multiplyScalar(.3).setY(-1).normalize();
    case 'charge':return _d.copy(away).negate().setY(.2).normalize();
    case 'jump':return _d.copy(away).setY(1.4).normalize();
    default:return _d.copy(away).multiplyScalar(.3);
  }
}
function updateFight(dt){
  const f=F.fish,sp=f.sp;f.t+=dt;const r=railW();const tip=tipW(V());
  const surf=waveH(f.pos.x,f.pos.z);
  _aw.set(f.pos.x-r.x,0,f.pos.z-r.z);const hd=_aw.length();_aw.divideScalar(Math.max(hd,1e-3));const perp=_pp.set(-_aw.z,0,_aw.x);
  if(F.state==='landing'){
    const goal=V(r.x+_aw.x*2.2,surf-.04,r.z+_aw.z*2.2);f.pos.lerp(goal,1-Math.exp(-2*dt));f.vel.set(0,0,0);F.landT+=dt;
    F.tension=.2+.12*Math.abs(Math.sin(f.t*9));
    if(Math.random()<dt*4){splash(f.pos,6,2.2,.8);if(Math.random()<.3)sfx.splash(.4);bend.kick(rand(-.3,.3));}
    if(F.landT>14){f.stamina=Math.min(1,f.stamina+.22);F.state='hooked';f.mode='run';f.modeT=2;msg('Ушла вглубь','Вымотайте её ещё раз',1.6);}
    return;
  }
  f.modeT-=dt;
  if(f.modeT<=0){const tired=f.stamina<.3;let m=(tired&&Math.random()<.6)?'rest':pick(sp.modes);if(m==='jump'&&f.pos.y<surf-2.5)m='run';
    f.mode=m;f.modeT=rand(1.2,2.8)*(m==='rest'?1.3:1);if(Math.random()<.4)f.side*=-1;}
  // forces: swimming, water drag, the line
  const swim=f.str*(.3+.7*f.stamina)*({run:1,zig:.85,shake:.7,dive:.95,rest:.25,charge:.9,jump:1.2}[f.mode]||1);
  const A=7/f.mass;
  _a.set(0,0,0);
  if(!f.air){
    _a.addScaledVector(fishSwimDir(f,_aw,perp),swim*A);
    _a.addScaledVector(f.vel,-2.2);
  }else _a.y-=9.8;
  // line: stretch of line + rod spring gives tension; the drag lets line slip when it is exceeded
  const toTip=_tt.copy(tip).sub(f.pos);const dist=toTip.length();toTip.divideScalar(Math.max(dist,1e-3));
  const rodAxis=V(0,1,0).applyQuaternion(rod.root.getWorldQuaternion(new THREE.Quaternion()));
  const flex=clamp(1-Math.abs(rodAxis.dot(toTip)),0,1);          // rod held at an angle to the line works as a spring
  const elastic=.02*F.line+.06+(rodInHand()?.35*flex:.05);
  let T=Math.max(0,dist-F.line)/elastic;
  const D=F.drag;
  if(T>D){const slip=(T-D)*elastic;F.line+=slip;F.slipAcc+=slip;T=D;if(F.slipAcc>.2){F.slipAcc=0;sfx.ratchet();hapPulse(freeHand(),.4,20);hapPulse(rodHand(),.3,20);}}
  // reeling shortens the line, harder the more the fish pulls
  if(F.reel>0){const g=F.reel*2.4*reelMult()*clamp(1-.75*T/D,.08,1)*dt;F.line=Math.max(1.2,F.line-g);F.clickAcc+=g;}
  if(!f.air)_a.addScaledVector(toTip,T*A);
  f.vel.addScaledVector(_a,dt);f.pos.addScaledVector(f.vel,dt);
  // water surface and depth limits
  const surf2=waveH(f.pos.x,f.pos.z);
  if(f.mode==='jump'&&!f.air&&f.pos.y>surf2-.6&&f.vel.y>0){f.air=true;f.vel.y=4.5+f.str*2;splash(f.pos,18,4,1.2);sfx.splash(1.2);}
  if(f.air){if(f.pos.y<surf2&&f.vel.y<0){f.air=false;f.mode='run';f.modeT=1.4;f.vel.multiplyScalar(.3);splash(f.pos,22,4.5,1.3);sfx.splash(1.4);bend.kick(1);hapPulse(rodHand(),.9,90);}}
  else{if(f.pos.y>surf2-.05){f.pos.y=surf2-.05;f.vel.y=Math.min(0,f.vel.y);}if(f.pos.y<surf2-(sp.depth[1]+6)){f.pos.y=surf2-(sp.depth[1]+6);f.vel.y=Math.max(0,f.vel.y);}}
  F.tension=damp(F.tension,f.air?T*.15:T,14,dt);F.depth=Math.max(0,surf2-f.pos.y);
  fishHaptics(dt,f);
  const LS=lineStrength();
  if(F.tension>LS)F.breakT+=dt;else F.breakT=Math.max(0,F.breakT-dt);
  if(F.breakT>.22){sfx.snap();hapPulse(rodHand(),1,200);bend.kick(-1.5);loseFish('Леска лопнула!','Кольцо было красным. Ослабьте фрикцион и держите удилище под углом к леске',true);return;}
  if(F.tension<.05)F.slackT+=dt;else F.slackT=Math.max(0,F.slackT-dt*2);
  if(F.slackT>((f.air||f.mode==='shake')?1.0:2.4)){loseFish('Сошла','Леска провисла. Подматывайте, когда рыба идёт к вам');return;}
  if(F.line>150){sfx.snap();loseFish('Катушка пуста','Рыба смотала всю леску. Затяните фрикцион',true);return;}
  // tiring: pulling against the way it swims wears it out faster (lead it with the rod)
  const against=Math.max(0,-fishSwimDir(f,_aw,perp).dot(toTip.clone().negate()));
  f.stamina=Math.max(0,f.stamina-dt/(sp.stam*1.6)*(.2+F.tension*1.2+against*F.tension*.8));
  if(hd<4.2&&!f.air){
    if(f.stamina<.35){F.state='landing';F.landT=0;
      const vr=renderer.xr.isPresenting;msg('Рыба у борта!',vr?(f.kg<=2.5?'Поднимите удилищем или подведите подсак':'Возьмите подсак у борта и подведите под рыбу'):'Резко мышь вверх или Пробел',2);S.fn.tut?.('landing');}
    else if(f.mode!=='run'){f.mode='run';f.modeT=2;msg('Рывок у борта!','Ещё не устала',1.2);}
  }
  if(f.pos.y>surf2-1.5&&Math.random()<dt*3)splash(V(f.pos.x,surf2,f.pos.z),4,1.5,.6);
}
function takeFishOut(){
  const f=F.fish;F.state='ready';F.fish=null;F.tension=0;F.line=.4;
  const sw=F.swim;F.swim=null;const ob=sw.ob;const w=new THREE.Vector3();sw.holder.getWorldPosition(w);
  ob.g.removeFromParent();scene.remove(sw.holder);ob.g.position.set(0,0,0);ob.g.quaternion.identity();
  const jr=save.journal[f.sp.id]||{n:0,best:0};const isRec=f.kg>jr.best;jr.n++;jr.best=Math.max(jr.best,f.kg);save.journal[f.sp.id]=jr;persist();
  const sub=fmtKg(f.kg)+' кг'+(isRec?' · рекорд!':'')+(f.sizeT>1?' · трофей':'');msg(f.sp.name,sub,2);
  sfx.splash(.8);splash(w,14,3,1);hapPulse(rodHand(),.8,120);
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
  const {ob}=takeFishOut();boat.add(ob.g);const tw=boat.worldToLocal(tipW(V()));ob.g.position.copy(tw).add(V(0,-.4,0));ob.g.quaternion.setFromEuler(new THREE.Euler(0,0,Math.PI/2));
  const it=addPiece(ob);const kin=new CANNON.Body({mass:0,type:CANNON.Body.KINEMATIC});kin.collisionResponse=false;kin.position.set(tw.x,tw.y,tw.z);world.addBody(kin);
  const c=new CANNON.DistanceConstraint(it.body,kin,.3,60);world.addConstraint(c);
  F.dangle={it,kin,c,p:tw.clone()};msg('Возьмите рыбу свободной рукой','Она подтянется к удилищу',1.8);S.fn.tut?.('dangle');
}
function netCatch(){
  const {ob}=takeFishOut();net.content.add(ob.g);ob.g.position.set(0,0,0);ob.g.quaternion.setFromEuler(new THREE.Euler(0,Math.PI/2,0));
  F.netted={ob};sfx.splash(1);hapPulse(freeHand(),.8,100);
  msg('В подсаке!','Достаньте рыбу рукой или переверните подсак над палубой',1.8);S.fn.tut?.('netted');
}
function releaseNetted(){const n=F.netted;if(!n)return null;F.netted=null;const ob=n.ob;boat.attach(ob.g);return addPiece(ob);}

/* ---------- reel: crank by hand, loads up under strain ---------- */
export const crank={held:false,hand:null,prevA:0,prevQ:null,acc:0,rate:0,angle:0};
function crankHandAngle(hp){const l=rod.crank.parent.worldToLocal(hp.clone()).sub(rod.crank.position);return Math.atan2(l.y,-l.z);}
S.fn.handGrabSpecial=h=>{
  const hp=h.grip.getWorldPosition(V());const rh=rodHand();
  if(F.dangle&&h!==rh){const it=F.dangle.it;const fp=it.obj.localToWorld(it.com.clone());if(hp.distanceTo(fp)<.5){snapToHand(it,hp);grabPiece(h,it);return true;}}
  if(rh&&rh!==h&&save.reelMode==='hand'&&hp.distanceTo(rod.knob.getWorldPosition(V()))<.15){
    crank.held=true;crank.hand=h;h.crank=true;crank.prevA=crankHandAngle(hp);crank.prevQ=h.grip.getWorldQuaternion(new THREE.Quaternion());
    h.mitt&&(h.mitt.visible=false);rod.knobHand.visible=true;hapPulse(h,.3,30);S.fn.tut?.('crank');return true;}
  if(F.netted&&!(netItem.heldBy===h)){const b=new THREE.Box3().setFromObject(F.netted.ob.g).expandByScalar(.06);if(b.containsPoint(hp)){const it=releaseNetted();if(it){grabPiece(h,it);return true;}}}
  if(F.state==='ready'){
    const end=rope.p[ROPE_N-1];
    if(F.hasLure&&hp.distanceTo(end)<.13){F.lureHold=h;hapPulse(h,.35,30);sfx.pick();msg('Держите приманку','Курком отстегните её от карабина',1.6);S.fn.tut?.('lurehold');return true;}
    for(const t of tackleSlots){if(hp.distanceTo(t.slot.getWorldPosition(V()))<.07){takeLure(h,t.lure.id);return true;}}
  }
  return false;
};
S.fn.onGrabPiece=(it,h)=>{
  if(F.dangle&&F.dangle.it===it){world.removeConstraint(F.dangle.c);world.removeBody(F.dangle.kin);F.dangle=null;msg('Снята с крючка','Несите на стол',1.2);S.fn.tut?.('unhooked');}
  if(F.netted&&F.netted.ob===it.vobj)F.netted=null;
};
S.fn.onToolGrab=(it,h)=>{if(it===rodItem)S.fn.tut?.('rod');if(it===netItem)S.fn.tut?.('net');};
S.fn.onRelease=(it,h)=>{if(it===netItem&&F.netted)releaseNetted();};
function updateCrank(dt){
  const h=crank.hand;if(!crank.held||!h)return;
  const gp=h.src&&h.src.gamepad;const sq=!!(gp&&gp.buttons[1]&&gp.buttons[1].pressed);const hp=h.grip.getWorldPosition(V());
  if(!sq||!rodHand()||hp.distanceTo(rod.knob.getWorldPosition(V()))>.3){crank.held=false;h.crank=false;h.prevSq=sq;h.mitt&&(h.mitt.visible=true);rod.knobHand.visible=false;return;}
  const a=crankHandAngle(hp);let da=a-crank.prevA;if(da>Math.PI)da-=TAU;if(da<-Math.PI)da+=TAU;crank.prevA=a;
  const q=h.grip.getWorldQuaternion(new THREE.Quaternion());const dq=q.clone().multiply(crank.prevQ.clone().invert());crank.prevQ=q;
  const ax=V(1,0,0).applyQuaternion(rod.crank.parent.getWorldQuaternion(new THREE.Quaternion()));const proj=dq.x*ax.x+dq.y*ax.y+dq.z*ax.z;let tw=2*Math.atan2(proj,dq.w);if(tw>Math.PI)tw-=TAU;if(tw<-Math.PI)tw+=TAU;
  let d=Math.abs(da)>Math.abs(tw)?da:tw;
  // first turn snaps the bail shut
  if(F.bail==='open'&&Math.abs(d)>.05){setBail(false);if(F.state==='water'||F.state==='flying')msg('Дужка закрыта','',.8);}
  // under strain the handle gets heavy; when the drag is slipping it barely moves
  const fight=F.state==='hooked'||F.state==='landing';const load=fight?clamp(F.tension/F.drag,0,1):0;
  const who=h===mainHand()?'main':'off';
  d*=1-.7*load;crank.angle+=d;crank.rate=damp(crank.rate,Math.abs(d)/Math.max(dt,1e-3),10,dt);crank.acc+=Math.abs(d);
  if(crank.acc>Math.PI/4){crank.acc=0;sfx.click(.07+load*.08);hapPulse(h,.15+load*.45,10+load*25);}
  if(fight&&load>.97&&Math.random()<dt*20)hapPulse(h,.6,15);
}
function takeLure(h,id){h.lureFree=true;const m=lureModel(LU[id]);m.name='heldLure';h.grip.add(m);m.position.set(0,-.02,-.05);h.heldLure=id;sfx.pick();hapPulse(h,.3,25);}
function updateHeldLures(){
  // a lure held on the line: trigger = unclip (click), letting go = it hangs again
  if(F.lureHold){const h=F.lureHold;const gp=h.src&&h.src.gamepad;const sq=!!(gp&&gp.buttons[1]&&gp.buttons[1].pressed);const trig=!!(gp&&gp.buttons[0]&&gp.buttons[0].value>.6);
    if(!sq||F.state!=='ready'){F.lureHold=null;}
    else if(trig&&!h.lureTrigPrev){F.hasLure=false;const id=F.lureId;setLureModel(null);F.lureHold=null;takeLure(h,id);h.lureFree=false;sfx.tie();hapPulse(h,.7,45);msg('Приманка отстёгнута','Поднесите любую к карабину, чтобы пристегнуть',1.8);}
    h.lureTrigPrev=trig;}
  for(const h of Object.values(HANDS)){if(!h||!h.heldLure)continue;const gp=h.src&&h.src.gamepad;const sq=!!(gp&&gp.buttons[1]&&gp.buttons[1].pressed);const hp=h.grip.getWorldPosition(V());
    const sp=rope.p[ROPE_N-1];
    if(hp.distanceTo(sp)>.16)h.lureFree=true;      // must be carried away from the carabiner before it can clip back
    if(F.state==='ready'&&!F.hasLure&&h.lureFree&&hp.distanceTo(sp)<.09){tieLure(h.heldLure);hapPulse(h,.7,40);const m=h.grip.getObjectByName('heldLure');if(m)h.grip.remove(m);h.heldLure=null;continue;}
    if(!sq){const m=h.grip.getObjectByName('heldLure');if(m)h.grip.remove(m);h.heldLure=null;}}
}

/* ---------- rod blank: a damped spring with inertia (it whips on a cast and loads under a fish) ---------- */
const bend={b:V(),v:V(),prevMid:null,prevVel:V(),
  kick(a){const dir=V(0,0,-1);this.v.addScaledVector(dir,a*3);}};
const _q1=new THREE.Quaternion(),_mid=V(),_v1=V(),_lt=V(),_tip=V();
function updateBend(dt){
  rod.root.updateMatrixWorld(true);const qi=rod.root.getWorldQuaternion(_q1).clone().invert();
  // inertia of the blank: acceleration of the rod's middle, felt opposite in the rod frame
  rod.root.localToWorld(_mid.set(0,1.3,0));
  let acc=V();if(bend.prevMid){const vel=_mid.clone().sub(bend.prevMid).divideScalar(Math.max(dt,1e-3));acc=vel.clone().sub(bend.prevVel).divideScalar(Math.max(dt,1e-3));bend.prevVel.copy(vel);}bend.prevMid=_mid.clone();
  acc.clampLength(0,200);const accL=acc.applyQuaternion(qi);
  // line load
  const load=V();const T=(F.state==='hooked'||F.state==='landing')?F.tension:biteLoad+(F.dangle?.25:0)+(F.state==='ready'||F.state==='wind'?.01+LU[F.lureId].mass*.0005:0);
  if(T>0){lineTarget(_lt);tipW(_tip);const dir=_lt.sub(_tip).normalize().applyQuaternion(qi);load.set(dir.x,0,dir.z).multiplyScalar(T*1.1+ (dir.y<0?T*.3:0));}
  const K=140,C=11;
  const f=V(load.x*K-accL.x*.045*K-bend.b.x*K-bend.v.x*C,0,load.z*K-accL.z*.045*K-bend.b.z*K-bend.v.z*C);
  bend.v.addScaledVector(f,dt);bend.b.addScaledVector(bend.v,dt);bend.b.clampLength(0,1.4);
  const B=bend.b.length();const ax=V(bend.b.z,0,-bend.b.x);const W=[.04,.08,.14,.2,.26,.28];
  for(let i=0;i<rod.segs.length;i++){if(B<1e-4)rod.segs[i].quaternion.identity();else rod.segs[i].quaternion.setFromAxisAngle(_v1.copy(ax).divideScalar(B),B*W[i]);}
}

/* ---------- rope ---------- */
function lineTarget(out){
  if(F.state==='flying'||F.state==='water')return out.copy(F.lure);
  if((F.state==='hooked'||F.state==='landing')&&F.fish){out.copy(F.fish.pos);if(F.swim&&F.swim.holder.visible)out.copy(F.swim.holder.position);return out;}
  if(F.dangle)return F.dangle.it.obj.localToWorld(V(F.dangle.it.vobj.fish.d.L*.45,0,0));
  return snapPoint(out);
}
function updateRope(dt){
  const hang=(F.state==='ready'||F.state==='wind')&&!F.lureHold;     // the lure just hangs on the line like a pendulum
  const A=tipW(V()),B=F.lureHold?F.lureHold.grip.getWorldPosition(V()):lineTarget(V());const dist=A.distanceTo(B);
  let rest=hang?Math.max(F.line,.3):(F.state==='hooked'||F.state==='landing')?Math.max(F.line,0):Math.max(F.line,dist);
  if(!hang)rest=Math.max(rest,dist*.999);
  if(!rope.ok){for(let i=0;i<ROPE_N;i++){rope.p[i].lerpVectors(A,B,i/(ROPE_N-1));rope.o[i].copy(rope.p[i]);}rope.ok=true;}
  const seg=rest/(ROPE_N-1);const g=-9.8*dt*dt;
  const iEnd=hang?ROPE_N:ROPE_N-1;const LUm=LU[F.lureId];
  for(let i=1;i<iEnd;i++){const p=rope.p[i],o=rope.o[i];const sw=waveH(p.x,p.z);const inW=p.y<sw;
    const vx=(p.x-o.x)*(inW?.55:.985),vy=(p.y-o.y)*(inW?.55:.985),vz=(p.z-o.z)*(inW?.55:.985);o.copy(p);p.x+=vx;p.y+=vy+(inW?g*.15:g);p.z+=vz;
    if(F.state==='flying'&&!inW){p.addScaledVector(wind,S.storm*.3*dt*dt*40);} }
  rope.p[0].copy(A);if(!hang)rope.p[ROPE_N-1].copy(B);
  for(let it=0;it<(hang?30:12);it++){
    for(let i=0;i<ROPE_N-1;i++){const a=rope.p[i],b=rope.p[i+1];_v1.subVectors(b,a);const l=_v1.length()||1e-6;const diff=(l-seg)/l;
      if(i===0)b.addScaledVector(_v1,-diff);else if(i+1===ROPE_N-1&&!hang)a.addScaledVector(_v1,diff);else{a.addScaledVector(_v1,diff*.5);b.addScaledVector(_v1,-diff*.5);}}
    rope.p[0].copy(A);if(!hang)rope.p[ROPE_N-1].copy(B);
  }
  if(hang||F.state==='ready'){F.lure.copy(rope.p[ROPE_N-1]);}
  const pa=lineGeo.attributes.position;for(let i=0;i<ROPE_N;i++)pa.setXYZ(i,rope.p[i].x,rope.p[i].y,rope.p[i].z);pa.needsUpdate=true;
}

/* ---------- per-frame, VR ---------- */
const tipPrev=V(),tipVel=V(),tipVelS=V();let vrFlickCd=0,trigPrev=false;
export function fishingVR(dt){
  const rh=rodHand();
  const tp=tipW(V());tipVel.copy(tp).sub(tipPrev).divideScalar(Math.max(dt,1e-3));tipPrev.copy(tp);tipVelS.lerp(tipVel,.35);vrFlickCd-=dt;
  updateCrank(dt);updateHeldLures();
  F.reel=0;
  if(rh){
    const gp=rh.src&&rh.src.gamepad;const trig=!!(gp&&gp.buttons[0]&&gp.buttons[0].value>.5);
    if(save.reelMode==='hand')F.reel=crank.held&&F.bail==='closed'?clamp(crank.rate/(TAU*1.5),0,1.2):0;
    else{const o=offHand();const og=o&&o.src&&o.src.gamepad;F.reel=og&&og.buttons[0]?og.buttons[0].value:0;if(F.reel>.1&&F.bail==='open')setBail(false);}
    // finger on the line: press = open the bail and pin the line; let go mid-swing = the lure flies
    if(trig&&!trigPrev&&F.state==='ready'){if(!F.hasLure)msg('Нет приманки','Возьмите её из ящика с приманками',1.6);else{setBail(true);F.state='wind';F.charge=0;}}
    if(F.state==='wind'){
      const sp=tipVelS.length();const v=tipVelS.clone().multiplyScalar(1.5);v.y=Math.max(v.y,sp*.45);v.clampLength(0,24);
      if(sp>1.2){const p=tp.clone(),vv=v.clone(),pa=arcGeo.attributes.position;let i=0,land=null;
        for(;i<ARC_N;i++){pa.setXYZ(i,p.x,p.y,p.z);for(let k=0;k<3;k++){vv.y-=9.8*.02;p.addScaledVector(vv,.02);}if(p.y<0){land=p.clone();break;}}
        for(let j=i;j<ARC_N;j++)pa.setXYZ(j,p.x,p.y,p.z);pa.needsUpdate=true;arc.visible=true;
        if(land){ringMark.position.set(land.x,waveH(land.x,land.z)+.05,land.z);ringMark.visible=true;}}
      else{arc.visible=false;ringMark.visible=false;}
      if(!trig){const sp2=tipVelS.length();if(sp2>1.2){launchLure(null,0,v);hapPulse(rodHand(),.3,30);}
        else{F.state='ready';setBail(false);arc.visible=false;ringMark.visible=false;msg('Слабый замах','Зажмите курок (палец на леске), махните и отпустите на взмахе',2);}}
    }
    // feathering: finger back on the spool slows the lure in the air
    F.feather=F.state==='flying'&&trig&&!trigPrev?true:F.feather&&trig;
    rh.fingerLine=trig&&(F.state==='wind'||F.state==='flying');
    trigPrev=trig;
    if(tipVel.y>1.7&&vrFlickCd<=0){vrFlickCd=.4;if(F.state==='water')tryHook();else if(F.state==='landing')liftOrNet();}
  }else{trigPrev=false;if(F.state==='wind'){F.state='ready';setBail(false);arc.visible=false;ringMark.visible=false;}}
  if(F.state==='landing'&&netItem.heldBy&&F.fish){const hc=net.hoop.getWorldPosition(V());if(hc.distanceTo(F.fish.pos)<.55)netCatch();}
  if(F.netted){const zdir=V(0,0,-1).applyQuaternion(net.root.getWorldQuaternion(new THREE.Quaternion()));
    if(zdir.y>.55||!netItem.heldBy&&!netItem.inHolster){releaseNetted();msg('Рыба на палубе','',1);}}
  if(F.dangle){const tgt=boat.worldToLocal(rodHand()?rod.root.localToWorld(V(0,.95,0)):tipW(V()));F.dangle.p.lerp(tgt,1-Math.exp(-3*dt));const kp=F.dangle.p;F.dangle.kin.position.set(kp.x,kp.y,kp.z);F.dangle.it.body.wakeUp();}
}
/* ---------- how each lure plays underwater, how well it is being fished, and what the rod hand feels ---------- */
function lurePlay(dt,L,reeling,maxD){
  const rh=rodHand();
  F.act=damp(F.act,clamp(F.reel,0,1),1.6,dt);
  // pauses: a stop of at least 0.4 s followed by moving again is a "pause" that makes the lure fall and play
  if(!reeling){F.pauseT+=dt;}else{if(F.pauseT>.4&&F.pauseT<3)F.pauseBonus=3;F.pauseT=0;}
  F.pauseBonus=Math.max(0,F.pauseBonus-dt);F.hopT+=dt;if(F.hopT>6)F.hops=Math.max(0,F.hops-dt*.5);
  let pres=.2;
  if(L.still)pres=!reeling&&F.depth>=maxD-.5?.95:reeling?.15:.5;
  else if(L.hop)pres=.15+.85*smooth(0,3,F.hops)*(F.hopT<4?1:.4);
  else if(L.vibe)pres=clamp(1-Math.abs(F.act-L.best)*1.8,.1,1)*(F.pauseBonus>0?1:.8)+(F.pauseBonus>0?.15:0);
  else if(L.tail)pres=clamp(1-Math.abs(F.act-L.best)*2.2,.1,1);
  else pres=clamp(1-Math.abs(F.act-L.best)*1.6,.1,1)+(F.pauseBonus>0?.25:0);
  F.pres=damp(F.pres,clamp(pres,0,1),2,dt);
  // feel in the rod hand
  if(!rh)return;
  if(L.flutter&&F.depth>.3){F.wobT+=dt*(reeling?2.2:1.1);while(F.wobT>=1){F.wobT-=1;hapPulse(rh,.2,40);bend.kick(.12);}}   // each roll of the spoon
  if(L.vibe&&reeling&&F.depth>.2){hapCont(rh,.14+.12*F.act);F.wobT+=dt*18;while(F.wobT>=1){F.wobT-=1;hapPulse(rh,.2,12);}}  // fine buzz
  if(L.tail&&reeling){hapCont(rh,.07+.05*F.act);}
  if(L.hop||L.still){
    if(!F.bottomHit&&F.depth>=maxD-.15&&!reeling){F.bottomHit=true;hapPulse(rh,.6,35);bend.kick(.5);sfx.tap(.5);}                 // knock on the bottom
    if(reeling||F.depth<maxD-1)F.bottomHit=false;
    if(L.hop&&!reeling&&F.depth<maxD-.3)hapCont(rh,.0);                                                                              // falling: slack, silence
  }
  if(!L.still&&!L.hop&&!L.vibe&&!L.tail&&reeling)hapCont(rh,.05);
}
/* ---------- per-frame, both ---------- */
export function updateFishing(dt){
  const r=railW();
  switch(F.state){
    case 'wind':F.charge=Math.min(1,F.charge+dt/1.1);break;
    case 'flying':{
      if(F.feather){F.lureVel.x*=Math.exp(-3*dt);F.lureVel.z*=Math.exp(-3*dt);}
      F.lureVel.multiplyScalar(Math.exp(-LU[F.lureId].air*dt));
      F.lureVel.y-=9.8*dt;F.lure.addScaledVector(F.lureVel,dt);F.line=Math.max(F.line,tipW(V()).distanceTo(F.lure)*1.02);
      rod.spool.rotation.y+=dt*40;hapCont(rodHand(),.12+(F.feather?.12:0));const h=waveH(F.lure.x,F.lure.z);
      if(F.lure.y<=h&&F.lureVel.y<0){const dist=Math.hypot(F.lure.x-r.x,F.lure.z-r.z);
        if(dist<3||F.lure.z>r.z+.3){F.state='ready';setBail(false);msg('Приманка упала у борта','Махните сильнее и в сторону моря',1.4);break;}
        F.state='water';F.depth=0;F.waterT=0;F.act=0;F.pres=.3;F.pauseT=0;F.pauseBonus=0;F.hops=0;F.hopT=99;F.bottomHit=false;F.bottom=clamp(6+dist*.55+(Math.sin(F.lure.x*.7)+Math.cos(F.lure.z*.5))*3,8,44);F.biteCheck=1.2;F.lure.y=h;hapPulse(rodHand(),.5,60);sfx.splash(.5);splash(F.lure,8,2,.5);
        if(!renderer.xr.isPresenting)F.bail='closed';
        else msg('Приманка в воде','Проверните катушку: дужка закроется, и можно вести',1.6);}
      break;}
    case 'water':{F.waterT+=dt;const L=LU[F.lureId];const dx=r.x-F.lure.x,dz=r.z-F.lure.z,dist=Math.hypot(dx,dz);
      const reeling=F.reel>.05&&F.bail==='closed';const maxD=Math.min(L.maxD,F.bottom);
      if(reeling){const spd=(F.bite?1.2:3.4)*F.reel*reelMult();F.lure.x+=dx/dist*spd*dt;F.lure.z+=dz/dist*spd*dt;
        if(L.sink<0)F.depth=Math.min(L.maxD,F.depth+1.6*F.reel*dt);else F.depth=Math.max(0,F.depth-F.reel*(L.hop?2.4:1.6)*dt);
        F.clickAcc+=spd*dt;if(F.clickAcc>.3&&!crank.held){F.clickAcc=0;sfx.click(.07);}}
      else{if(L.sink<0)F.depth=Math.max(0,F.depth+L.sink*dt);else F.depth=Math.min(maxD,F.depth+L.sink*dt);}
      lurePlay(dt,L,reeling,maxD);
      F.lure.addScaledVector(wind,S.storm*.35*dt);F.lure.y=waveH(F.lure.x,F.lure.z);
      F.line=tipW(V()).distanceTo(F.lure)+(F.bail==='open'?1.5+F.depth*.3:reeling?0:.4+F.depth*.15);
      // brought up to the boat: it climbs out of the water and hangs under the rod tip, no jump
      if(dist<1.7&&reeling&&!F.bite){F.state='ready';F.depth=0;F.line=Math.max(.5,tipW(V()).distanceTo(F.lure));F.lureVel.set(0,0,0);break;}
      if(F.bite)updateBite(dt);else{biteLoad=0;F.biteCheck-=dt;if(F.biteCheck<=0&&F.waterT>1.5){F.biteCheck=.5;startBite();}}
      break;}
    case 'ready':if(F.reel>.05&&F.bail==='closed'&&F.line>.4&&!F.lureHold){F.line=Math.max(.4,F.line-F.reel*2.4*reelMult()*dt);F.clickAcc+=F.reel*dt*2;if(F.clickAcc>.3&&!crank.held){F.clickAcc=0;sfx.click(.07);}}break;
    case 'hooked':case 'landing':updateFight(dt);break;
  }
  if(F.swim&&F.fish){
    const f=F.fish,h=F.swim.holder;h.visible=F.state==='landing'||f.air||F.depth<.9;h.position.copy(f.pos);
    if(!f.air&&F.state!=='landing')h.position.y=Math.max(h.position.y,waveH(f.pos.x,f.pos.z)-.25);
    const v=f.vel;const sp=Math.hypot(v.x,v.z);const yaw=sp>.2?Math.atan2(-v.z,v.x):h.rotation.y;
    h.rotation.y=yaw+Math.sin(f.t*(F.state==='landing'?18:10))*(F.state==='landing'?.6:.25);h.rotation.z=f.air?clamp(v.y*.15,-.9,.9):0;
  }
}
/* desktop rod pose */
let rodEl=.7,rodYaw=0;const _dir=V(),_zero=V(),_m1=new THREE.Matrix4();
export function updateDeskRod(dt,ndc){
  const nx=ndc.x,ny=ndc.y;let el;const yaw=-nx*.7;
  switch(F.state){case 'wind':el=.6+F.charge*1.55;break;case 'flying':el=.3;break;case 'water':el=.35+ny*.25;break;case 'hooked':case 'landing':el=.6+ny*.45;break;default:el=.8+ny*.15;}
  rodEl=damp(rodEl,el,F.state==='flying'?20:9,dt);rodYaw=damp(rodYaw,yaw,8,dt);
  const ce=Math.cos(rodEl);_dir.set(-Math.sin(rodYaw)*ce,Math.sin(rodEl),-Math.cos(rodYaw)*ce);
  _m1.lookAt(_zero,_dir,UP);deskHand.quaternion.setFromRotationMatrix(_m1);
}
export function deskCast(){const power=clamp(F.charge,.12,1);const dir=V(-Math.sin(rodYaw),0,-Math.cos(rodYaw)).applyQuaternion(rig.quaternion);dir.y=0;dir.normalize();launchLure(dir,power);}
/* visuals: rod bend, rope, lure, reel */
const ringCol=new THREE.Color();
export function updateRodLine(dt){
  updateBend(dt);updateRope(dt);
  if(!crank.held)crank.angle-=F.reel*dt*14;rod.crank.rotation.x=crank.angle;
  if(F.state==='hooked'&&F.slipAcc>0)rod.spool.rotation.y+=dt*12*clamp(F.tension/F.drag,0,1);
  rod.bail.rotation.y=damp(rod.bail.rotation.y,F.bail==='open'?2.6:0,18,dt);
  const end=rope.p[ROPE_N-1];
  lure.visible=F.hasLure&&!F.dangle&&F.state!=='hooked'&&F.state!=='landing'&&!(F.state==='water'&&F.depth>.3);
  lure.position.copy(end);
  // the lure hangs from the line: its top points along the last segment
  _v1.subVectors(rope.p[ROPE_N-2],end).normalize();lure.quaternion.setFromUnitVectors(UP,_v1);
  if(lureMesh){lureMesh.rotation.y+=dt*(F.state==='ready'?1.2:(LU[F.lureId].vibe?30:6));
    const tl=lureMesh.userData.tail;if(tl)tl.rotation.z=Math.sin(S.T*(8+F.act*10))*(.25+.45*F.act);}
  clip.visible=!F.hasLure&&F.state==='ready';clip.position.copy(end);clip.quaternion.copy(lure.quaternion);
  if(F.lureHold&&F.hasLure){/* carabiner stays on the line while a hand holds the lure */}
  const fight=F.state==='hooked'||F.state==='landing';const t=fight?F.tension/lineStrength():0;
  ringCol.setHex(!fight?0x3a8f6a:t<.6?0x4fd18b:t<.85?0xf2c14e:0xe0473a);rod.ring.material.color.copy(ringCol);
  rod.ring.scale.setScalar(fight&&t>.85?1+.15*Math.abs(Math.sin(S.T*18)):1);
  rod.dragKnob.material.color.setHSL(.02+.3*(1-F.drag/1.4),.6,.45);
  knobMat.emissive.setHex(0);
  if(rodHand()&&save.reelMode==='hand'&&!crank.held){const o=Object.values(HANDS).find(h=>h&&h!==rodHand());if(o&&o.grip.getWorldPosition(V()).distanceTo(rod.knob.getWorldPosition(V()))<.15)knobMat.emissive.setHex(0x664018);}
}
export function forceHook(sp,len){F.state='water';F.lure.set(0,0,-10);F.bail='closed';F.bite={sp,sizeT:.5,len,kg:Math.round(sp.k*len**3*100)/100};hookFish(false);}
export function resetFishing(){
  Object.assign(F,{state:'ready',bite:null,fish:null,tension:0,depth:0,line:.4,bail:'closed',feather:false});biteLoad=0;rope.ok=false;
  if(!F.hasLure){F.hasLure=true;setLureModel(F.lureId);}
  if(F.swim){scene.remove(F.swim.holder);F.swim=null;}
  if(F.dangle){world.removeConstraint(F.dangle.c);world.removeBody(F.dangle.kin);F.dangle=null;}
  if(F.netted){net.content.remove(F.netted.ob.g);F.netted=null;}
  arc.visible=false;ringMark.visible=false;
}
