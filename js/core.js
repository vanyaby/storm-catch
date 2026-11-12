/* Штормовой улов — shared core: helpers, data, scene, sea, boat, audio, UI */
import * as THREE from 'three';
export { THREE };

/* ---------------- helpers ---------------- */
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const lerp=(a,b,t)=>a+(b-a)*t;
export const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
export const rand=(a,b)=>a+Math.random()*(b-a);
export const pick=a=>a[Math.floor(Math.random()*a.length)];
export const damp=(a,b,l,dt)=>lerp(a,b,1-Math.exp(-l*dt));
export const hash=v=>{const s=Math.sin(v*127.1+311.7)*43758.5453;return s-Math.floor(s);};
export const fmtKg=k=>k.toLocaleString('ru-RU',{minimumFractionDigits:k<10?2:1,maximumFractionDigits:k<10?2:1});
export const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
export const UP=V(0,1,0);export const TAU=Math.PI*2;

/* ---------------- shared state ---------------- */
export const S={T:0,AMP:.18,storm:.05,rainI:0,flashT:0,gameState:'menu',view:'sea',tripT:0,products:[],pieces:[],cutSound:0,cutOnLine:false,
  boatHeaveV:0,shake:0,fn:{}};

/* ---------------- save + upgrades ---------------- */
const SAVE_KEY='storm-catch-v1';
export let save={money:0,line:0,knife:0,reel:0,journal:{},trips:0,comfort:0.4,reelMode:'hand',rodHand:'right',move:'smooth',tutorial:0,detail:'high'};
try{const s=JSON.parse(localStorage.getItem(SAVE_KEY)||'null');if(s)save=Object.assign(save,s);}catch(e){}
export function persist(){try{localStorage.setItem(SAVE_KEY,JSON.stringify(save));}catch(e){}}
export const UPG={
  line:{name:'Леска',vals:[1.0,1.3,1.75],cost:[0,140,360],desc:['0,30 мм, рвётся при туго затянутом фрикционе','0,40 мм, фрикцион можно затянуть сильнее','0,50 мм, держит крупного тунца']},
  reel:{name:'Катушка',vals:[1.0,1.3,1.6],cost:[0,110,290],desc:['Старая, выбирает медленно','С ручкой побольше, выбирает быстрее','Силовая, вытаскивает рыбу вдвое быстрее']},
  knife:{name:'Нож',vals:[1.0,1.3,1.6],cost:[0,90,230],desc:['Тупой, режет узкой полосой','Наточенный, режет шире и легче','Японская сталь, режет широко и разрубает кости']},
};
export const lineStrength=()=>UPG.line.vals[save.line];
export const reelMult=()=>UPG.reel.vals[save.reel];
export const knifeMult=()=>UPG.knife.vals[save.knife];

/* ---------------- species + lures ---------------- */
export const SPECIES=[
  {id:'mackerel',name:'Скумбрия',fam:'round',len:[.28,.46],k:9.5,price:14,hR:.18,wR:.12,xh:.8,
   back:0x2d7484,belly:0xdfe9e7,stripe:0x13262d,flesh:0xd99682,blood:0x6a2620,fin:0x3a5a62,
   str:.36,stam:6,agility:1.6,modes:['zig','run','zig','shake'],depth:[0,14],retrieve:1,storm:[0,1],w:1.0,bite:'rapid',window:.4,hot:3.2},
  {id:'perch',name:'Морской окунь',fam:'round',len:[.24,.44],k:14,price:16,hR:.32,wR:.14,xh:.74,
   back:0xc8432a,belly:0xf3a86b,flesh:0xf2c6b2,fin:0xd65a36,spiny:true,
   str:.42,stam:7,agility:.8,modes:['run','shake','charge','dive'],depth:[6,30],retrieve:.5,storm:[0,1],w:.85,bite:'double',window:.36},
  {id:'cod',name:'Треска',fam:'round',len:[.55,1.0],k:9,price:9,hR:.21,wR:.15,xh:.76,
   back:0x7d7647,belly:0xeae5cf,spots:0x4d482a,flesh:0xf0d2bd,fin:0x6a6440,liver:true,
   str:.6,stam:12,agility:.4,modes:['dive','run','rest','dive'],depth:[14,45],retrieve:0,storm:[0,1],w:.9,bite:'heavy',window:.6},
  {id:'halibut',name:'Палтус',fam:'flat',len:[.8,1.4],k:12,price:10,hR:.46,wR:.07,xh:.82,
   back:0x5c4b33,belly:0xf2eee5,spots:0x392d1d,flesh:0xf2d8c2,fin:0x4c3e2a,
   str:.85,stam:18,agility:.3,modes:['dive','rest','dive','run'],depth:[24,45],retrieve:0,storm:[.12,1],w:.4,bite:'snag',window:.7},
  {id:'tuna',name:'Тунец',fam:'round',len:[.9,1.4],k:15,price:11,hR:.27,wR:.21,xh:.8,
   back:0x1b2b5c,belly:0xd8dce6,flesh:0xa8232f,blood:0x45121a,fin:0xe9c23a,
   str:1.05,stam:26,agility:1,modes:['run','jump','charge','run','shake'],depth:[0,22],retrieve:1,storm:[.33,1],w:.45,bite:'hit',window:.3,hot:2.2},
  {id:'eel',name:'Грозовой угорь',fam:'eel',len:[.8,1.3],k:2.2,price:34,hR:.075,wR:.065,xh:.9,
   back:0x2a2575,belly:0x6c80e6,flesh:0xe8cde4,fin:0x5be7ff,glow:0x2fd6ff,
   str:.55,stam:10,agility:1.3,modes:['shake','zig','run'],depth:[0,25],retrieve:.5,storm:[.68,1],w:.6,bite:'buzz',window:.45},
];
export const SP=Object.fromEntries(SPECIES.map(s=>[s.id,s]));
export const LURES=[
  {id:'spoon',name:'Блесна',col:0xdfe4e6,metal:true,sink:1.9,maxD:45,mult:{mackerel:1.3,tuna:1.4}},
  {id:'jig',name:'Джиг',col:0xe5642c,sink:3.4,maxD:45,mult:{cod:1.6,perch:1.5,halibut:1.2,mackerel:.5,tuna:.4}},
  {id:'wobbler',name:'Воблер',col:0x3fbf6a,sink:-.6,maxD:3.5,mult:{mackerel:1.6,tuna:1.9,perch:.6,cod:.15,halibut:.1}},
  {id:'bait',name:'Донка с наживкой',col:0xc8a070,sink:3.0,maxD:45,mult:{halibut:2.4,cod:1.5,perch:1.1,mackerel:.3,tuna:.2,eel:.6}},
  {id:'glow',name:'Светящийся твистер',col:0x5be7ff,glow:true,sink:1.5,maxD:30,mult:{eel:2.6,mackerel:.6,tuna:.6}},
];
export const LU=Object.fromEntries(LURES.map(l=>[l.id,l]));

