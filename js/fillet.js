/* The assembly owns the two flank interfaces from the moment it is created.
   A sweep can sever a ligament or loosen a patch on one of those surfaces.
   Progress stays in fish coordinates when a piece turns over or is divided. */
import { S, V, clamp } from './core.js';
import { M, matLocal } from './fishbody.js';
import { anatomyFor, filletDepth } from './anatomy.js';

const NX=72, NZ=28;
const byPiece=new WeakMap();
const sideBit=side=>side<0?1:4;

function createSeam(ob,side,previous){
  const f=ob.fish,d=f.d,profile=anatomyFor(f);
  const dx=d.L/NX,dz=2*d.hmax/NZ;
  const lookup=new Array(NX*NZ),cells=[],connectors=[];
  for(let j=0;j<NZ;j++)for(let i=0;i<NX;i++){
    const xn=(i+.5)/NX,z=(j+.5)*dz-d.hmax;
    if(xn<=profile.tail||xn>=profile.neck||Math.abs(z)>=d.H(xn))continue;
    const point=V(d.X(xn),side*filletDepth(f,xn,z),z);
    if(!matLocal(ob,point))continue;
    const k=j*NX+i,cell={point,hit:previous?.lookup[k]?.hit===true};
    lookup[k]=cell;cells.push(cell);
  }
  for(const [id,xn] of profile.connectors.entries()){
    // These short ligaments run along the loin, above the vertebral column.
    const z=d.H(xn)*.25,point=V(d.X(xn),side*filletDepth(f,xn,z),z);
    if(!matLocal(ob,point))continue;
    connectors.push({id,point,cut:previous?.connectors.some(c=>c.id===id&&c.cut)||false});
  }
  return {side,dx,dz,lookup,cells,connectors};
}
export function prepareFlanks(ob,previous=[]){
  if(byPiece.has(ob))return;
  const seams=[];
  if(ob.kind==='fish'&&(ob.parts&2)){
    for(const side of [-1,1])if(ob.parts&sideBit(side)){
      seams.push(createSeam(ob,side,previous.find(s=>s.side===side)));
    }
  }
  byPiece.set(ob,seams);
}
export function flankGuide(ob,side){
  prepareFlanks(ob);
  const seam=byPiece.get(ob).find(s=>s.side===side);
  return seam?seam.connectors.filter(c=>!c.cut).map(c=>c.point):[];
}

