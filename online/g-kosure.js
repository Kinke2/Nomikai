/*
  コスれ!(オンライン版・隠しゲーム)
  画面の真ん中に棒が出る。それをひたすら指で擦って(上下に往復)、いちばん先に N 回(初期値 50 回)擦った人の勝ち。スピード勝負。
  いちばん擦れていない人(最下位)が飲む。みんなの進み具合は画面の上にリアルタイムで見える。
  隠しゲーム: ホストの名前が「チンコ」「ちんこ」のときだけロビーに出る(開発中モード(?dev=1)では常に出る)。出し分けは online-core.js 側。
  数え方: 指が一方向に一定距離(約 30px)動いて、向きが反転するたびに 1 回。左右の動きは数えない。各自の端末が数えて、回数をホストに送る。
  公平性: アプリは回数をそのまま集計し、「いちばん先に目標回数に達した人」を勝者にするだけ(補正・加工・ハンデは一切なし)。
          勝者は、ホストに「目標回数に達した」という知らせが届いた順(先着)で決まる。回線の遅れの差は補正していない(ホスト自身の遅れがゼロな分、わずかに有利)。
          回数は各自の端末が数えて申告する方式のため、改造すればごまかせる(飲み会で遊ぶ前提。研究データには使わないこと)。
          乱数は使わない。開発中モードのCPUだけが、見えている進み具合を元にランダムな回数ぶん進める(動作確認専用)。
  参考文献:
    [1] Button mashing(連打ゲームの一般的な形): https://en.wikipedia.org/wiki/Button_mashing
    [2] MDN Pointer events(指・マウス共通の入力イベント): https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
    [3] MDN Web Audio API(効果音の合成): https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
    [4] 通信・隠しゲームの出し分けは online-core.js の冒頭を参照
  (オンライン ロビーに登録されるゲーム。通信・部屋・QRは online-core.js が担当)
*/
(function(){
  'use strict';
  var NO = window.NomikaiOnline;

  /* PURE-BEGIN */
  var GOALS = [30, 50, 100];
  function activeIds(G){ return G.part.filter(function(id){ return !G.offline[id]; }); }
  function inPart(G, pid){ return G.part.indexOf(pid) >= 0; }
  function syncSetup(G){ G.part = G.players.map(function(p){ return p.id; }).filter(function(id){ return !G.offline[id]; }); }
  function newState(players, rnd){
    var G = { players: players, offline: {}, phase: 'setup', goal: 50, round: 0, part: [], count: {}, winner: null };
    syncSetup(G); return G;
  }
  function startRace(G){
    syncSetup(G); G.round++; G.phase = 'count'; G.count = {}; G.winner = null;
    G.part.forEach(function(id){ G.count[id] = 0; });
  }
  // 最下位(同点なら全員)。全員同じ回数なら飲む人なし
  function losers(G){
    var ids = G.part, vals = ids.map(function(id){ return G.count[id] || 0; });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if(mn === mx) return [];
    return ids.filter(function(id){ return (G.count[id] || 0) === mn; });
  }
  function act(G, pid, a, rnd){
    if(!a || typeof a !== 'object') return { error: '操作が不正です' };
    var host = pid === 'p0';
    switch(a.t){
      case 'setGoal':
        if(!host || G.phase !== 'setup' || GOALS.indexOf(a.v) < 0) return { error: '今は変えられません' };
        G.goal = a.v; return { ok: true };
      case 'start':
        if(!host || (G.phase !== 'setup' && G.phase !== 'result')) return { error: 'ホストだけが始められます' };
        syncSetup(G); if(G.part.length < 2) return { error: '2人以上必要です' };
        startRace(G); return { ok: true };
      case 'countDone':
        if(!host || G.phase !== 'count') return { error: '今は進められません' };
        G.phase = 'play'; return { ok: true };
      case 'prog':      // 自分の回数の申告(増える方向だけ受け付ける)
        if(G.phase !== 'play' || !inPart(G, pid)) return { error: '今は送れません' };
        if(typeof a.n !== 'number' || a.n % 1 !== 0 || a.n < 0) return { error: '回数が不正です' };
        var n = Math.min(a.n, G.goal);
        if(n <= (G.count[pid] || 0)) return { ok: true };
        G.count[pid] = n;
        if(n >= G.goal && G.winner == null){ G.winner = pid; G.phase = 'result'; }       // 先に目標回数に達した人(ホストへの到着順)
        return { ok: true };
      case 'resetup':
        if(!host || G.phase !== 'result') return { error: '今は戻れません' };
        G.phase = 'setup'; syncSetup(G); return { ok: true };
    }
    return { error: '未対応の操作' };
  }
  function force(G){
    if(G.phase === 'count') G.phase = 'play';
    else if(G.phase === 'play'){
      var best = -1, who = null, tie = false;
      G.part.forEach(function(id){ var c = G.count[id] || 0; if(c > best){ best = c; who = id; tie = false; } else if(c === best) tie = true; });
      G.winner = tie || best <= 0 ? null : who; G.phase = 'result';
    }
  }
  function waiting(G){ return []; }
  function sync(G){ if(G.phase === 'setup') syncSetup(G); }
  function view(G, pid){
    var v = { phase: G.phase, goal: G.goal, round: G.round, part: G.part, inPart: inPart(G, pid) };
    if(G.phase !== 'setup'){ v.count = G.count; }       // 進み具合は全員に見せる(レース表示)
    if(G.phase === 'result'){ v.winner = G.winner; v.losers = losers(G); }
    return v;
  }
  var game = { newState: newState, act: act, view: view, waiting: waiting, force: force, sync: sync };
  /* PURE-END */

  var CSS_ID = 'kosure-css';
  var CSS = [
    '.kz{position:relative;flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;}',
    '.krace{display:flex;flex-direction:column;gap:5px;margin:2px 0 4px;flex:0 0 auto;}',
    '.kr{display:flex;align-items:center;gap:8px;}.kr .chip{flex:0 0 74px;min-height:22px;font-size:11px;padding:1px 6px;}',
    '.kb{flex:1;height:10px;border-radius:6px;background:rgba(255,255,255,.1);overflow:hidden;}.kb i{display:block;height:100%;width:0;border-radius:6px;background:linear-gradient(90deg,#ffb347,#ff5e4d);transition:width .12s linear;}',
    '.kr.me .kb{height:14px;}.kn{flex:0 0 40px;text-align:right;font-weight:900;font-size:12px;font-variant-numeric:tabular-nums;color:var(--text-muted);}',
    '.kstick{position:relative;width:min(22vw,84px);height:min(100%,62vh);max-height:440px;border-radius:999px;background:linear-gradient(90deg,#6b7280 0%,#e5e7eb 35%,#9ca3af 60%,#4b5563 100%);box-shadow:0 10px 34px rgba(0,0,0,.55);flex:0 0 auto;}',
    '.kstick .kheat{position:absolute;inset:0;border-radius:999px;background:linear-gradient(90deg,#b91c1c,#fb923c 40%,#ef4444 70%,#7f1d1d);opacity:0;}',
    '.kstick .kcap{position:absolute;left:-6%;right:-6%;top:-3%;height:11%;border-radius:999px;background:linear-gradient(90deg,#374151,#d1d5db 40%,#4b5563);box-shadow:0 4px 10px rgba(0,0,0,.4);}',
    '.kstick.hit{animation:kHit .12s ease-out;}',
    '@keyframes kHit{0%{transform:translateX(-6px) scaleY(.985);}50%{transform:translateX(6px);}100%{transform:none;}}',
    '.kcnt{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;pointer-events:none;font-weight:900;font-size:min(34vw,24vh);color:#fff;text-shadow:0 0 24px rgba(255,160,60,.9),0 4px 14px rgba(0,0,0,.8);font-variant-numeric:tabular-nums;}',
    '.kcnt small{font-size:.28em;color:#ffd98a;}',
    '.kcd{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;}',
    '.kcd b{position:absolute;font-size:min(50vw,32vh);font-weight:900;color:#fff;text-shadow:0 0 30px rgba(255,200,90,.9),0 6px 18px rgba(0,0,0,.7);opacity:0;}',
    '@keyframes kNum{0%{transform:scale(2.2);opacity:0;}30%{transform:scale(1);opacity:1;}85%{transform:scale(.95);opacity:1;}100%{transform:scale(.6);opacity:0;}}',
    '.kgo{position:absolute;left:0;right:0;top:18%;text-align:center;font-weight:900;font-size:min(16vw,64px);color:#ffd98a;pointer-events:none;text-shadow:0 4px 18px rgba(0,0,0,.8);opacity:0;animation:kGo .9s ease-out both;}',
    '@keyframes kGo{0%{transform:scale(.4);opacity:0;}25%{transform:scale(1.15);opacity:1;}100%{transform:scale(1);opacity:0;}}',
    '.krow{display:flex;align-items:center;gap:10px;background:var(--bg-surface);border:1.5px solid var(--line);border-radius:14px;padding:10px 12px;margin-top:8px;}'
  ].join('\n');
  function injectCss(){
    if(document.getElementById(CSS_ID)) return;
    var st = document.createElement('style'); st.id = CSS_ID; st.textContent = CSS; document.head.appendChild(st);
  }

  function render(root, ctx){
    injectCss();
    var v = ctx.view, esc = ctx.esc, me = ctx.me, L = ctx.local;
    var q = function(id){ return document.getElementById(id); };
    function btn(id, label, cls){ return '<button class="' + (cls || 'btn-primary') + '" id="' + id + '">' + label + '</button>'; }
    function raceRows(counts){
      return v.part.map(function(id){
        var c = counts[id] || 0;
        return '<div class="kr' + (id === me ? ' me' : '') + '">' + ctx.chip(id) + '<div class="kb"><i id="kb_' + id + '" style="width:' + Math.min(100, c / v.goal * 100).toFixed(1) + '%"></i></div><span class="kn" id="kn_' + id + '">' + c + '</span></div>';
      }).join('');
    }

    if(v.phase !== 'play') L.built = null;

    /* ---- 設定 ---- */
    if(v.phase === 'setup'){
      var seg = function(n){
        var on = v.goal === n;
        return '<button id="kg' + n + '" ' + (ctx.isHost ? '' : 'disabled ') + 'style="flex:1;padding:16px 0;border-radius:12px;border:2px solid ' + (on ? 'var(--accent)' : 'var(--line)') + ';background:' + (on ? 'rgba(229,72,77,.14)' : 'var(--bg-surface)') + ';color:' + (on ? 'var(--accent)' : 'var(--text)') + ';font-weight:900;font-size:18px">' + n + '回</button>';
      };
      root.innerHTML = '<div class="eyebrow">KOSURE</div><div class="card-ui"><div class="big-text" style="font-size:24px">コスれ!</div>' +
        '<div class="sub-text">棒を擦って、先に目標回数に達した人の勝ち。最下位が飲む。</div></div>' +
        '<div class="section-label">目標回数</div><div style="display:flex;gap:8px">' + GOALS.map(seg).join('') + '</div>' +
        '<div class="spacer"></div><div class="bottombar">' + (ctx.isHost ? btn('kStart', '始める') : '<div class="sub-text" style="text-align:center">ホストが始めるのを待っています…</div>') + '</div>';
      GOALS.forEach(function(n){ if(q('kg' + n)) q('kg' + n).onclick = function(){ ctx.send({ t: 'setGoal', v: n }); }; });
      if(q('kStart')) q('kStart').onclick = function(){ ctx.send({ t: 'start' }); };
      return;
    }
    if(!v.inPart && v.phase !== 'result'){
      root.innerHTML = '<div class="card-ui"><div class="big-text">今回は観戦中</div></div>';
      return;
    }

    /* ---- カウントダウン(3秒) ---- */
    if(v.phase === 'count'){
      var rk = 'count:' + v.round;
      if(L.ckey !== rk){ L.ckey = rk; L.t0 = Date.now(); L.played = false; L.sent = false; }
      var el = (Date.now() - L.t0) / 1000;
      var A = function(name, dur, ease, delay){ return name + ' ' + dur + 's ' + ease + ' ' + (delay - el).toFixed(2) + 's 1 both'; };
      root.innerHTML = '<div class="krace">' + raceRows(v.count) + '</div><div class="kz"><div class="kstick"><div class="kheat"></div><div class="kcap"></div></div>' +
        '<div class="kcd">' + [3, 2, 1].map(function(n, i){ return '<b style="animation:' + A('kNum', 0.95, 'ease-out', 0.2 + i) + '">' + n + '</b>'; }).join('') + '</div></div>';
      if(!L.played){
        L.played = true;
        [0.2, 1.2, 2.2].forEach(function(t, i){ setTimeout(function(){ ctx.tone(440 + 60 * i, 0.12, 'triangle', 0.14); }, t * 1000); });
      }
      if(ctx.isHost) ctx.every(function(){ if(!L.sent && (Date.now() - L.t0) / 1000 >= 3.2){ L.sent = true; ctx.send({ t: 'countDone' }); } }, 250);
      return;
    }

    /* ---- 本番: 擦る。DOM は1回だけ作り、進み具合の更新だけを差し替える(再描画で指の操作が途切れないように) ---- */
    if(v.phase === 'play'){
      var key = 'play:' + v.round;
      if(L.built === key && q('kz')){
        v.part.forEach(function(id){
          var c = v.count[id] || 0, b = q('kb_' + id), n = q('kn_' + id);
          if(id === me) return;           // 自分の分は、自分の端末の数え方をそのまま表示する(遅れずに動かすため)
          if(b) b.style.width = Math.min(100, c / v.goal * 100).toFixed(1) + '%'; if(n) n.textContent = c;
        });
        return;
      }
      L.built = key; L.n = 0; L.sentN = 0; L.lastSend = 0; L.timer = 0;
      root.innerHTML = '<div class="kgo">コスれ!</div><div class="krace">' + raceRows(v.count) + '</div>' +
        '<div class="kz" id="kz"><div class="kstick" id="kstick"><div class="kheat" id="kheat"></div><div class="kcap"></div></div><div class="kcnt" id="kcnt">0<small> / ' + v.goal + '</small></div></div>';
      ctx.tone(880, 0.15, 'triangle', 0.16); if(navigator.vibrate) try{ navigator.vibrate(40); }catch(e){}
      var zone = q('kz'), stick = q('kstick'), goal = v.goal;
      function flush(){ L.timer = 0; if(L.n > L.sentN){ L.sentN = L.n; L.lastSend = Date.now(); ctx.send({ t: 'prog', n: L.n }); } }
      function stroke(){
        if(L.n >= goal) return;
        L.n++;
        var kn = q('kn_' + me), kb = q('kb_' + me), kc = q('kcnt'), kh = q('kheat');
        if(kn) kn.textContent = L.n; if(kb) kb.style.width = Math.min(100, L.n / goal * 100).toFixed(1) + '%';
        if(kc) kc.innerHTML = L.n + '<small> / ' + goal + '</small>';
        if(kh) kh.style.opacity = (L.n / goal * 0.85).toFixed(2);
        stick.classList.remove('hit'); void stick.offsetWidth; stick.classList.add('hit');
        ctx.tone(260 + 520 * L.n / goal, 0.04, 'square', 0.05); if(navigator.vibrate) try{ navigator.vibrate(6); }catch(e){}
        if(L.n >= goal || Date.now() - L.lastSend >= 90) flush();
        else if(!L.timer) L.timer = setTimeout(flush, 90);
      }
      // 上下の往復を数える: 一方向に thr だけ動いたあと、反対向きに thr 動くと 1 回(動き始めの1回目は thr 動いた時点で数える)
      var thr = 30, down = false, ext = 0, dir = 0;
      zone.addEventListener('pointerdown', function(e){ down = true; ext = e.clientY; dir = 0; try{ zone.setPointerCapture(e.pointerId); }catch(x){} e.preventDefault(); });
      zone.addEventListener('pointermove', function(e){
        if(!down) return; var y = e.clientY;
        if(dir === 0){ if(Math.abs(y - ext) >= thr){ dir = y > ext ? 1 : -1; ext = y; stroke(); } return; }
        if(dir === 1){ if(y > ext) ext = y; else if(ext - y >= thr){ dir = -1; ext = y; stroke(); } }
        else { if(y < ext) ext = y; else if(y - ext >= thr){ dir = 1; ext = y; stroke(); } }
      });
      ['pointerup', 'pointercancel'].forEach(function(n){ zone.addEventListener(n, function(){ down = false; dir = 0; }); });
      zone.addEventListener('contextmenu', function(e){ e.preventDefault(); });
      return;
    }

    /* ---- 結果 ---- */
    var order = v.part.slice().sort(function(a, b){ return (v.count[b] || 0) - (v.count[a] || 0); });
    var winTxt = v.winner ? '<div style="font-size:46px;line-height:1">👑</div><div style="margin-top:6px">' + ctx.chip(v.winner) + '</div><div class="big-text" style="font-size:22px;margin-top:6px">' + (v.winner === me ? 'あなたの勝ち!' : '勝ち!') + '</div>' : '<div class="big-text">決着なし</div>';
    var rows = order.map(function(id){
      var lo = v.losers.indexOf(id) >= 0;
      return '<div class="krow" style="border-color:' + (id === v.winner ? 'var(--gold)' : lo ? 'var(--danger)' : 'var(--line)') + '">' + ctx.chip(id) +
        '<div class="kb" style="margin:0 4px"><i style="width:' + Math.min(100, (v.count[id] || 0) / v.goal * 100).toFixed(1) + '%;transition:none"></i></div>' +
        '<span class="kn" style="flex:0 0 auto">' + (v.count[id] || 0) + '</span><span style="font-size:16px">' + (id === v.winner ? '👑' : lo ? '🍺' : '') + '</span></div>';
    }).join('');
    root.innerHTML = '<div style="text-align:center;margin-top:10px">' + winTxt + '</div>' + rows +
      '<div class="spacer"></div><div class="bottombar">' + (ctx.isHost ? btn('kAgain', 'もう一回') + btn('kSetup', '設定へ', 'btn-ghost') : '') + '</div>';
    if(q('kAgain')) q('kAgain').onclick = function(){ ctx.send({ t: 'start' }); };
    if(q('kSetup')) q('kSetup').onclick = function(){ ctx.send({ t: 'resetup' }); };
    var rkey = 'res:' + v.round;
    if(L.rkey2 !== rkey){
      L.rkey2 = rkey;
      if(v.winner === me){ [660, 880, 1175, 1568].forEach(function(f, i){ setTimeout(function(){ ctx.tone(f, 0.16, 'triangle', 0.14); }, i * 110); }); if(navigator.vibrate) try{ navigator.vibrate([60, 40, 60, 40, 120]); }catch(e){} }
      else ctx.tone(180, 0.3, 'sawtooth', 0.1);
    }
  }

  // 開発中モード用のCPU。見えている進み具合から、ランダムな回数ぶん進める(動作確認専用)
  function bot(v, me, rnd){
    if(v.phase === 'play' && v.inPart && v.count) return { t: 'prog', n: (v.count[me] || 0) + 1 + rnd(3) };
    return null;
  }

  NO.register({
    id: 'kosure', emoji: '🔥', title: 'コスれ!', accent: '#FF5E4D', accentInk: '#fff', min: 2, max: 10, hidden: true,
    reveal: function(hostName){ var n = String(hostName == null ? '' : hostName).normalize('NFKC').trim(); return n === 'チンコ' || n === 'ちんこ'; },
    tagline: '画面の棒をひたすら擦って、先に目標回数(50回)に達した人の勝ち。スピード勝負。',
    rules: [
      '画面の真ん中に<b>棒</b>が出る。<b>指で上下に擦る</b>(往復)と回数が増える。',
      '3・2・1のあとスタート。<b>先に目標回数(初期値50回)に達した人の勝ち</b>。みんなの進み具合は画面の上にリアルタイムで見える。',
      '<b>いちばん回数の少ない人(最下位)が飲む</b>(同点なら全員)。',
      '回数は各自のスマホが数える(一方向に約30px動いて反転すると1回)。勝者は「目標回数に達した」という知らせがホストに届いた順で決まり、回線の遅れの補正はしない。'
    ],
    game: game, bot: bot, render: render
  });
})();
