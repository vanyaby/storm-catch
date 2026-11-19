/* Small procedural timber textures and static, instanced deck fittings. */
import * as THREE from 'three';
const textures=new Map();
export function woodMaterial(color,board=false){
  const key=board?'board':'planks';let map=textures.get(key);
  if(!map){
    const cv=document.createElement('canvas');cv.width=cv.height=256;const g=cv.getContext('2d'),image=g.createImageData(256,256);
    for(let y=0;y<256;y++)for(let x=0;x<256;x++){
      const plank=Math.floor(y/64),seam=y%64<2,grain=Math.sin(y*.9+Math.sin(x*.045+plank)*3)+Math.sin(y*3+x*.017)*.35;
      const knot=Math.sin(Math.hypot((x-70-plank*29)*.35,(y%64-30)*2)*.9)*Math.exp(-((x-70-plank*29)**2/1100+(y%64-30)**2/100));
      let v=seam?.39:.79+grain*.045+knot*.075+Math.sin(plank*9)*.055;
      if(board&&((x*19+y*13)%107<2||(x*5-y*11+4096)%173<2))v*=.78;
      const i=(y*256+x)*4;image.data[i]=255*v;image.data[i+1]=249*v;image.data[i+2]=232*v;image.data[i+3]=255;
    }g.putImageData(image,0,0);map=new THREE.CanvasTexture(cv);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;textures.set(key,map);
  }
  const m=new THREE.MeshStandardMaterial({color,map,roughness:board?.76:.66,metalness:0,flatShading:true});
  m.onBeforeCompile=sh=>{
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vWood;').replace('#include <begin_vertex>','#include <begin_vertex>\nvec3 an=abs(normal);vWood=(an.y>.5?position.xz:an.z>.5?position.xy:position.zy)*vec2(.8,2.0);');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vWood;').replace('#include <map_fragment>','diffuseColor*=texture2D(map,vWood);');
  };return m;
}
export function addBoatDetails(boat){
  const mat=new THREE.MeshStandardMaterial({color:0xc2aa78,roughness:.9}),rope=new THREE.InstancedMesh(new THREE.TorusGeometry(.17,.012,4,24),mat,5),m=new THREE.Matrix4(),q=new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI/2,0,0));
  for(let i=0;i<5;i++)m.compose(new THREE.Vector3(2.0,.04+i*.014,.65),q,new THREE.Vector3(1+i*.06,1+i*.06,1)),rope.setMatrixAt(i,m);boat.add(rope);
  const fenders=new THREE.InstancedMesh(new THREE.CapsuleGeometry(.09,.27,3,8),new THREE.MeshStandardMaterial({color:0xddd6b9,roughness:.55}),4);
  for(let i=0;i<4;i++){m.makeTranslation(i<2?-.65:1.9,.58,i%2?1.31:-1.31);fenders.setMatrixAt(i,m);}boat.add(fenders);
}
