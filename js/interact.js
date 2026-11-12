/* Hands and objects: take it, it stays in your hand, throw it. Pieces of fish, organs and tools. */
import { THREE, S, V, UP, clamp, rand, damp, save, knifeMult, scene, camera, renderer, boat, TABLE, ICE, BUCKET, iceContent, bucketContent,
  HOLSTER, DECK_SPOT, fishRoot, Mat, sfx, msg, label, fmtKg, splash, fly } from './core.js';
import { hapPulse, hapCont, hapBoth, bindHands } from './haptics.js';
import { CANNON, world, G_STATIC, G_PIECE, G_ORGAN, G_TOOL } from './physics.js';
import { M, carve, scrape, split, evaluate, massOf, matAt, sampler } from './voxel.js';
const SKINS=[M.SKIN,M.SKIN2];

export const items=[];          // everything a hand can take: {type:'piece'|'tool', obj, body, com, vobj?, tool?, heldBy, ...}
export const links=[];          // organs hanging from an opened fish
const _m=new THREE.Matrix4(),_m2=new THREE.Matrix4(),_q=new THREE.Quaternion(),_v=V(),_v2=V();

/* ---------- bodies ---------- */
function bodyFromVoxels(ob){
  const N=Math.max(1,ob.count),vs=ob.vs;const b=clamp(Math.ceil(Math.cbrt(N/30)),1,18);
  const bx=Math.ceil(ob.nx/b),by=Math.ceil(ob.ny/b),bz=Math.ceil(ob.nz/b);const cnt=new Int32Array(bx*by*bz);const com=V();const c=V();let n=0;
  for(let z=0;z<ob.nz;z++)for(let y=0;y<ob.ny;y++)for(let x=0;x<ob.nx;x++){if(!ob.m[x+ob.nx*(y+ob.ny*z)])continue;cnt[((x/b)|0)+bx*(((y/b)|0)+by*((z/b)|0))]++;com.add(ob.center(x,y,z,c));n++;}
  if(n)com.divideScalar(n);
  const isOrgan=ob.kind==='organ';
  const body=new CANNON.Body({mass:massOf(ob),collisionFilterGroup:isOrgan?G_ORGAN:G_PIECE,collisionFilterMask:isOrgan?G_STATIC:(G_STATIC|G_PIECE|G_TOOL),
    linearDamping:isOrgan?.45:.12,angularDamping:isOrgan?.5:.3,allowSleep:true,sleepSpeedLimit:.06,sleepTimeLimit:.6});
  const thr=Math.max(1,b*b*b*.3);let shapes=0;
  for(let z=0;z<bz;z++)for(let y=0;y<by;y++){let x=0;while(x<bx){
    if(cnt[x+bx*(y+by*z)]<thr){x++;continue;}let xe=x;while(xe+1<bx&&cnt[xe+1+bx*(y+by*z)]>=thr)xe++;
    const lo=V(ob.o.x+x*b*vs,ob.o.y+y*b*vs,ob.o.z+z*b*vs),hi=V(ob.o.x+Math.min(ob.nx,(xe+1)*b)*vs,ob.o.y+Math.min(ob.ny,(y+1)*b)*vs,ob.o.z+Math.min(ob.nz,(z+1)*b)*vs);
    const h=hi.clone().sub(lo).multiplyScalar(.49),ctr=lo.add(hi).multiplyScalar(.5).sub(com);
    body.addShape(new CANNON.Box(new CANNON.Vec3(Math.max(h.x,.004),Math.max(h.y,.004),Math.max(h.z,.004))),new CANNON.Vec3(ctr.x,ctr.y,ctr.z));shapes++;x=xe+1;}}
  if(!shapes){const s=Math.max(vs,.01);body.addShape(new CANNON.Box(new CANNON.Vec3(s,s,s)));}
  return {body,com};
}
function placeBody(it){
  const g=it.obj;if(g.parent!==boat)boat.attach(g);
  const p=it.com.clone().applyQuaternion(g.quaternion).add(g.position);
  it.body.position.set(p.x,p.y,p.z);it.body.quaternion.set(g.quaternion.x,g.quaternion.y,g.quaternion.z,g.quaternion.w);
}
export function syncItems(){
  for(const it of items){const b=it.body;if(!b||!b.world)continue;if(it.heldBy&&it.kinematic)continue;
    it.obj.quaternion.set(b.quaternion.x,b.quaternion.y,b.quaternion.z,b.quaternion.w);
    it.obj.position.set(b.position.x,b.position.y,b.position.z).sub(_v.copy(it.com).applyQuaternion(it.obj.quaternion));}
}

