/* Layered fish. The body is a smooth shape; what is inside (skin, meat, backbone, ribs, belly cavity, head)
   is computed from the position, never stored. A piece is that shape cut by a list of planes, so a fish can be
   cut anywhere and at any angle. The cut face is drawn by the shader from the same layer rules. */
import { THREE, S, V, clamp, smooth, hash, TAU, sun, hemi, save, msg } from './core.js';

import { organShape, organContains, organGeometry, skinGeometry, skinMaterial } from './tissue.js';
import { organLayout } from './organ-profiles.js';
import { anatomyGLSL, anatomyUniforms, partAt, filletDepth } from './anatomy.js';
import { partBit, prepareAssembly, updateAssemblyFaces } from './assembly.js';
import { prepareFlanks } from './fillet.js';

export const M={E:0,SKIN:1,FLESH:2,BLOOD:3,BONE:4,HEAD:5,GILL:6,EYE:7,FIN:8,STOMACH:9,LIVER:10,GUT:11,ROE:12,GALL:13,LINING:14,RIB:15,SKIN2:16,HEART:17,BLADDER:18,CAV:20};
export const ORGAN_NAME={[M.STOMACH]:'Желудок',[M.LIVER]:'Печень',[M.GUT]:'Кишечник',[M.ROE]:'Икра',[M.GALL]:'Жёлчный пузырь',[M.HEART]:'Сердце',[M.BLADDER]:'Плавательный пузырь'};
const ORGAN_COL={[M.STOMACH]:0xc79c94,[M.LIVER]:0x7d3f28,[M.GUT]:0xdcbfa6,[M.ROE]:0xf08a3a,[M.GALL]:0x619449,[M.HEART]:0x9d3743,[M.BLADDER]:0xe4d9c7};
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
  f.detail=({mid:{NX:64,NT:28,N:3000,NS:600},high:{NX:96,NT:40,N:6000,NS:1200},max:{NX:144,NT:56,N:10000,NS:2000}})[save.detail]||{NX:96,NT:40,N:6000,NS:1200};
  const N=f.detail.N,pts=new Float32Array(N*3),mat=new Uint8Array(N);const p=V();let n=0,guard=0;
  while(n<N&&guard++<N*20){p.set((Math.random()-.5)*L,(Math.random()*2-1)*d.wmax,(Math.random()*2-1)*d.hmax);
    const m=layerBase(f,p);if(!m||m===M.CAV||m===M.FIN)continue;pts[n*3]=p.x;pts[n*3+1]=p.y;pts[n*3+2]=p.z;mat[n]=m;n++;}
  f.N=n;f.pts=pts;f.mat=mat;
  // surface samples (for the skin share)
  const NS=f.detail.NS;f.NS=NS;f.spts=new Float32Array(NS*3);f.suv=new Float32Array(NS*2);
  for(let i=0;i<NS;i++){const xn=.02+.96*Math.random(),th=Math.random()*TAU;const w=d.W(xn),h=d.H(xn);
    f.spts[i*3]=d.X(xn);f.spts[i*3+1]=Math.sin(th)*w*.97;f.spts[i*3+2]=Math.cos(th)*h*.97;f.suv[i*2]=xn;f.suv[i*2+1]=th;}
  let F0=0,H0=0;for(let i=0;i<n;i++){const m=mat[i];if(m===M.FLESH||m===M.BLOOD||m===M.LINING||m===M.SKIN)F0++;else if(m===M.HEAD||m===M.GILL||m===M.EYE)H0++;}
  f.F0=F0;f.H0=H0;
  f.geo=buildGeo(f);
  prepareAssembly(f);
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
  for(const ob of fishObjects)if(ob.kind==='fish'&&ob.mat)ob.mat.uniforms.uFresh.value=clamp(ob.fish.fresh,0,1);
  shared.uSunDir.value.copy(sun.position).normalize();shared.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity);
  shared.uSky.value.copy(hemi.color).multiplyScalar(hemi.intensity);shared.uGround.value.copy(hemi.groundColor).multiplyScalar(hemi.intensity);shared.uTime.value=S.T;
}
const fishObjects=new Set();
let uidN=0;
export class FObj{
  constructor(fish,kind){
    prep(fish);fish.refs=(fish.refs||0)+1;fishObjects.add(this);this.fish=fish;this.kind=kind;this.organs=[];this.open=false;this.planes=[];this.notches=[];this.uid=++uidN;
    this.g=new THREE.Group();this.g.userData.vobj=this;this.item=null;this.cut=false;
    if(kind==='fish'){
      this.parts=7;
      this.keep=new Uint8Array(fish.N).fill(1);this.skeep=new Uint8Array(fish.NS).fill(1);
      this.mat=makeMat(fish);this.mesh=new THREE.Mesh(fish.geo,this.mat);this.mesh.userData.vobj=this;this.mesh.frustumCulled=false;this.g.add(this.mesh);
    }
  }
  worldBounds(out=new THREE.Box3()){
    this.g.updateWorldMatrix(true,false);
    if(this.kind!=='fish')return out.setFromObject(this.g);
    const matrix=this.g.matrixWorld;
    if(!this.bounds||!this.boundsMatrix||!this.boundsMatrix.equals(matrix)){
      this.bounds=this.bounds||new THREE.Box3();this.bounds.makeEmpty();const f=this.fish,p=V();
      for(let i=0;i<f.N;i++)if(this.keep[i])this.bounds.expandByPoint(p.fromArray(f.pts,i*3).applyMatrix4(matrix));
      this.boundsMatrix=(this.boundsMatrix||new THREE.Matrix4()).copy(matrix);
    }
    return out.copy(this.bounds);
  }
  get count(){if(!this.keep)return 1;let n=0;for(let i=0;i<this.keep.length;i++)n+=this.keep[i];return n;}
  inside(p){
    for(const q of this.planes)if(q.x*p.x+q.y*p.y+q.z*p.z>q.w)return false;
    return this.kind!=='fish'||this.parts===7||Boolean(this.parts&partBit(partAt(this.fish,p)));
  }
  flushMeshes(){
    if(this.kind==='organ'){this.mesh.geometry.dispose();this.mesh.geometry=organGeometry(this.shape,this.planes);this.bounds=null;return;}
    if(this.kind!=='fish')return;const u=this.mat.uniforms;
    u.uParts.value=this.parts;updateAssemblyFaces(this);
    for(let i=0;i<MAXP;i++)u.uPl.value[i].copy(this.planes[i]||V4(0,0,0,1));u.uNp.value=Math.min(MAXP,this.planes.length);
    for(let i=0;i<MAXN;i++){const nn=this.notches[i];u.uNo.value[i].copy(nn?nn.p:V4(0,0,0,1));u.uNoC.value[i].copy(nn?nn.c:V4(0,0,0,-1));}
    u.uNn.value=Math.min(MAXN,this.notches.length);u.uOpen.value=this.open?1:0;
  }
  setHi(on){if(this.kind==='fish')this.mat.uniforms.uHi.value=on?1:0;else for(const o of this.g.children)if(o.material&&o.material.emissive)o.material.emissive.setHex(on?0x3a2a10:0);}
  setSwim(a,phase=-1){
    if(this.kind!=='fish')return;
    this.mat.uniforms.uSwim.value=a;
    this.mat.uniforms.uSwimPhase.value=phase;
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;fishObjects.delete(this);
    if(this.mat)this.mat.dispose();for(const o of this.organs)o.dispose();
    if(this.kind!=='fish')for(const o of this.g.children){o.geometry?.dispose();o.material?.map?.dispose();o.material?.dispose();}
    for(const face of this.faces?.values()||[])face.material.dispose();
    const f=this.fish;if(--f.refs===0){
      for(const face of f.cutSurfaces.values()){face.geometry.dispose();face.material.dispose();}
      f.cutSurfaces.clear();f.geo.dispose();f.skinTex.dispose();
    }
  }
}
const V4=(x,y,z,w)=>new THREE.Vector4(x,y,z,w);

