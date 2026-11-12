/* Layered fish. The body is a smooth shape; what is inside (skin, meat, backbone, ribs, belly cavity, head)
   is computed from the position, never stored. A piece is that shape cut by a list of planes, so a fish can be
   cut anywhere and at any angle. The cut face is drawn by the shader from the same layer rules. */
import { THREE, S, V, clamp, smooth, hash, TAU, sun, hemi } from './core.js';

export const M={E:0,SKIN:1,FLESH:2,BLOOD:3,BONE:4,HEAD:5,GILL:6,EYE:7,FIN:8,STOMACH:9,LIVER:10,GUT:11,ROE:12,GALL:13,LINING:14,RIB:15,SKIN2:16,CAV:20};
export const ORGAN_NAME={[M.STOMACH]:'Желудок',[M.LIVER]:'Печень',[M.GUT]:'Кишечник',[M.ROE]:'Икра',[M.GALL]:'Жёлчный пузырь'};
const ORGAN_COL={[M.STOMACH]:0xc79c94,[M.LIVER]:0x7d3f28,[M.GUT]:0xdcbfa6,[M.ROE]:0xf08a3a,[M.GALL]:0x4f8a3a};
const MAXP=10,MAXN=6;
const FAM={round:0,flat:1,eel:2};

/* ---------- shape ---------- */
function shapeS(sp,xn){
  if(sp.fam==='eel'){let s=.62+.38*Math.sin(Math.PI*Math.min(1,xn*1.15+.05));if(xn>.92)s*=1-(xn-.92)/.08*.55;if(xn<.12)s*=.45+xn*4.5;return s;}
  if(sp.fam==='flat')return Math.pow(Math.sin(Math.PI*(.07+.86*xn)),.6);
  return Math.pow(Math.sin(Math.PI*(.06+.89*xn)),.75);
}
export function fishDims(sp,L){
  const H=xn=>.5*L*sp.hR*shapeS(sp,xn), W=xn=>.5*L*sp.wR*Math.pow(shapeS(sp,xn),.9), X=xn=>(xn-.5)*L;
  let wmax=0,hmax=0;for(let i=0;i<=40;i++){wmax=Math.max(wmax,W(i/40));hmax=Math.max(hmax,H(i/40));}
  return {L,H,W,X,wmax,hmax};
}
export function newFish(sp,len,kg){
  return {sp,len,kg,d:fishDims(sp,len),fresh:1,bile:false,female:Math.random()<.45,id:Math.random()};
}

