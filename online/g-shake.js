/*
  高速シェイク(オンライン版・隠しゲーム)
  スマホを持って、制限時間(初期値10秒)のあいだ、ひたすら振り回す。振った回数がいちばん多い人の勝ち。いちばん少ない人(最下位)が飲む。
  隠しゲーム: ホストか参加者のだれか1人でも名前が「チンコ」「ちんこ」のときだけロビーに出る(同名は自動で「ちんこ2」のようになるので、末尾の数字は無視する)。
              開発中モード(?dev=1)では常に出る。出し分けは online-core.js 側(def.reveal)。
  数え方: 加速度センサー(DeviceMotion の accelerationIncludingGravity)の大きさ |a| が、重力 9.81 m/s² から 9 m/s² 以上ずれたら「1回」。
          数えたあと、ずれが 3 m/s² 未満に戻る(=いったん落ち着く)まで次は数えない。連続する2回は 80ms 以上あける。しきい値は固定で、端末ごとの調整はしない。
          センサーが使えない端末(PCなど)では、画面のボタンのタップ回数で代用する(振る動作とは比べられないので、動作確認用)。
          iPhone はセンサーの許可が必要で、「準備OK」を押したときに許可を求める。
  進行: 設定(時間を選ぶ)→ 全員が準備OK → 3秒カウントダウン → 本番(制限時間)→ 結果。
  公平性: アプリは各自の端末が数えた回数をそのまま集計し、多い順に並べるだけ(補正・加工・ハンデなし)。乱数は勝敗に使わない。
          制限時間は各自の端末が「本番の画面になった瞬間」から測る。端末への到着の遅れの差(数十ミリ秒)は補正していない。
          回数は各自の端末が数えて申告する方式のため、改造すればごまかせる(飲み会で遊ぶ前提。研究データには使わないこと)。
          センサーの機種差はあるが、センサーの値の補正はしない。開発中モードのCPUだけが、ランダムな回数ぶん進む(動作確認専用)。
  参考文献:
    [1] MDN DeviceMotionEvent(加速度センサー): https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent
    [2] MDN Web Audio API(効果音の合成): https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
    [3] Button mashing(連打ゲームの一般的な形。振る動作に置き換えたもの): https://en.wikipedia.org/wiki/Button_mashing
    [4] 通信・隠しゲームの出し分けは online-core.js の冒頭を参照
  (オンライン ロビーに登録されるゲーム。通信・部屋・QRは online-core.js が担当)
*/
(function(){
  'use strict';
  var NO = window.NomikaiOnline;

  /* PURE-BEGIN */
  var SECS = [5, 10, 20];
  function activeIds(G){ return G.part.filter(function(id){ return !G.offline[id]; }); }
  function inPart(G, pid){ return G.part.indexOf(pid) >= 0; }
  function syncSetup(G){ G.part = G.players.map(function(p){ return p.id; }).filter(function(id){ return !G.offline[id]; }); }
  function newState(players, rnd){
    var G = { players: players, offline: {}, phase: 'setup', secs: 10, round: 0, part: [], ready: {}, count: {} };
    syncSetup(G); return G;
  }
  function begin(G){
    syncSetup(G); G.round++; G.phase = 'ready'; G.ready = {}; G.count = {};
    G.part.forEach(function(id){ G.count[id] = 0; });
  }
  function checkAllReady(G){
    var a = activeIds(G);
    if(G.phase === 'ready' && a.length >= 2 && a.every(function(id){ return G.ready[id]; })) G.phase = 'count';
  }
  // 勝者 = 最多(同数なら全員)。最下位 = 最少(同数なら全員)。全員同じ回数なら勝者・最下位なし
  function ranks(G){
    var vals = G.part.map(function(id){ return G.count[id] || 0; });
    var mx = Math.max.apply(null, vals), mn = Math.min.apply(null, vals);
    if(mx === mn) return { winners: [], losers: [] };
    return { winners: G.part.filter(function(id){ return (G.count[id] || 0) === mx; }), losers: G.part.filter(function(id){ return (G.count[id] || 0) === mn; }) };
  }
  function act(G, pid, a, rnd){
    if(!a || typeof a !== 'object') return { error: '操作が不正です' };
    var host = pid === 'p0';
    switch(a.t){
      case 'setSecs':
        if(!host || G.phase !== 'setup' || SECS.indexOf(a.v) < 0) return { error: '今は変えられません' };
        G.secs = a.v; return { ok: true };
      case 'start':
        if(!host || (G.phase !== 'setup' && G.phase !== 'result')) return { error: 'ホストだけが始められます' };
        syncSetup(G); if(G.part.length < 2) return { error: '2人以上必要です' };
        begin(G); return { ok: true };
      case 'ready':
        if(G.phase !== 'ready' || !inPart(G, pid)) return { error: '今は押せません' };
        G.ready[pid] = true; checkAllReady(G); return { ok: true };
      case 'go':        // ホストが、準備OKを待たずに始める
        if(!host || G.phase !== 'ready') return { error: '今は始められません' };
        G.phase = 'count'; return { ok: true };
      case 'countDone':
        if(!host || G.phase !== 'count') return { error: '今は進められません' };
        G.phase = 'play'; return { ok: true };
      case 'prog':      // 自分の回数の申告(増える方向だけ受け付ける)
        if(G.phase !== 'play' || !inPart(G, pid)) return { error: '今は送れません' };
        if(typeof a.n !== 'number' || a.n % 1 !== 0 || a.n < 0 || a.n > 9999) return { error: '回数が不正です' };
        if(a.n > (G.count[pid] || 0)) G.count[pid] = a.n;
        return { ok: true };
      case 'timeUp':
        if(!host || G.phase !== 'play') return { error: '今は進められません' };
        G.phase = 'result'; return { ok: true };
      case 'resetup':
        if(!host || G.phase !== 'result') return { error: '今は戻れません' };
        G.phase = 'setup'; syncSetup(G); return { ok: true };
    }
    return { error: '未対応の操作' };
  }
  function force(G){
    if(G.phase === 'ready') G.phase = 'count';
    else if(G.phase === 'count') G.phase = 'play';
    else if(G.phase === 'play') G.phase = 'result';
  }
  function waiting(G){ return G.phase === 'ready' ? activeIds(G).filter(function(id){ return !G.ready[id]; }) : []; }
  function sync(G){ if(G.phase === 'setup') syncSetup(G); else checkAllReady(G); }
  function view(G, pid){
    var v = { phase: G.phase, secs: G.secs, round: G.round, part: G.part, inPart: inPart(G, pid) };
    if(G.phase === 'ready'){ v.ready = G.ready; v.myReady = !!G.ready[pid]; }
    if(G.phase === 'count' || G.phase === 'play' || G.phase === 'result') v.count = G.count;       // 回数は全員に見せる
    if(G.phase === 'result'){ var r = ranks(G); v.winners = r.winners; v.losers = r.losers; }
    return v;
  }
  var game = { newState: newState, act: act, view: view, waiting: waiting, force: force, sync: sync };
  /* PURE-END */

  /* ---- 振りの検出 ---- */
  var SH = { on: false, n: 0, last: 0, armed: true, seen: false, started: false, cb: null };
  var HI = 9, LO = 3, GAP = 80;
  function onMotion(e){
    var g = e && e.accelerationIncludingGravity;
    if(!g || g.x == null || g.y == null || g.z == null) return;
    SH.seen = true;
    if(!SH.on) return;
    var dev = Math.abs(Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z) - 9.81), t = Date.now();
    if(dev < LO) SH.armed = true;
    else if(SH.armed && dev >= HI && t - SH.last >= GAP){ SH.armed = false; SH.last = t; if(SH.cb) SH.cb(); }
  }
  function askMotion(){        // iPhone は、ユーザーのタップ操作の中でセンサーの許可を求める必要がある
    if(!SH.started){ SH.started = true; try{ window.addEventListener('devicemotion', onMotion); }catch(e){} }
    try{
      if(typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') DeviceMotionEvent.requestPermission().catch(function(){});
    }catch(e){}
  }

  var CSS_ID = 'shake-css';
  var CSS = [
    '.shz{position:relative;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;-webkit-user-select:none;user-select:none;touch-action:manipulation;}',
    '.shn{font-weight:900;font-size:min(40vw,26vh);line-height:1;color:#fff;text-shadow:0 0 26px rgba(80,200,255,.85),0 4px 14px rgba(0,0,0,.8);font-variant-numeric:tabular-nums;}',
    '.shph{font-size:min(30vw,18vh);line-height:1;}.shph.go{animation:shShake .12s linear infinite;}',
    '@keyframes shShake{0%{transform:translate(0,0) rotate(0);}25%{transform:translate(-8px,3px) rotate(-8deg);}50%{transform:translate(7px,-3px) rotate(7deg);}75%{transform:translate(-5px,-4px) rotate(-5deg);}100%{transform:translate(0,0) rotate(0);}}',
    '.shtime{width:min(86vw,420px);height:14px;border-radius:8px;background:rgba(255,255,255,.12);overflow:hidden;}.shtime i{display:block;height:100%;width:100%;border-radius:8px;background:linear-gradient(90deg,#6be3ff,#4f8bff);}',
    '.shbar{display:flex;align-items:center;gap:8px;}.shbar .chip{flex:0 0 74px;min-height:22px;font-size:11px;padding:1px 6px;}',
    '.shbar .b{flex:1;height:10px;border-radius:6px;background:rgba(255,255,255,.1);overflow:hidden;}.shbar .b i{display:block;height:100%;width:0;border-radius:6px;background:linear-gradient(90deg,#6be3ff,#4f8bff);transition:width .15s linear;}',
    '.shbar .k{flex:0 0 38px;text-align:right;font-weight:900;font-size:12px;font-variant-numeric:tabular-nums;color:var(--text-muted);}',
    '.shcd{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;}',
    '.shcd b{position:absolute;font-size:min(50vw,32vh);font-weight:900;color:#fff;text-shadow:0 0 30px rgba(110,220,255,.9),0 6px 18px rgba(0,0,0,.7);opacity:0;}',
    '@keyframes shNum{0%{transform:scale(2.2);opacity:0;}30%{transform:scale(1);opacity:1;}85%{transform:scale(.95);opacity:1;}100%{transform:scale(.6);opacity:0;}}',
    '.shgo{position:absolute;left:0;right:0;top:12%;text-align:center;font-weight:900;font-size:min(16vw,64px);color:#bfe9ff;pointer-events:none;text-shadow:0 4px 18px rgba(0,0,0,.8);opacity:0;animation:shGo .9s ease-out both;}',
    '@keyframes shGo{0%{transform:scale(.4);opacity:0;}25%{transform:scale(1.15);opacity:1;}100%{transform:scale(1);opacity:0;}}',
    '.shfx{position:fixed;inset:0;z-index:70;pointer-events:none;overflow:hidden;animation:shFxOut .5s ease-in 3.3s both;}',
    '@keyframes shFxOut{to{opacity:0;}}',
    '.shfx .cf{position:absolute;top:-4vh;width:9px;height:14px;opacity:0;animation:shFall 2.6s linear both;}',
    '@keyframes shFall{0%{opacity:1;transform:translateY(0) rotate(0);}100%{opacity:1;transform:translateY(112vh) rotate(var(--rot));}}',
    '.shrow{display:flex;align-items:center;gap:10px;background:var(--bg-surface);border:1.5px solid var(--line);border-radius:14px;padding:10px 12px;margin-top:8px;}',
    '.shrow .b{flex:1;height:10px;border-radius:6px;background:rgba(255,255,255,.1);overflow:hidden;}.shrow .b i{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,#6be3ff,#4f8bff);}'
  ].join('\n');
  function injectCss(){
    if(document.getElementById(CSS_ID)) return;
    var st = document.createElement('style'); st.id = CSS_ID; st.textContent = CSS; document.head.appendChild(st);
  }
  function confetti(){        // 見た目だけの乱数(Math.random)。勝敗には無関係
    var old = document.getElementById('shfx'); if(old) old.remove();
    var cols = ['#6be3ff', '#4f8bff', '#ffffff', '#ffd24a', '#ff5e8a', '#9dff7a'], h = '', d = document.createElement('div');
    for(var c = 0; c < 56; c++) h += '<span class="cf" style="left:' + (Math.random() * 100).toFixed(1) + '%;background:' + cols[c % cols.length] + ';--rot:' + (Math.random() * 1440 - 720).toFixed(0) + 'deg;animation-delay:' + (Math.random() * 1.4).toFixed(2) + 's;animation-duration:' + (2 + Math.random()).toFixed(2) + 's"></span>';
    d.id = 'shfx'; d.className = 'shfx'; d.innerHTML = h; document.body.appendChild(d);
    setTimeout(function(){ if(d.parentNode) d.remove(); }, 4000);
  }

  function render(root, ctx){
    injectCss();
    var v = ctx.view, me = ctx.me, L = ctx.local;
    var q = function(id){ return document.getElementById(id); };
    function btn(id, label, cls){ return '<button class="' + (cls || 'btn-primary') + '" id="' + id + '">' + label + '</button>'; }
    function bars(counts){
      var mx = Math.max.apply(null, v.part.map(function(id){ return counts[id] || 0; }).concat([10]));
      return v.part.map(function(id){
        var c = counts[id] || 0;
        return '<div class="shbar">' + ctx.chip(id) + '<div class="b"><i id="sb_' + id + '" style="width:' + (c / mx * 100).toFixed(1) + '%"></i></div><span class="k" id="sk_' + id + '">' + c + '</span></div>';
      }).join('');
    }
    if(v.phase !== 'play'){ SH.on = false; SH.cb = null; L.built = null; }

    /* ---- 設定 ---- */
    if(v.phase === 'setup'){
      var seg = function(n){
        var on = v.secs === n;
        return '<button id="sg' + n + '" ' + (ctx.isHost ? '' : 'disabled ') + 'style="flex:1;padding:16px 0;border-radius:12px;border:2px solid ' + (on ? 'var(--accent)' : 'var(--line)') + ';background:' + (on ? 'rgba(79,139,255,.16)' : 'var(--bg-surface)') + ';color:' + (on ? 'var(--accent)' : 'var(--text)') + ';font-weight:900;font-size:18px">' + n + '秒</button>';
      };
      root.innerHTML = '<div class="eyebrow">HIGH-SPEED SHAKE</div><div class="card-ui"><div class="big-text" style="font-size:24px">高速シェイク</div>' +
        '<div class="sub-text">制限時間のあいだ、スマホを振りまくる。回数が一番多い人の勝ち。最下位が飲む。</div></div>' +
        '<div class="section-label">制限時間</div><div style="display:flex;gap:8px">' + SECS.map(seg).join('') + '</div>' +
        '<div class="spacer"></div><div class="bottombar">' + (ctx.isHost ? btn('sStart', '始める') : '<div class="sub-text" style="text-align:center">ホストが始めるのを待っています…</div>') + '</div>';
      SECS.forEach(function(n){ if(q('sg' + n)) q('sg' + n).onclick = function(){ ctx.send({ t: 'setSecs', v: n }); }; });
      if(q('sStart')) q('sStart').onclick = function(){ askMotion(); ctx.send({ t: 'start' }); };
      return;
    }
    if(!v.inPart && v.phase !== 'result'){
      root.innerHTML = '<div class="card-ui"><div class="big-text">今回は観戦中</div></div>';
      return;
    }

    /* ---- 準備(全員が「準備OK」で開始) ---- */
    if(v.phase === 'ready'){
      var chips = v.part.map(function(id){ return '<div style="display:flex;align-items:center;gap:6px;margin:4px 0">' + ctx.chip(id) + '<span>' + (v.ready[id] ? '✅' : '…') + '</span></div>'; }).join('');
      root.innerHTML = '<div class="shz"><div class="shph">📱</div><div>' + chips + '</div></div>' +
        '<div class="bottombar">' + (v.myReady ? '' : btn('sReady', '準備OK')) + (ctx.isHost ? btn('sGo', 'このまま始める', 'btn-ghost') : '') + '</div>';
      if(q('sReady')) q('sReady').onclick = function(){ askMotion(); ctx.send({ t: 'ready' }); ctx.tone(660, 0.08, 'triangle', 0.1); };
      if(q('sGo')) q('sGo').onclick = function(){ askMotion(); ctx.send({ t: 'go' }); };
      return;
    }

    /* ---- カウントダウン(3秒) ---- */
    if(v.phase === 'count'){
      var rk = 'count:' + v.round;
      if(L.ckey !== rk){ L.ckey = rk; L.t0 = Date.now(); L.played = false; L.sent = false; }
      var el = (Date.now() - L.t0) / 1000;
      var A = function(name, dur, ease, delay){ return name + ' ' + dur + 's ' + ease + ' ' + (delay - el).toFixed(2) + 's 1 both'; };
      root.innerHTML = '<div class="shz"><div class="shph">📱</div><div class="shcd">' + [3, 2, 1].map(function(n, i){ return '<b style="animation:' + A('shNum', 0.95, 'ease-out', 0.2 + i) + '">' + n + '</b>'; }).join('') + '</div></div>';
      if(!L.played){
        L.played = true;
        [0.2, 1.2, 2.2].forEach(function(t, i){ setTimeout(function(){ ctx.tone(440 + 60 * i, 0.12, 'triangle', 0.14); }, t * 1000); });
      }
      if(ctx.isHost) ctx.every(function(){ if(!L.sent && (Date.now() - L.t0) / 1000 >= 3.2){ L.sent = true; ctx.send({ t: 'countDone' }); } }, 250);
      return;
    }

    /* ---- 本番: DOM は1回だけ作り、他の人の進み具合だけ差し替える ---- */
    if(v.phase === 'play'){
      var key = 'play:' + v.round;
      // ホストの締め切りタイマー(再描画のたびに ctx.every が止まるので、毎回つけ直す)。全員の最後の回数が届くよう、制限時間の0.9秒後に締め切る
      var hostTimer = function(){
        if(ctx.isHost) ctx.every(function(){ if(!L.sentUp && Date.now() - L.playT0 >= v.secs * 1000 + 900){ L.sentUp = true; ctx.send({ t: 'timeUp' }); } }, 200);
      };
      if(L.built === key && q('shn')){
        hostTimer();
        v.part.forEach(function(id){
          if(id === me) return;
          var c = v.count[id] || 0, mx = Math.max.apply(null, v.part.map(function(x){ return (x === me ? L.n : v.count[x]) || 0; }).concat([10]));
          var b = q('sb_' + id), k = q('sk_' + id); if(b) b.style.width = (c / mx * 100).toFixed(1) + '%'; if(k) k.textContent = c;
        });
        return;
      }
      L.built = key; L.playT0 = Date.now(); L.sentUp = false; L.n = 0; L.sentN = 0; L.lastSend = 0; L.timer = 0; L.over = false;
      var manual = !SH.seen, secs = v.secs;
      root.innerHTML = '<div class="shgo">振れ!</div><div style="display:flex;flex-direction:column;gap:5px;flex:0 0 auto">' + bars(v.count) + '</div>' +
        '<div class="shz"><div class="shph go" id="shph">📱</div><div class="shn" id="shn">0</div><div class="shtime"><i id="shtime"></i></div>' +
        (manual ? '<button class="btn-primary" id="shTap" style="width:min(86vw,420px);min-height:84px;font-size:22px;touch-action:manipulation">📳 センサーなし: ここを連打</button>' : '') + '</div>';
      ctx.tone(880, 0.15, 'triangle', 0.16); if(navigator.vibrate) try{ navigator.vibrate(40); }catch(e){}
      var t0 = Date.now();
      function flush(){ L.timer = 0; if(L.n > L.sentN){ L.sentN = L.n; L.lastSend = Date.now(); ctx.send({ t: 'prog', n: L.n }); } }
      function hit(){
        if(L.over) return;
        L.n++;
        var sn = q('shn'), sk = q('sk_' + me), sb = q('sb_' + me);
        if(sn) sn.textContent = L.n; if(sk) sk.textContent = L.n; if(sb) sb.style.width = '100%';
        if(Date.now() - L.lastSend >= 100) flush(); else if(!L.timer) L.timer = setTimeout(flush, 100);
        if(L.n % 5 === 0) ctx.tone(300 + Math.min(L.n, 120) * 6, 0.04, 'square', 0.04);
      }
      SH.n = 0; SH.armed = true; SH.last = 0; SH.cb = hit; SH.on = true;
      if(manual && q('shTap')) q('shTap').addEventListener('pointerdown', function(e){ e.preventDefault(); hit(); });
      // 制限時間(この端末で本番の画面になった瞬間から測る)。終わったら最後の回数を送る
      var tm = setInterval(function(){
        var p = (Date.now() - t0) / (secs * 1000), bar = q('shtime');
        if(bar) bar.style.width = Math.max(0, (1 - p) * 100).toFixed(1) + '%';
        if(p >= 1){
          clearInterval(tm); L.over = true; SH.on = false; SH.cb = null;
          if(L.timer){ clearTimeout(L.timer); L.timer = 0; }
          L.sentN = -1; flush();
          var ph = q('shph'); if(ph) ph.classList.remove('go');
          ctx.tone(300, 0.3, 'sawtooth', 0.12); if(navigator.vibrate) try{ navigator.vibrate(200); }catch(e){}
        }
      }, 50);
      hostTimer();
      return;
    }

    /* ---- 結果 ---- */
    var order = v.part.slice().sort(function(a, b){ return (v.count[b] || 0) - (v.count[a] || 0); });
    var mxr = Math.max.apply(null, order.map(function(id){ return v.count[id] || 0; }).concat([1]));
    var rows = order.map(function(id){
      var w = v.winners.indexOf(id) >= 0, lo = v.losers.indexOf(id) >= 0;
      return '<div class="shrow" style="border-color:' + (w ? 'var(--gold)' : lo ? 'var(--danger)' : 'var(--line)') + '">' + ctx.chip(id) + '<div class="b"><i style="width:' + ((v.count[id] || 0) / mxr * 100).toFixed(1) + '%"></i></div>' +
        '<span style="font-weight:900;min-width:36px;text-align:right">' + (v.count[id] || 0) + '</span><span style="font-size:16px">' + (w ? '👑' : lo ? '🍺' : '') + '</span></div>';
    }).join('');
    var head = v.winners.length ? '<div style="font-size:46px;line-height:1">👑</div><div style="margin-top:6px">' + v.winners.map(function(id){ return ctx.chip(id); }).join(' ') + '</div><div class="big-text" style="font-size:22px;margin-top:6px">' + (v.winners.indexOf(me) >= 0 ? 'あなたの勝ち!' : '勝ち!') + '</div>' : '<div class="big-text">引き分け</div>';
    root.innerHTML = '<div style="text-align:center;margin-top:10px">' + head + '</div>' + rows +
      '<div class="spacer"></div><div class="bottombar">' + (ctx.isHost ? btn('sAgain', 'もう一回') + btn('sSetup', '設定へ', 'btn-ghost') : '') + '</div>';
    if(q('sAgain')) q('sAgain').onclick = function(){ askMotion(); ctx.send({ t: 'start' }); };
    if(q('sSetup')) q('sSetup').onclick = function(){ ctx.send({ t: 'resetup' }); };
    var rkey = 'res:' + v.round;
    if(L.rkey2 !== rkey){
      L.rkey2 = rkey;
      if(v.winners.indexOf(me) >= 0){ confetti(); [660, 880, 1175, 1568].forEach(function(f, i){ setTimeout(function(){ ctx.tone(f, 0.16, 'triangle', 0.14); }, i * 120); }); if(navigator.vibrate) try{ navigator.vibrate([60, 40, 60, 40, 120]); }catch(e){} }
      else ctx.tone(180, 0.3, 'sawtooth', 0.1);
    }
  }

  // 開発中モード用のCPU(動作確認専用)。「準備OK」を押し、本番中は見えている回数に、ランダムな回数ぶん足す
  function bot(v, me, rnd){
    if(v.phase === 'ready' && v.inPart && !v.myReady) return { t: 'ready' };
    if(v.phase === 'play' && v.inPart && v.count) return { t: 'prog', n: (v.count[me] || 0) + 1 + rnd(6) };
    return null;
  }

  NO.register({
    id: 'shake', emoji: '📳', title: '高速シェイク', accent: '#4F8BFF', accentInk: '#fff', min: 2, max: 10, hidden: true,
    reveal: function(hostName, names){
      var norm = function(s){ return String(s == null ? '' : s).normalize('NFKC').trim().replace(/[0-9]+$/, ''); };
      var ok = function(s){ var n = norm(s); return n === 'チンコ' || n === 'ちんこ'; };
      return [hostName].concat(names || []).some(ok);       // ホストか参加者のだれか1人でも
    },
    tagline: 'スマホを制限時間(10秒)のあいだ振りまくる。回数が一番多い人の勝ち。',
    rules: [
      '全員が「準備OK」を押すと、<b>3秒のカウントダウン</b>のあとスタート。',
      '制限時間(初期値10秒)のあいだ、<b>スマホを持ってひたすら振る</b>。加速度センサーで振った回数を数える(iPhoneはセンサーの許可が必要)。',
      '<b>回数が一番多い人の勝ち。一番少ない人(最下位)が飲む</b>(同数なら全員)。みんなの回数は画面の上にリアルタイムで見える。',
      'センサーが使えない端末では、画面のボタンのタップ回数で代用する(振る動作とは比べられない)。落とさないように、ストラップや壁・人に注意!'
    ],
    game: game, bot: bot, render: render
  });
})();