/* ---------------- renderer, scene, camera, rig ---------------- */
export const canvas=document.getElementById('c');
export const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth,innerHeight);
renderer.xr.enabled=true;
renderer.xr.setReferenceSpaceType('local-floor');
export const scene=new THREE.Scene();
scene.fog=new THREE.Fog(0xf4cfa8,60,420);
export const camera=new THREE.PerspectiveCamera(72,innerWidth/innerHeight,.03,1200);
camera.rotation.order='YXZ';
export const rig=new THREE.Group();scene.add(rig);rig.add(camera);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
export const hemi=new THREE.HemisphereLight(0xcfe9ff,0x2e5560,1.2);scene.add(hemi);
export const sun=new THREE.DirectionalLight(0xfff0d8,2.2);sun.position.set(-60,80,-120);scene.add(sun);
export const Mat=(c,o={})=>new THREE.MeshStandardMaterial(Object.assign({color:c,flatShading:true,roughness:.85,metalness:0},o));

/* ---------------- palettes ---------------- */
const PAL=[
  {top:0x5fb3d4,hor:0xf4cfa8,sea:0x1f7f8c,crest:0x8fdcd4,sun:0xffe2b0,hs:0xcfe9ff,hg:0x2e5560,dc:0xfff0d8,di:2.2,hi:1.2,fn:60,ff:420},
  {top:0x56677a,hor:0xcbb672,sea:0x2a4f58,crest:0x9bb7b6,sun:0xffd27a,hs:0x9aa8b4,hg:0x2b3a3e,dc:0xffe0a0,di:1.3,hi:1.0,fn:35,ff:300},
  {top:0x0c1116,hor:0x28323a,sea:0x0e171c,crest:0xb9c7ca,sun:0x2a3440,hs:0x56636e,hg:0x10181c,dc:0x9fb0c0,di:.55,hi:.8,fn:18,ff:170},
].map(p=>{const o={};for(const k in p)o[k]=['di','hi','fn','ff'].includes(k)?p[k]:new THREE.Color(p[k]);return o;});
const curPal={};for(const k in PAL[0])curPal[k]=PAL[0][k] instanceof THREE.Color?PAL[0][k].clone():PAL[0][k];
function blendPal(s){const a=s<.5?PAL[0]:PAL[1],b=s<.5?PAL[1]:PAL[2],t=s<.5?s*2:(s-.5)*2;for(const k in curPal){if(curPal[k] instanceof THREE.Color)curPal[k].copy(a[k]).lerp(b[k],t);else curPal[k]=lerp(a[k],b[k],t);}}

/* ---------------- waves (calm right next to the boat) ---------------- */
const WAVES=[[.8,.6,.17,1.05,1.0,0],[-.3,1,.29,1.45,.55,1.7],[1,-.25,.5,2.0,.3,4.1],[.2,-1,.86,2.7,.15,2.3],[-.7,-.7,1.4,3.4,.07,5.2]]
  .map(([x,z,k,s,a,p])=>{const l=Math.hypot(x,z);return [x/l,z/l,k,s,a,p];});
export function waveH(x,z){let h=0;for(const w of WAVES)h+=w[4]*Math.sin((w[0]*x+w[1]*z)*w[2]-w[3]*S.T+w[5]);return h*S.AMP*(.15+.85*smooth(3.5,11,Math.hypot(x,z)));}
const f4=n=>n.toFixed(4);
const GLSL_WAVE=`float waveH(vec2 p){float h=0.0;`+WAVES.map(w=>`h+=${f4(w[4])}*sin(dot(vec2(${f4(w[0])},${f4(w[1])}),p)*${f4(w[2])}-${f4(w[3])}*uT+${f4(w[5])});`).join('')+`return h*uA*(0.15+0.85*smoothstep(3.5,11.0,length(p)));}`;

