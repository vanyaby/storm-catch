import { THREE, V } from './core.js';
import { partAt, createCutFaces } from './anatomy.js';

// The ownership of a sample never changes, even if this fish is cut into steaks.
export const partBit = side => side < 0 ? 1 : side > 0 ? 4 : 2;
export function prepareAssembly(f) {
  const p = V();
  function classify(coords, count) {
    return Uint8Array.from({length:count}, (_, i) => partBit(partAt(f, p.fromArray(coords, 3*i))));
  }
  f.meatParts = classify(f.pts, f.N);
  f.skinParts = classify(f.spts, f.NS);
  f.cutSurfaces = new Map();
}

// Only exposed surfaces need GPU buffers. Pieces of the same catch share
// the authored geometry, but each can have different transverse cuts.
export function updateAssemblyFaces(ob) {
  const frame = Boolean(ob.parts & 2);
  ob.faces ??= new Map();
  for (const side of [-1, 1]) {
    const show = frame !== Boolean(ob.parts & partBit(side));
    const face = ob.faces.get(side);
    if (face && !show) {
      face.removeFromParent();
      face.material.dispose();
      ob.faces.delete(side);
    }
    if (!show || face) continue;
    const key = side * (frame ? 2 : 1);
    const templates = ob.fish.cutSurfaces;
    if (!templates.has(key)) templates.set(key, createCutFaces(ob.fish, side, frame));
    const mesh = templates.get(key).clone();
    mesh.material = mesh.material.clone();
    mesh.material.onBeforeCompile = shader => {
      const u = ob.mat.uniforms;
      shader.uniforms.uPiecePlanes = u.uPl;
      shader.uniforms.uPlaneCount = u.uNp;
      shader.vertexShader = 'varying vec3 vCutLocal;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\nvCutLocal=position;');
      shader.fragmentShader = 'varying vec3 vCutLocal;\nuniform vec4 uPiecePlanes[' +
        u.uPl.value.length + '];\nuniform int uPlaneCount;\n' + shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' +
        'for(int i=0;i<' + u.uPl.value.length + ';++i){if(i>=uPlaneCount)break;' +
        'if(dot(uPiecePlanes[i].xyz,vCutLocal)>uPiecePlanes[i].w)discard;}');
    };
    mesh.userData.vobj = ob;
    ob.faces.set(side, mesh);
    ob.g.add(mesh);
  }
}
