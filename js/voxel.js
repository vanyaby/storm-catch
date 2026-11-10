/* Voxel fish: a 3D grid of materials. The knife removes voxels it sweeps through,
   loose islands become separate objects, organs are their own small voxel bodies. */
import { THREE, S, V, clamp, smooth, hash, TAU } from './core.js';

export const M={E:0,SKIN:1,FLESH:2,BLOOD:3,BONE:4,HEAD:5,GILL:6,EYE:7,FIN:8,STOMACH:9,LIVER:10,GUT:11,ROE:12,GALL:13,LINING:14};
const ORGAN_NAME={[M.STOMACH]:'Желудок',[M.LIVER]:'Печень',[M.GUT]:'Кишечник',[M.ROE]:'Икра',[M.GALL]:'Жёлчный пузырь'};
export { ORGAN_NAME };

/* ---------- shape of a fish ---------- */
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
const _c=new THREE.Color(),_c2=new THREE.Color();
function skinCol(sp,xn,th,out){
  const c=Math.cos(th),s=Math.sin(th);
  if(sp.fam==='flat'){out.set(s>0?sp.back:sp.belly);if(s>0&&hash(xn*31.7+c*7.3)>.74)out.set(sp.spots);}
  else{
    out.set(sp.belly);_c2.set(sp.back);out.lerp(_c2,smooth(-.25,.55,c));
    if(sp.stripe&&c>.15&&Math.sin(xn*58+c*9+Math.sin(xn*21)*2)>.45)out.set(sp.stripe);
    if(sp.spots&&c>-.1&&hash(xn*17.1+th*3.3)>.78)out.set(sp.spots);
    if(sp.id==='tuna'&&Math.abs(c)<.22)out.lerp(_c2.set(0x9aa8bd),.55);
  }
  return out;
}
const FIXED={[M.BONE]:0xebe2cb,[M.HEAD]:0xb06a55,[M.GILL]:0xc0303a,[M.EYE]:0x101010,[M.STOMACH]:0xc79c94,[M.LIVER]:0x7d3f28,[M.GUT]:0xdcbfa6,[M.ROE]:0xf08a3a,[M.GALL]:0x4f8a3a,[M.LINING]:0x8e9296};
function matColor(o,m,lx,ly,lz,out){
  const f=o.fish,sp=f.sp,d=f.d;
  switch(m){
    case M.SKIN:{const xn=clamp(lx/d.L+.5,0,1);const w=Math.max(1e-4,d.W(xn)),h=Math.max(1e-4,d.H(xn));skinCol(sp,xn,Math.atan2(ly/w,lz/h),out);break;}
    case M.FLESH:{out.set(sp.flesh);const fr=TAU/(d.L/13);const band=smooth(.8,.97,Math.sin(lx*fr+Math.abs(lz)*fr*1.7));out.multiplyScalar(1-.17*band);break;}
    case M.BLOOD:out.set(sp.blood||sp.flesh);break;
    case M.FIN:out.set(sp.fin);break;
    default:out.set(FIXED[m]||0xff00ff);
  }
  out.multiplyScalar(.93+hash(lx*91.3+ly*57.1+lz*13.7)*.14);
  return out;
}

