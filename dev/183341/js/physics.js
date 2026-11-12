/* physics world in the boat's own frame (the boat stands still) */
import * as CANNON from 'cannon-es';
import { TABLE, ICE } from './core.js';
export { CANNON };
export const world=new CANNON.World();
world.allowSleep=true;world.broadphase=new CANNON.SAPBroadphase(world);world.solver.iterations=10;
world.gravity.set(0,-9.82,0);
world.defaultContactMaterial.friction=.6;world.defaultContactMaterial.restitution=.05;
export const G_STATIC=1,G_PIECE=2,G_ORGAN=4,G_TOOL=8;
function staticBox(x,y,z,sx,sy,sz,ry=0){const b=new CANNON.Body({mass:0,type:CANNON.Body.STATIC,collisionFilterGroup:G_STATIC,collisionFilterMask:G_PIECE|G_ORGAN|G_TOOL});b.addShape(new CANNON.Box(new CANNON.Vec3(sx/2,sy/2,sz/2)));b.position.set(x,y,z);if(ry)b.quaternion.setFromEuler(0,ry,0);world.addBody(b);return b;}
staticBox(.2,-.05,0,7.4,.1,2.6);                               // deck
staticBox(TABLE.x,TABLE.top/2,TABLE.z,.72,TABLE.top,1.45);     // table with its board
staticBox(-.85,.5,-1.22,4.6,1.1,.08);staticBox(-.85,.5,1.22,4.6,1.1,.08);staticBox(-3.1,.5,0,.08,1.1,2.5);
staticBox(2.55,.5,-.62,2.65,1.1,.08,-.497);staticBox(2.55,.5,.62,2.65,1.1,.08,.497);
staticBox(-1.85,1.02,0,1.6,2.05,1.8);                          // wheelhouse
staticBox(-.5,.25,-.42,.42,.5,.36,.4);                         // tackle crate
staticBox(ICE.position.x,.2,ICE.position.z,.56,.4,.5);         // ice box (things above its opening get collected)
