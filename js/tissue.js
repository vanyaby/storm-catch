import { THREE, V, hash, TAU } from './core.js';
import { organStations, organRings } from './organ-profiles.js';

const SIDES=12, SAMPLE_COUNT=768;
const tetraEdges=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];

// Triangulated ring sweeps have a matching tetrahedral interior. Cut caps, point queries,
// and mass all use this same volume, including through the spaces between intestine folds.
function buildTemplate(spec) {
  const {kind,style}=spec, stations=organStations(kind,style);
  const path=new THREE.CatmullRomCurve3(stations.map(s=>V(s[0],0,s[1])));
  const points=[], shades=[], groups=[], tets=[], outer=new Map();
  const slices=kind==='gut'?stations.length-1:(stations.length-1)*(kind==='roe'?4:2);
  const centers=[];
  for(let i=0;i<=slices;i++) {
    const t=i/slices;
    centers.push(kind==='gut'?V(stations[i][0],0,stations[i][1]):path.getPoint(t));
  }
  for(let i=0;i<=slices;i++) {
    const t=i/slices, pos=t*(stations.length-1), j=Math.min(stations.length-2,Math.floor(pos)), mix=pos-j;
    const radius=THREE.MathUtils.lerp(stations[j][2],stations[j+1][2],mix);
    const depth=THREE.MathUtils.lerp(stations[j][3],stations[j+1][3],mix);
    const tangent=centers[Math.min(slices,i+1)].clone().sub(centers[Math.max(0,i-1)]).normalize();
    points.push(centers[i]);shades.push([.83,.75,.68]);
    for(let k=0;k<SIDES;k++){
      const a=TAU*k/SIDES, cs=Math.cos(a), sn=Math.sin(a);
      const beads=kind==='roe'?.5+.5*Math.cos(i*2.7+(k%2)*2.3)*Math.cos(a*5):0;
      const ripple=1+beads*.12;
      points.push(centers[i].clone().add(V(-tangent.z*sn*radius,cs*depth,tangent.x*sn*radius).multiplyScalar(ripple)));
      const vein=Math.exp(-Math.pow((sn-.23*Math.sin(t*11))/.19,2));
      const shade=kind==='roe'?.72+.24*beads:kind==='gut'?.83+.11*Math.cos(t*49)+.05*cs:.94-.16*vein+.05*cs;
      shades.push([shade,shade*(1-.12*vein),shade*(kind==='heart'?.84:.98)]);
    }
  }
  // Normalize to the authored placement box once. Templates are shared across fish.
  const box=new THREE.Box3().setFromPoints(points),mid=box.getCenter(V()),half=box.getSize(V()).multiplyScalar(.5);
  for(const point of points)point.sub(mid).divide(half);
  let volume=0;
  function tetra(group,ids) {
    const [a,b,c,d]=ids.map(id=>points[id]),ab=b.clone().sub(a),ac=c.clone().sub(a),ad=d.clone().sub(a);
    const nx=ac.clone().cross(ad),ny=ad.clone().cross(ab),nz=ab.clone().cross(ac),det=ab.dot(nx);
    if(Math.abs(det)<1e-15)return;
    volume+=Math.abs(det)/6;
    const tet={ids,a,nx:nx.divideScalar(det),ny:ny.divideScalar(det),nz:nz.divideScalar(det),end:volume};
    tets.push(tet);group.tets.push(tet);
    for(let k=0;k<4;k++){
      const face=ids.filter((_,j)=>j!==k),key=[...face].sort((l,r)=>l-r).join('/');
      if(outer.delete(key))continue;
      const [u,v,w]=face.map(id=>points[id]);
      const inward=v.clone().sub(u).cross(w.clone().sub(u)).dot(points[ids[k]].clone().sub(u))>0;
      if(inward)face.reverse();
      outer.set(key,face);
    }
  }
  const stride=SIDES+1;
  for(let i=0;i<slices;i++){
    const base=i*stride, group={box:new THREE.Box3().setFromPoints(points.slice(base,base+2*stride)),tets:[]};
    groups.push(group);
    for(let k=0;k<SIDES;k++){
      const [a,b,c]=[base,base+1+k,base+1+(k+1)%SIDES].sort((l,r)=>l-r);
      tetra(group,[a,b,c,c+stride]);tetra(group,[a,b,b+stride,c+stride]);tetra(group,[a,a+stride,b+stride,c+stride]);
    }
  }
  const faces=[...outer.values()], geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(points.flatMap(p=>p.toArray()),3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(shades.flat(),3));
  geometry.setIndex(faces.flat());geometry.computeVertexNormals();
  const normals=points.map((_,i)=>V().fromBufferAttribute(geometry.attributes.normal,i));
  const samples=[];
  let ti=0;
  for(let i=0;i<SAMPLE_COUNT;i++){
    const target=(i+.5)*volume/SAMPLE_COUNT;
    while(tets[ti].end<target)ti++;
    const tet=tets[ti], breaks=[0,hash(i*3+1),hash(i*3+2),hash(i*3+3),1].sort((a,b)=>a-b);
    const pt=V();tet.ids.forEach((id,k)=>pt.addScaledVector(points[id],breaks[k+1]-breaks[k]));
    samples.push(pt);
  }
  return {points,shades,normals,faces,geometry,tets,groups,volume,samples};
}

