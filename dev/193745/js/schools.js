/* Small fish around the boat: schools that circle just under the surface and turn toward a lure working near them. */
import { THREE, S, V, rand, scene, boat } from './core.js';

const N=3,PER=14;
const geo=(()=>{const g=new THREE.SphereGeometry(1,10,6);g.scale(.11,.025,.035);const t=new THREE.ConeGeometry(.022,.05,4);t.rotateZ(Math.PI/2);t.translate(-.13,0,0);
  const m=new THREE.BufferGeometry();const a=g.toNonIndexed(),b=t.toNonIndexed();
  const pos=new Float32Array(a.attributes.position.array.length+b.attributes.position.array.length);pos.set(a.attributes.position.array);pos.set(b.attributes.position.array,a.attributes.position.array.length);
  m.setAttribute('position',new THREE.BufferAttribute(pos,3));m.computeVertexNormals();return m;})();
const mat=new THREE.MeshStandardMaterial({color:0x9fb6c2,metalness:.55,roughness:.35});
const mesh=new THREE.InstancedMesh(geo,mat,N*PER);mesh.frustumCulled=false;scene.add(mesh);
const schools=[];
for(let i=0;i<N;i++){const s={a:rand(0,Math.PI*2),r:rand(5,11),w:rand(.08,.16)*(Math.random()<.5?-1:1),d:rand(.5,1.4),c:V(),pull:V(),fish:[]};
  for(let k=0;k<PER;k++)s.fish.push({o:V(rand(-.7,.7),rand(-.25,.25),rand(-.7,.7)),ph:rand(0,6)});schools.push(s);}
const _m=new THREE.Matrix4(),_q=new THREE.Quaternion(),_e=new THREE.Euler(),_s=V(1,1,1),_p=V();
export function updateSchools(dt,lure,lureActive){
  let i=0;
  for(const s of schools){
    s.a+=s.w*dt;const base=boat.localToWorld(V(Math.cos(s.a)*s.r,0,Math.sin(s.a)*s.r));
    if(lureActive&&lure&&lure.distanceTo(base)<5)s.pull.lerp(lure.clone().sub(base).setY(0).multiplyScalar(.6),1-Math.exp(-dt*.8));else s.pull.multiplyScalar(Math.exp(-dt*.5));
    s.c.copy(base).add(s.pull);s.c.y=-s.d;
    const yaw=s.a+(s.w>0?Math.PI/2:-Math.PI/2);
    for(const f of s.fish){f.ph+=dt*6;
      _p.copy(f.o).applyAxisAngle(V(0,1,0),-s.a).add(s.c);_p.y+=Math.sin(f.ph*.3)*.05;
      _e.set(0,-yaw+Math.sin(f.ph)*.18,0);_q.setFromEuler(_e);_m.compose(_p,_q,_s);mesh.setMatrixAt(i++,_m);}
  }
  mesh.instanceMatrix.needsUpdate=true;
}
