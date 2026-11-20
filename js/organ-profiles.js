/* Game anatomy in cavity-local coordinates. Each row is centre XYZ and half-size XYZ.
   X points to the head, Y across the flanks and Z toward the back. */
const layouts = {
  mackerel: {
    stomach:[.34,-.25,-.15, .32,.21,.30], liver:[.34,.26,.20, .34,.22,.30],
    gut:[-.36,-.04,-.40, .41,.24,.28], gall:[.10,.54,.13, .065,.11,.10],
    heart:[.73,.03,-.20, .10,.17,.14], roe:[-.27,-.17,.32, .44,.22,.16],
    folds:2, hook:.68, lobe:.58, tint:0xf9eeee
  },
  perch: {
    stomach:[.32,-.23,-.22, .33,.23,.40], liver:[.22,.26,.22, .34,.22,.32],
    gut:[-.38,-.04,-.41, .35,.24,.28], gall:[.03,.53,.17, .07,.10,.14],
    heart:[.72,.04,-.12, .11,.17,.18], roe:[-.33,-.32,.19, .39,.18,.17],
    bladder:[-.22,.02,.59, .45,.19,.13], folds:3, hook:1.15, lobe:.72, tint:0xffebdf
  },
  cod: {
    stomach:[.32,-.27,-.18, .30,.22,.34], liver:[.15,.25,.18, .52,.32,.35],
    gut:[-.37,-.04,-.43, .41,.20,.24], gall:[.24,.60,.11, .075,.075,.13],
    heart:[.75,.04,-.16, .095,.17,.13], roe:[-.35,-.32,.19, .38,.17,.15],
    bladder:[-.18,-.03,.64, .52,.20,.105], folds:2,hook:.95,lobe:.89,tint:0xffedcb
  },
  halibut: {
    stomach:[.23,-.25,-.30, .34,.20,.34], liver:[.19,.25,.27, .43,.20,.33],
    gut:[-.43,-.03,-.40, .31,.26,.32], gall:[.16,.54,.14, .085,.10,.12],
    heart:[.65,.02,-.23, .15,.20,.15], roe:[-.23,-.19,.40, .42,.24,.16],
    folds:3,hook:1.24,lobe:.53,tint:0xfaece0
  },
  tuna: {
    stomach:[.31,-.27,-.18, .34,.25,.37], liver:[.22,.28,.20, .40,.27,.33],
    gut:[-.38,-.04,-.42, .37,.25,.27], gall:[.14,.62,.12, .07,.085,.12],
    heart:[.74,.00,-.21, .14,.22,.22], roe:[-.34,-.32,.19, .40,.18,.17],
    bladder:[-.26,-.02,.62, .44,.20,.13], folds:3,hook:.81,lobe:.84,tint:0xffe2dc
  },
  eel: {
    stomach:[.39,-.17,-.16, .34,.20,.26], liver:[.21,.28,.13, .48,.18,.24],
    gut:[-.42,.01,-.20, .40,.23,.21], gall:[.23,.52,.12, .075,.085,.13],
    heart:[.79,.02,-.11, .085,.16,.17], roe:[-.36,-.26,.17, .41,.15,.13],
    bladder:[-.23,.02,.48, .52,.18,.12], folds:1,hook:.34,lobe:.40,tint:0xeae4fa
  }
};

const stored = new Map();
export function organLayout(fish, materials) {
  const p=layouts[fish.sp.id];
  return ['stomach','liver','gut','gall','heart','roe','bladder']
    .filter(k=>p[k] && (k!=='roe' || fish.female))
    .map(kind=>({kind, material:materials[kind.toUpperCase()], box:p[kind], style:p,
      key:fish.sp.id+'/'+kind}));
}

// A station is [longitudinal position, height, in-plane radius, flank thickness].
// Sweep perpendicular to the drawn path, so the open spaces between gut folds stay open when cut.
export function organStations(kind, p) {
  const h=p.hook,l=p.lobe;
  switch(kind) {
    case 'stomach': return [[1,.76,.026,.035],[.82,.53,.09,.13],[.67,.24,.22,.27],[.44,-.14,.34,.35],[-.05,-.39,.38,.36],[-.61,-.4,.26,.25],[-.82,-.12,.16,.16],[-.80,.10+.22*h,.09,.10],[-.61,.16+.29*h,.036,.05]];
    case 'liver': return [[-.95,-.59,.035,.05],[-.66,-.49,.20,.23],[-.16,-.34,.26,.30],[.36,-.23,.24,.31],[.62,-.04,.21,.25],[.58,.22,.21,.24],[.31,.36,.21,.25],[-.03,.43,.19,.22],[-l,.57,.03,.045]];
    case 'gut': {
      const out=[], bends=p.folds*2, spacing=1.70/bends, tube=.080;
      const push=(x,z)=>out.push([x,z,tube,tube*1.18]);
      let x=-.85, sign=1;
      push(x,-.46);
      for(let i=0;i<bends;i++){
        push(x,sign*.42);
        for(let j=1;j<=8;j++){
          const a=j*Math.PI/8;
          push(x+spacing*.5*(1-Math.cos(a)),sign*(.42+spacing*.5*Math.sin(a)));
        }
        x+=spacing;sign=-sign;
      }
      push(x,sign*.46);
      return out;
    }
    case 'gall': return [[-.68,-.57,.035,.04],[-.51,-.44,.24,.27],[-.23,-.28,.32,.35],[.03,-.07,.25,.26],[.25,.17,.12,.12],[.45,.39,.072,.07],[.76,.55,.046,.045]];
    case 'heart': return [[-.80,-.72,.032,.035],[-.57,-.47,.20,.23],[-.30,-.20,.34,.39],[.01,-.02,.38,.44],[.23,.10,.27,.32],[.43,.25,.16,.19],[.48,.49,.11,.13],[.35,.76,.08,.09]];
    case 'roe': return [[-.93,-.41,.027,.05],[-.67,-.40,.14,.22],[-.12,-.32,.24,.29],[.43,-.25,.19,.25],[.67,-.13,.10,.13],[.74,.03,.077,.09],[.55,.21,.12,.16],[.18,.31,.21,.28],[-.36,.41,.16,.24],[-.82,.50,.025,.04]];
    case 'bladder': return [[-.98,-.09,.035,.045],[-.73,-.08,.16,.21],[-.36,-.07,.20,.25],[.03,-.03,.15,.17],[.34,.03,.24,.32],[.66,.11,.23,.26],[.91,.22,.08,.09],[1,.27,.027,.035]];
  }
}

export function organRings(key, make) {
  if(!stored.has(key)) stored.set(key,make());
  return stored.get(key);
}