function triangleHeight(a,b,c,x,z){
  const e1x=b.x-a.x,e1z=b.z-a.z,e2x=c.x-a.x,e2z=c.z-a.z;
  const det=e1x*e2z-e1z*e2x;if(Math.abs(det)<1e-12)return NaN;
  const u=((x-a.x)*e2z-(z-a.z)*e2x)/det,v=(e1x*(z-a.z)-e1z*(x-a.x))/det;
  if(u<-.00001||v<-.00001||u+v>1.00001)return NaN;
  return a.y+u*(b.y-a.y)+v*(c.y-a.y);
}
function bladeHeight(quad,p,padding){
  let y=triangleHeight(quad[0],quad[1],quad[2],p.x,p.z);
  if(!Number.isFinite(y))y=triangleHeight(quad[0],quad[2],quad[3],p.x,p.z);
  if(Number.isFinite(y))return y;
  // The cutting edge has finite width. Use the nearest edge's actual height.
  let nearest=padding*padding;
  for(let i=0;i<4;i++){
    const a=quad[i],b=quad[(i+1)%4],dx=b.x-a.x,dz=b.z-a.z;
    const t=clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1),0,1);
    const gap=(p.x-a.x-t*dx)**2+(p.z-a.z-t*dz)**2;
    if(gap<=nearest){nearest=gap;y=a.y+t*(b.y-a.y);}
  }
  return y;
}
function hitDepth(ob,point,y,side,chop){
  const d=ob.fish.d,xn=point.x/d.L+.5;
  if(!Number.isFinite(y)||side*y<Math.max(.0004,Math.abs(point.y)*.35))return false;
  const tolerance=clamp(d.W(xn)*.17,.0025,.013);
  if(Math.abs(point.y-y)>tolerance)return false;
  const material=matLocal(ob,V(point.x,y,point.z));
  return !!material&&(chop||material!==M.BONE);
}
// The blue channel records where the edge has broken the outside skin.
function markSkin(f,point,dx,dz){
  const d=f.d,xn=point.x/d.L+.5,h=d.H(xn),w=d.W(xn),y=point.y/w;
  if(Math.abs(y)>1)return;
  const edge=h*Math.sqrt(1-y*y);
  for(const z of [-edge,edge]){
    if(Math.abs(z-point.z)>dz*.8)continue;
    const angle=Math.atan2(y,z/h);
    const v=(Math.floor(angle*64/(2*Math.PI))+64)%64;
    const first=clamp(Math.floor((xn-.5*dx/d.L)*128),0,127);
    const last=clamp(Math.floor((xn+.5*dx/d.L)*128),0,127);
    for(let u=first;u<=last;u++)f.skin[(v*128+u)*4+2]=0;
    f.skinTex.needsUpdate=true;
  }
}
export function recordFlank(ob,quad,qn,chop){
  if(ob.kind!=='fish')return null;
  const n=qn.clone().normalize();
  if(Math.abs(n.y)<.85||Math.abs(n.x)>.32)return null;
  prepareFlanks(ob);const seams=byPiece.get(ob);
  if(!seams.length)return null;
  const f=ob.fish,d=f.d,padding=clamp(d.L*.004,.001,.0035);
  const xs=quad.map(p=>p.x),zs=quad.map(p=>p.z);
  const xmin=Math.min(...xs)-padding,xmax=Math.max(...xs)+padding;
  const zmin=Math.min(...zs)-padding,zmax=Math.max(...zs)+padding;
  let touched;
  for(const s of seams){
    const i0=Math.max(0,Math.ceil((xmin+d.L/2)/s.dx-.5)),i1=Math.min(NX-1,Math.floor((xmax+d.L/2)/s.dx-.5));
    const j0=Math.max(0,Math.ceil((zmin+d.hmax)/s.dz-.5)),j1=Math.min(NZ-1,Math.floor((zmax+d.hmax)/s.dz-.5));
    let changed=false;
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
      const cell=s.lookup[j*NX+i];if(!cell||cell.hit)continue;
      const p=cell.point,y=bladeHeight(quad,p,padding);
      if(!hitDepth(ob,p,y,s.side,chop))continue;
      cell.hit=true;changed=true;
      markSkin(f,V(p.x,y,p.z),s.dx,s.dz);
    }
    for(const c of s.connectors){
      if(c.cut||c.point.x<xmin||c.point.x>xmax||c.point.z<zmin||c.point.z>zmax)continue;
      const y=bladeHeight(quad,c.point,padding);
      if(hitDepth(ob,c.point,y,s.side,chop)){c.cut=true;changed=true;}
    }
    if(changed){
      ob.cut=true;S.cutSound=.8;touched=s;
      if(ob.lift?.seam===s)ob.lift.dirty=true;
      if(s.connectors.length&&s.connectors.every(c=>c.cut))return {handled:true,complete:true,seam:s};
    }
  }
  return {handled:true,complete:false,seam:touched};
}
export function flankAt(ob,localPoint){
  let best=null,distance=Infinity;
  for(const seam of byPiece.get(ob)||[]){
    if(localPoint.y*seam.side<=0)continue;
    for(const cell of seam.cells){
      if(!cell.hit)continue;
      const p=cell.point,dx=p.x-localPoint.x,dz=p.z-localPoint.z;
      if(Math.abs(dx)>seam.dx*1.6||Math.abs(dz)>seam.dz*1.6)continue;
      if((localPoint.y-p.y)*seam.side<-.003)continue;
      const dist=dx*dx+dz*dz+.08*(localPoint.y-p.y)**2;
      if(dist<distance){distance=dist;best={point:p,side:seam.side,seam};}
    }
  }
  return best;
}
export function splitFlanks(ob,nb,finished){
  const previous=byPiece.get(ob)||[];
  const retained=previous.filter(s=>s!==finished);
  for(const piece of [ob,nb]){
    byPiece.delete(piece);prepareFlanks(piece,retained);
  }
}