/* ---------- pieces (voxel objects on the boat) ---------- */
export function addPiece(ob,vel){
  boat.attach(ob.g);
  const {body,com}=bodyFromVoxels(ob);
  const it={type:'piece',obj:ob.g,vobj:ob,body,com,heldBy:null};ob.item=it;
  placeBody(it);world.addBody(body);if(vel){body.velocity.copy(vel.v);body.angularVelocity.copy(vel.w);}
  items.push(it);S.pieces=items.filter(i=>i.type==='piece');
  return it;
}
export function rebuildBody(it){
  const vel=it.body?{v:it.body.velocity.clone(),w:it.body.angularVelocity.clone()}:null;const type=it.body?it.body.type:CANNON.Body.DYNAMIC;
  if(it.body&&it.body.world)world.removeBody(it.body);
  const {body,com}=bodyFromVoxels(it.vobj);it.body=body;it.com=com;placeBody(it);world.addBody(body);
  if(type===CANNON.Body.KINEMATIC){body.type=CANNON.Body.KINEMATIC;body.updateMassProperties();}
  if(vel){body.velocity.copy(vel.v);body.angularVelocity.copy(vel.w);}
  for(const l of links)if(l.a===it||l.b===it){world.removeConstraint(l.c);l.c=makeLinkConstraint(l);world.addConstraint(l.c);}
  for(const h of Object.values(HANDS))if(h&&h.held===it&&h.p2p){world.removeConstraint(h.p2p);h.p2p=null;regrab(h);}
}
export function removeItem(it){
  for(const l of [...links])if(l.a===it||l.b===it)unlink(l,true);
  for(const h of Object.values(HANDS))if(h&&h.held===it)dropHeld(h,true);
  if(mouse.it===it)mouseRelease();
  if(it.body&&it.body.world)world.removeBody(it.body);
  const i=items.indexOf(it);if(i>=0)items.splice(i,1);S.pieces=items.filter(i=>i.type==='piece');
}
export const pieceItems=()=>items.filter(i=>i.type==='piece');
export const boatPos=it=>it.body?V(it.body.position.x,it.body.position.y,it.body.position.z):it.obj.position.clone();
export const onTable=it=>{const p=boatPos(it);return Math.abs(p.x-TABLE.x)<.4&&Math.abs(p.z-TABLE.z)<.75&&p.y>TABLE.top-.04;};

