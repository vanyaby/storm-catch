/* The two loins share a curved bone-side boundary with the frame. Coordinates
   are fish-local: +X towards the head, +/-Y across the body, +Z dorsally. */
import * as THREE from 'three';

const profiles = {
  mackerel: {
    tail: .084, neck: .79, connectors: [.11, .28, .47, .62, .765],
    core: .10, keel: .15, ribs: .32, ribStart: .32, ribEnd: .745,
    ribCount: 11, vertebrae: 23, flakeCount: 22, chevron: .032, ribSweep: .052
  },
  perch: {
    tail: .095, neck: .73, connectors: [.12, .32, .47, .6, .703],
    core: .12, keel: .19, ribs: .34, ribStart: .34, ribEnd: .70,
    ribCount: 9, vertebrae: 19, flakeCount: 16, chevron: .049, ribSweep: .061
  },
  cod: {
    tail: .075, neck: .75, connectors: [.105, .27, .43, .59, .72],
    core: .095, keel: .17, ribs: .38, ribStart: .33, ribEnd: .715,
    ribCount: 10, vertebrae: 21, flakeCount: 14, chevron: .048, ribSweep: .060
  },
  halibut: {
    tail: .092, neck: .81, connectors: [.12, .275, .43, .58, .70, .78],
    core: .14, keel: .16, ribs: .28, ribStart: .19, ribEnd: .77,
    ribCount: 19, vertebrae: 23, flakeCount: 21, chevron: .064, ribSweep: .082,
    bilateralFan: true
  },
  tuna: {
    tail: .095, neck: .79, connectors: [.12, .30, .47, .62, .755],
    core: .11, keel: .21, ribs: .34, ribStart: .35, ribEnd: .75,
    ribCount: 13, vertebrae: 22, flakeCount: 18, chevron: .052, ribSweep: .047
  },
  eel: {
    tail: .054, neck: .885, connectors: [.077, .22, .39, .55, .71, .856],
    core: .12, keel: .20, ribs: .19, ribStart: .19, ribEnd: .85,
    ribCount: 28, vertebrae: 42, flakeCount: 39, chevron: .012, ribSweep: .024
  }
};

export const anatomyFor = f => profiles[f.sp.id];
const clamp01 = x => Math.max(0, Math.min(1, x));
function ramp(a,b,x) {
  const t=clamp01((x-a)/(b-a));
  return t*t*(3-2*t);
}

// Keep a thin layer of connective tissue over the actual visceral cavity.
// uCavC and uCavR describe this same ellipsoid in the body shader.
export function filletDepth(f,xn,z) {
  const a=anatomyFor(f), d=f.d, h=d.H(xn), w=d.W(xn);
  const dz=(z-f.zs)/h;
  const ribBand=ramp(a.ribStart-.06,a.ribStart,xn)*(1-ramp(a.ribEnd,a.ribEnd+.045,xn));
  const arc=a.bilateralFan ? 1-ramp(.69,.94,Math.abs(dz))
    : (1-ramp(.03,.27,dz))*ramp(-1,-.70,dz);
  const spine=(w*a.keel+.001)*(1-ramp(.075,.37,Math.abs(dz)));
  const core=w*a.core+Math.max(spine,w*a.ribs*ribBand*arc);
  const c=f.cav.c,r=f.cav.r,dx=(d.X(xn)-c.x)/r.x,cz=(z-c.z)/r.z;
  const cavity=r.y*Math.sqrt(Math.max(0,1-dx*dx-cz*cz));
  return Math.max(core,cavity+w*.035);
}

export function partAt(f,p) {
  const xn=p.x/f.d.L+.5,a=anatomyFor(f);
  if(xn<a.tail || xn>a.neck)return 0;
  const ny=p.y/f.d.W(xn),nz=p.z/f.d.H(xn);
  if(ny*ny+nz*nz>1.00001)return 0;
  const seam=filletDepth(f,xn,p.z);
  return p.y>seam ? 1 : p.y < -seam ? -1 : 0;
}

export function anatomyUniforms(f) {
  const a=anatomyFor(f);
  return {
    uFilletEnds:{value:new THREE.Vector2(a.tail,a.neck)},
    uFilletRibBand:{value:new THREE.Vector2(a.ribStart,a.ribEnd)},
    uFilletShape:{value:new THREE.Vector4(a.core,a.keel,a.ribs,a.bilateralFan?1:0)}
  };
}