/* ---------- the layer rules (same rules are in the shader) ---------- */
function prep(f){
  if(f.ready)return;f.ready=true;
  const sp=f.sp,d=f.d,L=d.L;
  if(sp.fam==='flat'){f.cav={c:V(d.X(.7),0,-d.H(.7)*.1),r:V(L*.075,d.W(.7)*.5,d.H(.7)*.3)};}
  else if(sp.fam==='eel'){f.cav={c:V(d.X(.62),0,-d.H(.6)*.2),r:V(L*.1,d.W(.6)*.5,d.H(.6)*.45)};}
  else f.cav={c:V(d.X(.52),0,-d.H(.5)*.33),r:V(d.H(.5)*.95,d.W(.5)*.5,d.H(.5)*.38)};
  f.zs=sp.fam==='flat'?0:d.H(.5)*.08;f.ribStep=L*.045;
  const ex=sp.fam==='flat'?.9:.91,eyes=sp.fam==='flat'?[[1,.25],[1,-.08]]:[[1,.3],[-1,.3]];
  f.er=Math.max(.004,d.H(ex)*(sp.id==='perch'?.26:.2));
  f.eyes=eyes.map(([sy,zf])=>V(d.X(ex),sy*d.W(ex)*Math.sqrt(Math.max(0,1-zf*zf)),zf*d.H(ex)));
  f.tail=L*(sp.fam==='eel'?.06:.15);f.nose=L*.04;
  f.finTop=sp.fam==='round'?d.H(.55)*(sp.spiny?1.95:1.6):d.hmax*1.02;
  // skin mask: R = skin is there, G = scales are there (u along the fish, v around it)
  f.skin=new Uint8Array(128*64*4).fill(255);f.skinTex=new THREE.DataTexture(f.skin,128,64);f.skinTex.needsUpdate=true;
  f.skinTex.magFilter=THREE.LinearFilter;f.skinTex.wrapT=THREE.RepeatWrapping;
  // volume samples: they give weight, composition and the area of a cut
  const N=6000,pts=new Float32Array(N*3),mat=new Uint8Array(N);const p=V();let n=0,guard=0;
  while(n<N&&guard++<N*20){p.set((Math.random()-.5)*L,(Math.random()*2-1)*d.wmax,(Math.random()*2-1)*d.hmax);
    const m=layerBase(f,p);if(!m||m===M.CAV||m===M.FIN)continue;pts[n*3]=p.x;pts[n*3+1]=p.y;pts[n*3+2]=p.z;mat[n]=m;n++;}
  f.N=n;f.pts=pts;f.mat=mat;
  // surface samples (for the skin share)
  const NS=1200;f.NS=NS;f.spts=new Float32Array(NS*3);f.suv=new Float32Array(NS*2);
  for(let i=0;i<NS;i++){const xn=.02+.96*Math.random(),th=Math.random()*TAU;const w=d.W(xn),h=d.H(xn);
    f.spts[i*3]=d.X(xn);f.spts[i*3+1]=Math.sin(th)*w*.97;f.spts[i*3+2]=Math.cos(th)*h*.97;f.suv[i*2]=xn;f.suv[i*2+1]=th;}
  let F0=0,H0=0;for(let i=0;i<n;i++){const m=mat[i];if(m===M.FLESH||m===M.BLOOD||m===M.LINING||m===M.SKIN)F0++;else if(m===M.HEAD||m===M.GILL||m===M.EYE)H0++;}
  f.F0=F0;f.H0=H0;
  f.geo=buildGeo(f);
}
const inTri=(px,pz,a,b,c)=>{const s1=(b[0]-a[0])*(pz-a[1])-(b[1]-a[1])*(px-a[0]),s2=(c[0]-b[0])*(pz-b[1])-(c[1]-b[1])*(px-b[0]),s3=(a[0]-c[0])*(pz-c[1])-(a[1]-c[1])*(px-c[0]);return (s1>=0&&s2>=0&&s3>=0)||(s1<=0&&s2<=0&&s3<=0);};
/* material at a fish-local point, ignoring cuts and the skin mask */
function layerBase(f,p){
  const sp=f.sp,d=f.d,L=d.L,xn=p.x/L+.5;
  if(xn<0||xn>1)return 0;
  const h=d.H(xn),w=Math.max(d.W(xn),.002);const e=(p.y/w)**2+(p.z/h)**2;
  if(e>1)return 0;
  const r=Math.sqrt(e),t=.0025/Math.min(w,h);
  for(const ep of f.eyes)if(p.distanceTo(ep)<f.er)return M.EYE;
  if(xn>=sp.xh){if(xn<sp.xh+.06&&Math.abs(p.y)>.5*w)return M.GILL;return r>1-t?M.HEAD:M.HEAD;}
  if(r>1-t)return M.SKIN;
  if(xn>.03&&Math.abs(p.y)<Math.max(.002,.13*w)&&Math.abs(p.z-f.zs)<Math.max(.002,.07*h))return M.BONE;
  const c=f.cav.c,cr=f.cav.r;const ce=((p.x-c.x)/cr.x)**2+((p.y-c.y)/cr.y)**2+((p.z-c.z)/cr.z)**2;
  if(ce<=1)return M.CAV;
  if(sp.fam!=='eel'&&xn>(sp.fam==='flat'?.25:.36)&&xn<(sp.fam==='flat'?.78:.72)){
    const ph=(((p.x-d.X(.36))/f.ribStep)%1+1)%1;const thick=.0024/f.ribStep;
    if(ph<thick&&Math.abs(p.y)<.32*w&&(sp.fam==='flat'?Math.abs(p.z)<.8*h:(p.z<f.zs&&p.z>-.8*h)))return M.RIB;
  }
  if(ce<=1.35)return M.LINING;
  if(sp.blood&&Math.abs(p.z)<.09*h&&Math.abs(p.y)>.45*w)return M.BLOOD;
  return M.FLESH;
}
function skinAt(f,xn,th){const u=clamp(Math.floor(xn*128),0,127),v=((Math.floor(th/TAU*64)%64)+64)%64;const i=(v*128+u)*4;return [f.skin[i],f.skin[i+1]];}
const thetaOf=(f,p,xn)=>{const w=Math.max(f.d.W(xn),.002),h=Math.max(f.d.H(xn),.002);return Math.atan2(p.y/w,p.z/h);};

