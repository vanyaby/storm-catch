import { THREE, V, clamp } from './core.js';
import { flankAt } from './fillet.js';
import { partAt } from './anatomy.js';

// A pinch opens only the connected patch already swept by the blade. The
// backbone side and every uncut attachment stay on the board.
function buildPatch(lift){
  const {ob,seam,anchor}=lift, d=ob.fish.d;
  const cols=Math.round(d.L/seam.dx),rows=seam.lookup.length/cols;
  const ids=seam.lookup;
  const field=new Float32Array(ids.length);
  const start=flankAt(ob,anchor);
  if(!start || start.seam!==seam)return;
  const column=x=>Math.floor((x+d.L/2)/seam.dx);
  const row=z=>Math.floor((z+d.hmax)/seam.dz);
  const first=row(start.point.z)*cols+column(start.point.x);
  const queue=[first], visited=new Uint8Array(ids.length);
  visited[first]=1;
  const reach=clamp(d.L*.36,.07,.25);
  for(let t=0;t<queue.length;t++){
    const k=queue[t],cell=ids[k];
    const x=k%cols,z=Math.floor(k/cols);
    const neighbours=[];
    if(x>0)neighbours.push(k-1);
    if(x+1<cols)neighbours.push(k+1);
    if(z>0)neighbours.push(k-cols);
    if(z+1<rows)neighbours.push(k+cols);
    const nearAttachment=neighbours.some(i=>ids[i]&&!ids[i].hit);
    const distance=Math.hypot(cell.point.x-anchor.x,cell.point.z-anchor.z);
    field[k]=Math.max(0,1-(distance/reach)**2)*(nearAttachment?.15:1);
    for(const c of seam.connectors)if(!c.cut){
      const gap=Math.hypot((c.point.x-cell.point.x)/seam.dx,(c.point.z-cell.point.z)/seam.dz);
      field[k]*=clamp((gap-.8)/1.5,0,1);
    }
    for(const i of neighbours)if(!visited[i]&&ids[i]?.hit){visited[i]=1;queue.push(i);}
  }
  function weight(x,z){
    const u=(x+d.L/2)/seam.dx-.5,v=(z+d.hmax)/seam.dz-.5;
    const i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j;
    if(i<0||j<0||i+1>=cols||j+1>=rows)return 0;
    const k=j*cols+i;
    return (1-b)*((1-a)*field[k]+a*field[k+1])+b*((1-a)*field[k+cols]+a*field[k+cols+1]);
  }
  lift.weight=weight;
  const geo=ob.mesh.geometry,pos=geo.attributes.position;
  const w=new Float32Array(pos.count),p=V();
  for(let i=0;i<w.length;i++){
    p.fromBufferAttribute(pos,i);
    if(partAt(ob.fish,p)===seam.side)w[i]=weight(p.x,p.z)*seam.side;
  }
  geo.setAttribute('aFlank',new THREE.BufferAttribute(w,1));

  // A pair of matching cut faces bounds the air gap under the lifted skin.
  const xyz=[],indices=[],weights=[],vertex=new Map();
  for(const k of queue){
    if(field[k]<=0)continue;
    vertex.set(k,weights.length);
    const p=ids[k].point;
    xyz.push(p.x,p.y,p.z);weights.push(field[k]*seam.side);
  }
  for(const [k,a] of vertex){
    if(k%cols===cols-1)continue;
    const b=vertex.get(k+1),c=vertex.get(k+cols),e=vertex.get(k+cols+1);
    if(b!==undefined&&c!==undefined)indices.push(a,c,b);
    if(b!==undefined&&c!==undefined&&e!==undefined)indices.push(b,c,e);
  }
  const face=new THREE.BufferGeometry();
  face.setAttribute('position',new THREE.Float32BufferAttribute(xyz,3));face.setIndex(indices);face.computeVertexNormals();
  lift.base.geometry.dispose();lift.base.geometry=face;
  lift.flap.geometry.dispose();lift.flap.geometry=face.clone();
  lift.weights=weights;lift.dirty=false;
}

export function startFilletLift(hand,ob){
  if(ob.kind!=='fish'||ob.lift)return false;
  const anchor=ob.g.worldToLocal(hand.grip.getWorldPosition(V()));
  const cut=flankAt(ob,anchor);
  if(!cut||cut.point.distanceTo(anchor)>ob.fish.d.wmax+.025)return false;
  const flesh=new THREE.MeshStandardMaterial({color:ob.fish.sp.flesh,side:THREE.DoubleSide,roughness:.72});
  const base=new THREE.Mesh(new THREE.BufferGeometry(),flesh);
  const flap=new THREE.Mesh(new THREE.BufferGeometry(),flesh);
  ob.g.add(base,flap);
  ob.mesh.geometry=ob.fish.geo.clone();
  const lift={hand,ob,anchor,seam:cut.seam,base,flap,dirty:true,amount:0};
  hand.filletLift=ob.lift=lift;
  updateFilletLift(hand);
  return true;
}
export function updateFilletLift(hand){
  const lift=hand.filletLift;if(!lift)return;
  if(lift.dirty)buildPatch(lift);
  if(!lift.weight)return;
  const {ob,anchor,seam}=lift;
  const local=ob.g.worldToLocal(hand.grip.getWorldPosition(V()));
  const amount=clamp((local.y-anchor.y)*seam.side,0,Math.min(.085,ob.fish.d.L*.18));
  lift.amount=amount;ob.mat.uniforms.uFlankLift.value=amount;
  lift.base.visible=lift.flap.visible=amount>.001;
  if(!lift.flap.visible)return;
  const pos=lift.flap.geometry.attributes.position,rest=lift.base.geometry.attributes.position;
  for(let i=0;i<pos.count;i++)pos.setY(i,rest.getY(i)+amount*lift.weights[i]);
  pos.needsUpdate=true;lift.flap.frustumCulled=false;
}
export function endFilletLift(hand){
  const lift=hand?.filletLift;if(!lift)return;
  const {ob,base,flap}=lift;
  base.removeFromParent();flap.removeFromParent();
  base.geometry.dispose();flap.geometry.dispose();base.material.dispose();
  ob.mesh.geometry.dispose();ob.mesh.geometry=ob.fish.geo;
  ob.mat.uniforms.uFlankLift.value=0;
  ob.lift=null;hand.filletLift=null;
}