/* ---------- organs hanging out of an opened belly ---------- */
function makeLinkConstraint(l){
  const pa=l.anchor.clone().sub(l.a.com),pb=l.anchor.clone().sub(l.b.com);
  return new CANNON.PointToPointConstraint(l.a.body,new CANNON.Vec3(pa.x,pa.y,pa.z),l.b.body,new CANNON.Vec3(pb.x,pb.y,pb.z),30);
}
function link(a,b,anchor){
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
  const line=new THREE.Line(g,new THREE.LineBasicMaterial({color:0xa8484a}));line.frustumCulled=false;boat.add(line);
  const l={a,b,anchor:anchor.clone(),line};l.c=makeLinkConstraint(l);world.addConstraint(l.c);links.push(l);return l;
}
function unlink(l,silent){world.removeConstraint(l.c);boat.remove(l.line);l.line.geometry.dispose();links.splice(links.indexOf(l),1);if(!silent){sfx.squelch();hapBoth(.7,80);}}
export function updateLinks(){
  for(const l of [...links]){
    if(l.a.body)l.b.body.wakeUp();
    const pa=l.anchor.clone().applyQuaternion(l.a.obj.quaternion).add(l.a.obj.position),pb=l.anchor.clone().applyQuaternion(l.b.obj.quaternion).add(l.b.obj.position);
    const a=l.line.geometry.attributes.position;a.setXYZ(0,pa.x,pa.y,pa.z);a.setXYZ(1,pb.x,pb.y,pb.z);a.needsUpdate=true;
    if(pa.distanceTo(pb)>.09)unlink(l);
  }
}
/* organ leaves the fish: becomes its own physical piece (optionally hanging on a string) */
export function releaseOrgan(fishIt,org,hang){
  const ob=fishIt.vobj;const i=ob.organs.indexOf(org);if(i<0)return null;ob.organs.splice(i,1);
  org.g.position.copy(ob.g.position);org.g.quaternion.copy(ob.g.quaternion);boat.add(org.g);
  const it=addPiece(org,fishIt.body?{v:fishIt.body.velocity.clone(),w:new CANNON.Vec3()}:null);
  if(hang)link(fishIt,it,org.anchor);
  S.fn.tut?.('organ');
  return it;
}
export function spillOrgans(fishIt){const ob=fishIt.vobj;if(!ob.open||!ob.organs.length)return;for(const org of [...ob.organs])releaseOrgan(fishIt,org,true);sfx.squelch();msg('Потроха вывалились','Оторвите их рукой',1.6);}

/* ---------- tools ---------- */
export function registerTool(tool,obj,shapeFn,mass,holster,gripPos,gripQuat){
  const body=new CANNON.Body({mass,collisionFilterGroup:G_TOOL,collisionFilterMask:G_STATIC|G_PIECE,linearDamping:.2,angularDamping:.4});
  shapeFn(body);
  const it={type:'tool',tool,obj,body,com:V(),heldBy:null,holster,gripPos,gripQuat,mats:[]};
  obj.traverse(o=>{if(o.isMesh&&o.material&&o.material.emissive&&!it.mats.includes(o.material)){o.material=o.material.clone();it.mats.push(o.material);}});
  items.push(it);toHolster(it);return it;
}
export function toHolster(it){
  if(it.body.world)world.removeBody(it.body);it.inHolster=true;
  boat.add(it.obj);it.obj.position.copy(it.holster.pos);it.obj.quaternion.copy(it.holster.quat);
}
function freeTool(it,vel,ang){
  it.inHolster=false;boat.attach(it.obj);placeBody(it);it.body.velocity.set(vel.x,vel.y,vel.z);it.body.angularVelocity.set(ang.x,ang.y,ang.z);
  if(!it.body.world)world.addBody(it.body);it.body.wakeUp();
}
export function setHi(it,on){
  if(it.type==='piece')it.vobj.mat.emissive.setHex(on?0x3a2a10:0);
  else for(const m of it.mats)m.emissive.setHex(on?0x5a4010:0);
}