/* ---------- objects: a fish piece or an organ ---------- */
const shared={uSunDir:{value:V(0,1,0)},uSunCol:{value:new THREE.Color()},uSky:{value:new THREE.Color()},uGround:{value:new THREE.Color()},uTime:{value:0},uWater:{value:new THREE.Color(0x0a3d4b)}};
export function updateFishShading(){
  shared.uSunDir.value.copy(sun.position).normalize();shared.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity);
  shared.uSky.value.copy(hemi.color).multiplyScalar(hemi.intensity);shared.uGround.value.copy(hemi.groundColor).multiplyScalar(hemi.intensity);shared.uTime.value=S.T;
}
let uidN=0;
export class FObj{
  constructor(fish,kind){
    prep(fish);this.fish=fish;this.kind=kind;this.organs=[];this.open=false;this.planes=[];this.notches=[];this.uid=++uidN;
    this.g=new THREE.Group();this.g.userData.vobj=this;this.item=null;this.cut=false;
    if(kind==='fish'){
      this.keep=new Uint8Array(fish.N).fill(1);this.skeep=new Uint8Array(fish.NS).fill(1);
      this.mat=makeMat(fish);this.mesh=new THREE.Mesh(fish.geo,this.mat);this.mesh.userData.vobj=this;this.mesh.frustumCulled=false;this.g.add(this.mesh);
    }
  }
  get count(){if(this.kind!=='fish')return 1;let n=0;for(let i=0;i<this.keep.length;i++)n+=this.keep[i];return n;}
  inside(p){for(const q of this.planes)if(q.x*p.x+q.y*p.y+q.z*p.z>q.w)return false;return true;}
  flushMeshes(){
    if(this.kind!=='fish')return;const u=this.mat.uniforms;
    for(let i=0;i<MAXP;i++)u.uPl.value[i].copy(this.planes[i]||V4(0,0,0,1));u.uNp.value=Math.min(MAXP,this.planes.length);
    for(let i=0;i<MAXN;i++){const nn=this.notches[i];u.uNo.value[i].copy(nn?nn.p:V4(0,0,0,1));u.uNoC.value[i].copy(nn?nn.c:V4(0,0,0,-1));}
    u.uNn.value=Math.min(MAXN,this.notches.length);u.uOpen.value=this.open?1:0;
  }
  setHi(on){if(this.kind==='fish')this.mat.uniforms.uHi.value=on?1:0;else for(const o of this.g.children)if(o.material&&o.material.emissive)o.material.emissive.setHex(on?0x3a2a10:0);}
  setSwim(a){if(this.kind==='fish')this.mat.uniforms.uSwim.value=a;}
  dispose(){if(this.mat)this.mat.dispose();for(const o of this.organs)o.dispose();if(this.kind==='organ')for(const o of this.g.children)o.geometry&&o.geometry.dispose();}
}
const V4=(x,y,z,w)=>new THREE.Vector4(x,y,z,w);

function makeOrgan(fish,mat,c,r){
  const ob=new FObj(fish,'organ');ob.organ=mat;ob.c=c.clone();ob.r=r.clone();
  const g=new THREE.SphereGeometry(1,16,12);const pa=g.attributes.position;
  for(let i=0;i<pa.count;i++){const x=pa.getX(i),y=pa.getY(i),z=pa.getZ(i);const k=1+.08*Math.sin(x*7+y*5)+.05*Math.sin(z*9);pa.setXYZ(i,x*k,y*k,z*k);}
  g.computeVertexNormals();
  const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:ORGAN_COL[mat],roughness:.32,metalness:.05,emissive:0}));
  m.scale.copy(r);m.position.copy(c);ob.g.add(m);m.userData.vobj=ob;
  ob.anchor=V(c.x+r.x*.9,c.y,c.z);
  return ob;
}
export function buildFish(fish){
  const ob=new FObj(fish,'fish');const f=fish,{c,r}=f.cav;
  const org=[
    [M.STOMACH,V(c.x+r.x*.3,c.y,c.z+r.z*.1),V(r.x*.42,r.y*.72,r.z*.5)],
    [M.LIVER,V(c.x+r.x*.45,c.y,c.z+r.z*.45),V(r.x*.32,r.y*.78,r.z*.3)],
    [M.GUT,V(c.x-r.x*.4,c.y,c.z-r.z*.15),V(r.x*.42,r.y*.6,r.z*.42)],
    [M.GALL,V(c.x+r.x*.18,c.y+r.y*.3,c.z+r.z*.45),V(Math.max(.004,r.x*.08),Math.max(.004,r.y*.25),Math.max(.004,r.z*.16))],
  ];
  if(f.female)org.push([M.ROE,V(c.x-r.x*.15,c.y,c.z+r.z*.3),V(r.x*.45,r.y*.65,r.z*.36)]);
  for(const [m,cc,rr] of org){const o=makeOrgan(f,m,cc,rr);ob.organs.push(o);ob.g.add(o.g);}
  ob.flushMeshes();
  return ob;
}

