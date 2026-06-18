/* ============================================================
   MEME GRAND PRIX — SEASON 2 RACE ENGINE  (race-engine.js)
   Deterministic positional race simulation.
   Single source of truth for race logic — consumed by race.html / quali.html / fp1.html.
   Pairs with stats-calculator.js (team stats) the way the site already does.

   LOCKED MODEL (designed + tuned by simulation):
     - Race Day Form 80-100%  (per team, per session)
     - Qualifying sets the grid (track position is real)
     - Tyres: SOFT / MED / HARD  (pace vs degradation)
     - Fuel: FULL (1 stop, heavy) / HALF (2 stops, light)
         fuel mass drives BOTH lap time AND tyre wear
     - Overtaking: probabilistic (~ pace delta), passEase 0.34
     - Incidents: 5% DNF per car
     - Seeded -> fully deterministic & reproducible
   Result of tuning: PUP (P1) ~60% win rate, full top-8 can win.
   ============================================================ */
(function (global) {
  const S = global.MEMEGP_Stats ||
            (typeof require !== 'undefined' ? require('./stats-calculator.js') : null);

  const TEAMS = ['PUP','TURBO','MASK','BILLY','VIBECOIN','MOMO','PEPONK','LOL',
                 'DOBERMANN','SHIH','SUS','420BLAZEIT','MARS','MONKO','NEURO'];

  // ---------- LOCKED PARAMETERS ----------
  const CFG = {
    TOTAL_LAPS : 20,
    FORM_FLOOR : 0.80,          // form ranges FORM_FLOOR..1.00
    QUALI_NOISE: 0.40,
    RACE_NOISE : 0.50,
    COMPOUNDS  : { SOFT:{off:-0.55,deg:0.115}, MED:{off:0,deg:0.055}, HARD:{off:0.50,deg:0.028} },
    KFUEL      : 1.00,          // s/lap penalty at a full brim (scales with mass)
    DEG_FUEL   : 0.60,          // heavy fuel raises wear rate by up to +60%
    STOP_LOSS  : 5.00,          // pit time loss (folded into the position drop)
    PASS_EASE  : 0.34,          // overtaking ease (tuned: PUP ~60%)
    INCIDENT_P : 0.05,          // per-car DNF probability
    PIT_DROP   : 7              // positions lost rejoining from a stop
  };

  // ---------- deterministic RNG ----------
  function makeRNG(seed){ let s = seed % 2147483647; if (s <= 0) s += 2147483646;
    return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

  const statsFor = t => S.calcStats({}, 5.0, null, t);
  const drawForm = r => CFG.FORM_FLOOR + (1 - CFG.FORM_FLOOR) * r();
  function cleanLap(st, form){
    return (31.5 - (st.engine*0.12 + st.chassis*0.08)*form)
         + (27.5 - (st.drag*0.10  + st.aero*0.10)*form)
         + (24.5 - (st.pit*0.08   + st.aero*0.12)*form);
  }

  // ---------- QUALIFYING ----------
  function runQualifying(stats, r){
    const rows = TEAMS.map(t => {
      const form = drawForm(r);
      return { t, form, lap: cleanLap(stats[t], form) + (r()-0.5)*CFG.QUALI_NOISE };
    });
    rows.sort((a,b) => a.lap - b.lap);
    rows.forEach((row,i) => row.pos = i+1);
    return rows;
  }

  // ---------- STRATEGY ----------
  // strategyConfig is { TICKER: {fuel, a,b[,c], pits:[...]} }  (community-chosen).
  // If absent, a randomised pick stands in (behaves like varied community picks).
  function defaultStrategy(r){
    const C = ['SOFT','MED','HARD'];
    if (r() < 0.5){ // FULL, 1 stop
      const a = C[(r()*3)|0]; let b = C[(r()*3)|0]; while (b===a) b = C[(r()*3)|0];
      return { fuel:'FULL', a, b, pits:[ [6,8,10,12][(r()*4)|0] ] };
    }
    return { fuel:'HALF', a:C[(r()*3)|0], b:C[(r()*3)|0], c:C[(r()*3)|0], pits:[7,14] }; // 2 stops
  }
  function fuelMass(s, L){
    if (s.fuel === 'FULL') return 1 - (L-1)/(CFG.TOTAL_LAPS-1);
    const seg = L<=7?0:(L<=14?1:2), ss=[1,8,15][seg], se=[7,14,20][seg];
    return 0.5 * (1 - (L-ss)/(se-ss+3));
  }
  const compoundAt  = (s,L) => s.fuel==='FULL' ? (L<=s.pits[0]?s.a:s.b) : (L<=7?s.a:(L<=14?s.b:s.c));
  const isStintStart= (s,L) => L===1 || (s.fuel==='FULL' ? L===s.pits[0]+1 : (L===8||L===15));

  // ---------- RACE ----------
  function runRace(stats, gridRows, strategies, r){
    let order = gridRows.map(g => g.t);
    const base={}, wear={}, willDNF={}, dnfLap={}, pitted={};
    TEAMS.forEach(t => {
      base[t]   = cleanLap(stats[t], drawForm(r));   // race-day form
      wear[t]   = 0; pitted[t] = {};
      willDNF[t]= r() < CFG.INCIDENT_P;
      if (willDNF[t]) dnfLap[t] = 2 + ((r()*(CFG.TOTAL_LAPS-2))|0);
    });

    const stopped = (t,L) => willDNF[t] && L >= dnfLap[t];
    function lapTime(t,L){
      const s = strategies[t], comp = compoundAt(s,L);
      if (isStintStart(s,L)) wear[t] = 0;
      const m = fuelMass(s,L);
      wear[t] += CFG.COMPOUNDS[comp].deg * (1 + m*CFG.DEG_FUEL);
      return base[t] + CFG.COMPOUNDS[comp].off + CFG.KFUEL*m + wear[t] + (r()-0.5)*CFG.RACE_NOISE;
    }

    const lapPositions = [];           // [lap][pos] = ticker  (for animation)
    const events = [];                 // {lap,type,...}  (for commentary)
    const fastest = { lap: Infinity, t: null };

    for (let L=1; L<=CFG.TOTAL_LAPS; L++){
      const lt = {};
      order.forEach(t => { lt[t] = stopped(t,L) ? Infinity : lapTime(t,L); });
      order.forEach(t => { if (isFinite(lt[t]) && lt[t] < fastest.lap){ fastest.lap = lt[t]; fastest.t = t; } });

      // DNF events at their lap
      order.forEach(t => { if (willDNF[t] && L === dnfLap[t]) events.push({lap:L, type:'dnf', t}); });

      // pit stops -> rejoin further back
      order.forEach(t => {
        if (stopped(t,L)) return;
        const s = strategies[t];
        if (s.pits.includes(L) && !pitted[t][L]){
          pitted[t][L] = true;
          const i = order.indexOf(t);
          const drop = Math.min(CFG.PIT_DROP, order.length-1-i + 5);
          order.splice(i,1);
          order.splice(Math.min(order.length, i+drop), 0, t);
          events.push({lap:L, type:'pit', t, fuel:s.fuel, tyre:compoundAt(s,L+1)});
        }
      });

      // overtaking — faster car passes slower with P ~ pace delta * passEase
      for (let p = order.length-1; p > 0; p--){
        const b = order[p], a = order[p-1];
        if (stopped(b,L)) continue;
        if (stopped(a,L)) { order[p-1]=b; order[p]=a; continue; }
        const d = lt[a] - lt[b];
        if (d > 0){
          const passP = Math.min(0.92, Math.max(0.015, d * CFG.PASS_EASE));
          if (r() < passP){ order[p-1]=b; order[p]=a; events.push({lap:L, type:'overtake', pass:b, over:a}); }
        }
      }
      lapPositions.push(order.slice());
    }

    const running = order.filter(t => !willDNF[t]);
    const dnfs    = order.filter(t =>  willDNF[t]).sort((a,b) => dnfLap[b]-dnfLap[a]);
    const result  = running.concat(dnfs);

    return {
      result, grid: gridRows.map(g=>g.t), lapPositions, events, fastest,
      dnf: TEAMS.filter(t => willDNF[t]),
      classified: running.length
    };
  }

  // ---------- WEEKEND ----------
  function simulateWeekend(seed, strategyConfig){
    const r = makeRNG(seed);
    const stats = {}; TEAMS.forEach(t => stats[t] = statsFor(t));
    const quali = runQualifying(stats, r);
    const strategies = {};
    TEAMS.forEach(t => strategies[t] = (strategyConfig && strategyConfig[t]) || defaultStrategy(r));
    const race = runRace(stats, quali, strategies, r);
    return { seed, quali, strategies, race };
  }

  const API = { VERSION:'S2-ENGINE-1.0', CFG, TEAMS, makeRNG, statsFor,
                runQualifying, runRace, simulateWeekend };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.MEMEGP_Race = API;
})(typeof window !== 'undefined' ? window : globalThis);