/* ---------- hands ---------- */
export const HANDS={left:null,right:null};
bindHands(HANDS);
export const mainHand=()=>HANDS[save.rodHand==='left'?'left':'right'];
export const offHand=()=>HANDS[save.rodHand==='left'?'right':'left'];
export function handMatrixBoat(h,out){h.grip.updateMatrixWorld(true);boat.updateMatrixWorld(true);_m2.copy(boat.matrixWorld).invert();return out.multiplyMatrices(_m2,h.grip.matrixWorld);}
export function grabPiece(h,it){
  S.fn.onGrabPiece?.(it,h);
  h.held=it;it.heldBy=it.heldBy||h;setHi(it,false);it.body.wakeUp();
  const other=Object.values(HANDS).find(o=>o&&o!==h&&o.held===it);
  const light=it.body.mass<=12||other;
  // remember where the piece sits relative to the hand
  const hm=handMatrixBoat(h,new THREE.Matrix4());it.obj.updateMatrix();h.offset=new THREE.Matrix4().multiplyMatrices(hm.clone().invert(),it.obj.matrix);
  if(light){it.kinematic=true;it.body.type=CANNON.Body.KINEMATIC;it.body.updateMassProperties();it.body.velocity.setZero();it.body.angularVelocity.setZero();}
  else{it.kinematic=false;regrab(h);msg('Тяжёлая рыба','Возьмите второй рукой, чтобы поднять',1.4);}
  sfx.pick();hapPulse(h,.4,30);
  if(it.vobj&&it.vobj.open&&it.vobj.organs.length)setTimeout(()=>{if(it.heldBy)spillOrgans(it);},350);
}
function regrab(h){
  const it=h.held;if(!it||it.kinematic)return;const hp=boat.worldToLocal(h.grip.getWorldPosition(V()));
  h.kin=h.kin||(()=>{const b=new CANNON.Body({mass:0,type:CANNON.Body.KINEMATIC});b.collisionResponse=false;world.addBody(b);return b;})();
  h.kin.position.set(hp.x,hp.y,hp.z);const piv=it.body.pointToLocalFrame(new CANNON.Vec3(hp.x,hp.y,hp.z));
  h.p2p=new CANNON.PointToPointConstraint(it.body,piv,h.kin,new CANNON.Vec3(0,0,0),160);world.addConstraint(h.p2p);
}
function handVel(h){const hs=h.hist;if(hs.length<2)return V();const a=hs[0],b=hs[hs.length-1];const dt=b.t-a.t;return dt>1e-3?b.p.clone().sub(a.p).divideScalar(dt):V();}
function dropHeld(h,silent){
  const it=h.held;if(!it)return;h.held=null;
  if(h.p2p){world.removeConstraint(h.p2p);h.p2p=null;}
  const still=Object.values(HANDS).find(o=>o&&o!==h&&o.held===it);
  if(still){it.heldBy=still;const hm=handMatrixBoat(still,new THREE.Matrix4());it.obj.updateMatrix();still.offset=new THREE.Matrix4().multiplyMatrices(hm.clone().invert(),it.obj.matrix);return;}
  it.heldBy=null;
  const v=handVel(h).clampLength(0,6),w=h.angVel?h.angVel.clone().clampLength(0,10):V();
  if(it.type==='tool'){
    if(it.obj.parent===h.grip){boat.attach(it.obj);}
    const hp=it.obj.position;if(!silent&&hp.distanceTo(it.holster.pos)<.25){toHolster(it);sfx.tie();return;}
    freeTool(it,v,w);return;
  }
  if(it.kinematic){it.kinematic=false;it.body.type=CANNON.Body.DYNAMIC;it.body.updateMassProperties();}
  if(!silent){it.body.velocity.set(v.x,v.y,v.z);it.body.angularVelocity.set(w.x,w.y,w.z);}
  it.body.wakeUp();
}
function localBox(obj){
  obj.updateMatrixWorld(true);const inv=obj.matrixWorld.clone().invert(),b=new THREE.Box3(),m=new THREE.Matrix4();
  obj.traverse(o=>{if(!o.isMesh||!o.geometry||!o.visible)return;o.geometry.computeBoundingBox();b.union(o.geometry.boundingBox.clone().applyMatrix4(m.multiplyMatrices(inv,o.matrixWorld)));});
  return b;
}
function nearestFor(h){
  const hp=h.grip.getWorldPosition(V());let best=null,bd=1e9;
  for(const it of items){
    if(it.heldBy&&it.type==='tool')continue;
    if(it.type==='tool'){   // any point of the tool: the hand is tested against its own shape, not just the handle
      if(!it.lbox)it.lbox=localBox(it.obj);
      const d=it.lbox.distanceToPoint(it.obj.worldToLocal(hp.clone()));
      if(d<.06&&d*.8<bd){bd=d*.8;best=it;}continue;}
    const box=new THREE.Box3().setFromObject(it.obj);if(box.isEmpty())continue;box.expandByScalar(.035);
    if(box.containsPoint(hp)){const d=box.getCenter(_v2).distanceTo(hp)*.5+(it.vobj.kind==='organ'?-.05:0);if(d<bd){bd=d;best=it;}}
  }
  // organs inside an opened fish
  for(const it of pieceItems()){const ob=it.vobj;if(!ob.open||!ob.organs.length)continue;
    for(const org of ob.organs){const box=new THREE.Box3().setFromObject(org.g);if(box.isEmpty())continue;box.expandByScalar(.03);if(box.containsPoint(hp)){const d=-.1;if(d<bd){bd=d;best={type:'organIn',fish:it,org};}}}}
  return best;
}
export function updateHand(h,dt,gp){
  if(!h)return;const now=performance.now()/1000;const hp=boat.worldToLocal(h.grip.getWorldPosition(V()));
  h.hist=h.hist||[];h.hist.push({t:now,p:hp.clone()});while(h.hist.length>5)h.hist.shift();
  const q=h.grip.getWorldQuaternion(new THREE.Quaternion());if(h.prevQ){const dq=q.clone().multiply(h.prevQ.clone().invert());const ang=2*Math.acos(clamp(dq.w,-1,1));const ax=V(dq.x,dq.y,dq.z);if(ax.lengthSq()>1e-8)ax.normalize();h.angVel=ax.multiplyScalar((ang>Math.PI?ang-2*Math.PI:ang)/Math.max(dt,1e-3));}h.prevQ=q;
  const sq=!!(gp&&gp.buttons[1]&&gp.buttons[1].pressed);
  if(h.crank){h.prevSq=sq;return;}                       // the reel owns this hand while cranking
  if(!h.held){
    const n=nearestFor(h);const cand=n&&n.type!=='organIn'?n:null;
    if(cand!==h.hover){if(h.hover&&h.hover.type)setHi(h.hover,false);h.hover=cand;if(cand){setHi(cand,true);hapPulse(h,.12,12);}}
    if(sq&&!h.prevSq&&!S.fn.handGrabSpecial?.(h)){
      if(n&&n.type==='organIn'){const it=releaseOrgan(n.fish,n.org,false);if(it){sfx.squelch();grabPiece(h,it);}}
      else if(n&&n.type==='tool'){h.held=n;n.heldBy=h;setHi(n,false);if(n.body.world)world.removeBody(n.body);n.inHolster=false;
        // taken exactly as it lies relative to the hand: no snapping to a fixed grip
        if(n.follow){boat.attach(n.obj);n.obj.updateMatrix();n.offset=new THREE.Matrix4().multiplyMatrices(handMatrixBoat(h,new THREE.Matrix4()).invert(),n.obj.matrix);}
        else h.grip.attach(n.obj);
        sfx.pick();hapPulse(h,.4,30);S.fn.onToolGrab?.(n,h);}
      else if(n)grabPiece(h,n);
    }
  }else if(!sq&&h.prevSq){const it=h.held;dropHeld(h);S.fn.onRelease?.(it,h);}
  // held pieces follow the hand exactly
  const it=h.held;
  if(it&&it.type==='piece'&&it.heldBy===h){
    if(it.kinematic){
      const hm=handMatrixBoat(h,_m);const tm=_m2.multiplyMatrices(hm,h.offset);const pos=V(),quat=new THREE.Quaternion(),sc=V();tm.decompose(pos,quat,sc);
      it.obj.position.copy(pos);it.obj.quaternion.copy(quat);
      const cp=it.com.clone().applyQuaternion(quat).add(pos);const b=it.body;const k=1/Math.max(dt,1e-3);
      b.velocity.set((cp.x-b.position.x)*k,(cp.y-b.position.y)*k,(cp.z-b.position.z)*k);b.position.set(cp.x,cp.y,cp.z);b.quaternion.set(quat.x,quat.y,quat.z,quat.w);
    }else if(h.kin){const k=1/Math.max(dt,1e-3);h.kin.velocity.set((hp.x-h.kin.position.x)*k,(hp.y-h.kin.position.y)*k,(hp.z-h.kin.position.z)*k);h.kin.position.set(hp.x,hp.y,hp.z);}
    h.wt=(h.wt||0)-dt;if(h.wt<=0){h.wt=.2;hapPulse(h,clamp(.06+it.body.mass/20,.06,.7),40);}
  }
  h.prevSq=sq;
}