export const anatomyGLSL=`
uniform vec2 uFilletEnds,uFilletRibBand;
uniform vec4 uFilletShape;
float filletDepthAt(float xn,float z) {
  float h=Hf(xn),w=Wf(xn),dz=(z-uZs)/h;
  float ribBand=smoothstep(uFilletRibBand.x-.06,uFilletRibBand.x,xn)
    *(1.-smoothstep(uFilletRibBand.y,uFilletRibBand.y+.045,xn));
  float arc=uFilletShape.w>.5 ? 1.-smoothstep(.69,.94,abs(dz))
    : (1.-smoothstep(.03,.27,dz))*smoothstep(-1.,-.70,dz);
  float spine=(w*uFilletShape.y+.001)*(1.-smoothstep(.075,.37,abs(dz)));
  float core=w*uFilletShape.x+max(spine,w*uFilletShape.z*ribBand*arc);
  vec2 q=(vec2((xn-.5)*uL,z)-uCavC.xz)/uCavR.xz;
  float cavity=uCavR.y*sqrt(max(0.,1.-dot(q,q)));
  return max(core,cavity+w*.035);
}
float anatomyPartAt(vec3 p) {
  float xn=p.x/uL+.5;
  if(xn<uFilletEnds.x || xn>uFilletEnds.y)return 0.;
  vec2 radial=p.yz/vec2(Wf(xn),Hf(xn));
  if(dot(radial,radial)>1.00001)return 0.;
  float seam=filletDepthAt(xn,p.z);
  return p.y>seam ? 1. : (p.y < -seam ? -1. : 0.);
}
`;

const mix=(a,b,t)=>a+(b-a)*t;
const radialWidth=(w,t)=>w*Math.sqrt(Math.max(0,1-t*t));

// Find the line at which the flesh face and elliptical skin actually meet.
function rimHeight(f,xn,sign) {
  const h=f.d.H(xn),w=f.d.W(xn);
  let inside=0,outside=1;
  for(let i=0;i<15;i++) {
    const t=(inside+outside)*.5;
    if(radialWidth(w,t)>=filletDepth(f,xn,sign*t*h))inside=t;
    else outside=t;
  }
  return sign*(inside+outside)*.5*h;
}