function makeOrgan(fish,mat,shape,planes=[]){
  const ob=new FObj(fish,'organ');ob.organ=mat;ob.shape=shape;ob.c=shape.c;ob.r=shape.r;
  ob.samples=shape.samples;ob.keep=new Uint8Array(ob.samples.N).fill(1);ob.planes=planes;
  const color=new THREE.Color(mat===M.LIVER&&fish.sp.liver?0xc99465:ORGAN_COL[mat]).multiply(new THREE.Color(shape.style.tint));
  const material=new THREE.MeshStandardMaterial({color,vertexColors:true,roughness:mat===M.BLADDER?.22:.37});
  ob.mesh=new THREE.Mesh(organGeometry(shape,planes),material);ob.g.add(ob.mesh);ob.mesh.userData.vobj=ob;
  ob.anchor=shape.anchor.clone();return ob;
}
export function buildFish(fish){
  const ob=new FObj(fish,'fish');
  fish.organKg=0;
  for(const spec of organLayout(fish,M)){
    const shape=organShape(fish.cav,spec),organ=makeOrgan(fish,spec.material,shape);
    fish.organKg+=shape.kg;ob.organs.push(organ);ob.g.add(organ.g);
  }
  prepareFlanks(ob);ob.flushMeshes();
  return ob;
}