/* ---------- desktop mouse: Ctrl + drag lifts a piece ---------- */
export const mouse={it:null,c:null,kin:null,target:V(),lift:0};
export function mouseGrab(it,pW){
  mouseRelease();if(!it||!it.body)return;
  if(!mouse.kin){mouse.kin=new CANNON.Body({mass:0,type:CANNON.Body.KINEMATIC});mouse.kin.collisionResponse=false;world.addBody(mouse.kin);}
  const pl=boat.worldToLocal(pW.clone());mouse.kin.position.set(pl.x,pl.y,pl.z);mouse.target.copy(pl);
  mouse.c=new CANNON.PointToPointConstraint(it.body,it.body.pointToLocalFrame(new CANNON.Vec3(pl.x,pl.y,pl.z)),mouse.kin,new CANNON.Vec3(),400);
  world.addConstraint(mouse.c);it.body.wakeUp();mouse.it=it;mouse.lift=pW.y+.2;
  if(it.vobj.open&&it.vobj.organs.length)setTimeout(()=>{if(mouse.it===it)spillOrgans(it);},300);
}
export function mouseRelease(){if(mouse.c)world.removeConstraint(mouse.c);if(mouse.it&&mouse.it.body)mouse.it.body.wakeUp();mouse.it=null;mouse.c=null;}
export function updateMouseGrab(dt){if(!mouse.it)return;const b=mouse.kin,k=1/Math.max(dt,1e-3);b.velocity.set((mouse.target.x-b.position.x)*k,(mouse.target.y-b.position.y)*k,(mouse.target.z-b.position.z)*k);b.position.set(mouse.target.x,mouse.target.y,mouse.target.z);}