/* ---------- geometry: one smooth body per fish, shared by all its pieces ---------- */
function buildGeo(f){
  const d=f.d,sp=f.sp,NX=96,NT=40;const pos=[],fin=[],idx=[];
  const ring=[];
  for(let i=0;i<=NX;i++){const xn=i/NX;const w=Math.max(d.W(xn),.0015),h=Math.max(d.H(xn),.0015);const row=[];
    for(let j=0;j<NT;j++){const th=j/NT*TAU;row.push(pos.length/3);pos.push(d.X(xn),Math.sin(th)*w,Math.cos(th)*h);fin.push(0);}ring.push(row);}
  for(let i=0;i<NX;i++)for(let j=0;j<NT;j++){const a=ring[i][j],b=ring[i][(j+1)%NT],c=ring[i+1][j],e=ring[i+1][(j+1)%NT];idx.push(a,c,b,b,c,e);}
  // tail end and nose caps
  const tailC=pos.length/3;pos.push(d.X(0)-.002,0,0);fin.push(0);for(let j=0;j<NT;j++)idx.push(tailC,ring[0][j],ring[0][(j+1)%NT]);
  const noseC=pos.length/3;pos.push(d.X(1)+f.nose,0,-d.H(.98)*.15);fin.push(0);for(let j=0;j<NT;j++)idx.push(noseC,ring[NX][(j+1)%NT],ring[NX][j]);
  // check the winding: normals must point out
  const tmp=new THREE.BufferGeometry();tmp.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));tmp.setIndex(idx);tmp.computeVertexNormals();
  const nIdx=ring[NX>>1][0];const ny=tmp.attributes.normal.getZ(nIdx);if(ny<0)for(let k=0;k<idx.length;k+=3){const t=idx[k+1];idx[k+1]=idx[k+2];idx[k+2]=t;}
  tmp.dispose();
  // fins: thin double-sided plates
  const finTri=(a,b,c)=>{const s=pos.length/3;pos.push(...a,...b,...c);fin.push(1,1,1);idx.push(s,s+1,s+2);};
  const X0=d.X(.02),h0=d.H(.03),tail=f.tail,hs=sp.fam==='flat'?d.H(.5)*.5:sp.fam==='eel'?d.H(.2)*1.6:d.H(.5)*.95,notch=sp.fam==='flat'?.85:.55;
  finTri([X0,0,h0*.8],[X0-tail,0,hs],[X0-tail*notch,0,0]);finTri([X0,0,h0*.8],[X0-tail*notch,0,0],[X0,0,-h0*.8]);finTri([X0,0,-h0*.8],[X0-tail*notch,0,0],[X0-tail,0,-hs]);
  if(sp.fam==='round'){const fa=sp.spiny?.38:.45,fb=sp.spiny?.72:.68;finTri([d.X(fa),0,d.H(fa)*.85],[d.X(fb),0,d.H(fb)*.85],[d.X((fa+fb)/2-.04),0,f.finTop]);
    // pectoral fins
    const px=d.X(sp.xh-.04),pw=d.W(sp.xh-.04),ph=d.H(sp.xh-.04);for(const s of [1,-1])finTri([px,s*pw*.9,-ph*.2],[px-d.L*.09,s*pw*1.5,-ph*.55],[px-d.L*.02,s*pw*.9,-ph*.6]);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('aFin',new THREE.Float32BufferAttribute(fin,1));g.setIndex(idx);g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/* ---------- material: surface colours, cut faces from the layer rules ---------- */
const GLSL_COMMON=`
uniform float uL,uHR,uWR,uXh,uZs,uRib,uFam,uBlood,uStripeOn,uSpotsOn,uTuna,uEr,uNose;
uniform vec3 uCavC,uCavR,uEye1,uEye2;
float shapeS(float xn){
  if(uFam>1.5){float s=.62+.38*sin(3.14159*min(1.,xn*1.15+.05));if(xn>.92)s*=1.-(xn-.92)/.08*.55;if(xn<.12)s*=.45+xn*4.5;return s;}
  if(uFam>.5)return pow(max(sin(3.14159*(.07+.86*xn)),0.),.6);
  return pow(max(sin(3.14159*(.06+.89*xn)),0.),.75);}
float Hf(float xn){return .5*uL*uHR*shapeS(xn);}
float Wf(float xn){return .5*uL*uWR*pow(shapeS(xn),.9);}
float hash1(float n){return fract(sin(n*127.1+311.7)*43758.5453);}
/* 1 skin 2 flesh 3 blood 4 bone 5 head 6 gill 7 eye 14 lining 15 rib 20 cavity 0 none */
float layerAt(vec3 p){
  float xn=p.x/uL+.5;if(xn<0.||xn>1.)return 0.;
  float h=Hf(xn),w=max(Wf(xn),.002);float e=(p.y/w)*(p.y/w)+(p.z/h)*(p.z/h);if(e>1.)return 0.;
  float r=sqrt(e),t=.0025/min(w,h);
  if(distance(p,uEye1)<uEr||distance(p,uEye2)<uEr)return 7.;
  if(xn>=uXh){if(xn<uXh+.06&&abs(p.y)>.5*w)return 6.;return 5.;}
  if(r>1.-t)return 1.;
  if(xn>.03&&abs(p.y)<max(.002,.13*w)&&abs(p.z-uZs)<max(.002,.07*h))return 4.;
  vec3 q=(p-uCavC)/uCavR;float ce=dot(q,q);
  if(ce<=1.)return 20.;
  if(uFam<1.5){float a=uFam>.5?.25:.36,b=uFam>.5?.78:.72;
    if(xn>a&&xn<b){float ph=fract((p.x-(.36-.5)*uL)/uRib);float thick=.0024/uRib;
      bool zok=uFam>.5?abs(p.z)<.8*h:(p.z<uZs&&p.z>-.8*h);
      if(ph<thick&&abs(p.y)<.32*w&&zok)return 15.;}}
  if(ce<=1.35)return 14.;
  if(uBlood>.5&&abs(p.z)<.09*h&&abs(p.y)>.45*w)return 3.;
  return 2.;}
`;
const VS=`
attribute float aFin;
uniform float uSwim,uTime;
varying vec3 vL,vW,vN,vCam;varying float vFin;
${GLSL_COMMON}
void main(){
  vec3 p=position;float xn=p.x/uL+.5;
  float tw=pow(clamp(1.-xn,0.,1.),1.4)+.15;
  p.y+=uSwim*uL*.07*tw*sin(xn*7.-uTime*9.);
  vL=position;vFin=aFin;
  vec4 wp=modelMatrix*vec4(p,1.);vW=wp.xyz;
  vN=normalize(mat3(modelMatrix)*normal);
  vCam=(inverse(modelMatrix)*vec4(cameraPosition,1.)).xyz;
  gl_Position=projectionMatrix*viewMatrix*wp;}
`;
const FS=`
uniform mat4 modelMatrix;uniform mat4 projectionMatrix;
uniform vec4 uPl[${MAXP}];uniform int uNp;uniform vec4 uNo[${MAXN}];uniform vec4 uNoC[${MAXN}];uniform int uNn;
uniform sampler2D uSkin;uniform float uHi,uOpen;
uniform vec3 uBack,uBelly,uStripe,uSpots,uFlesh,uBloodC,uFinC,uSunDir,uSunCol,uSky,uGround,uWater;
varying vec3 vL,vW,vN,vCam;varying float vFin;
${GLSL_COMMON}
vec3 layerCol(float m,vec3 p){
  if(m<1.5)return uFlesh;
  if(m<2.5){float fr=6.2832/(uL/13.);float band=smoothstep(.8,.97,sin(p.x*fr+abs(p.z)*fr*1.7));return uFlesh*(1.-.17*band)*(.96+.06*hash1(floor(p.x*900.)));}
  if(m<3.5)return uBloodC;
  if(m<4.5)return vec3(.84,.78,.62);
  if(m<5.5)return vec3(.42,.16,.11);
  if(m<6.5)return vec3(.55,.04,.05);
  if(m<7.5)return vec3(.01);
  if(m<14.5)return vec3(.27,.28,.3);
  if(m<15.5)return vec3(.76,.68,.5);
  return vec3(.2,.05,.05);}
vec3 skinCol(float xn,float th){
  float c=cos(th),s=sin(th);vec3 col;
  if(uFam>.5&&uFam<1.5){col=s>0.?uBack:uBelly;if(s>0.&&uSpotsOn>.5&&hash1(floor(xn*60.)*7.1+floor(c*9.))>.74)col=uSpots;}
  else{col=mix(uBelly,uBack,smoothstep(-.25,.55,c));
    if(uStripeOn>.5&&c>.15&&sin(xn*58.+c*9.+sin(xn*21.)*2.)>.45)col=uStripe;
    if(uSpotsOn>.5&&c>-.1&&hash1(floor(xn*90.)*13.7+floor(th*14.))>.8)col=uSpots;
    if(uTuna>.5&&abs(c)<.22)col=mix(col,vec3(.33,.4,.51),.55);}
  return col;}
void main(){
  for(int i=0;i<${MAXP};i++){if(i>=uNp)break;if(dot(uPl[i].xyz,vL)>uPl[i].w)discard;}
  vec3 col;vec3 n=normalize(vN);float spec=0.;float depth=gl_FragCoord.z;
  if(gl_FrontFacing||vFin>.5){
    float xn=vL.x/uL+.5;
    if(vFin>.5){col=uFinC;n=gl_FrontFacing?n:-n;}
    else{
      float w=max(Wf(xn),.002),h=max(Hf(xn),.002);float th=atan(vL.y/w,vL.z/h);
      vec4 sk=texture2D(uSkin,vec2(xn,th/6.2832+(th<0.?1.:0.)));
      if(xn>=uXh){col=skinCol(xn,th);if(xn<uXh+.012&&uFam<.5)col*=.55;}
      else if(sk.r<.5){col=layerCol(2.,vL)*.92;spec=.25;}
      else{col=skinCol(xn,th);if(sk.g>.5){spec=.55;col*=.96+.08*sin(xn*uL*420.)*sin(th*40.);}else{col=mix(col,vec3(.85,.82,.76),.22);spec=.1;}}
      if(distance(vL,uEye1)<uEr||distance(vL,uEye2)<uEr){float de=min(distance(vL,uEye1),distance(vL,uEye2))/uEr;col=de<.62?vec3(.01):vec3(.85,.78,.4);spec=.9;}
      for(int i=0;i<${MAXN};i++){if(i>=uNn)break;
        if(abs(dot(uNo[i].xyz,vL)-uNo[i].w)<.0011&&distance(vL,uNoC[i].xyz)<uNoC[i].w)col=vec3(.35,.05,.05);}
    }
  }else{
    // the cut face: find where the eye ray enters the kept part, colour that point by its layer
    vec3 dir=normalize(vL-vCam);float te=-1e9;vec3 nc=vec3(0.);
    for(int i=0;i<${MAXP};i++){if(i>=uNp)break;float dn=dot(uPl[i].xyz,dir);if(dn<0.){float t=(uPl[i].w-dot(uPl[i].xyz,vCam))/dn;if(t>te){te=t;nc=uPl[i].xyz;}}}
    if(te<-1e8)discard;
    vec3 P=vCam+dir*te;float m=layerAt(P);
    if(m<.5)discard;
    if(m>19.5){ // looking into the belly: the far wall of the cavity
      vec3 o=(vCam-uCavC)/uCavR,dd=dir/uCavR;float A=dot(dd,dd),B=dot(o,dd),C=dot(o,o)-1.;float D=B*B-A*C;
      float t2=D>0.?(-B+sqrt(D))/A:te;P=vCam+dir*t2;col=vec3(.42,.3,.3);nc=-normalize((P-uCavC)/(uCavR*uCavR));
    }else col=layerCol(m,P);
    n=normalize(mat3(modelMatrix)*nc);
    vec4 cp=projectionMatrix*viewMatrix*modelMatrix*vec4(P,1.);depth=clamp(cp.z/cp.w*.5+.5,0.,1.);
    spec=.2;
  }
  float dl=max(dot(n,uSunDir),0.);vec3 amb=mix(uGround,uSky,n.y*.5+.5);
  vec3 lit=col*(uSunCol*dl+amb*.9)/3.14159;
  vec3 v=normalize(cameraPosition-vW);vec3 hv=normalize(v+uSunDir);lit+=uSunCol*spec*pow(max(dot(n,hv),0.),40.)*.05;
  lit+=vec3(.23,.16,.06)*uHi;
  if(vW.y<0.){lit=mix(uWater,lit,exp(vW.y*1.2));}
  gl_FragDepth=depth;
  gl_FragColor=vec4(lit,1.);
  #include <colorspace_fragment>
}`;
function makeMat(f){
  const sp=f.sp,d=f.d,col=c=>new THREE.Color(c??0);
  const u={
    uL:{value:d.L},uHR:{value:sp.hR},uWR:{value:sp.wR},uXh:{value:sp.xh},uZs:{value:f.zs},uRib:{value:f.ribStep},uFam:{value:FAM[sp.fam]},uBlood:{value:sp.blood?1:0},
    uStripeOn:{value:sp.stripe?1:0},uSpotsOn:{value:sp.spots?1:0},uTuna:{value:sp.id==='tuna'?1:0},uEr:{value:f.er},uNose:{value:f.nose},
    uCavC:{value:f.cav.c},uCavR:{value:f.cav.r},uEye1:{value:f.eyes[0]},uEye2:{value:f.eyes[1]},
    uPl:{value:Array.from({length:MAXP},()=>V4(0,0,0,1))},uNp:{value:0},uNo:{value:Array.from({length:MAXN},()=>V4(0,0,0,1))},uNoC:{value:Array.from({length:MAXN},()=>V4(0,0,0,-1))},uNn:{value:0},
    uSkin:{value:f.skinTex},uHi:{value:0},uOpen:{value:0},uSwim:{value:0},
    uBack:{value:col(sp.back)},uBelly:{value:col(sp.belly)},uStripe:{value:col(sp.stripe)},uSpots:{value:col(sp.spots)},uFlesh:{value:col(sp.flesh)},uBloodC:{value:col(sp.blood||sp.flesh)},uFinC:{value:col(sp.fin)},
    uSunDir:shared.uSunDir,uSunCol:shared.uSunCol,uSky:shared.uSky,uGround:shared.uGround,uTime:shared.uTime,uWater:shared.uWater,
  };
  return new THREE.ShaderMaterial({uniforms:u,vertexShader:VS,fragmentShader:FS,side:THREE.DoubleSide});
}

/* ---------- queries the game uses ---------- */
const _inv=new THREE.Matrix4(),_q=V();
function localOf(ob,pW,out){ob.g.updateMatrixWorld(true);_inv.copy(ob.g.matrixWorld).invert();return out.copy(pW).applyMatrix4(_inv);}
function matLocal(ob,p){
  if(ob.kind==='organ'){const q=_q2.copy(p).sub(ob.c).divide(ob.r);return q.lengthSq()<=1?ob.organ:0;}
  if(!ob.inside(p))return 0;
  const f=ob.fish;let m=layerBase(f,p);
  if(m===M.SKIN){const xn=p.x/f.d.L+.5;const [r,g]=skinAt(f,xn,thetaOf(f,p,xn));m=r<128?M.FLESH:g<128?M.SKIN2:M.SKIN;}
  if(m===M.CAV)return 0;
  return m;
}
const _q2=V();
/* fast material lookup at world points for one object */
export function sampler(ob){
  ob.g.updateMatrixWorld(true);const inv=ob.g.matrixWorld.clone().invert();const q=V();
  return pW=>matLocal(ob,q.copy(pW).applyMatrix4(inv));
}
export function matAt(ob,pW){return matLocal(ob,localOf(ob,pW,_q));}
export function inCavity(ob,pW){if(ob.kind!=='fish')return false;const p=localOf(ob,pW,_q);if(!ob.inside(p))return false;return layerBase(ob.fish,p)===M.CAV;}

/* skin: the flat of the knife takes it off where it slides; the scaler takes off the scales */
function rubSkin(ob,ptsW,rad,channel){
  if(ob.kind!=='fish')return 0;const f=ob.fish,d=f.d;let n=0;const p=V();
  for(const pw of ptsW){localOf(ob,pw,p);if(!ob.inside(p))continue;const xn=p.x/d.L+.5;if(xn<.02||xn>f.sp.xh)continue;
    const w=Math.max(d.W(xn),.002),h=Math.max(d.H(xn),.002);const e=Math.sqrt((p.y/w)**2+(p.z/h)**2);if(e<.8||e>1.25)continue;
    const th=Math.atan2(p.y/w,p.z/h);const du=rad/d.L*128,dv=rad/((w+h)*.5)/TAU*64;
    const u0=xn*128,v0=((th/TAU)%1+1)%1*64;
    for(let v=Math.floor(v0-dv);v<=Math.ceil(v0+dv);v++)for(let u=Math.floor(u0-du);u<=Math.ceil(u0+du);u++){
      if(u<0||u>127)continue;if(((u-u0)/du)**2+((v-v0)/dv)**2>1)continue;const vv=((v%64)+64)%64;const i=(vv*128+u)*4;
      if(channel===0){if(f.skin[i]>0){f.skin[i]=0;f.skin[i+1]=0;n++;}}else if(f.skin[i]>0&&f.skin[i+1]>0){f.skin[i+1]=0;n++;}}}
  if(n){f.skinTex.needsUpdate=true;ob.cut=true;}
  return n;
}
export function scrape(ob,ptsW,rad){return rubSkin(ob,ptsW,rad,0);}
export function descale(ob,ptsW,rad){return rubSkin(ob,ptsW,rad,1);}

/* ---------- cutting ---------- */
/* split by the plane n·p = c (fish-local). The object keeps the n·p<=c side; returns the other side as a new object, or null */
export function cutPiece(ob,n,c){
  const f=ob.fish;let a=0,b=0;const side=new Uint8Array(f.N);
  for(let i=0;i<f.N;i++){if(!ob.keep[i])continue;const s=n.x*f.pts[i*3]+n.y*f.pts[i*3+1]+n.z*f.pts[i*3+2]>c;side[i]=s?1:0;if(s)b++;else a++;}
  if(a<4||b<4)return null;
  if(ob.planes.length>=MAXP)return null;
  if(b>a){n=n.clone().negate();c=-c;for(let i=0;i<f.N;i++)if(ob.keep[i])side[i]^=1;}
  const nb=new FObj(f,'fish');nb.planes=ob.planes.map(q=>q.clone());nb.notches=ob.notches.map(q=>({p:q.p.clone(),c:q.c.clone()}));nb.open=ob.open;nb.cut=true;
  for(let i=0;i<f.N;i++){nb.keep[i]=ob.keep[i]&&side[i];ob.keep[i]=ob.keep[i]&&!side[i]?1:0;}
  for(let i=0;i<f.NS;i++){if(!ob.skeep[i])continue;const s=n.x*f.spts[i*3]+n.y*f.spts[i*3+1]+n.z*f.spts[i*3+2]>c;nb.skeep[i]=s?1:0;ob.skeep[i]=s?0:1;}
  ob.planes.push(V4(n.x,n.y,n.z,c));nb.planes.push(V4(-n.x,-n.y,-n.z,-c));ob.cut=true;
  // a plane through the belly opens it on both sides
  const cav=f.cav;const dc=Math.abs(n.dot(cav.c)-c)/Math.sqrt((n.x*cav.r.x)**2+(n.y*cav.r.y)**2+(n.z*cav.r.z)**2);
  if(dc<1){ob.open=true;nb.open=true;}
  for(const o of [...ob.organs]){if(n.dot(o.c)>c){ob.organs.splice(ob.organs.indexOf(o),1);nb.organs.push(o);nb.g.add(o.g);}}
  nb.g.position.copy(ob.g.position);nb.g.quaternion.copy(ob.g.quaternion);
  ob.flushMeshes();nb.flushMeshes();
  return nb;
}
export function addNotch(ob,n,c,center,radius){
  if(ob.notches.length>=MAXN)ob.notches.shift();ob.notches.push({p:V4(n.x,n.y,n.z,c),c:V4(center.x,center.y,center.z,radius)});ob.cut=true;
  const f=ob.fish,cav=f.cav;const dc=Math.abs(n.dot(cav.c)-c)/Math.sqrt((n.x*cav.r.x)**2+(n.y*cav.r.y)**2+(n.z*cav.r.z)**2);
  if(dc<1&&center.distanceTo(cav.c)<radius+Math.max(cav.r.x,cav.r.y,cav.r.z))ob.open=true;
  ob.flushMeshes();
}
/* samples of the piece near a plane, in fish-local space */
export function nearPlane(ob,n,c,band){const f=ob.fish,out=[];for(let i=0;i<f.N;i++){if(!ob.keep[i])continue;const x=f.pts[i*3],y=f.pts[i*3+1],z=f.pts[i*3+2];if(Math.abs(n.x*x+n.y*y+n.z*z-c)<band)out.push(V(x,y,z));}return out;}

/* ---------- body for physics: three boxes along the fish (or one for an organ) ---------- */
export function bodyShape(ob){
  if(ob.kind==='organ')return {boxes:[{c:ob.c.clone(),h:ob.r.clone().multiplyScalar(.85)}],com:ob.c.clone(),mass:massOf(ob)};
  const f=ob.fish;const com=V();let n=0;let x0=1e9,x1=-1e9;
  for(let i=0;i<f.N;i++){if(!ob.keep[i])continue;const x=f.pts[i*3];com.x+=x;com.y+=f.pts[i*3+1];com.z+=f.pts[i*3+2];n++;if(x<x0)x0=x;if(x>x1)x1=x;}
  if(!n)return {boxes:[{c:V(),h:V(.01,.01,.01)}],com:V(),mass:.02};
  com.divideScalar(n);const K=x1-x0>.12?3:1;const boxes=[];
  for(let k=0;k<K;k++){const a=x0+(x1-x0)*k/K,b=x0+(x1-x0)*(k+1)/K;const lo=V(1e9,1e9,1e9),hi=V(-1e9,-1e9,-1e9);let m=0;
    for(let i=0;i<f.N;i++){if(!ob.keep[i])continue;const x=f.pts[i*3];if(x<a||x>b)continue;lo.min(_q.set(x,f.pts[i*3+1],f.pts[i*3+2]));hi.max(_q);m++;}
    if(m<2)continue;boxes.push({c:lo.clone().add(hi).multiplyScalar(.5),h:hi.clone().sub(lo).multiplyScalar(.5).max(V(.004,.004,.004))});}
  return {boxes,com,mass:massOf(ob)};
}
export function massOf(ob){
  if(ob.kind==='organ'){const r=ob.r;return Math.max(.01,4/3*Math.PI*r.x*r.y*r.z*1050);}
  return Math.max(.02,ob.fish.kg*ob.count/ob.fish.N);
}
export function stats(ob){
  const f=ob.fish,s={n:0,flesh:0,skin:0,scaled:0,bone:0,head:0,surface:0};
  for(let i=0;i<f.N;i++){if(!ob.keep[i])continue;const m=f.mat[i];s.n++;
    if(m===M.FLESH||m===M.BLOOD||m===M.LINING||m===M.SKIN)s.flesh++;else if(m===M.BONE||m===M.RIB)s.bone++;else if(m===M.HEAD||m===M.GILL||m===M.EYE)s.head++;}
  for(let i=0;i<f.NS;i++){if(!ob.skeep[i])continue;const xn=f.suv[i*2];if(xn>=f.sp.xh)continue;s.surface++;const [r,g]=skinAt(f,xn,f.suv[i*2+1]);if(r>127){s.skin++;if(g<128)s.scaled++;}}
  return s;
}
export function evaluate(ob){
  const f=ob.fish,sp=f.sp;const fresh=.5+.5*f.fresh;const base=f.kg*sp.price;
  if(ob.kind==='organ'){const kg=massOf(ob);
    if(ob.organ===M.ROE)return {kind:'Икра',kg,value:kg*sp.price*3.2*fresh*(f.bile?.8:1),waste:false};
    if(ob.organ===M.LIVER&&sp.liver)return {kind:'Печень трески',kg,value:kg*sp.price*1.8*fresh,waste:false};
    return {kind:ORGAN_NAME[ob.organ]||'Потроха',kg,value:0,waste:true};}
  const s=stats(ob);const kg=massOf(ob);const mf=s.flesh/Math.max(1,f.F0),hf=s.head/Math.max(1,f.H0);
  if(mf<.006&&hf<.25)return {kind:'Кости и плавники',kg,value:0,waste:true};
  let kind,mult;
  if(ob.organs.length){kind='Непотрошёная';mult=.55;}
  else if(s.head>s.n*.5){return {kind:'Голова',kg,value:base*.25*hf*fresh,waste:false};}
  else if(s.bone>s.n*.015){
    if(sp.fam==='eel'&&mf>.06&&mf<.45){kind='Стейк';mult=1.5;}
    else if(mf<.12){kind='Хребет на уху';mult=.5;}
    else if(mf>.6){kind='Тушка';mult=1.0;}
    else{kind='Кусок на кости';mult=1.15;}
  }else{
    const sk=s.skin/Math.max(1,s.surface);
    if(sk<.05){kind='Филе без кожи';mult=1.9;}else if(sk<.4){kind='Филе, кожа снята не до конца';mult=1.7;}else{kind='Филе';mult=1.6;}
  }
  if(hf>.2&&kind!=='Голова')mult*=.85;
  if(mf<.03){kind='Обрезки';mult=.4;}
  if(s.surface>20&&s.skin>10&&s.scaled/s.skin>.8){mult*=1.12;kind+=', без чешуи';}
  if(f.bile)mult*=.8;
  return {kind:kind+(f.bile?' (желчь)':''),kg,value:base*mf*mult*fresh,waste:false};
}
