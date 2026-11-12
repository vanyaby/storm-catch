/* A small sign in front of whatever a hand is reaching for: what it is, its weight, and what you can do with it. */
import { THREE, V, scene, camera, save, fmtKg } from './core.js';
import { evaluate } from './fishbody.js';

const TOOLS={
  rod:['Удочка','Курок — палец на леске, махните и отпустите. A/X — распустить леску'],
  knife:['Нож','Режет только нижней светлой кромкой. Плашмя толкает куски'],
  scaler:['Скребок','Водите по коже — снимает чешую'],
  net:['Подсак','Подведите под рыбу у борта'],
};
function makeTag(){
  const cv=document.createElement('canvas');cv.width=512;cv.height=176;const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false}));sp.scale.set(.24,.0825,1);sp.renderOrder=20;sp.visible=false;scene.add(sp);
  return {cv,tex,sp,key:'',t:0};
}
const tags=new Map();
function draw(tag,title,sub,hint){
  const g=tag.cv.getContext('2d');g.clearRect(0,0,512,176);
  g.fillStyle='rgba(14,30,36,.86)';g.beginPath();g.roundRect(4,4,504,168,22);g.fill();g.strokeStyle='rgba(216,168,71,.8)';g.lineWidth=3;g.stroke();
  g.fillStyle='#efe6d2';g.font='600 40px "Golos Text",sans-serif';g.fillText(title,24,56);
  g.fillStyle='#d8a847';g.font='500 30px "Golos Text",sans-serif';g.fillText(sub,24,100);
  g.fillStyle='#a9bcc0';g.font='400 24px "Golos Text",sans-serif';
  const words=hint.split(' ');let line='',y=140;for(const w of words){const t=line?line+' '+w:w;if(g.measureText(t).width>470){g.fillText(line,24,y);y+=28;line=w;if(y>170)break;}else line=t;}if(line&&y<=170)g.fillText(line,24,y);
  tag.tex.needsUpdate=true;
}
function describe(it){
  if(it.type==='organIn')return ['Потроха','внутри рыбы','Возьмите рукой и бросьте в ведро'];
  if(it.type==='tool'){const t=TOOLS[it.tool]||[it.tool,''];return [t[0],'',t[1]];}
  const ob=it.vobj;const ev=evaluate(ob);const fresh=Math.round(ob.fish.fresh*100);
  const sub=`${fmtKg(ev.kg)} кг · ${ev.waste?'отходы':Math.round(ev.value)+' монет'} · свежесть ${fresh}%`;
  let hint;
  if(ev.waste)hint='В ведро';
  else if(ob.kind==='organ')hint='Ценное — в ящик со льдом';
  else if(it.body&&it.body.mass>6)hint='Тяжёлая: возьмите двумя руками. Разделайте на столе';
  else if(ob.organs.length)hint=ob.open?'Брюхо вскрыто: достаньте потроха':'Вспорите брюхо ножом';
  else hint='Положите в ящик со льдом. Курок — взять щепотью, боковая — всей рукой';
  return [ev.kind,sub,hint];
}
export function updateTags(HANDS,dt){
  for(const k of ['left','right']){
    const h=HANDS[k];let tag=tags.get(k);if(!tag){tag=makeTag();tags.set(k,tag);}
    const it=h&&!h.held&&save.tags!=='off'?h.hover:null;
    if(!it){tag.sp.visible=false;tag.key='';continue;}
    const obj=it.type==='organIn'?it.org.g:it.obj;
    const box=new THREE.Box3().setFromObject(obj);if(box.isEmpty()){tag.sp.visible=false;continue;}
    const c=box.getCenter(V());c.y=box.max.y+.07;
    // a little toward the viewer so it is in front of the item
    const cam=camera.getWorldPosition(V());c.addScaledVector(cam.clone().sub(c).setY(0).normalize(),.05);
    tag.sp.position.copy(c);tag.sp.visible=true;
    tag.t-=dt;const key=(it.uid||it.tool||'')+'|'+(it.obj?it.obj.uuid:'');
    if(key!==tag.key||tag.t<=0){tag.t=.4;tag.key=key;const [a,b,hint]=describe(it);draw(tag,a,b,hint);}
  }
}