/* ---------- where pieces end up ---------- */
function iceSlot(){const n=iceContent.children.length;const col=n%3,row=Math.floor(n/3)%3,layer=Math.floor(n/9);return V((col-1)*.15,.015+layer*.03,(row-1)*.13);}
function bucketSlot(){return V(rand(-.06,.06),.02+Math.min(bucketContent.children.length,8)*.015,rand(-.06,.06));}
function fitScale(o,max){const b=new THREE.Box3().setFromObject(o);const s=b.getSize(V());return Math.min(1,max/Math.max(s.x,s.y,s.z,1e-3));}
export function toIce(it){
  const ev=evaluate(it.vobj);if(ev.waste){toBucket(it);return;}
  removeItem(it);for(const org of it.vobj.organs)org.g.visible=true;
  S.products.push({sp:it.vobj.fish.sp,kg:ev.kg,kind:ev.kind,value:ev.value});
  fly(it.obj,iceContent,iceSlot(),{dur:.6,arc:.35,scale:fitScale(it.obj,.3),keepQ:true});
  sfx.coin();label(ev.kind,`${fmtKg(ev.kg)} кг · ${Math.round(ev.value)} монет`,iceContent.localToWorld(V(0,.4,0)));
  S.fn.onIce?.(it,ev);
}
export function toBucket(it,silent){
  removeItem(it);fly(it.obj,bucketContent,bucketSlot(),{dur:.55,arc:.3,spin:4,scale:fitScale(it.obj,.22),onDone:()=>{while(bucketContent.children.length>12){const o=bucketContent.children[0];bucketContent.remove(o);o.userData.vobj&&o.userData.vobj.dispose();}}});
  if(!silent)sfx.squelch();
}
/* collect pieces dropped into the ice box or bucket; anything in the sea is brought back to the deck */
export function collect(dt){
  for(const it of [...items]){
    if(it.heldBy||mouse.it===it||!it.body||!it.body.world)continue;const p=it.body.position;
    if(it.type==='tool'){if(p.y<-.3||Math.abs(p.z)>3||p.x<-5||p.x>6){toHolster(it);msg('Инструмент на месте','Упал за борт, вернули в держатель',1.4);}continue;}
    if(Math.abs(p.x-ICE.position.x)<.27&&Math.abs(p.z-ICE.position.z)<.24&&p.y<.95&&p.y>.3){toIce(it);continue;}
    if(Math.hypot(p.x-BUCKET.position.x,p.z-BUCKET.position.z)<.17&&p.y<.5){toBucket(it);continue;}
    if(p.y<-.3||Math.abs(p.z)>3||p.x<-5||p.x>6){
      const w=it.obj.getWorldPosition(V());splash(w,10,2.5,.8);sfx.splash(.6);
      if(it.body.mass<.05||it.vobj.kind==='organ'){removeItem(it);boat.remove(it.obj);continue;}
      // forgiving: the sea throws it back on deck
      it.body.position.set(DECK_SPOT.x+rand(-.3,.3),.35,DECK_SPOT.z+rand(-.25,.25));it.body.velocity.setZero();it.body.angularVelocity.setZero();it.body.wakeUp();
      msg('Волной вернуло на палубу','',1.2);
    }
  }
  for(const it of items){if(!it.body||it.heldBy&&it.kinematic)continue;const b=it.body;const v=b.velocity.length();if(v>7)b.velocity.scale(7/v,b.velocity);}
}

