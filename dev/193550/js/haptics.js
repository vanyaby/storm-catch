/* Haptics mixer: every system says what it wants, once per frame we send ONE pulse per controller.
   hapCont  = a level held for this frame (rumble that follows the strain)
   hapPulse = a one-off tap with a length in ms */
import { save, clamp } from './core.js';
let HANDS=null;
export function bindHands(h){HANDS=h;}
const state=new WeakMap();
const st=h=>{let s=state.get(h);if(!s){s={cont:0,pulses:[]};state.set(h,s);}return s;};
const now=()=>performance.now();
export function hapCont(h,level){if(!h)return;const s=st(h);if(level>s.cont)s.cont=level;}
export function hapPulse(h,level,ms=40){if(!h)return;const s=st(h);s.pulses.push({l:clamp(level,0,1),until:now()+ms});if(s.pulses.length>8)s.pulses.shift();}
export function hapBoth(level,ms=40){if(!HANDS)return;for(const k of ['left','right'])hapPulse(HANDS[k],level,ms);}
export const hapLog={on:false,list:[]};
function send(h,level,ms){
  const gp=h.src&&h.src.gamepad;if(!gp)return;const v=clamp(level*(save.hapticGain??1),0,1);
  if(hapLog.on)hapLog.list.push([h.name||'?',+v.toFixed(2),ms]);
  const a=gp.hapticActuators&&gp.hapticActuators[0];
  try{
    if(a&&a.pulse)a.pulse(v,ms);
    else if(gp.vibrationActuator&&gp.vibrationActuator.playEffect)gp.vibrationActuator.playEffect('dual-rumble',{duration:ms,strongMagnitude:v,weakMagnitude:v});
  }catch(e){}
}
export function hapFlush(){
  if(!HANDS)return;const t=now();
  for(const k of ['left','right']){const h=HANDS[k];if(!h)continue;const s=st(h);
    s.pulses=s.pulses.filter(p=>p.until>t);let lv=s.cont;for(const p of s.pulses)lv=Math.max(lv,p.l);s.cont=0;
    if(lv>.015)send(h,lv,45);}
}
