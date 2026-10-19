/*
  メダル落とし 4目並べ(オンライン版・開発中)
  縦6×横7のボードに、上から赤と黄色のメダルを交互に落とす。メダルは下に積み上がる。縦・横・ななめのどれかに、自分のチームの色を4つ並べたら勝ち。
  2人ならそのまま1対1。3人以上は「赤チーム」と「黄チーム」に分かれ、自分のチームの番なら、チームの誰でも(先に押した人が)落とせる。相談して決めよう。
  負けたチーム全員が飲む。引き分け(ボードが全部うまる)なら誰も飲まない。
  公平性: チーム分けと「どちらのチームが先攻か」は、crypto.getRandomValues の棄却サンプリング(randInt)+ Fisher–Yates のシャッフルで決める(補正なし)。
          アプリは「落とした場所に積む」「4つ並んだかを判定する」だけで、勝敗や手に補正は一切しない。先攻が有利なゲームだが、そのまま(先攻は毎回ランダム)。
          開発中モードのCPUは、まだ空いている列からランダムに選ぶだけ(動作確認専用。強さや研究データとしては使わないこと)。
  参考文献:
    [1] Connect Four(ルールと歴史): https://en.wikipedia.org/wiki/Connect_Four
    [2] Fisher–Yates shuffle(偏りのないシャッフル): https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
    [3] MDN Web Audio API(効果音の合成): https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
    [4] 通信・乱数・参考文献一覧は online-core.js の冒頭を参照
  (オンライン ロビーに登録されるゲーム。通信・部屋・QRは online-core.js が担当)
*/
(function(){
  'use strict';
  var NO = window.NomikaiOnline;

  /* PURE-BEGIN */
  var ROWS = 6, COLS = 7;
  function activeIds(G){ return G.part.filter(function(id){ return !G.offline[id]; }); }
  function inPart(G, pid){ return G.part.indexOf(pid) >= 0; }
  function syncSetup(G){ G.part = G.players.map(function(p){ return p.id; }).filter(function(id){ return !G.offline[id]; }); }
  function emptyBoard(){ var b = []; for(var r = 0; r < ROWS; r++){ var row = []; for(var c = 0; c < COLS; c++) row.push(-1); b.push(row); } return b; }   // -1=空き 0=赤 1=黄
  function shuffle(arr, rnd){                       // Fisher–Yates
    var a = arr.slice();
    for(var i = a.length - 1; i > 0; i--){ var j = rnd(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function newState(players, rnd){
    var G = { players: players, offline: {}, phase: 'setup', round: 0, part: [], teams: {}, turn: 0, board: emptyBoard(), moves: 0, last: null, winner: null, winLine: [], draw: false };
    syncSetup(G); return G;
  }
  // (r,c) に置いた t 色から、4つ以上つながっている場所を返す(なければ空)
  function findLine(board, r, c, t){
    var dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for(var d = 0; d < dirs.length; d++){
      var dr = dirs[d][0], dc = dirs[d][1], cells = [[r, c]], k;
      for(k = 1; ; k++){ var rr = r + dr * k, cc = c + dc * k; if(rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || board[rr][cc] !== t) break; cells.push([rr, cc]); }
      for(k = 1; ; k++){ var r2 = r - dr * k, c2 = c - dc * k; if(r2 < 0 || r2 >= ROWS || c2 < 0 || c2 >= COLS || board[r2][c2] !== t) break; cells.push([r2, c2]); }
      if(cells.length >= 4) return cells;
    }
    return [];
  }
  function act(G, pid, a, rnd){
    if(!a || typeof a !== 'object') return { error: '操作が不正です' };
    var host = pid === 'p0';
    switch(a.t){
      case 'start':
        if(!host || (G.phase !== 'setup' && G.phase !== 'result')) return { error: 'ホストだけが始められます' };
        syncSetup(G); if(G.part.length < 2) return { error: '2人以上必要です' };
        G.teams = {}; shuffle(G.part, rnd).forEach(function(id, i){ G.teams[id] = i % 2; });      // ランダムにチーム分け(交互に振り分け)
        G.turn = rnd(2);                                                                          // 先攻もランダム
        G.board = emptyBoard(); G.moves = 0; G.last = null; G.winner = null; G.winLine = []; G.draw = false;
        G.round++; G.phase = 'play'; return { ok: true };
      case 'drop':
        if(G.phase !== 'play' || !inPart(G, pid)) return { error: '今は落とせません' };
        if(G.teams[pid] !== G.turn) return { error: '相手チームの番です' };
        if(typeof a.c !== 'number' || a.c % 1 !== 0 || a.c < 0 || a.c >= COLS) return { error: '列が不正です' };
        var r = -1;
        for(var i = ROWS - 1; i >= 0; i--){ if(G.board[i][a.c] === -1){ r = i; break; } }
        if(r < 0) return { error: 'その列はいっぱいです' };
        G.board[r][a.c] = G.turn; G.moves++; G.last = { r: r, c: a.c, t: G.turn, by: pid };
        var line = findLine(G.board, r, a.c, G.turn);
        if(line.length){ G.winner = G.turn; G.winLine = line; G.phase = 'result'; }
        else if(G.moves >= ROWS * COLS){ G.draw = true; G.phase = 'result'; }
        else G.turn = 1 - G.turn;
        return { ok: true };
      case 'resetup':
        if(!host || G.phase !== 'result') return { error: '今は戻れません' };
        G.phase = 'setup'; syncSetup(G); return { ok: true };
    }
    return { error: '未対応の操作' };
  }
  function force(G){ if(G.phase === 'play'){ G.draw = true; G.phase = 'result'; } }       // ホストが強制終了 = 引き分け
  function waiting(G){ return G.phase === 'play' ? activeIds(G).filter(function(id){ return G.teams[id] === G.turn; }) : []; }
  function sync(G){ if(G.phase === 'setup') syncSetup(G); }
  function view(G, pid){
    var v = { phase: G.phase, round: G.round, part: G.part, inPart: inPart(G, pid) };
    if(G.phase === 'setup') return v;
    v.teams = G.teams; v.turn = G.turn; v.board = G.board; v.moves = G.moves; v.last = G.last;
    v.myTeam = G.teams[pid] == null ? -1 : G.teams[pid]; v.myTurn = G.phase === 'play' && v.myTeam === G.turn;
    if(G.phase === 'result'){ v.winner = G.winner; v.winLine = G.winLine; v.draw = G.draw; }
    return v;
  }
  var game = { newState: newState, act: act, view: view, waiting: waiting, force: force, sync: sync };
  /* PURE-END */

  var CSS_ID = 'connect4-css';
  var CSS = [
    '.cf4{--cs:max(30px,min(calc((100vw - 28px) / 7),calc((100vh - 300px) / 7)));display:flex;flex-direction:column;align-items:center;gap:8px;flex:1 1 auto;min-height:0;}',
    '@supports(height:100dvh){.cf4{--cs:max(30px,min(calc((100vw - 28px) / 7),calc((100dvh - 300px) / 7)));}}',
    '.cfteams{display:flex;flex-direction:column;gap:6px;width:calc(var(--cs) * 7);flex:0 0 auto;}',
    '.cftm{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:12px;border:2px solid var(--line);background:var(--bg-surface);transition:border-color .2s,box-shadow .2s;}',
    '.cftm.on{box-shadow:0 0 14px 1px var(--tc);border-color:var(--tc);}',
    '.cftm.win{border-color:var(--gold);box-shadow:0 0 16px 2px rgba(255,200,60,.7);}.cftm.lose{border-color:var(--danger);opacity:.85;}',
    '.cftm .dot{flex:0 0 22px;height:22px;}.cftm .mem{display:flex;flex-wrap:wrap;gap:4px;flex:1;min-width:0;}.cftm .mem .chip{min-height:22px;font-size:11px;padding:1px 7px;}.cftm .st{flex:0 0 auto;font-size:18px;}',
    '.cfboard{position:relative;width:calc(var(--cs) * 7);height:calc(var(--cs) * 7);border-radius:16px;overflow:hidden;flex:0 0 auto;background:linear-gradient(#1f4fd8,#163aa8);box-shadow:0 10px 30px rgba(0,0,0,.55);}',
    '.cfgrid{position:absolute;inset:0;display:grid;grid-template-columns:repeat(7,1fr);grid-template-rows:repeat(7,1fr);}',
    '.cfcell{position:relative;display:flex;align-items:center;justify-content:center;}',
    '.cfhole{width:84%;height:84%;border-radius:50%;background:#0e1430;box-shadow:inset 0 3px 8px rgba(0,0,0,.7);position:relative;}',
    '.cfzone{position:absolute;left:0;right:0;top:0;height:calc(var(--cs));background:rgba(8,14,40,.55);}',
    '.cfcols{position:absolute;inset:0;display:grid;grid-template-columns:repeat(7,1fr);}.cfcols button{background:transparent;border:0;padding:0;min-width:0;-webkit-tap-highlight-color:transparent;}.cfcols button:active{background:rgba(255,255,255,.12);}',
    '.md{position:absolute;inset:7%;border-radius:50%;}',
    '.md.t0{background:radial-gradient(circle at 34% 28%,#ff9a8f 0,#e5483a 42%,#a81f16 78%,#7a120c 100%);box-shadow:0 2px 5px rgba(0,0,0,.5),inset 0 0 0 calc(var(--cs) * .035) rgba(255,255,255,.28);}',
    '.md.t1{background:radial-gradient(circle at 34% 28%,#fff1a8 0,#f5c82e 42%,#c28d08 78%,#8a6203 100%);box-shadow:0 2px 5px rgba(0,0,0,.5),inset 0 0 0 calc(var(--cs) * .035) rgba(255,255,255,.35);}',
    '.md::after{content:"★";position:absolute;inset:20%;border-radius:50%;border:calc(var(--cs) * .03) solid rgba(0,0,0,.22);box-shadow:inset 0 1px 2px rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;color:rgba(0,0,0,.28);font-size:calc(var(--cs) * .36);line-height:1;}',
    '.mdw{position:absolute;inset:0;}.mdw.drop{animation:cfDrop .55s cubic-bezier(.45,0,.9,.6) both;}',
    '@keyframes cfDrop{0%{transform:translateY(var(--from));}72%{transform:translateY(0);animation-timing-function:ease-out;}84%{transform:translateY(-14%);}100%{transform:translateY(0);}}',
    '.md.win{animation:cfWin .7s ease-in-out infinite alternate;z-index:3;}',
    '@keyframes cfWin{0%{filter:brightness(1);transform:scale(1);}100%{filter:brightness(1.5) drop-shadow(0 0 8px #fff);transform:scale(1.08);}}',
    '.cfturn{position:absolute;top:0;left:0;width:calc(var(--cs));height:calc(var(--cs));pointer-events:none;}',
    '.cfhint{text-align:center;font-weight:900;font-size:14px;color:#ffd98a;min-height:20px;flex:0 0 auto;}',
    '.cffx{position:fixed;inset:0;z-index:70;pointer-events:none;overflow:hidden;animation:cfFxOut .5s ease-in 3.3s both;}',
    '@keyframes cfFxOut{to{opacity:0;}}',
    '.cffx .cf{position:absolute;top:-4vh;width:9px;height:14px;opacity:0;animation:cfFall 2.6s linear both;}',
    '@keyframes cfFall{0%{opacity:1;transform:translateY(0) rotate(0);}100%{opacity:1;transform:translateY(112vh) rotate(var(--rot));}}'
  ].join('\n');
  function injectCss(){
    if(document.getElementById(CSS_ID)) return;
    var st = document.createElement('style'); st.id = CSS_ID; st.textContent = CSS; document.head.appendChild(st);
  }
  var TEAM = [{ name: '赤', color: '#E5483A' }, { name: '黄', color: '#F5C82E' }];
  function confetti(color){        // 見た目だけの乱数(Math.random)。勝敗には無関係
    var old = document.getElementById('cffx'); if(old) old.remove();
    var cols = [color, '#ffffff', '#ffd24a', color, '#9dff7a'], h = '', d = document.createElement('div');
    for(var c = 0; c < 50; c++) h += '<span class="cf" style="left:' + (Math.random() * 100).toFixed(1) + '%;background:' + cols[c % cols.length] + ';--rot:' + (Math.random() * 1440 - 720).toFixed(0) + 'deg;animation-delay:' + (Math.random() * 1.4).toFixed(2) + 's;animation-duration:' + (2 + Math.random()).toFixed(2) + 's"></span>';
    d.id = 'cffx'; d.className = 'cffx'; d.innerHTML = h; document.body.appendChild(d);
    setTimeout(function(){ if(d.parentNode) d.remove(); }, 4000);
  }

  function render(root, ctx){
    injectCss();
    var v = ctx.view, me = ctx.me, L = ctx.local;
    var q = function(id){ return document.getElementById(id); };
    function btn(id, label, cls){ return '<button class="' + (cls || 'btn-primary') + '" id="' + id + '">' + label + '</button>'; }

    if(v.phase === 'setup'){
      root.innerHTML = '<div class="eyebrow">CONNECT 4</div><div class="card-ui"><div class="big-text" style="font-size:22px">メダル落とし 4目並べ</div>' +
        '<div class="sub-text">赤と黄色のメダルを交互に落として、先に4つ並べたチームの勝ち。3人以上はランダムで2チームに分かれる。</div></div>' +
        '<div class="spacer"></div><div class="bottombar">' + (ctx.isHost ? btn('fStart', '始める(チーム分け)') : '<div class="sub-text" style="text-align:center">ホストが始めるのを待っています…</div>') + '</div>';
      if(q('fStart')) q('fStart').onclick = function(){ ctx.send({ t: 'start' }); };
      return;
    }
    if(!v.inPart && v.phase !== 'result'){
      root.innerHTML = '<div class="card-ui"><div class="big-text">今回は観戦中</div><div class="sub-text">途中で入り直したので、次の対戦から参加できます。</div></div>';
      return;
    }

    // 最新の1手だけ「落ちる」演出をつける(再描画されても途中から続くよう、経過時間ぶん animation-delay を負にずらす)
    var mk = v.round + ':' + v.moves;
    if(L.mk !== mk){ L.mk = mk; L.mt0 = Date.now(); L.mplayed = false; }
    var el = (Date.now() - L.mt0) / 1000;
    var winSet = {}; (v.winLine || []).forEach(function(p){ winSet[p[0] + ',' + p[1]] = 1; });
    var cells = '';
    for(var r = 0; r < ROWS; r++){
      for(var c = 0; c < COLS; c++){
        var t = v.board[r][c], disc = '';
        if(t >= 0){
          var isLast = v.last && v.last.r === r && v.last.c === c, w = winSet[r + ',' + c];
          disc = '<div class="mdw' + (isLast ? ' drop' : '') + '"' + (isLast ? ' style="--from:' + (-(r + 1) * 100) + '%;animation-delay:' + (-el).toFixed(2) + 's"' : '') + '>' +
            '<div class="md t' + t + (w ? ' win' : '') + '"' + (w ? ' style="animation-delay:' + (0.65 - el).toFixed(2) + 's"' : '') + '></div></div>';
        }
        cells += '<div class="cfcell"><div class="cfhole">' + disc + '</div></div>';
      }
    }
    // 1行目は「落とす場所」。盤面は2行目から(グリッドは7行 = 落とし口1 + 盤面6)
    var grid = '<div class="cfgrid">' + new Array(COLS + 1).join('<div class="cfcell"></div>') + cells + '</div>';
    var cols = '';
    for(var cc = 0; cc < COLS; cc++) cols += '<button data-c="' + cc + '" aria-label="' + (cc + 1) + '列"></button>';
    var playing = v.phase === 'play';
    var teams = [0, 1].map(function(tm){
      var mem = v.part.filter(function(id){ return v.teams[id] === tm; }).map(function(id){ return ctx.chip(id); }).join('');
      var cls = 'cftm', st = '';
      if(playing && v.turn === tm){ cls += ' on'; st = '▶'; }
      if(v.phase === 'result'){ if(v.winner === tm){ cls += ' win'; st = '👑'; } else if(!v.draw){ cls += ' lose'; st = '🍺'; } }
      return '<div class="' + cls + '" style="--tc:' + TEAM[tm].color + '"><div class="md t' + tm + ' dot" style="position:relative;inset:auto"></div><div class="mem">' + mem + '</div><span class="st">' + st + '</span></div>';
    }).join('');
    var hint = playing ? (v.myTurn ? '👆 あなたのチームの番!' : '') : (v.draw ? '引き分け' : '');
    // 落とし口に、いまの番の色のメダルを見せる
    var turnDisc = playing ? '<div class="cfturn"><div class="md t' + v.turn + '" style="animation:cfWin .7s ease-in-out infinite alternate;opacity:.9"></div></div>' : '';
    root.innerHTML = '<div class="cf4"><div class="cfteams">' + teams + '</div><div class="cfhint">' + hint + '</div>' +
      '<div class="cfboard">' + grid + turnDisc + '<div class="cfcols" id="cfcols">' + cols + '</div></div></div>' +
      (v.phase === 'result' ? '<div class="spacer"></div><div class="bottombar">' + (ctx.isHost ? btn('fAgain', 'もう一回') + btn('fSetup', '設定へ', 'btn-ghost') : '') + '</div>' : '');
    if(q('fAgain')) q('fAgain').onclick = function(){ ctx.send({ t: 'start' }); };
    if(q('fSetup')) q('fSetup').onclick = function(){ ctx.send({ t: 'resetup' }); };
    if(playing){
      var colsEl = q('cfcols');
      if(colsEl) colsEl.addEventListener('click', function(e){
        var b = e.target.closest ? e.target.closest('button[data-c]') : null; if(!b) return;
        if(!v.myTurn){ ctx.toast(v.myTeam < 0 ? '観戦中です' : '相手チームの番です'); return; }
        ctx.send({ t: 'drop', c: +b.dataset.c });
      });
    }
    // 効果音(新しい1手のとき1回だけ。落ちて跳ねる「コトッ」)
    if(!L.mplayed && v.last){
      L.mplayed = true;
      setTimeout(function(){ ctx.tone(180, 0.07, 'triangle', 0.16); }, 400);
      setTimeout(function(){ ctx.tone(140, 0.06, 'triangle', 0.1); }, 520);
      if(v.myTurn) { if(navigator.vibrate) try{ navigator.vibrate(25); }catch(e){} }
    }
    if(v.phase === 'result' && L.rk !== 'r' + v.round){
      L.rk = 'r' + v.round;
      if(!v.draw && v.winner === v.myTeam){ setTimeout(function(){ confetti(TEAM[v.winner].color); [660, 880, 1175, 1568].forEach(function(f, i){ setTimeout(function(){ ctx.tone(f, 0.16, 'triangle', 0.14); }, i * 120); }); if(navigator.vibrate) try{ navigator.vibrate([60, 40, 60, 40, 120]); }catch(e){} }, 650); }
      else if(!v.draw && v.myTeam >= 0) setTimeout(function(){ ctx.tone(180, 0.3, 'sawtooth', 0.1); }, 650);
    }
  }

  // 開発中モード用のCPU(動作確認専用): 自分のチームの番なら、空いている列からランダムに落とす
  function bot(v, me, rnd){
    if(v.phase !== 'play' || !v.inPart || !v.myTurn) return null;
    var open = [];
    for(var c = 0; c < COLS; c++) if(v.board[0][c] === -1) open.push(c);
    return open.length ? { t: 'drop', c: open[rnd(open.length)] } : null;
  }

  NO.register({
    id: 'connect4', emoji: '🔴', title: 'メダル落とし 4目並べ', accent: '#F5C82E', accentInk: '#2b2100', min: 2, max: 10,
    tagline: '赤と黄色のメダルを上から落として、先に4つ並べたチームの勝ち。負けたチームが飲む。',
    rules: [
      '縦6×横7のボードに、<b>赤と黄色のメダルを交互に上から落とす</b>。メダルは下から積み上がる。',
      '<b>縦・横・ななめのどれかに、自分のチームの色を4つ並べたら勝ち</b>。ボードが全部うまったら引き分け。',
      '2人なら1対1。3人以上は<b>ランダムで赤・黄の2チーム</b>に分かれ、<b>先攻もランダム</b>。自分のチームの番は、<b>チームの誰でも(先に押した人が)</b>落とせる。相談して決めよう。',
      '<b>負けたチーム全員が飲む</b>(引き分けなら誰も飲まない)。'
    ],
    game: game, bot: bot, render: render
  });
})();