export function organShape(cavity,spec) {
  const template=organRings(spec.key,()=>buildTemplate(spec)),row=spec.box;
  const c=V(...row.slice(0,3)).multiply(cavity.r).add(cavity.c),r=V(...row.slice(3)).multiply(cavity.r);
  const pts=new Float32Array(SAMPLE_COUNT*3),tmp=V();
  template.samples.forEach((p,i)=>tmp.copy(p).multiply(r).add(c).toArray(pts,i*3));
  const density=spec.kind==='bladder'?160:1050;
  return {c,r,template,kind:spec.kind,style:spec.style,kg:template.volume*r.x*r.y*r.z*density,
    samples:{pts,N:SAMPLE_COUNT},anchor:template.points[0].clone().multiply(r).add(c)};
}

const queryPoint=V(),delta=V();
export function organContains(shape,p) {
  const q=queryPoint.copy(p).sub(shape.c).divide(shape.r);
  if(Math.max(Math.abs(q.x),Math.abs(q.y),Math.abs(q.z))>1.000001)return false;
  for(const group of shape.template.groups){
    if(!group.box.containsPoint(q))continue;
    for(const tet of group.tets){
      delta.subVectors(q,tet.a);
      const a=delta.dot(tet.nx),b=delta.dot(tet.ny),c=delta.dot(tet.nz);
      if(a>=-1e-7&&b>=-1e-7&&c>=-1e-7&&a+b+c<=1.0000001)return true;
    }
  }
  return false;
}

const side=(p,q)=>q.n.dot(p)-q.w;
function clipFace(poly,q) {
  const kept=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],da=side(a.p,q),db=side(b.p,q);
    if(da<=0)kept.push(a);
    if((da<0&&db>0)||(da>0&&db<0)){
      const t=da/(da-db);
      kept.push({p:a.p.clone().lerp(b.p,t),n:a.n.clone().lerp(b.n,t),col:a.col.map((v,k)=>v+(b.col[k]-v)*t)});
    }
  }
  return kept;
}
function cutGeometry(template,planes) {
  const pos=[],norm=[],color=[];
  function emit(poly) {
    for(let j=1;j+1<poly.length;j++)for(const v of [poly[0],poly[j],poly[j+1]]){
      pos.push(v.p.x,v.p.y,v.p.z);norm.push(v.n.x,v.n.y,v.n.z);color.push(...v.col);
    }
  }
  const vertices=template.points.map((p,i)=>({p,n:template.normals[i],col:template.shades[i]}));
  for(const face of template.faces){
    let poly=face.map(i=>vertices[i]);
    for(const q of planes)poly=clipFace(poly,q);
    emit(poly);
  }
  for(const q of planes){
    const u=(Math.abs(q.n.x)<.9?V(1,0,0):V(0,1,0)).cross(q.n).normalize(),v=q.n.clone().cross(u);
    for(const tet of template.tets){
      const points=tet.ids.map(i=>template.points[i]),dist=points.map(p=>side(p,q));
      if(Math.min(...dist)>0 || Math.max(...dist)<=0)continue;
      const ring=[];
      for(const p of points)if(Math.abs(side(p,q))<=1e-10)ring.push(p);
      for(const [a,b] of tetraEdges)if(dist[a]*dist[b]<0&&Math.min(Math.abs(dist[a]),Math.abs(dist[b]))>1e-10)
        ring.push(points[a].clone().lerp(points[b],dist[a]/(dist[a]-dist[b])));
      if(ring.length<3)continue;
      const ctr=ring.reduce((s,p)=>s.add(p),V()).divideScalar(ring.length);
      const angle=p=>Math.atan2(p.dot(v)-ctr.dot(v),p.dot(u)-ctr.dot(u));
      ring.sort((a,b)=>angle(a)-angle(b));
      let poly=ring.map(p=>({p,n:q.n,col:[.77,.56,.53]}));
      for(const other of planes)if(other!==q)poly=clipFace(poly,other);
      emit(poly);
    }
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(color,3));
  return geo;
}

