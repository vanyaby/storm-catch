/* Closed, plane-clipped ellipsoids. Geometry is rebuilt only when a cut completes. */
import { THREE, V, hash, TAU } from './core.js';

export function organSamples(c,r){
  const pts=[];let i=0;
  while(pts.length<1536*3){const p=V(hash(++i*3)*2-1,hash(i*3+1)*2-1,hash(i*3+2)*2-1);if(p.lengthSq()>1)continue;p.multiply(r).add(c);pts.push(p.x,p.y,p.z);}
  return {pts:new Float32Array(pts),N:pts.length/3};
}
function clip(poly,q){
  const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=q.x*a.x+q.y*a.y+q.z*a.z-q.w,db=q.x*b.x+q.y*b.y+q.z*b.z-q.w;
    if(da<=1e-8)out.push(a);if((da<0&&db>0)||(da>0&&db<0))out.push(a.clone().lerp(b,da/(da-db)));}return out;
}
export function organGeometry(c,r,planes){
  const sphere=new THREE.SphereGeometry(1,24,16),pa=sphere.attributes.position,ix=sphere.index.array,tri=[];
  for(let i=0;i<ix.length;i+=3)tri.push([0,1,2].map(k=>V().fromBufferAttribute(pa,ix[i+k]).multiply(r).add(c)));
  sphere.dispose();const pos=[],norm=[],colors=[];
  const emit=(poly,n,shade)=>{for(let i=1;i+1<poly.length;i++)for(const p of [poly[0],poly[i],poly[i+1]]){pos.push(p.x,p.y,p.z);const nn=n||p.clone().sub(c).divide(r).divide(r).normalize();norm.push(nn.x,nn.y,nn.z);colors.push(shade,shade,shade);}};
  for(let poly of tri){for(const q of planes)poly=clip(poly,q);if(poly.length>2)emit(poly,null,1);}
  for(const q of planes){
    const n=V(q.x,q.y,q.z),u=Math.abs(n.x)<.9?V(1,0,0):V(0,1,0);u.addScaledVector(n,-u.dot(n)).normalize();const v=n.clone().cross(u),points=[],keys=new Set();
    for(const t of tri)for(let k=0;k<3;k++){const a=t[k],b=t[(k+1)%3],da=n.dot(a)-q.w,db=n.dot(b)-q.w;if(da*db>0||Math.abs(da-db)<1e-12)continue;
      const p=a.clone().lerp(b,da/(da-db)),key=p.toArray().map(x=>Math.round(x*1e7)).join(',');if(!keys.has(key)){keys.add(key);points.push(p);}}
    if(points.length<3)continue;const center=points.reduce((a,p)=>a.add(p),V()).divideScalar(points.length);
    points.sort((a,b)=>Math.atan2(a.clone().sub(center).dot(v),a.clone().sub(center).dot(u))-Math.atan2(b.clone().sub(center).dot(v),b.clone().sub(center).dot(u)));
    let poly=points;for(const other of planes)if(other!==q)poly=clip(poly,other);if(poly.length>2)emit(poly,n,.55);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeBoundingBox();g.computeBoundingSphere();return g;
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
