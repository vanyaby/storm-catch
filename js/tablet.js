import {THREE,boat,SPECIES,LURES,save,V} from './core.js';

const ink='#193738',paper='#f2ecd9',teal='#205d58',accent='#ecb45c';
const behaviour={
  mackerel:'Клюёт серией частых толчков. После подсечки резко меняет направление.',
  perch:'Двойной удар выдаёт поклёвку. На крючке трясёт головой и бросается к лодке.',
  cod:'Тяжёлая потяжка у дна. Ныряет, затем делает короткую передышку.',
  halibut:'Сначала похож на зацеп. После подсечки снова и снова уходит в глубину.',
  tuna:'Бьёт резко, уходит в длинный рывок и может выпрыгнуть из воды.',
  eel:'Поклёвка отдаётся дрожью. В сильный шторм ищите его по резким боковым рывкам.'
};
const css=n=>'#'+n.toString(16).padStart(6,'0');
function illustration(c,item,fish){
  c.save();c.translate(615,235);
  const path=(d,fill,stroke=ink)=>{const p=new Path2D(d);if(fill){c.fillStyle=fill;c.fill(p);}if(stroke){c.strokeStyle=stroke;c.lineWidth=2;c.stroke(p);}};
  if(fish){
    const h=item.fam==='flat'?65:item.fam==='eel'?15:Math.min(54,item.hR*164);
    c.scale(1,h/45);
    path('M-110 0 L-161 -34 Q-155 -6 -144 0 Q-155 7 -161 34 Z',css(item.fin));
    path('M-62 -23 L-39 -52 L-32 -36 L-24 -52 L-17 -38 L-10 -51 L18 -32 Z',css(item.fin));
    const paint=c.createLinearGradient(0,-40,1,39);paint.addColorStop(0,css(item.back));paint.addColorStop(1,css(item.belly));
    path('M-125 0 Q-74 -13 -50 -28 Q35 -65 109 -19 Q137 -9 145 0 Q130 17 95 25 Q32 59 -48 29 Q-85 10 -125 5 Z',paint);
    for(let i=0;i<9;i++){
      const x=-62+i*15,y=-13-15*Math.sin(i/9*Math.PI);
      if(item.stripe)path('M'+x+' '+y+' q12 6 6 16',null,css(item.stripe));
      if(item.spots){c.fillStyle=css(item.spots);c.beginPath();c.ellipse(x,y,3,2,.4,0,Math.PI*2);c.fill();}
    }
    path('M64 2 Q40 19 25 21 L47 2 Z',css(item.fin));
    path('M87 -18 Q74 2 86 19 M121 8 L140 2',null);
    c.fillStyle=ink;c.beginPath();c.arc(112,-9,4,0,Math.PI*2);c.fill();
  }else{
    const shapes={
      spoon:'M-94 6 Q-25 -60 87 -19 Q92 8 -17 32 Q-64 39 -94 6 Z',
      jig:'M-88 4 L-39 -18 L91 -9 L55 13 L-43 25 Z',
      wobbler:'M-99 4 Q-4 -46 83 -18 L101 -4 Q53 31 -48 19 Z',
      bait:'M-59 -4 Q-80 -38 -49 -41 Q-25 -41 -36 -13 Q-49 14 -14 9 Q30 -4 57 19 Q19 12 -11 29 Q-65 41 -59 -4 Z',
      glow:'M85 -11 Q20 -24 -34 -8 Q-83 12 -97 -13 Q-104 -37 -69 -37 Q-115 -53 -120 -17 Q-119 30 -62 20 L74 15 Z'
    };
    path(shapes[item.id],css(item.col));
    path('M-80 14 Q-94 52 -110 39 Q-119 32 -111 22 L-108 31',null);
    if(item.id==='wobbler')path('M74 10 L100 30 L112 27 L94 8 Z','#b4caca');
  }
  c.restore();
}

