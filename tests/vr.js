// Replace the headset transport only. The game receives its normal connection,
// pose and gamepad inputs, and uses the same raycaster and controller handlers.
const report={checks:[]};
function expect(name,pass){
  report.checks.push({name,pass:Boolean(pass)});
  if(!pass)throw Error(name);
}
try{
  await import('./js/main.js');
  const {renderer,V,ui}=await import('./js/core.js');
  const g=window.__game,xr=renderer.xr;
  renderer.setAnimationLoop(null);
  const session=new EventTarget();
  session.requestAnimationFrame=fn=>queueMicrotask(fn);
  Object.defineProperty(navigator,'xr',{configurable:true,value:{requestSession:async mode=>{
    expect('Requests immersive VR',mode==='immersive-vr');return session;
  }}});
  xr.setSession=async()=>{xr.isPresenting=true;};
  xr.getCamera=()=>g.camera;
  xr.enabled=false; // render to the browser canvas in this simulated session
  ui.bVR.click();
  await new Promise(resolve=>setTimeout(resolve,0));
  expect('Opens settings in the headset before starting the timer',g.vrPanel.visible&&g.portState.settings&&g.S.gameState==='menu');
  const pulses=[];
  function connect(index,name){
    const buttons=Array.from({length:6},()=>({pressed:false,value:0}));
    const src={handedness:name,gamepad:{buttons,axes:[0,0,0,0],hapticActuators:[{pulse:v=>pulses.push([name,v])}]}};
    xr.getController(index).dispatchEvent({type:'connected',data:src});
    const hand=g.HANDS[name];hand.grip.matrixAutoUpdate=hand.ctl.matrixAutoUpdate=true;return hand;
  }
  const left=connect(0,'left'),right=connect(1,'right');
  const press=(hand,i,on)=>Object.assign(hand.src.gamepad.buttons[i],{pressed:on,value:Number(on)});
  function select(hand,key){
    hand.ctl.position.copy(hand.ctl.parent.worldToLocal(g.camera.getWorldPosition(V())));
    const b=g.portState.buttons.find(b=>b.key===key&&b.enabled);
    if(!b)throw Error('Missing button '+key);
    const point=g.vrPanel.localToWorld(V(((b.x+b.w/2)/512-.5)*1.5,(.5-(b.y+b.h/2)/512)*1.5,0));
    const direction=hand.ctl.parent.worldToLocal(point).sub(hand.ctl.position).normalize();
    hand.ctl.quaternion.setFromUnitVectors(V(0,0,-1),direction);
    press(hand,0,true);g.updateVRShop();press(hand,0,false);g.updateVRShop();
  }
  const gain=g.save.hapticGain;
  select(left,'haptic');
  expect('Left trigger changes vibration strength',g.save.hapticGain!==gain);
  select(right,'again');
  expect('Right trigger starts voyage and holsters rod',g.S.gameState==='sea'&&g.rodItem.inHolster);
  const tablet=g.atlas.screen,ctx=tablet.material.map.image.getContext('2d'),labels=[];
  const paint=ctx.fillText.bind(ctx);
  ctx.fillText=(label,...args)=>{labels.push(String(label));paint(label,...args);};
  function tap(x,y){
    labels.length=0;
    const target=tablet.localToWorld(V((x/960-.5)*.516,(.5-y/600)*.3225,0));
    const origin=tablet.localToWorld(V(0,0,.4));
    left.ctl.position.copy(left.ctl.parent.worldToLocal(origin));
    left.ctl.quaternion.setFromUnitVectors(V(0,0,-1),left.ctl.parent.worldToLocal(target).sub(left.ctl.position).normalize());
    press(left,0,true);g.atlas.update(g.HANDS);press(left,0,false);g.atlas.update(g.HANDS);
  }
  const {SPECIES,LURES}=await import('./js/core.js');
  for(const [tab,list] of [SPECIES,LURES].entries()){
    tap(490+tab*164,35);
    for(const [i,item] of list.entries()){
      tap(110,135+i*79);
      expect('Tablet opens '+item.id,labels.filter(t=>t===item.name).length===2);
    }
  }
  tap(835,35);tap(795,530);
  expect('Tutorial pages turn on the physical tablet',labels.includes('Предыдущий'));
  ctx.fillText=paint;
  right.grip.position.copy(g.rig.worldToLocal(g.rod.root.getWorldPosition(V())));
  press(right,1,true);g.updateHand(right,1/72,right.src.gamepad);
  expect('Squeeze takes rod from holder',g.rodItem.heldBy===right);
  const dt=1/72;
  const fish=await import('./js/fishing.js');
  function tick(){g.S.T+=dt;g.fishingVR(dt);fish.updateFishing(dt);fish.updateRodLine(dt);}
  for(let i=0;i<20;i++)tick();
  press(right,4,true);tick();
  expect('Rod-hand A pins the line for casting',g.F.state==='wind'&&g.F.bail==='open');
  for(let i=0;i<12;i++){right.grip.position.z-=.075;right.grip.position.y+=.023;tick();}
  press(right,4,false);
  for(let i=0;i<20&&g.F.state==='wind';i++)tick();
  expect('Releasing during forward swing launches lure',g.F.state==='flying');
  for(let i=0;i<300&&g.F.state==='flying';i++)tick();
  expect('Cast lands beyond boat with line off spool',g.F.state==='water'&&g.F.line>2&&g.F.bail==='open');
  const {hapFlush}=await import('./js/haptics.js');hapFlush();
  expect('Feedback reaches rod controller',pulses.some(([h,v])=>h==='right'&&v>0));
  press(left,5,true);g.step(48);press(left,5,false);
  expect('Holding Y returns to visible port',g.S.gameState==='port'&&g.vrPanel.visible);
  select(left,'settings');expect('Comfort settings reopen in port',g.portState.settings);
  xr.getController(1).dispatchEvent({type:'disconnected'});
  expect('Disconnect releases rod and clears right hand',!g.HANDS.right&&!g.rodItem.heldBy);
  xr.isPresenting=false;session.dispatchEvent(new Event('end'));
  expect('Session exit restores desktop rod',g.rodItem.desk);
}catch(error){report.error=String(error.stack||error);}
document.documentElement.setAttribute('data-results',JSON.stringify(report));