// A single indexed mesh and material per exposed side, including bone relief
// and muscle septa. The caller can clip each physical piece independently.
export function createCutFaces(f,side,frame) {
  const a=anatomyFor(f),d=f.d,span=a.neck-a.tail;
  const positions=[],colors=[],indices=[];
  const vec=(x,y,z)=>new THREE.Vector3(x,y,z);
  const color=n=>new THREE.Color(n);
  const loin=color(f.sp.flesh),blood=color(f.sp.blood||0x96615d);
  const marrow=color(0xbc8d78),bone=color(0xf0dcb3),joint=color(0xdab78f);
  const tendon=color(f.sp.id==='eel'?0xf5e8f4:0xffe6d0);
  const fascia=color(0xd6b2a1),liner=color(0x967d79),shade=new THREE.Color();
  function vertex(p,c) {
    const id=positions.length/3;
    positions.push(p.x,p.y,p.z);colors.push(c.r,c.g,c.b);
    return id;
  }
  function grid(nu,nv,sample,reverse=false) {
    const first=positions.length/3;
    for(let i=0;i<=nu;i++)for(let j=0;j<=nv;j++) {
      sample(i/nu,j/nv,i,j);
      if(i===0||j===0)continue;
      const e=first+i*(nv+1)+j,b=e-1,c=e-nv-1,k=c-1;
      if(reverse)indices.push(k,c,b,c,e,b);
      else indices.push(k,b,c,c,b,e);
    }
  }
  const point=(xn,z,offset=0)=>vec(d.X(xn),side*(filletDepth(f,xn,z)+offset),z);
  function tissueColor(xn,z) {
    const t=z/d.H(xn),ds=Math.abs(z-f.zs)/d.H(xn);
    const count=a.flakeCount,phase=(xn-a.tail+a.chevron*Math.abs(t))*count/span;
    if(frame) {
      const belly=ramp(a.ribStart-.055,a.ribStart+.06,xn)*(1-ramp(a.ribEnd-.025,a.ribEnd+.04,xn));
      return shade.copy(loin).lerp(fascia,.57).lerp(liner,belly*(1-ramp(-.48,-.08,t))*.72)
        .lerp(blood,(1-ramp(.05,.24,ds))*.83).multiplyScalar(.85+.10*Math.cos(phase*6.283));
    }
    const redBand=(f.sp.blood?.78:.29)*(1-ramp(.025,.16,ds));
    return shade.copy(loin).lerp(blood,redBand)
      .lerp(tendon,.17*ramp(.58,.99,Math.abs(t))).multiplyScalar(.96+.04*Math.cos(phase*6.283));
  }

  let lo=0,hi=0;
  const sections=f.sp.fam==='eel'?68:52,rows=30;
  grid(sections,rows,(u,v,i,j)=>{
    const xn=mix(a.tail,a.neck,u);
    if(!j){lo=rimHeight(f,xn,-1);hi=rimHeight(f,xn,1);}
    const z=mix(lo,hi,.5-.5*Math.cos(Math.PI*v));
    vertex(point(xn,z),tissueColor(xn,z));
  },frame ? side>0 : side<0);

  // Both adjoining pieces have a lateral crescent at the neck and tail.
  for(const [xn,normal] of [[a.tail,-1],[a.neck,1]]) {
    const h=d.H(xn),w=d.W(xn),bottom=rimHeight(f,xn,-1),top=rimHeight(f,xn,1);
    grid(4,rows,(u,v)=>{
      const z=mix(bottom,top,.5-.5*Math.cos(Math.PI*v)),t=z/h;
      const inner=filletDepth(f,xn,z),outer=radialWidth(w,t);
      const p=vec(d.X(xn),side*mix(inner,outer,u),z);
      const c=shade.copy(loin).lerp(blood,(f.sp.blood?.8:.28)*(1-ramp(.02,.22,Math.abs(t))))
        .lerp(tendon,.36*Math.pow(u,5)).multiplyScalar(.86+.08*Math.cos(12*t+3*u));
      vertex(p,c);
    },normal*side*(frame?-1:1)<0);
  }

  function tube(path,radius,tint,segments,sides) {
    const points=Array.from({length:segments+1},(_,i)=>path(i/segments));
    grid(segments,sides,(u,v,i)=>{
      const tangent=points[Math.min(i+1,segments)].clone().sub(points[Math.max(0,i-1)]).normalize();
      const across=vec(0,side,0).cross(tangent).normalize(),out=tangent.clone().cross(across);
      const angle=v*2*Math.PI,r=radius(u);
      const p=points[i].clone().addScaledVector(across,r*Math.cos(angle)).addScaledVector(out,r*Math.sin(angle));
      vertex(p,tint(u));
    },true);
  }

  if(frame) {
    const pitch=span/a.vertebrae;
    for(let i=0;i<a.vertebrae;i++) {
      const x=a.tail+(i+.5)*pitch,unit=Math.min(d.H(x),d.W(x));
      tube(u=>{
        const xn=x+(u-.5)*pitch, z=f.zs;
        return point(xn,z,-unit*.021);
      },u=>unit*(.070+.053*Math.cos(u*Math.PI)**4)*Math.min(1,u*11,(1-u)*11),
      u=>u<.22||u>.78?joint:bone,8,8);
    }
    for(let i=0;i<a.ribCount;i++) {
      const s=(i+.5)/a.ribCount,x=mix(a.ribStart,a.ribEnd,s),h=d.H(x);
      const reach=.56+.28*Math.sin(s*Math.PI),unit=Math.min(h,d.W(x));
      // Flatfish expose a fin-supporting fan on either edge of the central spine.
      for(const dir of a.bilateralFan?[-1,1]:[-1]) {
        tube(u=>{
          const xn=x-a.ribSweep*u*(.44+.56*u);
          const z=f.zs+dir*h*reach*u;
          return point(xn,z,unit*(.009+.022*Math.sin(Math.PI*u)));
        },u=>unit*(.052*(1-u)+.009)*Math.min(1,(1-u)*14),
        u=>u<.18?joint:bone,9,6);
      }
    }
    if(!a.bilateralFan) {
      // Neural spines arch towards the dorsal edge above each centrum.
      for(let i=1;i<a.vertebrae-1;i++) {
        const x=a.tail+(i+.5)*pitch,h=d.H(x),unit=Math.min(h,d.W(x));
        tube(u=>point(x-.82*pitch*u,f.zs+h*(f.sp.fam==='eel'?.27:.40)*u,-unit*.003),
          u=>unit*.045*(1-u),u=>u<.2?marrow:joint,4,5);
      }
    }
  } else {
    // Thin chevron-shaped sheets of connective tissue delineate the myomeres.
    // Their edges taper towards the skin and change direction across the loin.
    const pitch=span/a.flakeCount;
    for(let i=1;i<a.flakeCount;i++) {
      const x=a.tail+i*pitch;
      for(const dir of [-1,1]) {
        grid(13,1,(u,v)=>{
          const t=mix(.022,.94,u);
          const pull=a.chevron*(.65*u+.35*Math.sin(Math.PI*u*.8));
          const xn=Math.max(a.tail,Math.min(a.neck,x-pull+(v-.5)*pitch*.091*Math.sin(Math.PI*u)));
          const z=mix(f.zs,dir*d.H(xn)*.98,t);
          const unit=Math.min(d.H(xn),d.W(xn));
          const p=point(xn,z,-unit*.006);
          const c=shade.copy(loin).lerp(tendon,.36+.28*Math.sin(Math.PI*u));
          vertex(p,c);
        },dir*side>0);
      }
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:frame?.53:.42,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name=(frame?'carcass':'fillet')+(side>0?'-right':'-left');
  return mesh;
}