/* what the blade edge is sitting in right now (for resistance) */
export function edgeMats(pts){
  const r={n:0,soft:0,hard:0,bone:0};const bb=new THREE.Box3().setFromPoints(pts).expandByScalar(.01);
  for(const it of pieceItems()){const box=new THREE.Box3().setFromObject(it.obj);if(!box.intersectsBox(bb))continue;
    for(const p of pts){const m=matAt(it.vobj,p);if(!m)continue;r.n++;if(!r.it)r.it=it;if(m===M.BONE)r.bone++;else if(m===M.HEAD||m===M.GILL||m===M.RIB)r.hard++;else r.soft++;}}
  return r;
}
export { sampler };
export function snapToHand(it,hpW){const pl=boat.worldToLocal(hpW.clone());it.obj.position.copy(pl).sub(it.com.clone().applyQuaternion(it.obj.quaternion));it.body.position.set(pl.x,pl.y,pl.z);it.body.velocity.setZero();}
/* ---------- cutting ---------- */
/* edge0/edge1: arrays of world points along the blade now and a moment ago */
export function knifeSweep(edgePrev,edgeNow,opts){
  const tris=[];for(let i=0;i<edgeNow.length-1;i++){const a0=edgePrev[i],b0=edgePrev[i+1],a1=edgeNow[i],b1=edgeNow[i+1];tris.push([a0,b0,b1],[a0,b1,a1]);}
  const bb=new THREE.Box3();for(const p of edgePrev)bb.expandByPoint(p);for(const p of edgeNow)bb.expandByPoint(p);bb.expandByScalar(.02);
  let total=0,bone=0,touched=[];const mats={};const addM=r=>{for(const k in r.mats)mats[k]=(mats[k]||0)+r.mats[k];};
  for(const it of pieceItems()){
    const box=new THREE.Box3().setFromObject(it.obj);if(!box.intersectsBox(bb))continue;
    const res=cutObj(it.vobj,tris,{...opts,edge:edgeNow});if(res.removed){total+=res.removed;touched.push(it);}bone+=res.bone;addM(res);
    for(const org of it.vobj.organs){const ob2=new THREE.Box3().setFromObject(org.g);if(ob2.intersectsBox(bb)){const r2=cutObj(org,tris,opts);addM(r2);total+=r2.removed;if(r2.removed&&!touched.includes(it))touched.push(it);}}
  }
  for(const it of touched)afterCut(it);
  return {removed:total,bone,mats};
}
function cutObj(ob,tris,opts){
  // a narrow kerf: the blade takes only what its edge actually passes through
  const kerf=opts.kerf??(.56+.1*(knifeMult()-1)*3);   // >0.5 voxel guarantees the cut really separates
  // flat blade never touches the meat: it only peels the skin layer it slides over
  if(opts.flat){
    // flat blade: cut only where the edge itself sits in the meat; sliding over the surface peels just the skin
    let inSolid=0,inMeat=0;
    const E=opts.edge||[],dense=[];for(let i=0;i<E.length-1;i++)for(let k=0;k<4;k++)dense.push(E[i].clone().lerp(E[i+1],k/4));if(E.length)dense.push(E[E.length-1]);
    for(const p of dense){const m=matAt(ob,p);if(!m)continue;inSolid++;if(m!==M.SKIN&&m!==M.SKIN2&&m!==M.FIN)inMeat++;}
    if(inMeat<2||inMeat<inSolid*.5)return carve(ob,tris,{kerf:kerf+.55,only:SKINS});
  }
  const res=carve(ob,tris,{kerf,chop:opts.chop});
  if(res.removed){
    const f=ob.fish;if(!f.bile&&((res.mats[M.GALL]||0)>0||(res.mats[M.STOMACH]||0)>2||(res.mats[M.GUT]||0)>2)){f.bile=true;msg('Задели потроха!','Желчь и содержимое попали на мясо, оно подешевеет',2.2);}
    if(ob.open&&!ob.wasOpen){ob.wasOpen=true;msg('Брюхо вскрыто','Достаньте потроха рукой',1.8);sfx.squelch();S.fn.tut?.('open');}
  }
  return res;
}
const pending=new Set();
export function markCut(it){afterCut(it);}
function afterCut(it){it.vobj.cut=true;it.vobj.flushMeshes();for(const o of it.vobj.organs)o.flushMeshes();pending.add(it);S.cutSound=1;}
let splitT=0;
export function processSplits(dt,force){
  splitT-=dt;if(!pending.size||(splitT>0&&!force))return;splitT=.15;
  for(const it of [...pending]){
    pending.delete(it);if(!items.includes(it))continue;const ob=it.vobj;
    for(const org of [...ob.organs]){if(org.splitPending){const parts=split(org);for(const p of parts){p.flushMeshes();ob.organs.push(p);ob.g.add(p.g);}if(org.count<=0){ob.organs.splice(ob.organs.indexOf(org),1);ob.g.remove(org.g);}}}
    if(!ob.splitPending)continue;
    const made=split(ob);ob.flushMeshes();
    if(ob.count<=0){removeItem(it);boat.remove(ob.g);continue;}
    const vel={v:it.body.velocity.clone(),w:it.body.angularVelocity.clone()};
    for(const nb of made){nb.flushMeshes();boat.add(nb.g);nb.g.position.copy(ob.g.position);nb.g.quaternion.copy(ob.g.quaternion);
      const nit=addPiece(nb,vel);if(nb.kind==='fish')S.fn.onPiece?.(nit);
      // a piece cut out of a held fish falls; the hand keeps the bigger part
    }
    rebuildBody(it);
    if(made.length){sfx.chop();S.fn.onSplit?.(it,made);}
  }
}