export function organGeometry(shape,planes) {
  const local=planes.map(p=>{
    const world=V(p.x,p.y,p.z),n=world.clone().multiply(shape.r),len=n.length();
    return {n:n.divideScalar(len),w:(p.w-world.dot(shape.c))/len};
  });
  const g=local.length?cutGeometry(shape.template,local):shape.template.geometry.clone();
  g.scale(shape.r.x,shape.r.y,shape.r.z);g.translate(shape.c.x,shape.c.y,shape.c.z);
  g.computeBoundingBox();g.computeBoundingSphere();return g;
}

/* A curled, opaque skin ribbon, one material and one draw call per physical scrap. */
export function skinGeometry(area){
  const width=Math.min(.045,Math.sqrt(area*.32)),length=area/width,g=new THREE.PlaneGeometry(length,width,10,3);g.rotateX(-Math.PI/2);
  const p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);p.setY(i,.007*Math.sin(x/length*5)+.008*(z/width)**2+.003*Math.sin(x*94+z*53));}g.computeVertexNormals();g.computeBoundingBox();return g;
}
export function skinMaterial(f,cells){
  const cv=document.createElement('canvas');cv.width=128;cv.height=64;const ctx=cv.getContext('2d'),sp=f.sp;
  const back=new THREE.Color(sp.back),belly=new THREE.Color(sp.belly),dark=new THREE.Color(sp.stripe||sp.spots||sp.back),col=new THREE.Color();
  const data=ctx.createImageData(128,64);for(let y=0;y<64;y++)for(let x=0;x<128;x++){
    const cell=cells[Math.min(cells.length-1,Math.floor(x/128*cells.length))],th=cell.th+(y/64-.5)*.6,xn=cell.xn,c=Math.cos(th);
    col.copy(belly).lerp(back,sp.fam==='flat'?(Math.sin(th)>0?1:0):THREE.MathUtils.smoothstep(c,-.25,.55));
    if(sp.stripe&&c>.15&&Math.sin(xn*58+c*9+Math.sin(xn*21)*2)>.45)col.copy(dark);
    if(sp.spots&&hash(Math.floor(xn*90)*13.7+Math.floor(th*14))>.8)col.copy(dark);
    if(cell.scaled)col.lerp(belly,.18);else col.multiplyScalar(.9+.14*Math.sin(x*.9+Math.sin(y)*.7)*Math.sin(y*1.7));
    col.convertLinearToSRGB();const i=(y*128+x)*4;data.data[i]=col.r*255;data.data[i+1]=col.g*255;data.data[i+2]=col.b*255;data.data[i+3]=255;
  }ctx.putImageData(data,0,0);const map=new THREE.CanvasTexture(cv);map.colorSpace=THREE.SRGBColorSpace;
  const m=new THREE.MeshStandardMaterial({map,roughness:.34,metalness:.12,side:THREE.DoubleSide});
  m.onBeforeCompile=sh=>{sh.fragmentShader=sh.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\nif(!gl_FrontFacing)diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.28,.12,.10),.68);');};return m;
}