/* ---------- geometry: one smooth body per fish, shared by all its pieces ---------- */
function buildGeo(f){
  const d=f.d,sp=f.sp,{NX,NT}=f.detail;const pos=[],fin=[],idx=[];
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
attribute float aFin,aFlank;
uniform float uFlankLift;
uniform float uSwim,uTime,uSwimPhase;
varying vec3 vL,vW,vN,vCam;varying float vFin;
${GLSL_COMMON}
void main(){
  vec3 p=position;p.y+=aFlank*uFlankLift;float xn=p.x/uL+.5;
  float tw=pow(clamp(1.-xn,0.,1.),1.4)+.15;
  float phase=uSwimPhase>=0.?uSwimPhase:uTime*9.;
  p.y+=uSwim*uL*.07*tw*sin(xn*7.-phase);
  vL=position;vFin=aFin;
  vec4 wp=modelMatrix*vec4(p,1.);vW=wp.xyz;
  vN=normalize(mat3(modelMatrix)*normal);
  vCam=(inverse(modelMatrix)*vec4(cameraPosition,1.)).xyz;
  gl_Position=projectionMatrix*viewMatrix*wp;}
`;
const FS=`
uniform mat4 modelMatrix;uniform mat4 projectionMatrix;
uniform vec4 uPl[${MAXP}];uniform int uNp;uniform vec4 uNo[${MAXN}];uniform vec4 uNoC[${MAXN}];uniform int uNn;
uniform sampler2D uSkin;uniform float uHi,uOpen,uFresh;
uniform float uParts;
uniform vec3 uBack,uBelly,uStripe,uSpots,uFlesh,uBloodC,uFinC,uSunDir,uSunCol,uSky,uGround,uWater;
varying vec3 vL,vW,vN,vCam;varying float vFin;
${GLSL_COMMON}
${anatomyGLSL}
bool ownsPart(vec3 p){
  if(uParts>6.5)return true;
  float side=anatomyPartAt(p);
  float bit=side<-.5?1.:(side>.5?4.:2.);
  return mod(floor(uParts/bit),2.)>.5;
}
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
    if(!ownsPart(vL))discard;
    float xn=vL.x/uL+.5;
    if(vFin>.5){col=uFinC;n=gl_FrontFacing?n:-n;}
    else{
      float w=max(Wf(xn),.002),h=max(Hf(xn),.002);float th=atan(vL.y/w,vL.z/h);
      vec4 sk=texture2D(uSkin,vec2(xn,th/6.2832+(th<0.?1.:0.)));
      if(xn>=uXh){col=skinCol(xn,th);if(xn<uXh+.012&&uFam<.5)col*=.55;}
      else if(sk.r<.5){col=layerCol(2.,vL)*.92;spec=.25;}
      else{col=skinCol(xn,th);if(sk.g>.5){spec=.55;col*=.96+.08*sin(xn*uL*420.)*sin(th*40.);}else{col=mix(col,vec3(.85,.82,.76),.22);spec=.1;}}
      if(distance(vL,uEye1)<uEr||distance(vL,uEye2)<uEr){float de=min(distance(vL,uEye1),distance(vL,uEye2))/uEr;col=de<.62?vec3(.01):vec3(.85,.78,.4);spec=.9;}
      col=mix(vec3(.34,.075,.055),col,smoothstep(.12,.92,sk.b));
      for(int i=0;i<${MAXN};i++){if(i>=uNn)break;
        if(abs(dot(uNo[i].xyz,vL)-uNo[i].w)<.0011&&distance(vL,uNoC[i].xyz)<uNoC[i].w)col=vec3(.35,.05,.05);}
    }
  }else{
    // the cut face: find where the eye ray enters the kept part, colour that point by its layer
    vec3 dir=normalize(vL-vCam);float te=-1e9;vec3 nc=vec3(0.);
    for(int i=0;i<${MAXP};i++){if(i>=uNp)break;float dn=dot(uPl[i].xyz,dir);if(dn<0.){float t=(uPl[i].w-dot(uPl[i].xyz,vCam))/dn;if(t>te){te=t;nc=uPl[i].xyz;}}}
    if(te<-1e8)discard;
    vec3 P=vCam+dir*te;if(!ownsPart(P))discard;float m=layerAt(P);
    if(m<.5)discard;
    if(m>19.5){ // looking into the belly: the far wall of the cavity
      vec3 o=(vCam-uCavC)/uCavR,dd=dir/uCavR;float A=dot(dd,dd),B=dot(o,dd),C=dot(o,o)-1.;float D=B*B-A*C;
      float t2=D>0.?(-B+sqrt(D))/A:te;P=vCam+dir*t2;col=vec3(.42,.3,.3);nc=-normalize((P-uCavC)/(uCavR*uCavR));
    }else{
      col=layerCol(m,P);float xn=P.x/uL+.5;
      float rim=sqrt(pow(P.y/max(Wf(xn),.002),2.)+pow(P.z/max(Hf(xn),.002),2.));
      col=mix(col,uBloodC*.65,smoothstep(.68,.99,rim)*.20);
    }
    n=normalize(mat3(modelMatrix)*nc);
    vec4 cp=projectionMatrix*viewMatrix*modelMatrix*vec4(P,1.);depth=clamp(cp.z/cp.w*.5+.5,0.,1.);
    spec=.2;
  }
  float stale=1.-uFresh;float grey=dot(col,vec3(.299,.587,.114));
  col=mix(col,vec3(grey)*.86,stale*.38);spec*=1.-stale*.45;
  float dl=max(dot(n,uSunDir),0.);vec3 amb=mix(uGround,uSky,n.y*.5+.5);
  vec3 lit=col*(uSunCol*dl+amb*.9)/3.14159;
  vec3 v=normalize(cameraPosition-vW);vec3 hv=normalize(v+uSunDir);float fres=pow(1.-max(dot(n,v),0.),4.);
  lit+=uSunCol*spec*pow(max(dot(n,hv),0.),64.)*.15;
  lit+=uSky*fres*(.018+.045*spec);
  if(gl_FrontFacing&&vFin<.5&&(uStripeOn>.5||uTuna>.5)){
    vec3 pearl=.5+.5*cos(vec3(0.,2.1,4.2)+dot(n,v)*8.+vL.x*90.);
    lit+=pearl*spec*fres*.075;
  }
  lit+=vec3(.23,.16,.06)*uHi;
  if(vW.y<0.){lit=mix(uWater,lit,exp(vW.y*1.2));}
  gl_FragDepth=depth;
  gl_FragColor=vec4(lit,1.);
  #include <colorspace_fragment>
}`;
function makeMat(f){
  const sp=f.sp,d=f.d,col=c=>new THREE.Color(c??0);
  const u={
    ...anatomyUniforms(f),uParts:{value:7},
    uL:{value:d.L},uHR:{value:sp.hR},uWR:{value:sp.wR},uXh:{value:sp.xh},uZs:{value:f.zs},uRib:{value:f.ribStep},uFam:{value:FAM[sp.fam]},uBlood:{value:sp.blood?1:0},
    uStripeOn:{value:sp.stripe?1:0},uSpotsOn:{value:sp.spots?1:0},uTuna:{value:sp.id==='tuna'?1:0},uEr:{value:f.er},uNose:{value:f.nose},
    uCavC:{value:f.cav.c},uCavR:{value:f.cav.r},uEye1:{value:f.eyes[0]},uEye2:{value:f.eyes[1]},
    uPl:{value:Array.from({length:MAXP},()=>V4(0,0,0,1))},uNp:{value:0},uNo:{value:Array.from({length:MAXN},()=>V4(0,0,0,1))},uNoC:{value:Array.from({length:MAXN},()=>V4(0,0,0,-1))},uNn:{value:0},
    uSkin:{value:f.skinTex},uFresh:{value:f.fresh},uHi:{value:0},uOpen:{value:0},uSwim:{value:0},uSwimPhase:{value:-1},uFlankLift:{value:0},
    uBack:{value:col(sp.back)},uBelly:{value:col(sp.belly)},uStripe:{value:col(sp.stripe)},uSpots:{value:col(sp.spots)},uFlesh:{value:col(sp.flesh)},uBloodC:{value:col(sp.blood||sp.flesh)},uFinC:{value:col(sp.fin)},
    uSunDir:shared.uSunDir,uSunCol:shared.uSunCol,uSky:shared.uSky,uGround:shared.uGround,uTime:shared.uTime,uWater:shared.uWater,
  };
  const mat=new THREE.ShaderMaterial({uniforms:u,vertexShader:VS,fragmentShader:FS,side:THREE.DoubleSide});
  mat.defaultAttributeValues.aFlank=[0];
  return mat;
}

/* ---------- queries the game uses ---------- */
const _inv=new THREE.Matrix4(),_q=V();
function localOf(ob,pW,out){ob.g.updateMatrixWorld(true);_inv.copy(ob.g.matrixWorld).invert();return out.copy(pW).applyMatrix4(_inv);}
export function matLocal(ob,p){
  if(!ob.inside(p))return 0;
  if(ob.kind==='organ')return organContains(ob.shape,p)?ob.organ:0;
  if(ob.kind!=='fish')return 0;
  const f=ob.fish;let m=layerBase(f,p);
  if(m===M.SKIN){const xn=p.x/f.d.L+.5;const [r,g]=skinAt(f,xn,thetaOf(f,p,xn));m=r<128?M.FLESH:g<128?M.SKIN2:M.SKIN;}
  if(m===M.CAV)return 0;
  return m;
}
// Intersect the current section's actual surface, including after previous cuts.
export function organPlaneIntersects(ob,n,c){
  const g=ob.mesh.geometry,pos=g.attributes.position,indices=g.index;
  const total=indices?indices.count:pos.count;
  for(let i=0;i<total;i+=3){
    let min=Infinity,max=-Infinity;
    for(let j=i;j<i+3;j++){
      const k=indices?indices.getX(j):j,d=n.x*pos.getX(k)+n.y*pos.getY(k)+n.z*pos.getZ(k)-c;
      min=Math.min(min,d);max=Math.max(max,d);
    }
    if(min<=0&&max>=0)return true;
  }
  return false;
}
// Map a blade in the lifted flap back onto its original tissue. The air
// between the two moist cut faces offers no resistance.
function liftedMaterial(ob,p){
  const lift=ob.lift;
  if(lift?.amount>0&&lift.weight){
    const {side}=lift.seam;
    const separation=lift.weight(p.x,p.z)*lift.amount;
    const height=side*p.y-filletDepth(ob.fish,p.x/ob.fish.d.L+.5,p.z);
    if(height>0&&height<separation)return 0;
    if(height>=separation)p.y-=side*separation;
  }
  return matLocal(ob,p);
}
/* fast material lookup at world points for one object */
export function sampler(ob){
  ob.g.updateMatrixWorld(true);const inv=ob.g.matrixWorld.clone().invert();const q=V();
  return pW=>liftedMaterial(ob,q.copy(pW).applyMatrix4(inv));
}
export function matAt(ob,pW){return liftedMaterial(ob,localOf(ob,pW,_q));}
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
      if(channel===0){if(f.skin[i]>0){
        const ux=(u+.5)/128,angle=(vv+.5)/64*TAU,ww=d.W(ux),hh=d.H(ux),surface=V(d.X(ux),Math.sin(angle)*ww,Math.cos(angle)*hh);
        if(!ob.inside(surface))continue;
        const pending=ob.peel||(ob.peel={area:0,center:V(),cells:[]});
        const area=d.L/128*TAU/64*Math.hypot(ww*Math.cos(angle),hh*Math.sin(angle));
        pending.area+=area;pending.center.addScaledVector(surface,area);pending.cells.push({xn:ux,th:angle,scaled:f.skin[i+1]<128});
        f.skin[i]=0;f.skin[i+1]=0;n++;
      }}else if(f.skin[i]>0&&f.skin[i+1]>0){f.skin[i+1]=0;n++;}}}
  if(n){f.skinTex.needsUpdate=true;ob.cut=true;}
  if(channel===0&&ob.peel?.area>=.0015){
    const peel=ob.peel;ob.peel=null;const skin=new FObj(f,'skin');skin.skinArea=peel.area;skin.cut=true;
    const center=peel.center.divideScalar(peel.area),xn=center.x/d.L+.5;
    const normal=V(0,center.y/Math.max(d.W(xn)**2,1e-6),center.z/Math.max(d.H(xn)**2,1e-6)).normalize();
    skin.mesh=new THREE.Mesh(skinGeometry(peel.area),skinMaterial(f,peel.cells));skin.mesh.userData.vobj=skin;skin.g.add(skin.mesh);
    ob.g.add(skin.g);skin.g.position.copy(center).addScaledVector(normal,.018);skin.g.quaternion.setFromUnitVectors(V(0,1,0),normal);
    if(S.fn.onSkin)S.fn.onSkin(skin);else{skin.g.removeFromParent();skin.dispose();}
  }
  return n;
}
export function scrape(ob,ptsW,rad){return rubSkin(ob,ptsW,rad,0);}
export function descale(ob,ptsW,rad){return rubSkin(ob,ptsW,rad,1);}

/* ---------- cutting ---------- */
/* split by the plane n·p = c (fish-local). The object keeps the n·p<=c side; returns the other side as a new object, or null */
export function cutPiece(ob,n,c){
  if(ob.kind==='skin')return null;
  if(ob.kind==='organ')return cutOrgan(ob,n,c);
  const f=ob.fish;let a=0,b=0;const side=new Uint8Array(f.N);
  for(let i=0;i<f.N;i++){if(!ob.keep[i])continue;const s=n.x*f.pts[i*3]+n.y*f.pts[i*3+1]+n.z*f.pts[i*3+2]>c;side[i]=s?1:0;if(s)b++;else a++;}
  if(a<4||b<4)return null;
  if(ob.planes.length>=MAXP)return null;
  if(b>a){n=n.clone().negate();c=-c;for(let i=0;i<f.N;i++)if(ob.keep[i])side[i]^=1;}
  const nb=new FObj(f,'fish');nb.parts=ob.parts;nb.planes=ob.planes.map(q=>q.clone());nb.notches=ob.notches.map(q=>({p:q.p.clone(),c:q.c.clone()}));nb.open=ob.open;nb.cut=true;
  for(let i=0;i<f.N;i++){nb.keep[i]=ob.keep[i]&&side[i];ob.keep[i]=ob.keep[i]&&!side[i]?1:0;}
  nb.skeep.fill(0);
  for(let i=0;i<f.NS;i++){if(!ob.skeep[i])continue;const s=n.x*f.spts[i*3]+n.y*f.spts[i*3+1]+n.z*f.spts[i*3+2]>c;nb.skeep[i]=s?1:0;ob.skeep[i]=s?0:1;}
  ob.planes.push(V4(n.x,n.y,n.z,c));nb.planes.push(V4(-n.x,-n.y,-n.z,-c));ob.cut=true;
  // a plane through the belly opens it on both sides
  const cav=f.cav;const dc=Math.abs(n.dot(cav.c)-c)/Math.sqrt((n.x*cav.r.x)**2+(n.y*cav.r.y)**2+(n.z*cav.r.z)**2);
  if(dc<1){ob.open=true;nb.open=true;}
  for(const o of [...ob.organs]){
    const part=cutOrgan(o,n,c);
    if(part){part.g.position.set(0,0,0);part.g.quaternion.identity();nb.organs.push(part);nb.g.add(part.g);}
    else if(!o.keep.some((k,i)=>k&&n.x*o.samples.pts[i*3]+n.y*o.samples.pts[i*3+1]+n.z*o.samples.pts[i*3+2]<=c)){
      ob.organs.splice(ob.organs.indexOf(o),1);nb.organs.push(o);nb.g.add(o.g);
    }
  }
  nb.g.position.copy(ob.g.position);nb.g.quaternion.copy(ob.g.quaternion);
  ob.bounds=null;nb.bounds=null;ob.flushMeshes();nb.flushMeshes();
  return nb;
}
export function detachFillet(ob,side){
  const bit=partBit(side),f=ob.fish;
  if(ob.kind!=='fish'||!(ob.parts&2)||!(ob.parts&bit)||Math.abs(side)!==1)return null;
  if(!ob.keep.some((k,i)=>k&&f.meatParts[i]===bit)||!ob.keep.some((k,i)=>k&&f.meatParts[i]!==bit))return null;
  const fillet=new FObj(f,'fish');
  fillet.parts=bit;ob.parts&=~bit;
  fillet.planes=ob.planes.map(q=>q.clone());
  fillet.notches=ob.notches.map(q=>({p:q.p.clone(),c:q.c.clone()}));
  function transfer(original,detached,owners){
    for(let i=0;i<original.length;i++){
      detached[i]=original[i]&&owners[i]===bit?1:0;
      if(detached[i])original[i]=0;
    }
  }
  transfer(ob.keep,fillet.keep,f.meatParts);transfer(ob.skeep,fillet.skeep,f.skinParts);
  fillet.g.position.copy(ob.g.position);fillet.g.quaternion.copy(ob.g.quaternion);
  ob.cut=fillet.cut=true;ob.bounds=null;ob.flushMeshes();fillet.flushMeshes();
  return fillet;
}
export function damageOrgan(ob){
  if(!ob.fish.bile&&[M.GALL,M.STOMACH,M.GUT].includes(ob.organ)){ob.fish.bile=true;msg('Задели потроха!','Желчь и содержимое попали на мясо, оно подешевеет',2.2);}
}
export function cutOrgan(ob,n,c){
  if(ob.planes.length>=MAXP)return null;const f=ob.samples,side=new Uint8Array(f.N);let a=0,b=0;
  for(let i=0;i<f.N;i++)if(ob.keep[i]){side[i]=n.x*f.pts[i*3]+n.y*f.pts[i*3+1]+n.z*f.pts[i*3+2]>c?1:0;if(side[i])b++;else a++;}
  if(!a||!b)return null;damageOrgan(ob);
  const otherPlanes=[...ob.planes,V4(-n.x,-n.y,-n.z,-c)];
  const nb=makeOrgan(ob.fish,ob.organ,ob.shape,otherPlanes);
  for(let i=0;i<f.N;i++){nb.keep[i]=ob.keep[i]&&side[i]?1:0;ob.keep[i]=ob.keep[i]&&!side[i]?1:0;}
  ob.planes.push(V4(n.x,n.y,n.z,c));ob.cut=nb.cut=true;
  for(const piece of [ob,nb])if(!piece.inside(piece.anchor)){
    let best=Infinity;
    for(let i=0;i<f.N;i++)if(piece.keep[i]){
      const p=_q.fromArray(f.pts,i*3),d=p.distanceToSquared(piece.shape.anchor);
      if(d<best){piece.anchor.copy(p);best=d;}
    }
  }
  nb.g.position.copy(ob.g.position);nb.g.quaternion.copy(ob.g.quaternion);ob.flushMeshes();return nb;
}
export function addNotch(ob,n,c,center,radius){
  if(ob.kind!=='fish')return;
  if(ob.notches.length>=MAXN)ob.notches.shift();ob.notches.push({p:V4(n.x,n.y,n.z,c),c:V4(center.x,center.y,center.z,radius)});ob.cut=true;
  const f=ob.fish,cav=f.cav;const dc=Math.abs(n.dot(cav.c)-c)/Math.sqrt((n.x*cav.r.x)**2+(n.y*cav.r.y)**2+(n.z*cav.r.z)**2);
  if(dc<1&&center.distanceTo(cav.c)<radius+Math.max(cav.r.x,cav.r.y,cav.r.z))ob.open=true;
  ob.flushMeshes();
}
/* samples of the piece near a plane, in fish-local space */
export function nearPlane(ob,n,c,band){const f=ob.kind==='organ'?ob.samples:ob.fish,out=[];for(let i=0;i<f.N;i++){if(!ob.keep[i])continue;const x=f.pts[i*3],y=f.pts[i*3+1],z=f.pts[i*3+2];if(Math.abs(n.x*x+n.y*y+n.z*z-c)<band)out.push(V(x,y,z));}return out;}

/* ---------- body for physics: three boxes along the fish (or one for an organ) ---------- */
export function bodyShape(ob){
  if(ob.kind!=='fish'){
    const lo=V(Infinity,Infinity,Infinity),hi=V(-Infinity,-Infinity,-Infinity),com=V();let count=0;
    if(ob.kind==='organ'){const f=ob.samples;for(let i=0;i<f.N;i++)if(ob.keep[i]){const p=V().fromArray(f.pts,i*3);lo.min(p);hi.max(p);com.add(p);count++;}com.divideScalar(Math.max(1,count));}
    else{ob.mesh.geometry.computeBoundingBox();lo.copy(ob.mesh.geometry.boundingBox.min);hi.copy(ob.mesh.geometry.boundingBox.max);com.addVectors(lo,hi).multiplyScalar(.5);}
    return {boxes:[{c:lo.clone().add(hi).multiplyScalar(.5),h:hi.clone().sub(lo).multiplyScalar(.5).max(V(.003,.002,.003))}],com,mass:massOf(ob)};
  }
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
  if(ob.kind==='skin')return ob.skinArea*.001*1050;
  if(ob.kind==='organ')return ob.shape.kg*ob.count/ob.samples.N;
  const carcass=ob.fish.kg-(ob.fish.organKg||0);
  return carcass*ob.count/ob.fish.N+ob.organs.reduce((sum,o)=>sum+massOf(o),0);
}
export function stats(ob){
  const f=ob.fish,s={n:0,flesh:0,skin:0,scaled:0,bone:0,head:0,surface:0};
  for(let i=0;i<f.N;i++){if(!ob.keep[i])continue;const m=f.mat[i];s.n++;
    if(m===M.FLESH||m===M.BLOOD||m===M.LINING||m===M.SKIN)s.flesh++;else if(m===M.BONE||m===M.RIB)s.bone++;else if(m===M.HEAD||m===M.GILL||m===M.EYE)s.head++;}
  for(let i=0;i<f.NS;i++){if(!ob.skeep[i])continue;const xn=f.suv[i*2];if(xn>=f.sp.xh)continue;s.surface++;const [r,g]=skinAt(f,xn,f.suv[i*2+1]);if(r>127){s.skin++;if(g<128)s.scaled++;}}
  return s;
}
// Clip the anatomical backbone against the same half-planes that bound the piece.
// Thin steaks can contain no randomly sampled bone even when the spine crosses both faces.
function backboneSection(ob){
  const f=ob.fish,d=f.d;
  let start=d.X(.03),end=d.X(f.sp.xh),tailFace=null,headFace=null;
  for(const plane of ob.planes){
    const limit=plane.w-plane.z*f.zs;
    if(Math.abs(plane.x)<1e-8){if(limit<0)return null;continue;}
    const x=limit/plane.x;
    if(plane.x<0&&x>=start){start=x;tailFace=plane;}
    if(plane.x>0&&x<=end){end=x;headFace=plane;}
  }
  return end>start?{start,end,tailFace,headFace}:null;
}
function isSteak(ob,section){
  if(!section?.tailFace||!section.headFace)return false;
  const {start,end,tailFace:a,headFace:b}=section,f=ob.fish,d=f.d;
  const thickness=end-start,mid=(start+end)/2,xn=mid/d.L+.5;
  if(xn<.14||thickness<.009||thickness>d.L*(f.sp.fam==='eel'?.30:.20))return false;
  // Opposed, nearly transverse knife faces distinguish a slice from a lengthwise or diagonal cut.
  if(Math.min(-a.x,b.x)<.82||a.x*b.x+a.y*b.y+a.z*b.z>-.85)return false;
  // Follow the midpoint between the two faces across the fish. The inner 65% of each
  // cross-sectional radius must remain on the piece, even if the rind was trimmed.
  const slopeY=(a.y/a.x+b.y/b.x)/2,slopeZ=(a.z/a.x+b.z/b.x)/2;
  const w=.65*d.W(xn),h=.65*d.H(xn);
  return ob.planes.every(p=>{
    const reach=Math.hypot(w*(p.y-p.x*slopeY),h*(p.z-p.x*slopeZ));
    return p.x*mid+p.z*f.zs+reach<=p.w+1e-8;
  });
}
export function evaluate(ob){
  const f=ob.fish,sp=f.sp;const fresh=.5+.5*f.fresh;const base=f.kg*sp.price;
  if(ob.kind==='skin')return {kind:'Кожа',kg:massOf(ob),value:0,waste:true};
  if(ob.kind==='organ'){const kg=massOf(ob);
    if(ob.organ===M.ROE)return {kind:'Икра',kg,value:kg*sp.price*3.2*fresh*(f.bile?.8:1),waste:false};
    if(ob.organ===M.LIVER&&sp.liver)return {kind:'Печень трески',kg,value:kg*sp.price*1.8*fresh,waste:false};
    return {kind:ORGAN_NAME[ob.organ]||'Потроха',kg,value:0,waste:true};}
  const s=stats(ob);const kg=massOf(ob);const mf=s.flesh/Math.max(1,f.F0),hf=s.head/Math.max(1,f.H0);
  if(mf<.006&&hf<.25)return {kind:'Кости и плавники',kg,value:0,waste:true};
  const spine=backboneSection(ob);
  let kind,mult;
  if(ob.parts===2){kind=ob.organs.length?'Хребет с потрохами':'Хребет на уху';mult=.5;}
  else if(ob.organs.length){kind='Непотрошёная';mult=.55;}
  else if(s.head>s.n*.5){return {kind:'Голова',kg,value:base*.25*hf*fresh,waste:false};}
  else if(s.head<s.n*.05&&isSteak(ob,spine)){kind='Стейк';mult=1.5;}
  else if(ob.parts!==1&&ob.parts!==4&&(spine||s.bone>s.n*.015)){
    if(mf<.12){kind='Хребет на уху';mult=.5;}
    else if(mf>.6){kind='Тушка';mult=1.0;}
    else{kind='Кусок на кости';mult=1.15;}
  }else{
    const sk=s.skin/Math.max(1,s.surface);
    if(sk<.05){kind='Филе без кожи';mult=1.9;}else if(sk<.4){kind='Филе, кожа снята не до конца';mult=1.7;}else{kind='Филе';mult=1.6;}
  }
  if(hf>.2&&kind!=='Голова')mult*=.85;
  if(mf<.03&&kind!=='Стейк'){kind='Обрезки';mult=.4;}
  if(s.surface>20&&s.skin>10&&s.scaled/s.skin>.8){mult*=1.12;kind+=', без чешуи';}
  if(f.bile)mult*=.8;
  return {kind:kind+(f.bile?' (желчь)':''),kg,value:base*mf*mult*fresh,waste:false};
}