export function makeTablet(tutorial){
  const group=new THREE.Group();boat.add(group);group.position.set(-.86,1.10,-1.03);group.rotation.set(-.37,-.01,.01);group.rotation.y=.72;
  const box=(w,h,d,color,y,z)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.72}));mesh.position.set(0,y,z);group.add(mesh);};
  box(.54,.338,.028,0x263936,0,-.015);box(.055,.65,.045,0x42534e,-.35,-.054);
  const canvas=document.createElement('canvas');canvas.width=960;canvas.height=600;
  const c=canvas.getContext('2d'),texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const screen=new THREE.Mesh(new THREE.PlaneGeometry(.516,.3225),new THREE.MeshBasicMaterial({map:texture,toneMapped:false}));group.add(screen);screen.position.z=.002;
  const tabs=['Рыбы','Приманки','Обучение'],indices=[0,0,0],buttons=[];
  let tab=0,lastStep=-1;
  const text=(s,x,y,size,color=ink,bold=false)=>{c.fillStyle=color;c.font=(bold?'bold ':'')+size+'px Arial';c.fillText(s,x,y);};
  function lines(s,x,y,width,size){
    let line='';for(const w of s.split(' ')){c.font=size+'px Arial';if(line&&c.measureText(line+' '+w).width>width){text(line,x,y,size);line='';y+=size+7;}line+=(line?' ':'')+w;}text(line,x,y,size);return y+size+7;
  }
  function button(x,y,w,h,label,active,action){
    buttons.push({x,y,w,h,action});c.fillStyle=active?teal:'#e4dfcd';c.fillRect(x,y,w,h);text(label,x+14,y+h/2+8,23,active?'#fff9e6':ink,active);
  }
  function draw(){
    buttons.length=0;lastStep=save.tutorial;c.fillStyle=paper;c.fillRect(0,0,960,600);
    c.fillStyle=ink;c.fillRect(0,0,960,76);text('Бортовой атлас',25,50,37,'#fff6dc',true);
    tabs.forEach((s,i)=>button(451+i*164,12,155,52,s,tab===i,()=>{tab=i;if(i===2)indices[2]=Math.min(save.tutorial,tutorial.length-1);draw();}));
    if(tab===2){
      const i=indices[2];text('Обучение',35,153,46,ink,true);text((i+1)+' / '+tutorial.length,790,150,29,teal);
      lines(tutorial[i].t,38,235,868,34);
      if(i)button(35,507,250,59,'Предыдущий',false,()=>{indices[2]--;draw();});
      if(i<tutorial.length-1)button(675,507,250,59,'Следующий',true,()=>{indices[2]++;draw();});
    }else{
      const fish=tab===0,list=fish?SPECIES:LURES,item=list[indices[tab]];
      list.forEach((v,i)=>button(18,103+i*79,274,65,v.name,i===indices[tab],()=>{indices[tab]=i;draw();}));
      text(item.name,325,145,40,ink,true);
      c.fillStyle='#ded9c5';c.fillRect(322,300,610,2);
      illustration(c,item,fish);
      text(fish?item.len.map(n=>Math.round(n*100)).join('–')+' см    /    '+item.depth.join('–')+' м':item.mass+' г    /    до '+item.maxD+' м',325,347,31,teal,true);
      const end=lines(fish?behaviour[item.id]:item.hint,325,403,605,26);
      const matches=fish?LURES.filter(l=>(l.mult[item.id]||0)>1):SPECIES.filter(s=>(item.mult[s.id]||0)>1);
      if(matches.length)lines((fish?'Приманки · ':'Улов · ')+matches.map(v=>v.name).join(', '),325,end+24,608,24);
    }
    texture.needsUpdate=true;
  }
  const ray=new THREE.Raycaster(),dot=new THREE.Mesh(new THREE.CircleGeometry(.004,12),new THREE.MeshBasicMaterial({color:accent,depthTest:false}));dot.visible=false;dot.renderOrder=12;screen.add(dot);
  function hit(raycaster){screen.updateWorldMatrix(true,false);return raycaster.intersectObject(screen,false)[0];}
  function activate(uv){const x=uv.x*960,y=(1-uv.y)*600;buttons.find(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h)?.action();}
  draw();
  return {screen,hit,activate,update(hands){
    dot.visible=false;
    if(lastStep!==save.tutorial&&tab===2&&indices[2]===lastStep){indices[2]=Math.min(save.tutorial,tutorial.length-1);draw();}
    for(const hand of Object.values(hands)){
      if(!hand?.src)continue;
      const down=!!(hand.src.gamepad?.buttons[0]?.value>.6);
      hand.ctl.updateWorldMatrix(true,false);ray.ray.origin.setFromMatrixPosition(hand.ctl.matrixWorld);ray.ray.direction.set(0,0,-1).transformDirection(hand.ctl.matrixWorld);
      const h=!hand.held&&!hand.crank&&!hand.heldLure&&hit(ray);
      if(h&&h.distance<2){dot.position.copy(screen.worldToLocal(h.point.clone()));dot.position.z=.002;dot.visible=true;if(down&&!hand.atlasDown){activate(h.uv);hand.atlasPress=true;}}
      if(!down)hand.atlasPress=false;hand.atlasDown=down;
    }
  }};
}