/* ---------- voxel object ---------- */
export class VObj{
  constructor(fish,kind,nx,ny,nz,vs,o){
    this.fish=fish;this.kind=kind;this.nx=nx;this.ny=ny;this.nz=nz;this.vs=vs;this.o=o.clone();
    this.m=new Uint8Array(nx*ny*nz);this.cav=null;this.organ=null;this.organs=[];this.anchor=null;
    this.g=new THREE.Group();this.g.userData.vobj=this;
    this.mat=new THREE.MeshStandardMaterial({vertexColors:true,flatShading:true,roughness:.5,metalness:.08,side:THREE.DoubleSide,
      emissive:new THREE.Color(0),emissiveIntensity:1});
    this.slabs=[];this.dirty=new Set();this.body=null;this.com=V();this.count=0;this.splitPending=false;this.open=false;
  }
  idx(x,y,z){return x+this.nx*(y+this.ny*z);}
  get(x,y,z){if(x<0||y<0||z<0||x>=this.nx||y>=this.ny||z>=this.nz)return 0;return this.m[x+this.nx*(y+this.ny*z)];}
  center(x,y,z,out){return out.set(this.o.x+(x+.5)*this.vs,this.o.y+(y+.5)*this.vs,this.o.z+(z+.5)*this.vs);}
  markAll(){const n=Math.ceil(this.nx/SLAB);for(let i=0;i<n;i++)this.dirty.add(i);}
  markVoxel(x){for(const xx of [x-1,x,x+1]){if(xx<0)continue;this.dirty.add(Math.floor(xx/SLAB));}}
  recount(){let n=0;for(let i=0;i<this.m.length;i++)if(this.m[i])n++;this.count=n;return n;}
  flushMeshes(){for(const s of this.dirty)this.meshSlab(s);this.dirty.clear();}
  dispose(){for(const m of this.slabs)if(m){m.geometry.dispose();}this.mat.dispose();}
  /* surface nets over one slab of cells along x */
  meshSlab(si){
    const {nx,ny,nz,m,vs,o}=this;const x0=si*SLAB,x1=Math.min(nx-1,x0+SLAB);
    if(this.slabs[si]){this.g.remove(this.slabs[si]);this.slabs[si].geometry.dispose();this.slabs[si]=null;}
    if(x0>=x1)return;
    const cx0=Math.max(0,x0-1),cx1=Math.min(nx-2,x1);const cw=cx1-cx0+1,cyN=ny-1,czN=nz-1;
    const vx=new Float32Array(cw*cyN*czN*3);const has=new Uint8Array(cw*cyN*czN);
    const ci=(cx,cy,cz)=>(cx-cx0)+cw*(cy+cyN*cz);
    const solid=(x,y,z)=>m[x+nx*(y+ny*z)]!==0;
    for(let cz=0;cz<czN;cz++)for(let cy=0;cy<cyN;cy++)for(let cx=cx0;cx<=cx1;cx++){
      let mask=0,b=0;
      for(let k=0;k<8;k++){const dx=k&1,dy=(k>>1)&1,dz=(k>>2)&1;if(solid(cx+dx,cy+dy,cz+dz))mask|=1<<k;}
      if(mask===0||mask===255)continue;
      let sx=0,sy=0,sz=0,n=0;
      for(const [a,c] of EDGES){if(((mask>>a)&1)!==((mask>>c)&1)){sx+=(CO[a][0]+CO[c][0])*.5;sy+=(CO[a][1]+CO[c][1])*.5;sz+=(CO[a][2]+CO[c][2])*.5;n++;}}
      const i=ci(cx,cy,cz);has[i]=1;vx[i*3]=o.x+(cx+sx/n+.5)*vs;vx[i*3+1]=o.y+(cy+sy/n+.5)*vs;vx[i*3+2]=o.z+(cz+sz/n+.5)*vs;b++;
    }
    const pos=[],col=[];const cc=new THREE.Color();const vtx=i=>[vx[i*3],vx[i*3+1],vx[i*3+2]];
    const quad=(c0,c1,c2,c3,flip,mat,vxx,vyy,vzz)=>{
      if(c0<0||c1<0||c2<0||c3<0||!has[c0]||!has[c1]||!has[c2]||!has[c3])return;
      const a=vtx(c0),b=vtx(c1),c=vtx(c2),d=vtx(c3);
      matColor(this,mat,o.x+(vxx+.5)*vs,o.y+(vyy+.5)*vs,o.z+(vzz+.5)*vs,cc);
      if(flip)pos.push(...a,...c,...b,...a,...d,...c);else pos.push(...a,...b,...c,...a,...c,...d);
      for(let k=0;k<6;k++)col.push(cc.r,cc.g,cc.b);
    };
    const C=(cx,cy,cz)=>(cx<cx0||cx>cx1||cy<0||cz<0||cy>=cyN||cz>=czN)?-1:ci(cx,cy,cz);
    for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=x0;x<x1;x++){
      const a=m[x+nx*(y+ny*z)];
      if(x+1<nx){const b=m[x+1+nx*(y+ny*z)];if((a!==0)!==(b!==0)&&y>0&&z>0)quad(C(x,y-1,z-1),C(x,y,z-1),C(x,y,z),C(x,y-1,z),b!==0,a||b,a?x:x+1,y,z);}
      if(y+1<ny&&x>0){const b=m[x+nx*(y+1+ny*z)];if((a!==0)!==(b!==0)&&z>0)quad(C(x-1,y,z-1),C(x,y,z-1),C(x,y,z),C(x-1,y,z),a!==0,a||b,x,a?y:y+1,z);}
      if(z+1<nz&&x>0&&y>0){const b=m[x+nx*(y+ny*(z+1))];if((a!==0)!==(b!==0))quad(C(x-1,y-1,z),C(x,y-1,z),C(x,y,z),C(x-1,y,z),b!==0,a||b,x,y,a?z:z+1);}
    }
    if(!pos.length)return;
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
    g.computeBoundingSphere();
    const mesh=new THREE.Mesh(g,this.mat);mesh.userData.vobj=this;this.slabs[si]=mesh;this.g.add(mesh);
  }
}
const SLAB=16;
const CO=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
const EDGES=[[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];

/* ---------- building a fish ---------- */
export function newFish(sp,len,kg){
  return {sp,len,kg,d:fishDims(sp,len),fresh:1,bile:false,female:Math.random()<.45,id:Math.random()};
}
function ellipsoidObj(fish,mat,c,r,vs,organ){
  const nx=Math.ceil(2*r[0]/vs)+3,ny=Math.ceil(2*r[1]/vs)+3,nz=Math.ceil(2*r[2]/vs)+3;
  const o=V(c[0]-(nx/2)*vs,c[1]-(ny/2)*vs,c[2]-(nz/2)*vs);
  const ob=new VObj(fish,'organ',nx,ny,nz,vs,o);ob.organ=organ;const p=V();
  for(let z=1;z<nz-1;z++)for(let y=1;y<ny-1;y++)for(let x=1;x<nx-1;x++){ob.center(x,y,z,p);
    const e=((p.x-c[0])/r[0])**2+((p.y-c[1])/r[1])**2+((p.z-c[2])/r[2])**2;if(e<=1)ob.m[ob.idx(x,y,z)]=mat;}
  if(ob.recount()===0){const x=nx>>1,y=ny>>1,z=nz>>1;ob.m[ob.idx(x,y,z)]=mat;ob.count=1;}
  ob.anchor=V(c[0]+r[0]*.9,c[1],c[2]);
  return ob;
}
export function buildFish(fish){
  const sp=fish.sp,d=fish.d,L=d.L;
  const N=clamp(Math.round(L/.0068),46,100),vs=L/N;fish.vs=vs;
  const tail=L*(sp.fam==='eel'?.06:.15),nose=L*.04;
  const finTop=sp.fam==='round'?d.H(.55)*(sp.spiny?1.95:1.6):d.hmax*1.02;
  const ymax=d.wmax*1.05;
  const x0=-L/2-tail-vs*2,x1=L/2+nose+vs*2,z0=-d.hmax*1.05-vs*2,z1=Math.max(finTop,d.hmax*1.05)+vs*2;
  const nx=Math.ceil((x1-x0)/vs),ny=Math.ceil(2*(ymax+vs*2)/vs),nz=Math.ceil((z1-z0)/vs);
  const ob=new VObj(fish,'fish',nx,ny,nz,vs,V(x0,-ny*vs/2,z0));
  // cavity for the organs
  let gc,gr;
  if(sp.fam==='flat'){gc=[d.X(.7),0,-d.H(.7)*.1];gr=[L*.075,d.W(.7)*.5,d.H(.7)*.3];}
  else if(sp.fam==='eel'){gc=[d.X(.62),0,-d.H(.6)*.2];gr=[L*.1,d.W(.6)*.5,d.H(.6)*.45];}
  else{gc=[d.X(.52),0,-d.H(.5)*.33];gr=[d.H(.5)*.95,d.W(.5)*.5,d.H(.5)*.38];}
  fish.cav={c:gc,r:gr};
  ob.cav=new Uint8Array(nx*ny*nz);
  const zs=sp.fam==='flat'?0:d.H(.5)*.08,ribStep=L*.045;
  const ex=sp.fam==='flat'?.9:.91,eyes=sp.fam==='flat'?[[1,.25],[1,-.08]]:[[1,.3],[-1,.3]];const er=Math.max(vs*1.1,d.H(ex)*(sp.id==='perch'?.26:.2));
  const eyeP=eyes.map(([sy,zf])=>V(d.X(ex),sy*d.W(ex)*Math.sqrt(Math.max(0,1-zf*zf))*.8,zf*d.H(ex)));
  const p=V();
  const X0=d.X(.02),h0=d.H(.03),hs=sp.fam==='flat'?d.H(.5)*.5:sp.fam==='eel'?d.H(.2)*1.6:d.H(.5)*.95,notch=sp.fam==='flat'?.85:.55;
  const inTri=(px,pz,a,b,c)=>{const s1=(b[0]-a[0])*(pz-a[1])-(b[1]-a[1])*(px-a[0]),s2=(c[0]-b[0])*(pz-b[1])-(c[1]-b[1])*(px-b[0]),s3=(a[0]-c[0])*(pz-c[1])-(a[1]-c[1])*(px-c[0]);return (s1>=0&&s2>=0&&s3>=0)||(s1<=0&&s2<=0&&s3<=0);};
  const tailTris=[[[X0,h0*.8],[X0-tail,hs],[X0-tail*notch,0]],[[X0,h0*.8],[X0-tail*notch,0],[X0,-h0*.8]],[[X0,-h0*.8],[X0-tail*notch,0],[X0-tail,-hs]]];
  const fa=sp.spiny?.38:.45,fb=sp.spiny?.72:.68;
  const finTri=[[d.X(fa),d.H(fa)*.85],[d.X(fb),d.H(fb)*.85],[d.X((fa+fb)/2-.04),finTop]];
  for(let z=1;z<nz-1;z++)for(let y=1;y<ny-1;y++)for(let x=1;x<nx-1;x++){
    ob.center(x,y,z,p);const xn=p.x/L+.5;let m=0;
    if(xn>=0&&xn<=1){
      const h=d.H(xn),w=Math.max(d.W(xn),vs*.6);const e=(p.y/w)**2+(p.z/h)**2;
      if(e<=1){
        m=xn>=sp.xh?M.HEAD:M.FLESH;
        if(m===M.FLESH&&sp.blood&&Math.abs(p.z)<.09*h&&Math.abs(p.y)>.45*w)m=M.BLOOD;
        if(xn>.03&&xn<sp.xh+.02&&Math.abs(p.y)<Math.max(vs*.9,.13*w)&&Math.abs(p.z-zs)<Math.max(vs*.9,.07*h))m=M.BONE;
        if(sp.fam!=='eel'&&m===M.FLESH&&xn>(sp.fam==='flat'?.25:.36)&&xn<(sp.fam==='flat'?.78:.72)){
          const ph=((p.x-d.X(.36))/ribStep)%1;const thick=vs/ribStep*1.05;
          if((ph<thick||ph>1-1e-3)&&Math.abs(p.y)<.32*w&&(sp.fam==='flat'?Math.abs(p.z)<.8*h:(p.z<zs&&p.z>-.8*h)))m=M.BONE;
        }
        if(m===M.HEAD&&xn<sp.xh+.06&&Math.abs(p.y)>.5*w)m=M.GILL;
        for(const ep of eyeP)if(p.distanceTo(ep)<er)m=M.EYE;
        const ce=((p.x-gc[0])/gr[0])**2+((p.y-gc[1])/gr[1])**2+((p.z-gc[2])/gr[2])**2;
        if(ce<=1&&m!==M.BONE){m=M.E;ob.cav[ob.idx(x,y,z)]=1;}
      }else if(xn>.98&&e<=1.6&&Math.abs(p.z+.15*h)<h*.5&&p.x<d.X(1)+nose*(1-e*.4))m=M.HEAD;
    }
    if(!m&&Math.abs(p.y)<=vs*.6){
      if(p.x<X0+vs&&tailTris.some(t=>inTri(p.x,p.z,...t)))m=M.FIN;
      if(sp.fam==='round'&&p.z>0&&inTri(p.x,p.z,...finTri))m=M.FIN;
    }
    if(m)ob.m[ob.idx(x,y,z)]=m;
  }
  // skin on the outside, lining against the cavity
  const out=ob.m.slice();
  for(let z=1;z<nz-1;z++)for(let y=1;y<ny-1;y++)for(let x=1;x<nx-1;x++){
    const i=ob.idx(x,y,z),m=ob.m[i];if(!m||m===M.FIN||m===M.EYE)continue;
    let air=false,cav=false;
    for(const [dx,dy,dz] of N6){const j=ob.idx(x+dx,y+dy,z+dz);if(!ob.m[j]){if(ob.cav[j])cav=true;else air=true;}}
    if(air)out[i]=M.SKIN;else if(cav&&(m===M.FLESH||m===M.BLOOD))out[i]=M.LINING;
  }
  ob.m=out;ob.recount();
  let F0=0,H0=0;for(let i=0;i<ob.m.length;i++){const m=ob.m[i];if(m===M.FLESH||m===M.BLOOD||m===M.LINING)F0++;else if(m===M.HEAD||m===M.GILL||m===M.EYE)H0++;}
  fish.F0=F0;fish.H0=H0;fish.N0=ob.count;fish.density=fish.kg/(ob.count*vs*vs*vs);
  // organs inside the cavity
  const [c0,c1,c2]=gc,[r0,r1,r2]=gr;
  const org=[
    [M.STOMACH,[c0+r0*.3,c1,c2+r2*.1],[r0*.42,r1*.72,r2*.5]],
    [M.LIVER,[c0+r0*.45,c1,c2+r2*.45],[r0*.32,r1*.78,r2*.3]],
    [M.GUT,[c0-r0*.4,c1,c2-r2*.15],[r0*.42,r1*.6,r2*.42]],
    [M.GALL,[c0+r0*.18,c1+r1*.3,c2+r2*.45],[Math.max(vs*1.2,r0*.08),Math.max(vs*1.2,r1*.25),Math.max(vs*1.2,r2*.16)]],
  ];
  if(fish.female)org.push([M.ROE,[c0-r0*.15,c1,c2+r2*.3],[r0*.45,r1*.65,r2*.36]]);
  for(const [mat,c,r] of org){const o2=ellipsoidObj(fish,mat,c,r,vs,mat);o2.markAll();o2.flushMeshes();ob.organs.push(o2);ob.g.add(o2.g);}
  ob.markAll();ob.flushMeshes();
  return ob;
}
const N6=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

/* ---------- carving ---------- */
const _inv=new THREE.Matrix4(),_p=V(),_a=V(),_b=V(),_cq=V();
function closestOnTri(p,a,b,c,out){
  const ab=_ab.subVectors(b,a),ac=_ac.subVectors(c,a),ap=_ap.subVectors(p,a);
  const d1=ab.dot(ap),d2=ac.dot(ap);if(d1<=0&&d2<=0)return out.copy(a);
  const bp=_bp.subVectors(p,b),d3=ab.dot(bp),d4=ac.dot(bp);if(d3>=0&&d4<=d3)return out.copy(b);
  const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);return out.copy(a).addScaledVector(ab,v);}
  const cp=_cp.subVectors(p,c),d5=ab.dot(cp),d6=ac.dot(cp);if(d6>=0&&d5<=d6)return out.copy(c);
  const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0){const w=d2/(d2-d6);return out.copy(a).addScaledVector(ac,w);}
  const va=d3*d6-d5*d4;if(va<=0&&(d4-d3)>=0&&(d5-d6)>=0){const w=(d4-d3)/((d4-d3)+(d5-d6));return out.copy(b).addScaledVector(_bc.subVectors(c,b),w);}
  const den=1/(va+vb+vc),v=vb*den,w=vc*den;return out.copy(a).addScaledVector(ab,v).addScaledVector(ac,w);
}
const _ab=V(),_ac=V(),_ap=V(),_bp=V(),_cp=V(),_bc=V();
/* tris: array of [a,b,c] world-space Vector3. opts: {kerf (voxels), chop (cuts bone), only (material), maxRemove} */
export function carve(ob,tris,opts={}){
  ob.g.updateMatrixWorld(true);_inv.copy(ob.g.matrixWorld).invert();
  const vs=ob.vs,o=ob.o,kerf=opts.kerf??.75,k2=kerf*kerf;
  const lt=tris.map(t=>t.map(q=>q.clone().applyMatrix4(_inv).sub(o).divideScalar(vs).subScalar(.5)));
  let mnx=1e9,mny=1e9,mnz=1e9,mxx=-1e9,mxy=-1e9,mxz=-1e9;
  for(const t of lt)for(const q of t){mnx=Math.min(mnx,q.x);mny=Math.min(mny,q.y);mnz=Math.min(mnz,q.z);mxx=Math.max(mxx,q.x);mxy=Math.max(mxy,q.y);mxz=Math.max(mxz,q.z);}
  const ix0=Math.max(0,Math.floor(mnx-kerf)),iy0=Math.max(0,Math.floor(mny-kerf)),iz0=Math.max(0,Math.floor(mnz-kerf));
  const ix1=Math.min(ob.nx-1,Math.ceil(mxx+kerf)),iy1=Math.min(ob.ny-1,Math.ceil(mxy+kerf)),iz1=Math.min(ob.nz-1,Math.ceil(mxz+kerf));
  const res={removed:0,bone:0,mats:{}};if(ix0>ix1||iy0>iy1||iz0>iz1)return res;
  if((ix1-ix0)*(iy1-iy0)*(iz1-iz0)>400000)return res;
  const m=ob.m,nx=ob.nx,ny=ob.ny;
  for(let z=iz0;z<=iz1;z++)for(let y=iy0;y<=iy1;y++)for(let x=ix0;x<=ix1;x++){
    const i=x+nx*(y+ny*z),mm=m[i];if(!mm)continue;
    if(opts.only&&mm!==opts.only)continue;
    _p.set(x,y,z);let best=1e9;
    for(const t of lt){closestOnTri(_p,t[0],t[1],t[2],_cq);const dd=_cq.distanceToSquared(_p);if(dd<best)best=dd;if(best<=k2)break;}
    if(best>k2)continue;
    if(mm===M.BONE&&!opts.chop){res.bone++;continue;}
    if(opts.dry){res.removed++;res.mats[mm]=(res.mats[mm]||0)+1;continue;}
    m[i]=0;res.removed++;res.mats[mm]=(res.mats[mm]||0)+1;ob.markVoxel(x);
    if(ob.cav){for(const [dx,dy,dz] of N6){const j=(x+dx)+nx*((y+dy)+ny*(z+dz));if(ob.cav[j]){ob.open=true;break;}}}
  }
  if(res.removed&&!opts.dry){ob.count-=res.removed;ob.splitPending=true;}
  return res;
}
/* scrape skin: turn surface skin voxels near points into bare meat (remove the skin layer) */
export function scrape(ob,ptsW,rad){
  ob.g.updateMatrixWorld(true);_inv.copy(ob.g.matrixWorld).invert();const vs=ob.vs,r=rad/vs,r2=r*r;let n=0;
  for(const pw of ptsW){
    const q=pw.clone().applyMatrix4(_inv).sub(ob.o).divideScalar(vs).subScalar(.5);
    const x0=Math.max(0,Math.floor(q.x-r)),x1=Math.min(ob.nx-1,Math.ceil(q.x+r)),y0=Math.max(0,Math.floor(q.y-r)),y1=Math.min(ob.ny-1,Math.ceil(q.y+r)),z0=Math.max(0,Math.floor(q.z-r)),z1=Math.min(ob.nz-1,Math.ceil(q.z+r));
    for(let z=z0;z<=z1;z++)for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const i=ob.idx(x,y,z);if(ob.m[i]!==M.SKIN)continue;if((x-q.x)**2+(y-q.y)**2+(z-q.z)**2>r2)continue;ob.m[i]=0;n++;ob.markVoxel(x);}
  }
  if(n){ob.count-=n;ob.splitPending=true;}
  return n;
}
/* ---------- connectivity: loose islands become their own objects ---------- */
export function split(ob){
  ob.splitPending=false;
  const {nx,ny,nz,m}=ob;const n=m.length;const lab=new Int32Array(n);const q=new Int32Array(n);const comps=[];
  for(let s=0;s<n;s++){
    if(!m[s]||lab[s])continue;const id=comps.length+1;let h=0,t=0;q[t++]=s;lab[s]=id;
    let cnt=0,bx0=1e9,by0=1e9,bz0=1e9,bx1=-1,by1=-1,bz1=-1;
    while(h<t){const i=q[h++];cnt++;const x=i%nx,yz=(i/nx)|0,y=yz%ny,z=(yz/ny)|0;
      if(x<bx0)bx0=x;if(x>bx1)bx1=x;if(y<by0)by0=y;if(y>by1)by1=y;if(z<bz0)bz0=z;if(z>bz1)bz1=z;
      if(x>0){const j=i-1;if(m[j]&&!lab[j]){lab[j]=id;q[t++]=j;}}
      if(x<nx-1){const j=i+1;if(m[j]&&!lab[j]){lab[j]=id;q[t++]=j;}}
      if(y>0){const j=i-nx;if(m[j]&&!lab[j]){lab[j]=id;q[t++]=j;}}
      if(y<ny-1){const j=i+nx;if(m[j]&&!lab[j]){lab[j]=id;q[t++]=j;}}
      if(z>0){const j=i-nx*ny;if(m[j]&&!lab[j]){lab[j]=id;q[t++]=j;}}
      if(z<nz-1){const j=i+nx*ny;if(m[j]&&!lab[j]){lab[j]=id;q[t++]=j;}}
    }
    comps.push({id,cnt,b:[bx0,by0,bz0,bx1,by1,bz1]});
  }
  if(comps.length<=1){ob.count=comps.length?comps[0].cnt:0;return [];}
  comps.sort((a,b)=>b.cnt-a.cnt);
  const keep=comps[0].id;const made=[];
  for(const c of comps.slice(1)){
    if(c.cnt<5){for(let i=0;i<n;i++)if(lab[i]===c.id){m[i]=0;ob.markVoxel(i%nx);}continue;}
    const [bx0,by0,bz0,bx1,by1,bz1]=c.b;const sx=bx1-bx0+3,sy=by1-by0+3,sz=bz1-bz0+3;
    const nb=new VObj(ob.fish,ob.kind,sx,sy,sz,ob.vs,V(ob.o.x+(bx0-1)*ob.vs,ob.o.y+(by0-1)*ob.vs,ob.o.z+(bz0-1)*ob.vs));
    nb.organ=ob.organ;if(ob.cav)nb.cav=new Uint8Array(sx*sy*sz);
    for(let z=bz0;z<=bz1;z++)for(let y=by0;y<=by1;y++)for(let x=bx0;x<=bx1;x++){const i=x+nx*(y+ny*z);
      if(lab[i]===c.id){nb.m[nb.idx(x-bx0+1,y-by0+1,z-bz0+1)]=m[i];m[i]=0;}
      if(ob.cav&&ob.cav[i])nb.cav[nb.idx(x-bx0+1,y-by0+1,z-bz0+1)]=1;}
    for(let x=bx0;x<=bx1;x++)ob.markVoxel(x);
    nb.count=c.cnt;nb.open=ob.open;nb.g.position.copy(ob.g.position);nb.g.quaternion.copy(ob.g.quaternion);
    nb.markAll();made.push(nb);
  }
  ob.count=comps[0].cnt;
  // organs still inside go with the piece whose cavity wall is nearest
  if(ob.organs.length&&made.length){
    const all=[ob,...made];
    for(const org of [...ob.organs]){
      let best=ob,bd=1e9;for(const p of all){const d=distToSolid(p,org.anchor);if(d<bd){bd=d;best=p;}}
      if(best!==ob){ob.organs.splice(ob.organs.indexOf(org),1);best.organs.push(org);best.g.add(org.g);}
    }
  }
  return made;
}
function distToSolid(ob,pLocal){
  const q=pLocal.clone().sub(ob.o).divideScalar(ob.vs).subScalar(.5);let best=1e9;const R=6;
  const cx=Math.round(q.x),cy=Math.round(q.y),cz=Math.round(q.z);
  for(let z=cz-R;z<=cz+R;z+=2)for(let y=cy-R;y<=cy+R;y+=2)for(let x=cx-R;x<=cx+R;x+=2){if(ob.get(x,y,z)){const d=(x-q.x)**2+(y-q.y)**2+(z-q.z)**2;if(d<best)best=d;}}
  return best;
}
/* ---------- composition & worth ---------- */
export function stats(ob){
  const s={n:0,flesh:0,skin:0,bone:0,head:0,fin:0,organ:0,surface:0,byMat:{}};const {nx,ny,nz,m}=ob;
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const i=x+nx*(y+ny*z),mm=m[i];if(!mm)continue;s.n++;s.byMat[mm]=(s.byMat[mm]||0)+1;
    if(mm===M.FLESH||mm===M.BLOOD||mm===M.LINING)s.flesh++;else if(mm===M.SKIN)s.skin++;else if(mm===M.BONE)s.bone++;else if(mm===M.HEAD||mm===M.GILL||mm===M.EYE)s.head++;else if(mm===M.FIN)s.fin++;else s.organ++;
    if(mm===M.SKIN||!ob.get(x+1,y,z)||!ob.get(x-1,y,z)||!ob.get(x,y+1,z)||!ob.get(x,y-1,z)||!ob.get(x,y,z+1)||!ob.get(x,y,z-1))s.surface++;}
  return s;
}
export function massOf(ob){return Math.max(.02,ob.count*ob.vs**3*ob.fish.density);}
export function evaluate(ob){
  const f=ob.fish,sp=f.sp,s=stats(ob);const kg=s.n*ob.vs**3*f.density;const fresh=.5+.5*f.fresh;const base=f.kg*sp.price;
  if(ob.kind==='organ'){
    if(ob.organ===M.ROE&&s.n>8)return {kind:'Икра',kg,value:kg*sp.price*3.2*fresh*(f.bile?.8:1),waste:false};
    if(ob.organ===M.LIVER&&sp.liver&&s.n>8)return {kind:'Печень трески',kg,value:kg*sp.price*1.8*fresh,waste:false};
    return {kind:ORGAN_NAME[ob.organ]||'Потроха',kg,value:0,waste:true};
  }
  const mf=s.flesh/f.F0,hf=s.head/Math.max(1,f.H0);
  if(mf<.006&&hf<.25)return {kind:s.skin>s.bone?'Кожа':'Кости и плавники',kg,value:0,waste:true};
  let kind,mult;
  if(ob.organs.length){kind='Непотрошёная';mult=.55;}
  else if(s.head>s.n*.5){return {kind:'Голова',kg,value:base*.25*hf*fresh,waste:false};}
  else if(s.bone>s.n*.02){
    if(sp.fam==='eel'&&mf>.06&&mf<.45){kind='Стейк';mult=1.5;}
    else if(mf<.12){kind='Хребет на уху';mult=.5;}
    else if(mf>.6){kind='Тушка';mult=1.0;}
    else{kind='Кусок на кости';mult=1.15;}
  }else{
    const sk=s.skin/Math.max(1,s.surface);
    if(sk<.05){kind='Филе без кожи';mult=1.9;}else if(sk<.22){kind='Филе, кожа снята не до конца';mult=1.7;}else{kind='Филе';mult=1.6;}
  }
  if(hf>.2&&kind!=='Голова')mult*=.85;
  if(mf<.03){kind='Обрезки';mult=.4;}
  if(f.bile)mult*=.8;
  return {kind:kind+(f.bile?' (желчь)':''),kg,value:base*mf*mult*fresh,waste:false};
}
