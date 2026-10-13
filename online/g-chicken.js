/*
  チキンレース(オンライン版・開発中)
  山札(ポイントカード12枚 + 💣3枚)を1枚ずつめくっていく。毎ステップ、全員が同時に・秘密で「進む」か「降りる」を選ぶ。
    ・降りた人: そこまでに貯めたポイントを持ち帰って安全に抜ける。
    ・進んだ人: 山札から1枚めくる。ポイントカードなら進んだ全員に加算。ひとりだけ進んだ場合は2倍(ひとり勝負ボーナス)。
                💣が出たら、進んだ全員が「ドボン」= そのラウンドの得点は0点でラウンド終了。
  モード: 「一発勝負」(1ラウンド。最下位が飲む) / 「複数ラウンド」(3・5・7ラウンド。合計点の最下位が飲む)。
          最下位が複数なら全員が飲む。全員同点のときも全員が飲む(誰も得をしなかったので)。
  山札の中身(ポイントカードの数値・💣の枚数)は最初から全員に公開。めくられたカードも全員が見える。
    → 「次が💣の確率」は公開情報から正確に計算できる(アプリは確率や結果を一切補正しない)。
  公平性: 山札の並びは crypto.getRandomValues による棄却サンプリング(randInt)+ Fisher–Yates シャッフルだけで決める。
          罰の量(ひと口〜一気)も同じ一様乱数で抽選する。誰かを有利・不利にする補正は一切しない。
          切断などで選択がない人は「降りる」として扱う(安全側。ホストが待たずに進める時のみ)。
  参考文献(ゲームの構造):
    [1] Diamant(インカの黄金): 同時に「進む/降りる」を選び、危険カードで残っていた人が失う Push-your-luck 型の定番
        https://en.wikipedia.org/wiki/Diamant_(board_game)
    [2] Chicken (game): 互いに引かないと共倒れになる「チキンゲーム」の考え方 https://en.wikipedia.org/wiki/Chicken_(game)
    [3] Fisher–Yates shuffle(偏りのないシャッフル): https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
    [4] MDN Web Audio API(効果音の合成): https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
    [5] 通信・乱数・参考文献一覧は online-core.js の冒頭を参照
  (オンライン ロビーに登録されるゲーム。通信・部屋・QRは online-core.js が担当)
*/
(function(){
  'use strict';
  var NO = window.NomikaiOnline;

  /* PURE-BEGIN */
  var GAINS = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7];   // ポイントカード(公開)
  var HAZ = 3;                                          // 💣の枚数(公開)
  var ROUND_CHOICES = [3, 5, 7];
  var STAKES = ['ひと口', 'ふた口', 'グラスの半分', '一気'];   // 罰の量(一様に抽選)

  // 暗号論的乱数 + 棄却サンプリング(剰余の偏りを出さない)。rnd が渡されない場合(force など)の予備。
  function secureInt(n){
    var c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : null;
    if(!c) throw new Error('crypto unavailable');
    var buf = new Uint32Array(1), lim = Math.floor(4294967296 / n) * n;
    do { c.getRandomValues(buf); } while(buf[0] >= lim);
    return buf[0] % n;
  }
  function shuffle(arr, rnd){                         // Fisher–Yates
    var a = arr.slice();
    for(var i = a.length - 1; i > 0; i--){ var j = rnd(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function makeDeck(rnd){
    var d = GAINS.map(function(v){ return { v: v }; });
    for(var k = 0; k < HAZ; k++) d.push({ h: true });
    return shuffle(d, rnd);
  }
  function activeIds(G){ return G.part.filter(function(id){ return !G.offline[id]; }); }
  function inPart(G, pid){ return G.part.indexOf(pid) >= 0; }
  function nRounds(G){ return G.mode === 'single' ? 1 : G.rounds; }
  function inIds(G){ return G.part.filter(function(id){ return G.status[id] === 'in'; }); }
  function waitIds(G){ return inIds(G).filter(function(id){ return !G.offline[id] && !G.choice[id]; }); }

  // めくられたカードから、山札に残っている中身(公開情報)を計算
  function leftInfo(G){
    var gains = GAINS.slice(), haz = HAZ;
    G.seen.forEach(function(c){
      if(c.h) haz--; else { var i = gains.indexOf(c.v); if(i >= 0) gains.splice(i, 1); }
    });
    return { n: gains.length + haz, haz: haz, gains: gains };
  }

  function newState(players, rnd){
    var G = { players: players, offline: {}, phase: 'setup', mode: 'multi', rounds: 5, round: 0, part: [], status: {}, banked: {}, choice: {},
              deck: [], pos: 0, seen: [], step: null, stepNo: 0, ended: false, roundScore: {}, total: {}, drinks: {},
              stake: '', drinkers: [], last: false };
    syncSetup(G);
    return G;
  }
  function syncSetup(G){ G.part = G.players.map(function(p){ return p.id; }).filter(function(id){ return !G.offline[id]; }); }
  function resetMatch(G){ G.round = 0; G.total = {}; G.drinks = {}; G.last = false; G.drinkers = []; G.stake = ''; }

  function startRound(G, rnd){
    syncSetup(G);
    G.round++; G.deck = makeDeck(rnd); G.pos = 0; G.seen = []; G.status = {}; G.banked = {}; G.choice = {};
    G.part.forEach(function(id){ G.status[id] = 'in'; G.banked[id] = 0; });
    G.stepNo = 0; G.step = null; G.ended = false; G.roundScore = {}; G.last = false; G.drinkers = []; G.stake = '';
    G.phase = 'choose';
  }

  // 全員の選択が出そろったら1ステップ進める
  function maybeAdvance(G){
    if(G.phase !== 'choose') return;
    if(!waitIds(G).length) resolveStep(G);
  }
  function resolveStep(G){
    var all = inIds(G);
    // 選択がない人(切断など)は「降りる」として扱う。選ばれた選択をそのまま集計する
    var leavers = all.filter(function(id){ return G.choice[id] !== 'go'; });
    var goers = all.filter(function(id){ return G.choice[id] === 'go'; });
    leavers.forEach(function(id){ G.status[id] = 'left'; });
    var st = { n: ++G.stepNo, leavers: leavers, goers: goers, card: null, solo: false, gain: 0, bombed: [], ended: false };
    if(!goers.length){ st.ended = true; }
    else {
      var card = G.deck[G.pos++]; G.seen.push(card); st.card = card;
      if(card.h){
        st.bombed = goers.slice(); st.ended = true;
        goers.forEach(function(id){ G.status[id] = 'bomb'; G.banked[id] = 0; });
      } else {
        st.solo = goers.length === 1; st.gain = card.v * (st.solo ? 2 : 1);
        goers.forEach(function(id){ G.banked[id] += st.gain; });
        if(G.pos >= G.deck.length) st.ended = true;
      }
    }
    G.step = st; G.ended = st.ended; G.choice = {}; G.phase = 'flip';
  }

  function lowestOf(ids, score){
    if(!ids.length) return [];
    var mn = Math.min.apply(null, ids.map(function(id){ return score[id]; }));
    return ids.filter(function(id){ return score[id] === mn; });   // 同点は全員(全員同点なら全員)
  }
  function endRound(G, rnd){
    var r = rnd || secureInt;
    G.part.forEach(function(id){
      G.roundScore[id] = G.status[id] === 'bomb' ? 0 : G.banked[id];
      G.total[id] = (G.total[id] || 0) + G.roundScore[id];
    });
    G.last = G.round >= nRounds(G);
    if(G.last){
      var score = G.mode === 'single' ? G.roundScore : G.total;
      G.drinkers = lowestOf(G.part, score);
      G.stake = STAKES[r(STAKES.length)];
      G.drinkers.forEach(function(id){ G.drinks[id] = (G.drinks[id] || 0) + 1; });
    }
    G.phase = 'result';
  }

  function act(G, pid, a, rnd){
    if(!a || typeof a !== 'object') return { error: '操作が不正です' };
    var host = pid === 'p0';
    switch(a.t){
      case 'setMode':
        if(!host || G.phase !== 'setup' || (a.m !== 'single' && a.m !== 'multi')) return { error: '今は変えられません' };
        G.mode = a.m; return { ok: true };
      case 'setRounds':
        if(!host || G.phase !== 'setup' || ROUND_CHOICES.indexOf(a.n) < 0) return { error: '今は変えられません' };
        G.rounds = a.n; return { ok: true };
      case 'start':
        if(!host || G.phase !== 'setup') return { error: 'ホストだけが始められます' };
        syncSetup(G); if(G.part.length < 2) return { error: '2人以上必要です' };
        resetMatch(G); startRound(G, rnd); return { ok: true };
      case 'choose':
        if(G.phase !== 'choose' || G.status[pid] !== 'in') return { error: '今は選べません' };
        if(a.c !== 'go' && a.c !== 'leave') return { error: '選択が不正です' };
        G.choice[pid] = a.c; maybeAdvance(G); return { ok: true };
      case 'flipDone':
        if(!host || G.phase !== 'flip') return { error: '今は進められません' };
        if(G.ended) endRound(G, rnd); else G.phase = 'choose';
        return { ok: true };
      case 'next':
        if(!host || G.phase !== 'result' || G.last) return { error: '今は進められません' };
        startRound(G, rnd); return { ok: true };
      case 'resetup':
        if(!host || G.phase !== 'result' || !G.last) return { error: '今は戻れません' };
        resetMatch(G); G.phase = 'setup'; syncSetup(G); return { ok: true };
    }
    return { error: '未対応の操作' };
  }
  function force(G){
    if(G.phase === 'choose') resolveStep(G);              // 未選択は「降りる」
    else if(G.phase === 'flip'){ if(G.ended) endRound(G); else G.phase = 'choose'; }
  }
  function waiting(G){ return G.phase === 'choose' ? waitIds(G) : []; }
  function sync(G){ if(G.phase === 'setup') syncSetup(G); else maybeAdvance(G); }

  function view(G, pid){
    var v = { phase: G.phase, mode: G.mode, rounds: nRounds(G), setRounds: G.rounds, round: G.round, part: G.part, inPart: inPart(G, pid), total: G.total, drinks: G.drinks };
    if(G.phase === 'setup') return v;
    v.status = G.status; v.banked = G.banked; v.seen = G.seen; v.left = leftInfo(G); v.stepNo = G.stepNo; v.stake = G.stake;
    if(G.phase === 'choose'){ v.myChoice = G.choice[pid] || null; v.submitted = Object.keys(G.choice); }   // 他人の選択は送らない
    if(G.phase === 'flip'){ v.step = G.step; v.ended = G.ended; }
    if(G.phase === 'result'){ v.step = G.step; v.roundScore = G.roundScore; v.drinkers = G.drinkers; v.last = G.last; }
    return v;
  }
  var game = { newState: newState, act: act, view: view, waiting: waiting, force: force, sync: sync };
  /* PURE-END */

  /* ---------------- 演出(CSS・音) ---------------- */
  // 心音(ドクッ)・めくる音・爆発音は Web Audio API で合成(外部ファイルなし)。参考: MDN Web Audio API https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
  function thump(sfx, dt, amp){
    var a = sfx.ac, t0 = a.currentTime + 0.02 + dt;
    [0, 0.13].forEach(function(o, i){
      var os = a.createOscillator(), g = a.createGain();
      os.type = 'sine'; os.frequency.setValueAtTime(i ? 62 : 74, t0 + o); os.frequency.exponentialRampToValueAtTime(40, t0 + o + 0.12);
      g.gain.setValueAtTime(0.0001, t0 + o); g.gain.exponentialRampToValueAtTime(amp * (i ? 0.7 : 1), t0 + o + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + o + 0.16);
      os.connect(g); g.connect(sfx.out); os.start(t0 + o); os.stop(t0 + o + 0.2);
    });
  }
  function noiseBurst(sfx, dt, dur, f0, f1, amp){
    var a = sfx.ac, t0 = a.currentTime + 0.02 + dt, n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for(var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    var src = a.createBufferSource(); src.buffer = buf;
    var fl = a.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(f0, t0); fl.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    var g = a.createGain(); g.gain.value = amp; src.connect(fl); fl.connect(g); g.connect(sfx.out); src.start(t0);
  }
  function boomSound(sfx){
    var a = sfx.ac, t0 = a.currentTime + 0.02, o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(130, t0); o.frequency.exponentialRampToValueAtTime(35, t0 + 0.45);
    g.gain.setValueAtTime(0.7, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
    o.connect(g); g.connect(sfx.out); o.start(t0); o.stop(t0 + 0.5);
    noiseBurst(sfx, 0, 0.5, 2400, 280, 0.8);
  }

  var CSS_ID = 'chicken-css';
  var CSS = [
    '.ckst{position:relative;border-radius:18px;overflow:hidden;flex:0 0 auto;min-height:440px;background:linear-gradient(#10151f 0%,#1b2433 55%,#2a2f3a 56%,#1a1d24 100%);border:1px solid #2f3a4d;padding:14px 10px 18px;}',
    '.ckst .road{position:absolute;left:0;right:0;bottom:0;height:44%;background:repeating-linear-gradient(90deg,transparent 0 46px,rgba(255,255,255,.12) 46px 50px);opacity:.5;}',
    '.cktitle{position:relative;text-align:center;font-weight:900;letter-spacing:.3em;font-size:13px;color:#ffd98a;}',
    '.cksec{position:relative;text-align:center;font-size:11.5px;color:#9fb0c8;margin:12px 0 6px;font-weight:700;}',
    '.ckrow{position:relative;display:flex;flex-wrap:wrap;justify-content:center;gap:8px 6px;min-height:34px;}',
    '.ckp{opacity:0;display:flex;flex-direction:column;align-items:center;gap:2px;}',
    '.ckp .t{font-size:11px;font-weight:900;padding:1px 8px;border-radius:999px;}',
    '.ckp .t.l{background:rgba(95,208,168,.18);color:#5FD0A8;border:1px solid #5FD0A8;}',
    '.ckp .t.g{background:rgba(255,90,69,.15);color:#ff9a8a;border:1px solid #FF5A45;}',
    '@keyframes ckSlide{0%{transform:translateX(-60px) scale(.8);opacity:0;}100%{transform:none;opacity:1;}}',
    '@keyframes ckPop{0%{transform:scale(.5);opacity:0;}70%{transform:scale(1.1);opacity:1;}100%{transform:none;opacity:1;}}',
    '.ckcard{position:relative;margin:14px auto 4px;width:132px;height:176px;perspective:700px;}',
    '.ckin{position:absolute;inset:0;transform-style:preserve-3d;}',
    '.ckf,.ckb{position:absolute;inset:0;border-radius:14px;backface-visibility:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;border:3px solid #c9a35a;box-shadow:0 8px 20px rgba(0,0,0,.55);}',
    '.ckb{background:repeating-linear-gradient(45deg,#3b2a6b 0 10px,#2f2158 10px 20px);font-size:54px;}',
    '.ckf{transform:rotateY(180deg);background:linear-gradient(#fff7e0,#f2dfae);color:#3a2414;}',
    '.ckf.h{background:linear-gradient(#3a1010,#1a0707);color:#fff;border-color:#ff5a45;}',
    '.ckf .n{font-size:58px;font-weight:900;line-height:1;}.ckf .u{font-size:12px;font-weight:900;opacity:.75;margin-top:4px;}.ckf .x2{font-size:13px;font-weight:900;color:#c0392b;margin-top:2px;}',
    '.ckf.h .big{font-size:64px;}',
    '@keyframes ckBeat{0%,100%{transform:scale(1);}10%{transform:scale(1.07);}20%{transform:scale(1);}30%{transform:scale(1.06);}45%{transform:scale(1);}}',
    '@keyframes ckFlipA{0%{transform:rotateY(0) scale(1);}60%{transform:rotateY(180deg) scale(1.18);}100%{transform:rotateY(180deg) scale(1);}}',
    '@keyframes ckShake{0%,100%{transform:translate(0,0);}20%{transform:translate(-5px,3px);}40%{transform:translate(5px,-3px);}60%{transform:translate(-4px,-2px);}80%{transform:translate(3px,3px);}}',
    '@keyframes ckBomb{0%{transform:translateX(0) rotate(0);opacity:1;}30%{transform:translateX(-5px) rotate(-6deg);}60%{transform:translateX(5px) rotate(6deg);}100%{transform:translateY(8px);opacity:.55;filter:grayscale(1);}}',
    '@keyframes ckGain{0%{transform:translateY(0);}40%{transform:translateY(-8px) scale(1.15);}100%{transform:translateY(0) scale(1);}}',
    '@keyframes ckRed{0%{opacity:0;}15%{opacity:.85;}100%{opacity:0;}}',
    '.ckflash{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle,rgba(255,214,170,.95),rgba(255,70,40,.85) 40%,rgba(0,0,0,0) 75%);opacity:0;}',
    '.ckcap{position:relative;text-align:center;font-weight:900;font-size:17px;line-height:1.6;margin-top:10px;opacity:0;text-shadow:0 2px 8px rgba(0,0,0,.85);}',
    '@keyframes ckFade{from{opacity:0;}to{opacity:1;}}',
    '.ckmeter{height:10px;border-radius:6px;background:#26303f;overflow:hidden;margin:8px 0 4px;}',
    '.ckmeter>i{display:block;height:100%;background:linear-gradient(90deg,#E8C24A,#FF5A45);}',
    '.ckchips{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;margin-top:6px;}',
    '.ckchip{min-width:30px;text-align:center;padding:3px 7px;border-radius:8px;background:#f2dfae;color:#3a2414;font-weight:900;font-size:13px;}',
    '.ckchip.h{background:#3a1010;color:#fff;border:1px solid #ff5a45;}',
    '.ckchip.used{opacity:.25;text-decoration:line-through;}',
    '.ckgo{flex:1;padding:20px 0;border-radius:16px;border:2.5px solid var(--line);background:var(--bg-surface);color:var(--text);font-weight:900;font-size:22px;}',
    '.ckgo small{display:block;font-size:11px;font-weight:700;opacity:.75;margin-top:4px;}',
    '.ckgo.go.sel{border-color:var(--danger);background:rgba(255,90,69,.18);color:#ff9a8a;}',
    '.ckgo.lv.sel{border-color:var(--safe);background:rgba(95,208,168,.16);color:var(--safe);}'
  ].join('\n');
  function injectCss(){
    if(document.getElementById(CSS_ID)) return;
    var st = document.createElement('style'); st.id = CSS_ID; st.textContent = CSS; document.head.appendChild(st);
  }

  function render(root, ctx){
    injectCss();
    var v = ctx.view, esc = ctx.esc, me = ctx.me, h = '';
    function btn(id, label, cls){ return '<button class="' + (cls || 'btn-primary') + '" id="' + id + '">' + label + '</button>'; }
    function names(ids){ return ids.length ? ids.map(function(id){ return esc(ctx.nameOf(id)); }).join('・') : 'なし'; }
    function modeLabel(){ return v.mode === 'single' ? '一発勝負' : '複数ラウンド(' + v.rounds + 'R)'; }
    var q = function(id){ return document.getElementById(id); };

    /* ---- 設定 ---- */
    if(v.phase === 'setup'){
      var seg = function(id, label, on, dis){
        return '<button id="' + id + '" ' + (dis ? 'disabled ' : '') + 'style="flex:1;padding:14px 0;border-radius:12px;border:2px solid ' + (on ? 'var(--accent)' : 'var(--line)') + ';background:' + (on ? 'rgba(111,207,151,.14)' : 'var(--bg-surface)') + ';color:' + (on ? 'var(--accent)' : 'var(--text)') + ';font-weight:900;font-size:15px">' + label + '</button>';
      };
      h = '<div class="eyebrow">CHICKEN RACE</div>' +
        '<div class="card-ui"><div class="big-text" style="font-size:20px">遊び方を選ぶ</div>' +
        '<div class="sub-text">' + (ctx.isHost ? 'ホストが決めてスタート。' : 'ホストが設定しています…') + '</div></div>' +
        '<div class="section-label">モード</div>' +
        '<div style="display:flex;gap:8px">' + seg('mSingle', '一発勝負', v.mode === 'single', !ctx.isHost) + seg('mMulti', '複数ラウンド', v.mode === 'multi', !ctx.isHost) + '</div>' +
        '<div class="sub-text" style="margin-top:8px">' + (v.mode === 'single' ? '1ラウンドだけ。そのラウンドの<b>最下位が飲む</b>。' : 'ラウンドを重ねて<b>合計点の最下位が飲む</b>(💣は、そのラウンドが0点になるだけ)。') + '</div>' +
        (v.mode === 'multi' ? '<div class="section-label">ラウンド数</div><div style="display:flex;gap:8px">' + [3, 5, 7].map(function(n){ return seg('mR' + n, n + 'ラウンド', v.setRounds === n, !ctx.isHost); }).join('') + '</div>' : '') +
        '<div class="sub-text" style="margin-top:14px">参加: ' + names(v.part) + '</div>' +
        '<div class="spacer"></div><div class="bottombar">' + (ctx.isHost ? btn('mStart', 'スタート') : '<div class="sub-text" style="text-align:center">ホストがスタートするのを待っています…</div>') + '</div>';
      root.innerHTML = h;
      if(q('mSingle')) q('mSingle').onclick = function(){ ctx.send({ t: 'setMode', m: 'single' }); };
      if(q('mMulti')) q('mMulti').onclick = function(){ ctx.send({ t: 'setMode', m: 'multi' }); };
      [3, 5, 7].forEach(function(n){ if(q('mR' + n)) q('mR' + n).onclick = function(){ ctx.send({ t: 'setRounds', n: n }); }; });
      if(q('mStart')) q('mStart').onclick = function(){ ctx.send({ t: 'start' }); };
      return;
    }

    var top = '<div class="eyebrow">' + (v.mode === 'single' ? '一発勝負' : 'ROUND ' + v.round + ' / ' + v.rounds) + (v.phase !== 'result' ? ' ・ STEP ' + (v.phase === 'flip' ? v.stepNo : v.stepNo + 1) : '') + '</div>';
    var STT = { 'in': ['🏃', '進行中', 'var(--danger)'], left: ['🐔', '降りた', 'var(--safe)'], bomb: ['💥', 'ドボン', 'var(--danger)'] };
    function board(){
      var rows = v.part.map(function(id){
        var s = STT[v.status[id]] || STT['in'];
        return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">' + ctx.chip(id) +
          '<span style="font-size:12px;font-weight:900;color:' + s[2] + '">' + s[0] + ' ' + s[1] + '</span>' +
          '<span style="margin-left:auto;font-size:12px;color:var(--text-muted)">今回 <b style="font-size:17px;color:var(--text)">' + (v.banked[id] || 0) + '</b>' +
          (v.mode === 'multi' ? ' / 合計 <b style="font-size:17px;color:var(--text)">' + (v.total[id] || 0) + '</b>' : '') + ' / 飲んだ ' + (v.drinks[id] || 0) + '</span></div>';
      }).join('');
      return '<div class="section-label">いまの状況</div><div style="background:var(--bg-surface);border:1px solid var(--line);border-radius:14px;padding:2px 14px">' + rows + '</div>';
    }
    function deckInfo(){
      var L = v.left, p = L.n ? Math.round(1000 * L.haz / L.n) / 10 : 0;
      var all = [];   // 公開されている山札の中身。めくられた分は薄く表示
      var seen = v.seen.slice();
      var chips = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7].map(function(x){
        var i = seen.findIndex ? seen.findIndex(function(c){ return !c.h && c.v === x; }) : -1;
        if(i >= 0){ seen.splice(i, 1); return '<span class="ckchip used">' + x + '</span>'; }
        return '<span class="ckchip">' + x + '</span>';
      });
      var hz = 0; v.seen.forEach(function(c){ if(c.h) hz++; });
      for(var k = 0; k < 3; k++) chips.push('<span class="ckchip h' + (k < hz ? ' used' : '') + '">💣</span>');
      return '<div style="background:var(--bg-surface);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-top:12px">' +
        '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700"><span>山札 あと <b>' + L.n + '</b>枚(💣 <b style="color:var(--danger)">' + L.haz + '</b>枚)</span>' +
        '<span>次が💣の確率 <b style="color:var(--danger);font-size:16px">' + p + '%</b></span></div>' +
        '<div class="ckmeter"><i style="width:' + Math.min(100, p) + '%"></i></div>' +
        '<div class="ckchips">' + chips.join('') + '</div></div>';
    }

    /* ---- 選択 ---- */
    if(v.phase === 'choose'){
      var s = v.status[me], mine = v.banked[me] || 0;
      if(!v.inPart){
        h = top + '<div class="card-ui"><div class="big-text">このラウンドは観戦中</div><div class="sub-text">途中で入り直したので、次のラウンドから参加できます。</div></div>' + deckInfo() + board() + ctx.waitHtml();
      } else if(s !== 'in'){
        h = top + '<div class="card-ui"><div class="big-text">' + (s === 'left' ? '🐔 あなたは降りました' : '💥 ドボン') + '</div><div class="sub-text">このラウンドの確定: <b>' + mine + '</b>点。他の人の選択を待っています。</div></div>' + deckInfo() + board() + ctx.waitHtml();
      } else {
        h = top + '<div class="card-ui"><div class="sub-text">いまの持ち点(このラウンド)</div><div class="big-text" style="font-size:44px;color:var(--accent)">' + mine + '</div>' +
          '<div class="sub-text">進む人だけが次の1枚をめくる。💣なら進んだ人は<b>0点</b>。ひとりだけ進めば<b>得点2倍</b>。</div></div>' + deckInfo() +
          '<div style="display:flex;gap:10px;margin-top:14px">' +
          '<button class="ckgo go' + (v.myChoice === 'go' ? ' sel' : '') + '" id="cGo">進む<small>次の1枚をめくる</small></button>' +
          '<button class="ckgo lv' + (v.myChoice === 'leave' ? ' sel' : '') + '" id="cLeave">降りる<small>' + mine + '点を持ち帰る</small></button></div>' +
          '<div class="sub-text" style="text-align:center;margin-top:8px">' + (v.myChoice ? '選択済み(全員が選ぶまで変更できます)' : 'みんなが選ぶまで、どちらか選んでください') + '</div>' +
          '<div class="waitbar">' + (v.submitted.length ? '選択済み: ' + names(v.submitted) : '') + '</div>' + ctx.waitHtml() + board();
      }
      root.innerHTML = h;
      if(q('cGo')) q('cGo').onclick = function(){ ctx.send({ t: 'choose', c: 'go' }); ctx.tone(520, 0.06, 'triangle', 0.08); };
      if(q('cLeave')) q('cLeave').onclick = function(){ ctx.send({ t: 'choose', c: 'leave' }); ctx.tone(330, 0.06, 'triangle', 0.08); };
      return;
    }

    /* ---- めくり演出 ---- */
    if(v.phase === 'flip'){
      var st = v.step, L = ctx.local, rk = 'flip:' + v.round + ':' + st.n;
      if(L.rkey !== rk){ L.rkey = rk; L.t0 = Date.now(); L.played = false; L.sent = false; }
      var el = (Date.now() - L.t0) / 1000;
      var A = function(name, dur, ease, delay, fill, iter){ return name + ' ' + dur + 's ' + ease + ' ' + (delay - el).toFixed(2) + 's ' + (iter || 1) + ' ' + (fill || 'both'); };
      var T0 = 0.7, STEP = 0.55;
      var tCard = T0 + st.leavers.length * STEP + 0.5, tBeat = 1.7, tF = tCard + tBeat + 0.1, tCap = tF + 0.9;
      var leaveHtml = st.leavers.length ? st.leavers.map(function(id, i){
        return '<div class="ckp" style="animation:' + A('ckSlide', 0.45, 'ease-out', T0 + i * STEP) + '">' + ctx.chip(id) + '<span class="t l">🐔 降りた +' + (v.banked[id] || 0) + '</span></div>';
      }).join('') : '<span style="font-size:12px;color:#7d8aa0;opacity:1">(降りた人はいない)</span>';
      var goHtml = st.goers.map(function(id, i){
        var bomb = st.bombed.indexOf(id) >= 0;
        return '<div class="ckp" style="animation:' + A('ckPop', 0.4, 'ease-out', tCard + 0.2 + i * 0.1) + '"><div style="' + (bomb ? 'animation:' + A('ckBomb', 0.8, 'ease-out', tF + 0.3) : st.card ? 'animation:' + A('ckGain', 0.6, 'ease-out', tF + 0.3) : '') + '">' + ctx.chip(id) + '</div>' +
          '<span class="t g">進んだ</span>' +
          (st.card ? '<span class="t g" style="opacity:0;animation:' + A('ckFade', 0.4, 'ease', tF + 0.3) + '">' + (bomb ? '💥 ドボン' : '+' + st.gain) + '</span>' : '') + '</div>';
      }).join('');
      var cardHtml = '';
      if(st.card){
        var face = st.card.h ? '<div class="ckf h"><div class="big">💣</div><div class="u">ドボン!</div></div>'
          : '<div class="ckf"><div class="n">+' + st.card.v + '</div><div class="u">ポイント</div>' + (st.solo ? '<div class="x2">ひとり勝負 ×2 = +' + st.gain + '</div>' : '') + '</div>';
        cardHtml = '<div class="ckcard" style="animation:' + A('ckPop', 0.4, 'ease-out', tCard) + '"><div class="ckin" style="animation:' + A('ckBeat', 0.5, 'ease-in-out', tCard + 0.2, 'both', 3) + ',' + A('ckFlipA', 0.7, 'ease-in-out', tF, 'forwards') + '">' +
          '<div class="ckb">🐔</div>' + face + '</div></div>';
      }
      var cap, capCol = '#cfe8d8';
      if(!st.card){ cap = '全員が降りた。ラウンド終了'; }
      else if(st.card.h){ cap = '💣! 進んだ ' + names(st.bombed) + ' はドボン(このラウンド0点)'; capCol = '#ffb4a8'; }
      else { cap = '+' + st.gain + ' を ' + names(st.goers) + ' が獲得' + (st.solo ? '(ひとり勝負 ×2)' : ''); }
      var tCapUse = st.card ? tCap : tCard + 0.2;
      var tEnd = tCapUse + 2.4;
      h = top + '<div class="ckst"><div class="road"></div>' +
        '<div class="ckflash" style="' + (st.card && st.card.h ? 'animation:' + A('ckRed', 0.5, 'ease-out', tF + 0.25) : '') + '"></div>' +
        '<div class="cktitle">CHICKEN RACE</div>' +
        '<div class="cksec">降りた人</div><div class="ckrow">' + leaveHtml + '</div>' +
        (st.goers.length ? '<div class="cksec">進んだ人</div><div class="ckrow">' + goHtml + '</div>' : '') +
        cardHtml +
        '<div class="ckcap" style="color:' + capCol + ';animation:' + A('ckFade', 0.6, 'ease', tCapUse) + '">' + cap + '</div></div>' +
        '<div class="spacer"></div><div class="bottombar">' + (ctx.isHost ? '<button class="btn-primary" id="fDone" style="visibility:hidden">' + (v.ended ? '結果を見る' : '次へ') + '</button>' : '<div class="sub-text" style="text-align:center">めくっています…</div>') + '</div>';
      root.innerHTML = h;
      if(!L.played){
        L.played = true;
        st.leavers.forEach(function(_, i){ setTimeout(function(){ ctx.tone(660 - 40 * i, 0.08, 'sine', 0.1); }, (T0 + i * STEP + 0.2) * 1000); });
        if(st.card){
          var sf = ctx.sfx && ctx.sfx();
          if(sf){ [0, 0.5, 0.9, 1.2, 1.42, 1.62].forEach(function(dt, i){ setTimeout(function(){ var s2 = ctx.sfx && ctx.sfx(); if(s2) thump(s2, 0, 0.5 + i * 0.08); }, (tCard + dt) * 1000); }); }
          setTimeout(function(){ var s3 = ctx.sfx && ctx.sfx(); if(s3) noiseBurst(s3, 0, 0.25, 4000, 600, 0.35); }, tF * 1000);
          if(st.card.h) setTimeout(function(){ var s4 = ctx.sfx && ctx.sfx(); if(s4) boomSound(s4); ctx.tone(120, 0.5, 'sawtooth', 0.08); }, (tF + 0.3) * 1000);
          else setTimeout(function(){ [784, 988, 1175].forEach(function(f, i){ setTimeout(function(){ ctx.tone(f, 0.12, 'triangle', 0.1); }, i * 90); }); }, (tF + 0.3) * 1000);
        }
      }
      if(ctx.isHost){
        var done = function(){ if(!L.sent){ L.sent = true; ctx.send({ t: 'flipDone' }); } };
        ctx.every(function(){
          var t = (Date.now() - L.t0) / 1000, b = document.getElementById('fDone');
          if(b && t >= tCapUse + 0.4) b.style.visibility = 'visible';
          if(t >= tEnd) done();
        }, 400);
        var fb = q('fDone'); if(fb) fb.onclick = done;
      }
      return;
    }

    /* ---- 結果 ---- */
    var order = v.part.slice().sort(function(a, b){ return v.roundScore[b] - v.roundScore[a]; });
    var rows = order.map(function(id){
      var bomb = v.status[id] === 'bomb', dr = v.last && v.drinkers.indexOf(id) >= 0;
      return '<div style="display:flex;align-items:center;gap:10px;background:var(--bg-surface);border:1.5px solid ' + (dr ? 'var(--danger)' : 'var(--line)') + ';border-radius:14px;padding:10px 12px;margin-top:8px">' +
        '<span style="font-size:26px;font-weight:900;width:44px;text-align:center">' + v.roundScore[id] + '</span>' + ctx.chip(id) +
        '<span style="margin-left:auto;font-size:12px;font-weight:900;color:' + (dr ? 'var(--danger)' : bomb ? 'var(--danger)' : 'var(--safe)') + '">' + (dr ? '最下位 → 飲む' : bomb ? '💥 ドボン' : v.status[id] === 'left' ? '🐔 降りた' : '生き残り') + '</span></div>';
    }).join('');
    var tot = '';
    if(v.mode === 'multi'){
      var ord2 = v.part.slice().sort(function(a, b){ return (v.total[b] || 0) - (v.total[a] || 0); });
      tot = '<div class="section-label">合計点</div><div style="background:var(--bg-surface);border:1px solid var(--line);border-radius:14px;padding:2px 14px">' +
        ord2.map(function(id, i){ return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)"><span style="width:22px;color:var(--text-muted);font-size:12px">' + (i + 1) + '</span>' + ctx.chip(id) + '<span style="margin-left:auto;font-size:17px;font-weight:900">' + (v.total[id] || 0) + '</span></div>'; }).join('') + '</div>';
    }
    var verdict = v.last
      ? '<div class="card-ui"><div class="big-text" style="color:var(--danger)">飲むのは: ' + names(v.drinkers) + '</div><div class="sub-text">' + esc(v.stake) + '(' + (v.mode === 'single' ? 'このラウンドの最下位' : '合計点の最下位') + (v.drinkers.length > 1 ? '・同点は全員' : '') + ')</div></div>'
      : '<div class="card-ui"><div class="big-text" style="font-size:20px">ラウンド ' + v.round + ' 終了</div><div class="sub-text">飲むのは最後に合計点の最下位。残り ' + (v.rounds - v.round) + ' ラウンド。</div></div>';
    h = top + verdict + '<div class="section-label">このラウンドの得点</div>' + rows + tot + '<div class="spacer"></div><div class="bottombar">' +
      (ctx.isHost ? (v.last ? btn('rAgain', 'もう一度(設定に戻る)') : btn('rNext', '次のラウンドへ')) : '<div class="sub-text" style="text-align:center">ホストが次へ進めるのを待っています…</div>') + '</div>';
    root.innerHTML = h;
    if(q('rNext')) q('rNext').onclick = function(){ ctx.send({ t: 'next' }); };
    if(q('rAgain')) q('rAgain').onclick = function(){ ctx.send({ t: 'resetup' }); };
  }

  // 開発中モード用のCPU(進む/降りるをランダムに選ぶだけ)
  function bot(v, me, rnd){
    if(!v.inPart || v.phase !== 'choose' || v.status[me] !== 'in' || v.myChoice) return null;
    return { t: 'choose', c: rnd(2) ? 'go' : 'leave' };
  }

  NO.register({
    id: 'chicken', emoji: '🐔', title: 'チキンレース', accent: '#F2994A', accentInk: '#2A1500', min: 3, max: 8,
    tagline: '進むか降りるか。💣が出たら進んだ人はドボン。一発勝負も複数ラウンドも選べる。',
    rules: [
      '山札は<b>ポイントカード12枚 + 💣3枚</b>(中身は最初から全員に公開)。毎ステップ、全員が同時に・こっそり<b>「進む」か「降りる」</b>を選ぶ。',
      '<b>降りた人</b>はそこまでの点を持ち帰って安全に抜ける。<b>進んだ人</b>は山札を1枚めくる。ポイントカードなら進んだ全員に加点(<b>ひとりだけ進むと2倍</b>)。',
      '<b>💣が出たら、進んだ人は「ドボン」</b>(そのラウンドは0点)でラウンド終了。降りていた人は無傷。',
      '<b>一発勝負</b>=1ラウンドの最下位が飲む。<b>複数ラウンド</b>(3・5・7)=合計点の最下位が飲む。同点なら全員が飲む。',
      '「次が💣の確率」は公開情報から正確に計算して表示する。アプリは確率も結果も補正しない。'
    ],
    game: game, bot: bot, render: render
  });
})();