const skyU={top:{value:new THREE.Color()},hor:{value:new THREE.Color()},sunc:{value:new THREE.Color()},sunDir:{value:V(-.4,.35,-.85).normalize()},flash:{value:0}};
export const sky=new THREE.Mesh(new THREE.SphereGeometry(900,24,14),new THREE.ShaderMaterial({
  uniforms:skyU,side:THREE.BackSide,depthWrite:false,fog:false,
  vertexShader:`varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`uniform vec3 top;uniform vec3 hor;uniform vec3 sunc;uniform vec3 sunDir;uniform float flash;varying vec3 vDir;
  void main(){vec3 d=normalize(vDir);float y=d.y;vec3 c=mix(hor,top,pow(clamp(y,0.0,1.0),0.55));if(y<0.0)c=hor*0.8;
  float s=max(dot(d,sunDir),0.0);c+=sunc*(pow(s,300.0)*1.2+pow(s,12.0)*0.12);c+=vec3(flash*0.9,flash*0.95,flash);gl_FragColor=vec4(c,1.0);
  #include <colorspace_fragment>
  }`
}));
sky.renderOrder=-10;scene.add(sky);
const seaU={uT:{value:0},uA:{value:.2},uDeep:{value:new THREE.Color()},uCrest:{value:new THREE.Color()},uFoam:{value:0}};
const seaMat=new THREE.MeshStandardMaterial({color:0xffffff,flatShading:true,roughness:.55,metalness:.05});
seaMat.onBeforeCompile=sh=>{
  Object.assign(sh.uniforms,seaU);
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nuniform float uT;uniform float uA;varying float vH;\n'+GLSL_WAVE)
   .replace('#include <begin_vertex>','vec3 transformed=vec3(position);vec4 wp0=modelMatrix*vec4(position,1.0);float hh=waveH(wp0.xz);transformed.y+=hh;vH=hh/max(uA,0.05);');
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform vec3 uDeep;uniform vec3 uCrest;uniform float uFoam;varying float vH;')
   .replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb=mix(uDeep,uCrest,smoothstep(0.15,1.5,vH));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.93,0.96,0.96),uFoam*smoothstep(1.0,1.45,vH));');
};
const seaGeo=new THREE.PlaneGeometry(360,360,140,140);seaGeo.rotateX(-Math.PI/2);
export const sea=new THREE.Mesh(seaGeo,seaMat);sea.frustumCulled=false;scene.add(sea);
{
  const isleMat=Mat(0x3f5148,{roughness:1}),rockMat=Mat(0x5a5f60,{roughness:1});
  [[-150,-230,40,14],[210,-260,60,18],[-300,40,50,22],[260,120,35,10],[40,-330,30,12]].forEach(([x,z,r,h],i)=>{
    const m=new THREE.Mesh(new THREE.IcosahedronGeometry(1,1),i%2?rockMat:isleMat);m.scale.set(r,h,r*.8);m.position.set(x,-2,z);m.rotation.y=i;scene.add(m);});
}
const lighthouse=new THREE.Group();lighthouse.position.set(-150,8,-230);scene.add(lighthouse);
{const w=Mat(0xf2efe6),r=Mat(0xb83a2a);for(let i=0;i<4;i++){const s=new THREE.Mesh(new THREE.CylinderGeometry(2.2-i*.3,2.5-i*.3,5,8),i%2?r:w);s.position.y=2.5+i*5;lighthouse.add(s);}
 const lamp=new THREE.Mesh(new THREE.SphereGeometry(1.4,8,6),new THREE.MeshBasicMaterial({color:0xfff2b0}));lamp.position.y=21.5;lighthouse.add(lamp);}
const beam=new THREE.Mesh(new THREE.ConeGeometry(8,140,12,1,true),new THREE.MeshBasicMaterial({color:0xfff2c0,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,fog:false}));
beam.geometry.translate(0,-70,0);beam.rotation.z=Math.PI/2;const beamPivot=new THREE.Group();beamPivot.position.y=21.5;beamPivot.add(beam);lighthouse.add(beamPivot);
const RAIN_N=1400;const rainPos=new Float32Array(RAIN_N*6);
for(let i=0;i<RAIN_N;i++){const x=rand(-25,25),y=rand(0,22),z=rand(-25,25);rainPos.set([x,y,z,x+.15,y-.7,z],i*6);}
const rainGeo=new THREE.BufferGeometry();rainGeo.setAttribute('position',new THREE.BufferAttribute(rainPos,3));
const rain=new THREE.LineSegments(rainGeo,new THREE.LineBasicMaterial({color:0xc8d6dc,transparent:true,opacity:0,depthWrite:false}));rain.frustumCulled=false;scene.add(rain);
export const wind=V(.6,0,-.2).normalize();

/* ---------------- boat (stands still) ---------------- */
export const boat=new THREE.Group();boat.position.y=.05;scene.add(boat);
function hullShape(inset){const s=new THREE.Shape(),w=1.25-inset;s.moveTo(-3.1+inset,-w);s.lineTo(1.4,-w);s.quadraticCurveTo(3.0-inset,-w*.8,3.7-inset*1.6,0);s.quadraticCurveTo(3.0-inset,w*.8,1.4,w);s.lineTo(-3.1+inset,w);s.lineTo(-3.1+inset,-w);return s;}
function ringShape(outer,inner){const s=hullShape(outer);const h=hullShape(inner);s.holes.push(new THREE.Path(h.getPoints(6).reverse()));return s;}
{
  const hullG=new THREE.ExtrudeGeometry(hullShape(0),{depth:1.05,bevelEnabled:false,curveSegments:5});hullG.rotateX(Math.PI/2);boat.add(new THREE.Mesh(hullG,Mat(0x7a2b22)));
  const bandG=new THREE.ExtrudeGeometry(hullShape(-.01),{depth:.42,bevelEnabled:false,curveSegments:5});bandG.rotateX(Math.PI/2);boat.add(new THREE.Mesh(bandG,Mat(0xe7dcc4)));
  const deckG=new THREE.ShapeGeometry(hullShape(.06),5);deckG.rotateX(-Math.PI/2);const deck=new THREE.Mesh(deckG,Mat(0x9c7b55));deck.position.y=.01;boat.add(deck);
  for(let i=-6;i<=6;i++){const p=new THREE.Mesh(new THREE.BoxGeometry(6.4,.004,.012),Mat(0x6f553a));p.position.set(.1,.014,i*.18);boat.add(p);}
  const bwG=new THREE.ExtrudeGeometry(ringShape(0,.07),{depth:.92,bevelEnabled:false,curveSegments:5});bwG.rotateX(-Math.PI/2);boat.add(new THREE.Mesh(bwG,Mat(0x2f6b73)));
  const capG=new THREE.ExtrudeGeometry(ringShape(-.02,.09),{depth:.05,bevelEnabled:false,curveSegments:5});capG.rotateX(-Math.PI/2);const cap=new THREE.Mesh(capG,Mat(0xa77d4f));cap.position.y=.92;boat.add(cap);
  for(let i=0;i<14;i++){const p=new THREE.Mesh(new THREE.BoxGeometry(rand(.2,.5),rand(.1,.25),.01),Mat(0x5c9aa0));const side=i%2?1:-1;p.position.set(rand(-2.8,1.3),rand(.25,.75),side*1.255);boat.add(p);}
  const wh=new THREE.Group();wh.position.set(-1.85,0,0);boat.add(wh);
  const walls=new THREE.Mesh(new THREE.BoxGeometry(1.6,2.05,1.8),Mat(0xe9e1cc));walls.position.y=1.02;wh.add(walls);
  const roof=new THREE.Mesh(new THREE.BoxGeometry(1.8,.1,2.0),Mat(0x3a4a50));roof.position.y=2.1;wh.add(roof);
  const winM=new THREE.MeshStandardMaterial({color:0x2a2a20,emissive:0xffb24a,emissiveIntensity:.55,flatShading:true});
  for(const z of [-.45,.45]){const w=new THREE.Mesh(new THREE.BoxGeometry(.02,.5,.6),winM);w.position.set(.81,1.5,z);wh.add(w);}
  for(const z of [-.91,.91]){const w=new THREE.Mesh(new THREE.BoxGeometry(.8,.45,.02),winM);w.position.set(0,1.5,z);wh.add(w);}
  const lamp=new THREE.PointLight(0xffb060,4,7,1.5);lamp.position.set(.95,1.9,0);wh.add(lamp);
  const buoyM=Mat(0xe5642c);for(const z of [-.93,.93]){const b=new THREE.Mesh(new THREE.TorusGeometry(.22,.07,6,10),buoyM);b.position.set(-.3,1.15,z);wh.add(b);}
  const mast=new THREE.Mesh(new THREE.CylinderGeometry(.05,.07,4.2,6),Mat(0x8a6a45));mast.position.set(2.4,2.1,0);boat.add(mast);
  for(let i=0;i<3;i++){const c=new THREE.Mesh(new THREE.BoxGeometry(.5,.32,.4),Mat(0x8c6a42));c.position.set(-2.75,.16+(i===2?.32:0),i===2?-.2:(i?.25:-.25));boat.add(c);}
}
export const TABLE={x:1.3,z:-.32,top:.93};
{
  const top=new THREE.Mesh(new THREE.BoxGeometry(.72,.06,1.45),Mat(0x7d6346));top.position.set(TABLE.x,.87,TABLE.z);boat.add(top);
  for(const [dx,dz] of [[-.3,-.65],[.3,-.65],[-.3,.65],[.3,.65]]){const l=new THREE.Mesh(new THREE.BoxGeometry(.06,.84,.06),Mat(0x5c4732));l.position.set(TABLE.x+dx,.42,TABLE.z+dz);boat.add(l);}
  const board=new THREE.Mesh(new THREE.BoxGeometry(.56,.03,1.3),Mat(0xd9c49a,{roughness:.95}));board.position.set(TABLE.x,.915,TABLE.z);boat.add(board);
  // magnetic knife strip on the table's near edge
  const strip=new THREE.Mesh(new THREE.BoxGeometry(.03,.05,.35),Mat(0x2b2f31,{metalness:.6,roughness:.4}));strip.position.set(TABLE.x-.38,.93,TABLE.z+.45);boat.add(strip);
}
export const fishRoot=new THREE.Group();fishRoot.position.set(TABLE.x,TABLE.top,TABLE.z);fishRoot.rotation.y=Math.PI/2;boat.add(fishRoot);
export const hPlane=new THREE.Mesh(new THREE.PlaneGeometry(1.3,.52),new THREE.MeshBasicMaterial({color:0xd0a54c,transparent:true,opacity:.32,side:THREE.DoubleSide,depthWrite:false}));
hPlane.rotation.x=-Math.PI/2;hPlane.visible=false;fishRoot.add(hPlane);
hPlane.add(new THREE.LineSegments(new THREE.EdgesGeometry(hPlane.geometry),new THREE.LineBasicMaterial({color:0xd0a54c})));
export const ICE=new THREE.Group();ICE.position.set(1.28,0,.78);boat.add(ICE);
{
  const m=Mat(0x3d7f9a);const body=new THREE.Mesh(new THREE.BoxGeometry(.56,.62,.5),m);body.position.y=.31;ICE.add(body);
  const inner=new THREE.Mesh(new THREE.BoxGeometry(.5,.02,.44),Mat(0xe6f3f6,{roughness:.3}));inner.position.y=.6;ICE.add(inner);
  for(let i=0;i<10;i++){const c=new THREE.Mesh(new THREE.BoxGeometry(.06,.05,.06),Mat(0xd8f0f6,{roughness:.2,transparent:true,opacity:.9}));c.position.set(rand(-.2,.2),.62,rand(-.18,.18));c.rotation.set(rand(0,1),rand(0,1),0);ICE.add(c);}
  const lid=new THREE.Mesh(new THREE.BoxGeometry(.58,.05,.52),m);lid.position.set(.3,.85,0);lid.rotation.z=-1.25;ICE.add(lid);
}
export const iceContent=new THREE.Group();iceContent.position.y=.64;ICE.add(iceContent);
export const BUCKET=new THREE.Group();BUCKET.position.set(.62,0,-.98);boat.add(BUCKET);
{const b=new THREE.Mesh(new THREE.CylinderGeometry(.17,.13,.32,9,1,true),Mat(0x6e7a7e,{side:THREE.DoubleSide,metalness:.3}));b.position.y=.16;BUCKET.add(b);
 const bt=new THREE.Mesh(new THREE.CircleGeometry(.13,9),Mat(0x4c5558));bt.rotation.x=-Math.PI/2;bt.position.y=.01;BUCKET.add(bt);}
export const bucketContent=new THREE.Group();bucketContent.position.y=.12;BUCKET.add(bucketContent);
/* holsters (boat-local poses) */
export const HOLSTER={
  rod:{pos:V(.28,.62,-1.2),quat:new THREE.Quaternion().setFromEuler(new THREE.Euler(-.62,0,0))},
  knife:{pos:V(TABLE.x-.36,.95,TABLE.z+.54),quat:new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,-Math.PI/2))},
  scaler:{pos:V(TABLE.x-.36,.95,TABLE.z+.36),quat:new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,-Math.PI/2))},
  net:{pos:V(-.45,.98,-1.17),quat:new THREE.Quaternion().setFromEuler(new THREE.Euler(.35,0,0))},
};
{const tube=new THREE.Mesh(new THREE.CylinderGeometry(.03,.03,.3,6),Mat(0xb8bcc0,{metalness:.7,roughness:.35}));tube.position.copy(HOLSTER.rod.pos);tube.quaternion.copy(HOLSTER.rod.quat);tube.translateY(.15);boat.add(tube);
 const hook=new THREE.Mesh(new THREE.TorusGeometry(.03,.008,5,8,Math.PI),Mat(0xb8bcc0,{metalness:.7}));hook.position.copy(HOLSTER.net.pos).add(V(0,.05,.03));boat.add(hook);}
export const PLAYER=V(0,0,-.6), RAIL=V(0,.95,-1.25), DECK_SPOT=V(.62,.06,.55);

/* ---------------- lures + tackle box ---------------- */
export function lureModel(l){
  const g=new THREE.Group();
  const m=Mat(l.col,{metalness:l.metal?.9:.1,roughness:l.metal?.2:.5,emissive:l.glow?l.col:0,emissiveIntensity:l.glow?.8:0});let body;
  switch(l.id){
    case 'spoon':body=new THREE.Mesh(new THREE.OctahedronGeometry(.03,0),m);body.scale.set(.5,1.4,.25);break;
    case 'jig':body=new THREE.Mesh(new THREE.SphereGeometry(.014,6,4),m);{const t=new THREE.Mesh(new THREE.ConeGeometry(.01,.05,5),Mat(0xf2e3a0));t.position.y=-.03;t.rotation.x=Math.PI;g.add(t);}break;
    case 'wobbler':body=new THREE.Mesh(new THREE.CapsuleGeometry(.011,.045,3,6),m);break;
    case 'bait':body=new THREE.Mesh(new THREE.IcosahedronGeometry(.016,0),m);{const s=new THREE.Mesh(new THREE.SphereGeometry(.012,6,4),Mat(0x555a5c,{metalness:.6}));s.position.y=.06;g.add(s);}break;
    case 'glow':body=new THREE.Mesh(new THREE.CylinderGeometry(.007,.002,.06,5),m);break;
  }
  g.add(body);const h=new THREE.Mesh(new THREE.ConeGeometry(.005,.022,4),Mat(0xc22a2a));h.position.y=-.05;h.rotation.x=Math.PI;g.add(h);
  return g;
}
export const TACKLE=new THREE.Group();TACKLE.position.set(-.5,.48,-.42);TACKLE.rotation.y=.4;boat.add(TACKLE);
export const tackleSlots=[];
{
  const crate=new THREE.Mesh(new THREE.BoxGeometry(.42,.46,.36),Mat(0x8c6a42));crate.position.y=-.25;TACKLE.add(crate);
  const tray=new THREE.Mesh(new THREE.BoxGeometry(.4,.05,.3),Mat(0x2d5a63));TACKLE.add(tray);
  for(let i=0;i<5;i++){
    const div=new THREE.Mesh(new THREE.BoxGeometry(.004,.05,.3),Mat(0x22454c));div.position.set(-.2+i*.08,.01,0);TACKLE.add(div);
    const slot=new THREE.Group();slot.position.set(-.16+i*.08,.04,0);slot.rotation.x=Math.PI/2;TACKLE.add(slot);
    const lm=lureModel(LURES[i]);lm.scale.setScalar(1.3);slot.add(lm);tackleSlots.push({slot,lure:LURES[i]});
  }
}

/* ---------------- particles, labels, birds ---------------- */
const partGeo=new THREE.BufferGeometry();partGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,.05,0,-.04,-.03,0,.04,-.03,0],3));
const partMat=new THREE.MeshBasicMaterial({color:0xeef6f6,side:THREE.DoubleSide,transparent:true,opacity:.9});
const parts=[];for(let i=0;i<220;i++){const m=new THREE.Mesh(partGeo,partMat);m.visible=false;scene.add(m);parts.push({m,v:V(),life:0});}
let partI=0;
export function splash(p,n=12,spd=2.5,size=1){for(let i=0;i<n;i++){const o=parts[partI++%parts.length];o.m.visible=true;o.m.position.copy(p);o.m.scale.setScalar(size*rand(.6,1.4));o.v.set(rand(-1,1)*spd*.5,rand(.6,1.2)*spd,rand(-1,1)*spd*.5);o.life=rand(.5,1.1);o.m.rotation.set(rand(0,6),rand(0,6),0);}}
export function updateParts(dt){for(const o of parts){if(o.life<=0)continue;o.life-=dt;o.v.y-=9.8*dt;o.m.position.addScaledVector(o.v,dt);o.m.rotation.x+=dt*8;if(o.life<=0||o.m.position.y<waveH(o.m.position.x,o.m.position.z)-.2){o.life=0;o.m.visible=false;}}}
const floaters=[];
export function label(text,sub,pos,color='#efe6d2'){
  const c=document.createElement('canvas');c.width=512;c.height=sub?168:110;const g=c.getContext('2d');
  g.fillStyle='rgba(12,22,27,.78)';g.beginPath();g.roundRect(6,6,500,c.height-12,24);g.fill();
  g.textAlign='center';g.fillStyle=color;g.font='600 50px "Golos Text",system-ui,sans-serif';g.fillText(text,256,72);
  if(sub){g.font='500 36px "Golos Text",system-ui,sans-serif';g.fillStyle='#d0a54c';g.fillText(sub,256,132);}
  const tx=new THREE.CanvasTexture(c);tx.colorSpace=THREE.SRGBColorSpace;
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tx,transparent:true,depthTest:false}));s.renderOrder=30;
  s.scale.set(.42,.42*c.height/512,1);s.position.copy(pos);scene.add(s);floaters.push({s,t:0,dur:2.6});
}
export function updateFloaters(dt){for(let i=floaters.length-1;i>=0;i--){const f=floaters[i];f.t+=dt;f.s.position.y+=dt*.12;f.s.material.opacity=1-smooth(f.dur*.6,f.dur,f.t);if(f.t>f.dur){scene.remove(f.s);f.s.material.map.dispose();f.s.material.dispose();floaters.splice(i,1);}}}
export const hotspot={pos:V(6,0,-22),t:0};
const birds=[];
{const wingG=new THREE.BufferGeometry();wingG.setAttribute('position',new THREE.Float32BufferAttribute([0,0,-.12,0,0,.12,.55,0,0],3));wingG.computeVertexNormals();
 const bm=Mat(0xf2f2ee,{side:THREE.DoubleSide}),bd=Mat(0x9aa0a4);
 for(let i=0;i<6;i++){const g=new THREE.Group();const body=new THREE.Mesh(new THREE.ConeGeometry(.07,.42,5),bd);body.rotation.x=Math.PI/2;g.add(body);
  const l=new THREE.Mesh(wingG,bm),r=new THREE.Mesh(wingG,bm);r.scale.x=-1;g.add(l,r);scene.add(g);birds.push({g,l,r,ph:rand(0,6),rad:rand(3,7),h:rand(5,10),sp:rand(.4,.8)*(i%2?1:-1)});}}
export function updateBirds(dt){
  hotspot.t-=dt;if(hotspot.t<=0){hotspot.t=rand(60,95);const a=rand(-.75,.75),dd=rand(14,32);const r=boat.localToWorld(RAIL.clone());hotspot.pos.set(r.x+Math.sin(a)*dd,0,r.z-Math.cos(a)*dd);}
  const vis=S.storm<.82;
  for(const b of birds){b.g.visible=vis;b.ph+=dt*b.sp;b.g.position.set(hotspot.pos.x+Math.cos(b.ph)*b.rad,b.h+Math.sin(b.ph*3)*.4,hotspot.pos.z+Math.sin(b.ph)*b.rad);b.g.rotation.y=-b.ph+(b.sp>0?0:Math.PI);const f=Math.sin(S.T*9+b.ph*5)*.6;b.l.rotation.z=f;b.r.rotation.z=-f;}
  if(vis&&Math.random()<dt*.7){const p=hotspot.pos.clone().add(V(rand(-3,3),0,rand(-3,3)));p.y=waveH(p.x,p.z);splash(p,5,1.6,.6);}
  if(vis&&S.storm<.5&&Math.random()<dt*.06)sfx.gull();
}

/* ---------------- audio ---------------- */
export const AU={ctx:null,muted:false};
export function audioInit(){
  if(AU.ctx){if(AU.ctx.state!=='running')AU.ctx.resume();return;}
  const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
  const C=new AC();AU.ctx=C;AU.master=C.createGain();AU.master.gain.value=.8;AU.master.connect(C.destination);
  const len=C.sampleRate*2,buf=C.createBuffer(1,len,C.sampleRate),dd=buf.getChannelData(0);for(let i=0;i<len;i++)dd[i]=Math.random()*2-1;AU.noise=buf;
  const loop=(type,f,q=.7)=>{const s=C.createBufferSource();s.buffer=buf;s.loop=true;const fl=C.createBiquadFilter();fl.type=type;fl.frequency.value=f;fl.Q.value=q;const g=C.createGain();g.gain.value=0;s.connect(fl).connect(g).connect(AU.master);s.start();return {f:fl,g};};
  AU.ocean=loop('lowpass',420);AU.wind=loop('bandpass',500,1.3);AU.rain=loop('highpass',2600);AU.cut=loop('bandpass',2600,3);
  const o=C.createOscillator();o.type='sawtooth';o.frequency.value=500;const of=C.createBiquadFilter();of.type='bandpass';of.frequency.value=1200;of.Q.value=5;const og=C.createGain();og.gain.value=0;o.connect(of).connect(og).connect(AU.master);o.start();AU.whine={o,of,g:og};
}
function burst({f=2000,q=1,type='bandpass',dur=.05,vol=.3,f2,delay=0}){
  const C=AU.ctx;if(!C||AU.muted)return;const t=C.currentTime+delay;
  const s=C.createBufferSource();s.buffer=AU.noise;const fl=C.createBiquadFilter();fl.type=type;fl.frequency.setValueAtTime(f,t);if(f2)fl.frequency.exponentialRampToValueAtTime(f2,t+dur);fl.Q.value=q;
  const g=C.createGain();g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+.004);g.gain.exponentialRampToValueAtTime(.0008,t+dur);
  s.connect(fl).connect(g).connect(AU.master);s.start(t,Math.random()*1.5);s.stop(t+dur+.05);
}
function tone({f=440,f2,type='sine',dur=.2,vol=.2,delay=0}){
  const C=AU.ctx;if(!C||AU.muted)return;const t=C.currentTime+delay;
  const o=C.createOscillator();o.type=type;o.frequency.setValueAtTime(f,t);if(f2)o.frequency.exponentialRampToValueAtTime(f2,t+dur);
  const g=C.createGain();g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+.01);g.gain.exponentialRampToValueAtTime(.0008,t+dur);
  o.connect(g).connect(AU.master);o.start(t);o.stop(t+dur+.05);
}
export const sfx={
  click:(v=.12)=>burst({f:3200,q:4,dur:.018,vol:v}),
  ratchet:()=>{burst({f:2400,q:6,dur:.025,vol:.22});burst({f:1800,q:6,dur:.02,vol:.15,delay:.03});},
  tap:(v=.5)=>{tone({f:120,f2:70,dur:.09,vol:.25*v});burst({f:900,q:2,dur:.04,vol:.12*v});},
  thump:(v=1)=>{tone({f:90,f2:45,dur:.25,vol:.5*v});burst({f:500,q:1,dur:.12,vol:.25*v});},
  splash:(s=1)=>{burst({f:1400,f2:300,q:.6,type:'lowpass',dur:.45*s+.1,vol:.35*Math.min(1.4,s)});burst({f:4000,q:.8,dur:.2,vol:.1*s,delay:.03});},
  whoosh:()=>burst({f:600,f2:2400,q:1.5,dur:.3,vol:.22}),
  slap:()=>{burst({f:1800,q:.7,dur:.12,vol:.6});tone({f:200,f2:90,dur:.12,vol:.35});},
  snap:()=>{burst({f:5000,q:2,dur:.06,vol:.5});tone({f:900,f2:200,dur:.15,vol:.2,type:'triangle'});},
  chop:()=>{burst({f:1500,q:1.5,dur:.08,vol:.35});tone({f:180,f2:120,dur:.07,vol:.2});},
  bone:()=>{burst({f:3200,q:6,dur:.04,vol:.18});},
  squelch:()=>burst({f:500,f2:200,q:2,type:'lowpass',dur:.18,vol:.35}),
  coin:()=>{tone({f:1320,dur:.25,vol:.12,type:'triangle'});tone({f:1760,dur:.35,vol:.1,type:'triangle',delay:.08});},
  tie:()=>{burst({f:3000,q:5,dur:.03,vol:.2});burst({f:2400,q:5,dur:.03,vol:.18,delay:.06});},
  pick:()=>burst({f:1200,q:3,dur:.03,vol:.15}),
  gull:()=>{const b=rand(1500,2000);tone({f:b,f2:b*.65,dur:.28,vol:.05,type:'triangle'});tone({f:b*.9,f2:b*.6,dur:.22,vol:.04,type:'triangle',delay:.32});},
  thunder:(d=0)=>{burst({f:160,f2:40,type:'lowpass',q:.5,dur:3.2,vol:.75,delay:d});burst({f:400,f2:60,type:'lowpass',q:.5,dur:1.2,vol:.4,delay:d+.05});},
  buzz:()=>burst({f:4200,q:8,dur:.05,vol:.08}),
  wave:()=>burst({f:900,f2:120,type:'lowpass',q:.4,dur:2.5,vol:.9}),
};
export function audioUpdate(dt,tension){
  if(!AU.ctx)return;const t=AU.ctx.currentTime,m=AU.muted?0:1;
  AU.ocean.g.gain.setTargetAtTime(m*(.1+S.storm*.16),t,.2);
  AU.wind.g.gain.setTargetAtTime(m*Math.pow(S.storm,1.5)*.32,t,.3);AU.wind.f.frequency.setTargetAtTime(320+S.storm*650+Math.sin(S.T*.7)*120*S.storm,t,.3);
  AU.rain.g.gain.setTargetAtTime(m*S.rainI*.16,t,.3);
  AU.whine.g.gain.setTargetAtTime(m*(tension>.55?(tension-.55)*.12:0),t,.05);AU.whine.o.frequency.setTargetAtTime(380+tension*900,t,.05);
  AU.cut.g.gain.setTargetAtTime(m*S.cutSound*.35,t,.03);AU.cut.f.frequency.setTargetAtTime(S.cutOnLine?3400:2000,t,.05);
  S.cutSound=damp(S.cutSound,0,8,dt);
}

/* ---------------- UI ---------------- */
const $=id=>document.getElementById(id);
export const ui={hud:$('hud'),msg:$('msg'),hint:$('hint'),stormFill:$('stormFill'),stormTxt:$('stormTxt'),catchTxt:$('catchTxt'),lureTxt:$('lureTxt'),gauges:$('gauges'),
  gFill:$('gFill'),gTen:$('gTen'),gDrag:$('gDrag'),gLine:$('gLine'),gDragMk:$('gDragMk'),gBrkMk:$('gBrkMk'),gStam:$('gStam'),slap:$('slap'),
  bView:$('bView'),bIce:$('bIce'),bHome:$('bHome'),bMute:$('bMute'),start:$('start'),port:$('port'),portCard:$('portCard'),bStart:$('bStart'),bVR:$('bVR'),vrNote:$('vrNote')};
let msgTimer=0,lastHintKey='';
export const vrMsg={text:'',t:0};
export function msg(text,sub='',dur=2.2){ui.msg.innerHTML=text+(sub?`<small>${sub}</small>`:'');ui.msg.classList.add('show');msgTimer=dur;vrMsg.text=text+(sub?'. '+sub:'');vrMsg.t=dur+1;}
export function setHint(key,html){if(key===lastHintKey)return;lastHintKey=key;ui.hint.innerHTML=html;}
export function resetHint(){lastHintKey='';}
export function tickMsg(dt){if(msgTimer>0){msgTimer-=dt;if(msgTimer<=0)ui.msg.classList.remove('show');}vrMsg.t-=dt;}

/* ---------------- weather ---------------- */
const _v2=V();
export function updateEnv(dt){
  if(S.gameState==='sea'){S.tripT+=dt;S.storm=clamp(S.tripT/600,0,1);}else S.storm=damp(S.storm,.05,.5,dt);
  S.AMP=lerp(.16,1.5,Math.pow(S.storm,1.3));seaU.uT.value=S.T;seaU.uA.value=S.AMP;
  blendPal(S.storm);
  skyU.top.value.copy(curPal.top);skyU.hor.value.copy(curPal.hor);skyU.sunc.value.copy(curPal.sun);
  scene.fog.color.copy(curPal.hor).multiplyScalar(.95);scene.fog.near=curPal.fn;scene.fog.far=curPal.ff;
  seaU.uDeep.value.copy(curPal.sea);seaU.uCrest.value.copy(curPal.crest);seaU.uFoam.value=smooth(.45,.9,S.storm);
  hemi.color.copy(curPal.hs);hemi.groundColor.copy(curPal.hg);sun.color.copy(curPal.dc);
  S.flashT-=dt;let flash=0;
  if(S.storm>.68&&Math.random()<dt*.12*(S.storm-.6)*6){S.flashT=.25;sfx.thunder(rand(.4,1.6));}
  if(S.flashT>0)flash=S.flashT/.25*(Math.random()<.7?1:.4);
  skyU.flash.value=flash*.8;hemi.intensity=curPal.hi+flash*3;sun.intensity=curPal.di+flash*2;
  S.rainI=smooth(.42,.85,S.storm);rain.material.opacity=S.rainI*.5;
  const rp=rainGeo.attributes.position;const fall=(14+S.storm*10)*dt;const cp=camera.getWorldPosition(_v2);
  rain.position.set(cp.x,0,cp.z);
  for(let i=0;i<RAIN_N;i++){let y=rp.getY(i*2)-fall;if(y<-2)y+=24;const x=rp.getX(i*2),z=rp.getZ(i*2);rp.setXYZ(i*2,x,y,z);rp.setXYZ(i*2+1,x+.12+wind.x*.3*S.storm,y-.7,z+wind.z*.3*S.storm);}
  rp.needsUpdate=true;rain.visible=S.rainI>.01;
  beam.material.opacity=smooth(.35,.8,S.storm)*.18;beamPivot.rotation.y+=dt*.9;
  wind.applyAxisAngle(UP,dt*.01);
  sea.position.set(Math.round(rig.position.x/4)*4,0,Math.round(rig.position.z/4)*4);sky.position.copy(rig.position);
}

/* ---------------- flying objects ---------------- */
const anims=[];
export function fly(obj,toParent,toLocal,o={}){
  scene.attach(obj);
  anims.push({obj,toParent,toLocal:toLocal.clone(),from:obj.position.clone(),t:0,dur:o.dur||.7,arc:o.arc??.4,spin:o.spin||0,
    s0:obj.scale.x,s1:o.scale??obj.scale.x,endQ:o.endQ||null,keepQ:o.keepQ,onDone:o.onDone,keepParent:o.keepParent});
}
export function clearAnims(){anims.length=0;}
const _va=V();
export function updateAnims(dt){
  for(let i=anims.length-1;i>=0;i--){const a=anims[i];a.t+=dt;const u=clamp(a.t/a.dur,0,1),e=u<.5?2*u*u:1-Math.pow(-2*u+2,2)/2;
    const target=a.toParent===scene?_va.copy(a.toLocal):a.toParent.localToWorld(_va.copy(a.toLocal));
    a.obj.position.lerpVectors(a.from,target,e);a.obj.position.y+=Math.sin(Math.PI*u)*a.arc;
    a.obj.scale.setScalar(lerp(a.s0,a.s1,e));
    if(a.spin)a.obj.rotateX(a.spin*dt*(1-u));
    if(u>=1){anims.splice(i,1);
      if(!a.keepParent&&a.toParent!==scene){a.toParent.attach(a.obj);a.obj.position.copy(a.toLocal);if(!a.keepQ){if(a.endQ)a.obj.quaternion.copy(a.endQ);else a.obj.quaternion.identity();}}
      a.onDone&&a.onDone();}
  }
}
