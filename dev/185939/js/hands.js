/* Hands with fingers: a fisherman's glove. Fingers run along -Z, the back of the hand is +Y, the thumb is on +X: this is a LEFT hand, mirrored (scale.x=-1) for the right one.
   Poses come from the controller buttons, and from what is held (each object has its own grip). */
import { THREE, V, clamp, damp, save, Mat } from './core.js';

const GLOVE=0xd8a847,GLOVE2=0xc4923a,CUFF=0x2f6b73,SLEEVE=0x35444a;
/* finger = [length of 3 segments], knuckle position */
const FINGERS=[
  {n:'index', x:.030, z:-.088, len:[.036,.023,.019], w:.0165},
  {n:'middle',x:.010, z:-.092, len:[.040,.025,.020], w:.0170},
  {n:'ring',  x:-.010,z:-.089, len:[.036,.023,.019], w:.0160},
  {n:'pinky', x:-.029,z:-.083, len:[.028,.018,.016], w:.0145},
];
const matGlove=Mat(GLOVE,{roughness:.85,side:THREE.DoubleSide}),matGlove2=Mat(GLOVE2,{roughness:.85,side:THREE.DoubleSide}),matCuff=Mat(CUFF,{roughness:.8,side:THREE.DoubleSide}),matSleeve=Mat(SLEEVE,{roughness:.9,side:THREE.DoubleSide});
function seg(w,h,l,m){const g=new THREE.Mesh(new THREE.BoxGeometry(w,h,l),m);g.position.z=-l/2;return g;}

export function buildHand(){
  const root=new THREE.Group();
  // palm and back of the hand
  const palm=new THREE.Mesh(new THREE.BoxGeometry(.078,.024,.09),matGlove);palm.position.set(0,0,-.045);root.add(palm);
  const back=new THREE.Mesh(new THREE.BoxGeometry(.07,.006,.07),matGlove2);back.position.set(0,.014,-.05);root.add(back);
  const heel=new THREE.Mesh(new THREE.BoxGeometry(.07,.026,.03),matGlove);heel.position.set(0,-.001,.005);root.add(heel);
  // cuff and sleeve
  const cuff=new THREE.Mesh(new THREE.CylinderGeometry(.04,.037,.045,8),matCuff);cuff.rotation.x=Math.PI/2;cuff.position.set(0,0,.045);root.add(cuff);
  const sleeve=new THREE.Mesh(new THREE.CylinderGeometry(.034,.04,.1,8),matSleeve);sleeve.rotation.x=Math.PI/2;sleeve.position.set(0,0,.12);root.add(sleeve);
  const fingers=[];
  for(const f of FINGERS){
    const k=new THREE.Group();k.position.set(f.x,.002,f.z);root.add(k);
    const s1=seg(f.w,f.w*.9,f.len[0],matGlove);k.add(s1);
    const j2=new THREE.Group();j2.position.z=-f.len[0];k.add(j2);const s2=seg(f.w*.95,f.w*.85,f.len[1],matGlove);j2.add(s2);
    const j3=new THREE.Group();j3.position.z=-f.len[1];j2.add(j3);const s3=seg(f.w*.9,f.w*.8,f.len[2],matGlove2);j3.add(s3);
    fingers.push({k,j2,j3,len:f.len});
  }
  // thumb: base on the +X side
  const tb=new THREE.Group();tb.position.set(.04,-.004,-.03);tb.rotation.set(0,-.45,-.25);root.add(tb);
  tb.add(seg(.019,.017,.034,matGlove));
  const t2=new THREE.Group();t2.position.z=-.034;tb.add(t2);t2.add(seg(.018,.016,.028,matGlove));
  const t3=new THREE.Group();t3.position.z=-.028;t2.add(t3);t3.add(seg(.016,.014,.022,matGlove2));
  const thumb={k:tb,j2:t2,j3:t3};
  const cur=[0,0,0,0,0];            // thumb, index, middle, ring, pinky
  return {root,fingers,thumb,cur,pose:null};
}

/* apply 5 curls (0 open .. 1 closed) to the finger joints */
export function setCurls(hand,c){
  for(let i=0;i<4;i++){const f=hand.fingers[i];const v=c[i+1];
    f.k.rotation.x=-v*1.25;f.j2.rotation.x=-v*1.45;f.j3.rotation.x=-v*1.0;}
  const t=c[0];hand.thumb.k.rotation.set(-t*.25,-.45+t*.55,-.25+t*.1);hand.thumb.j2.rotation.set(-t*.35,t*.5,0);hand.thumb.j3.rotation.set(-t*.3,t*.35,0);
}

/* grips: curls for [thumb, index, middle, ring, pinky] */
export const POSES={
  rest:   [.15,.25,.35,.4,.45],
  reach:  [.1,.12,.15,.18,.2],
  rod:    [.62,.72,.8,.82,.82],
  rodLine:[.55,.12,.8,.82,.82],        // index finger stretched along the line on the spool
  knife:  [.45,.55,.82,.85,.85],
  scaler: [.6,.7,.8,.82,.82],
  net:    [.65,.75,.82,.82,.82],
  crank:  [.55,.55,.3,.12,.1],          // pinch
  lure:   [.5,.62,.5,.2,.15],           // pinch
  fish:   [.35,.5,.5,.5,.45],           // wrapped around the body
  piece:  [.3,.4,.4,.4,.38],
  organ:  [.6,.7,.72,.72,.7],           // a fistful
};
const TOOL_POSE={rod:'rod',knife:'knife',scaler:'scaler',net:'net'};

/* every frame: choose a pose and ease the fingers to it */
export function animateHand(h,dt){
  const hand=h.hand;if(!hand)return;
  if(!h.crank)hand.root.visible=!h.held&&!h.heldLure;
  const gp=h.src&&h.src.gamepad;
  let target;
  if(h.crank){/* the free hand is drawn on the reel handle by fishing.js */target=POSES.crank;}
  else if(h.heldLure||h.lureHold)target=POSES.lure;
  else if(h.held){
    const it=h.held;
    if(it.type==='tool')target=(it.tool==='rod'&&h.fingerLine)?POSES.rodLine:POSES[TOOL_POSE[it.tool]||'rod'];
    else if(it.vobj&&it.vobj.kind==='organ')target=POSES.organ;
    else if(it.vobj&&it.vobj.kind==='fish'&&it.body&&it.body.mass>.8)target=POSES.fish;
    else target=POSES.piece;
  }else{
    // free hand: fingers follow the buttons
    const bv=i=>{const b=gp&&gp.buttons[i];return b?(typeof b.value==='number'?b.value:(b.pressed?1:0)):0;};
    const sq=bv(1),tr=bv(0);
    const th=gp&&gp.buttons.some((b,i)=>i>=3&&(b.touched||b.pressed))?0.15:0.55;
    const open=POSES.reach,rest=POSES.rest;
    const base=h.hover?open:rest;
    target=[lerpv(base[0],th+.3*sq,.5),lerpv(base[1],tr,.85),lerpv(base[2],sq,.9),lerpv(base[3],sq,.9),lerpv(base[4],sq,.9)];
    target[0]=clamp(base[0]*.4+.45*sq+(th<.3?-.05:.1),0,1);
  }
  const k=1-Math.exp(-16*dt);
  for(let i=0;i<5;i++){if(!isFinite(hand.cur[i]))hand.cur[i]=0;const t=isFinite(target[i])?target[i]:0;hand.cur[i]+=(t-hand.cur[i])*k;}
  setCurls(hand,hand.cur);
}
const lerpv=(a,b,t)=>a+(b-a)*t;
