const results = {checks:[]};
function check(name, passed, detail) {
  results.checks.push({name, pass:Boolean(passed), detail});
}
try {
  await import('./js/main.js');
  const {renderer,boat,V,SP,RAIL,S,save,waveH}=await import('./js/core.js');
  const {F,tieLure,updateFishing,resetFishing,updateRodLine}=await import('./js/fishing.js');
  const g=window.__game;
  const shaderErrors=[];
  renderer.debug.onShaderError=(gl,program,vs,fs)=>shaderErrors.push(gl.getShaderInfoLog(vs)+' '+gl.getShaderInfoLog(fs));
  const key=(code,type='keydown')=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true}));
  renderer.setAnimationLoop(null);
  document.querySelector('#'+(await import('./js/core.js')).ui.bStart.id).click();
  key('Digit2');
  function step(n) {
    for(let i=0;i<n;i++){S.T+=1/60;updateFishing(1/60);updateRodLine(1/60);}
  }
  key('KeyL');
  step(120);
  check('Lower from the boat using the keyboard',F.state==='water'&&F.depth>.2,[F.state,F.depth]);
  key('KeyL','keyup');
  check('Release closes bail',!F.lineFree&&F.bail==='closed',[F.lineFree,F.bail]);
  key('KeyL');
  window.dispatchEvent(new Event('blur'));
  check('Window blur closes an open bail',!F.lineFree&&F.bail==='closed',[F.lineFree,F.bail]);
  resetFishing();tieLure('jig');
  renderer.domElement.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true}));
  step(58);
  window.dispatchEvent(new PointerEvent('pointerup',{button:0,bubbles:true}));
  let flight=0;
  while(F.state==='flying'&&flight++<300)step(1);
  check('Mouse cast pays out line and leaves the bail open on landing',flight>0&&F.state==='water'&&F.line>10&&F.bail==='open',[flight,F.state,F.line,F.bail]);
  F.reel=1;step(1);
  check('First retrieve closes cast bail',F.bail==='closed');
  function land(local) {
    resetFishing();tieLure('jig');
    const w=boat.localToWorld(local);
    F.state='flying';F.lure.set(w.x,waveH(w.x,w.z)-.04,w.z);F.lureVel.set(0,-1,0);
    updateFishing(1/60);
    return F.state;
  }
  check('Port-side water',land(V(0,0,-1.7))==='water',F.state);
  check('Starboard water',land(V(0,0,1.7))==='water',F.state);
  check('Reject deck',land(V(0,0,.2))==='ready',F.state);
  check('Far cast',land(V(0,0,-18))==='water',F.state);
  F.biteCheck=1e4;const first=F.bottom;
  F.reel=1;F.bail='closed';step(90);
  check('Bottom changes during retrieve',Math.abs(F.bottom-first)>.005,[first,F.bottom]);
  land(V(0,0,-42));
  check('Offshore grounds reach halibut depth',F.bottom>SP.halibut.depth[0],F.bottom);
  const close=land(V(0,0,-5)),shoreBed=F.bottom;
  g.forceHook(SP.cod,.72);
  F.fish.pos.set(0,-shoreBed-1,-5);F.fish.mode='dive';F.fish.modeT=4;
  updateFishing(1/60);
  check('A diving hooked fish stays above the bed',F.fish.pos.y>=-shoreBed-.01,F.fish.pos.y);
  resetFishing();
  {
    const {rodItem,rod,tipW,crank}=await import('./js/fishing.js');
    const {bindHands,hapFlush}=await import('./js/haptics.js');
    g.forceHook(SP.cod,.8);
    let amplitude=0,crankAmp=0;
    const hand={src:{gamepad:{hapticActuators:[{pulse(v){amplitude=v;}}]}}};
    const off={src:{gamepad:{hapticActuators:[{pulse(v){crankAmp=v;}}]}}};
    bindHands({left:off,right:hand});rodItem.heldBy=hand;
    const startPos=rod.root.position.clone();
    const startTip=tipW(),fishPos=startTip.clone().add(V(0,-7,-9));
    const fish=F.fish;fish.mode='rest';fish.modeT=60;fish.pos.copy(fishPos);
    F.drag=.85;F.reel=0;F.tension=0;F.line=startTip.distanceTo(fishPos)-.07;
    const dt=1/90;
    const realNow=performance.now.bind(performance);let simMs=realNow();
    Object.defineProperty(performance,'now',{value:()=>simMs,configurable:true});
    function raiseRod(dy){
      const p=rod.root.getWorldPosition(V());p.y+=dy;
      rod.root.position.copy(rod.root.parent.worldToLocal(p));
    }
    function tick(fixed=true){
      simMs+=1000*dt;
      amplitude=0;crankAmp=0;
      if(fixed){fish.pos.copy(fishPos);fish.vel.set(0,0,0);}
      updateFishing(dt);hapFlush();
      return amplitude;
    }
    for(let i=0;i<50;i++)tick();
    const quiet=amplitude;
    const lift=[];
    for(let i=0;i<65;i++){raiseRod(.004);lift.push(tick());}
    check('Slow lift builds from a quiet loaded hold',quiet>.015&&lift.at(-1)>quiet+.08,[quiet,lift.at(-1)]);
    fish.mode='dive';fish.modeT=50;
    const dive=Array.from({length:110},()=>tick());
    check('Underwater animation uses the current fish stroke',Number.isFinite(F.fish.phase)&&F.swim.ob.mat.uniforms.uSwimPhase?.value===F.fish.phase);
    check('Ordinary diving effort has a graded crest below maximum',Math.max(...dive)<.78&&Math.max(...dive)-Math.min(...dive)>.025,[Math.min(...dive),Math.max(...dive)]);
    check('Free second hand stays quiet',crankAmp===0);
    crank.hand=off;crank.held=true;fish.mode='rest';
    // Repeatedly load the clutch just past breakaway without moving the fish.
    for(let i=0;i<70;i++)tick();
    const lineBefore=F.line,slip=[];
    for(let i=0;i<180;i++){raiseRod(.007);const last=F.line;tick();if(F.line>last)slip.push({t:F.tension,second:crankAmp});}
    check('Slipping clutch drops below its breakaway load',F.line>lineBefore&&slip.slice(-10).every(x=>x.t<F.drag*.95),slip.at(-1));
    check('Holding the reel transmits clutch feedback',slip.some(x=>x.second>.06));
    crank.hand=null;crank.held=false;
    fish.mode='charge';fish.modeT=4;fish.pos.copy(fishPos);fish.vel.copy(tipW().sub(fish.pos).normalize()).multiplyScalar(4);
    const unload=Array.from({length:30},()=>tick(false));
    check('Fish swimming toward the rod unloads within a third of a second',unload.at(-1)<.03,unload.at(-1));
    const noPayout=rod.spool.rotation.y;updateRodLine(dt);
    check('Spool stays still when payout stops',rod.spool.rotation.y===noPayout);
    delete performance.now;
    rodItem.heldBy=null;bindHands(g.HANDS);rod.root.position.copy(startPos);resetFishing();
  }
  const {newFish,buildFish,evaluate,cutPiece,massOf}=await import('./js/fishbody.js');
  const {addPiece,releaseOrgan,pieceItems,knifeSweep,toIce,toBucket,updateHand,releaseHand}=await import('./js/interact.js');
  const ob=buildFish(newFish(SP.cod,.8,5));
  ob.g.position.set(1,.99,0);
  boat.add(ob.g);
  const it=addPiece(ob);
  for(const org of [...ob.organs]) {
    toBucket(releaseOrgan(it,org,false),true);
  }
  const edge=(x,y)=>[ob.g.localToWorld(V(x,y,-.12)),ob.g.localToWorld(V(x,y,.12))];
  for(const x of [-.12,-.04]) knifeSweep(edge(x,-.10),edge(x,.10),{chop:true});
  const meat=pieceItems().filter(i=>i.vobj.fish===ob.fish&&i.vobj.kind==='fish');
  const slab=meat.find(i=>evaluate(i.vobj).kind.startsWith('Стейк'));
  check('Two cuts with the knife produce a cod steak',slab,meat.map(i=>evaluate(i.vobj).kind));
  check('Steaks and removed organs sum to the original catch mass',Math.abs(meat.reduce((n,i)=>n+massOf(i.vobj),ob.fish.organKg)-5)<.001);
  const {flankGuide}=await import('./js/fillet.js');
  const {filletDepth}=await import('./js/anatomy.js');
  const flank=buildFish(newFish(SP.cod,.8,4));
  flank.g.position.set(-.2,1,0);
  boat.add(flank.g);
  const fit=addPiece(flank);
  for(const org of [...flank.organs])toBucket(releaseOrgan(fit,org,false),true);
  const edgeAt=(x,y)=>[flank.g.localToWorld(V(x,y,-.15)),flank.g.localToWorld(V(x,y,.15))];
  const before=pieceItems().length;
  const guides=flankGuide(flank,1).map(p=>p.clone());
  const cutBond=p=>knifeSweep(edgeAt(p.x-.032,p.y),edgeAt(p.x+.032,p.y),{});
  const firstBond=guides[0];
  cutBond(firstBond);
  check('Partial fillet stays attached',pieceItems().length===before);
  // Regrip the carcass and change its orientation between strokes.
  flank.g.position.z+=.24;flank.g.rotation.y=.56;flank.g.updateMatrixWorld(true);
  const hand={grip:new g.THREE.Group(),src:null};boat.add(hand.grip);
  hand.grip.position.copy(boat.worldToLocal(flank.g.localToWorld(firstBond.clone().add(V(0,.01,0)))));hand.grip.updateMatrixWorld(true);
  const buttons=[{value:1},{pressed:false}];
  updateHand(hand,1/72,{buttons});
  hand.grip.position.y+=.035;
  updateHand(hand,1/72,{buttons});
  check('Pinching raises the cut flank while whole fish stays on board',Boolean(hand.filletLift&&flank.mat.uniforms.uFlankLift?.value>.01));
  renderer.render(g.scene,g.camera);
  check('Partial cut visible on the skin',flank.fish.skin.some((v,i)=>i%4===2&&v<255));
  if(flank.lift){
    const {sampler}=await import('./js/fishbody.js');
    const gap=flank.lift.weight(firstBond.x,firstBond.z)*flank.lift.amount;
    const inGap=flank.g.localToWorld(firstBond.clone().add(V(0,gap*.5,0)));
    check('Knife samples air in the open seam',sampler(flank)(inGap)===0);
  }
  cutBond(flankGuide(flank,-1)[0]);
  check('Opposite flank does not complete this fillet',pieceItems().length===before);
  guides.slice(2).forEach(cutBond);
  check('Uncut bridge survives disjoint pass',pieceItems().length===before);
  cutBond(guides[1]);
  check('Last connecting pass releases a fillet',pieceItems().length===before+1,pieceItems().filter(p=>p.vobj.fish===flank.fish).map(p=>evaluate(p.vobj).kind));
  check('Freed fillet stays in the pinching hand',hand.held?.vobj&&evaluate(hand.held.vobj).kind.startsWith('Филе'),pieceItems().filter(i=>i.vobj.fish===flank.fish).map(i=>[i.body.mass,i.vobj.inside(V(-.14,.028,0)),evaluate(i.vobj).kind]));
  releaseHand(hand);
  renderer.render(g.scene,g.camera);
  check('Cut skins and opened faces render without shader errors',shaderErrors.length===0,shaderErrors);
  check('Release clears the lift and hand grip',!hand.filletLift&&!hand.held&&!flank.lift);
  const {detachFillet}=await import('./js/fishbody.js');
  for(const [id,sp] of Object.entries(SP)){
    const whole=buildFish(newFish(sp,.8,4)),organs=whole.organs.slice();
    const sides=id==='eel'?[-1,1]:[1,-1];
    const pieces=sides.map(side=>detachFillet(whole,side));
    const complete=pieces.every(p=>p?.faces.size===1&&evaluate(p).kind.startsWith('Филе'))
      &&whole.faces.size===2&&whole.parts===2&&whole.organs.length===organs.length
      &&Math.abs(massOf(whole)+pieces.reduce((sum,p)=>sum+massOf(p),0)-4)<1e-8
      &&detachFillet(whole,sides[0])===null;
    check('Both authored flanks, ribs and conserved mass for '+id,complete);
    for(const p of [whole,...pieces])p.dispose();
  }
  if(slab) {
    const value=evaluate(slab.vobj).value;
    toIce(slab);
    const start=save.money;
    g.endTrip('home');
    check('Port sells the steak once',save.money-start===Math.round(value)&&S.products[0]?.kind.startsWith('Стейк'));
  }
} catch(error) {results.error=String(error.stack||error);}
document.documentElement.setAttribute('data-results',JSON.stringify(results));
