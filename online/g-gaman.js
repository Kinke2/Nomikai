/*
  我慢くらべ入札(オンライン版・開発中)
  全員に同じ持ち点(10点)。5ラウンド、毎回みんなが同時に・秘密で入札する。
  一番高く入札した人は安全。それ以外の中で「一番低く入札した人」が飲む(同点なら全員)。
  入札した点数は勝っても負けても戻らない(全員支払い)。持ち点の配分と読み合いがカギ。
  公平性: アプリは入札値をそのまま集計して順位を出すだけ(補正・加工なし)。
          乱数を使うのは「各ラウンドの飲む量」の抽選だけ(crypto.getRandomValues による一様抽選)。
          持ち点を先に使い切った人が後半で不利になるのは、ゲーム本来の読み合いとして補正しない。
  参考文献(ゲームの構造):
    [1] All-pay auction(全員支払い型オークション): https://en.wikipedia.org/wiki/All-pay_auction
    [2] War of attrition(消耗戦ゲーム): https://en.wikipedia.org/wiki/War_of_attrition_(game)
    [3] Blotto game(限られた資源を複数の場面に配分する同時手番ゲーム): https://en.wikipedia.org/wiki/Blotto_game
    [4] 通信・乱数・参考文献一覧は online-core.js の冒頭を参照
  (オンライン ロビーに登録されるゲーム。通信・部屋・QRは online-core.js が担当)
*/
(function(){
  'use strict';
  var NO = window.NomikaiOnline;

  /* PURE-BEGIN */
  var POINTS = 10, ROUNDS = 5;
  var STAKES = ['ひと口', 'ふた口', 'グラスの半分', '一気'];   // 飲む量(各ラウンドで一様に抽選)
  function activeIds(G){ return G.part.filter(function(id){ return !G.offline[id]; }); }
  function inPart(G, pid){ return G.part.indexOf(pid) >= 0; }

  // bids: { playerId: 入札点 }
  // 勝者 = 最高入札(同点なら全員)。飲む人 = 勝者以外の中で最低入札(同点なら全員)。全員が勝者なら飲む人なし。
  function resolve(bids){
    var ids = Object.keys(bids);
    if(!ids.length) return { winners: [], drinkers: [], high: null, low: null };
    var vals = ids.map(function(id){ return bids[id]; });
    var high = Math.max.apply(null, vals);
    var winners = ids.filter(function(id){ return bids[id] === high; });
    var rest = ids.filter(function(id){ return bids[id] !== high; });
    var low = null, drinkers = [];
    if(rest.length){
      low = Math.min.apply(null, rest.map(function(id){ return bids[id]; }));
      drinkers = rest.filter(function(id){ return bids[id] === low; });
    }
    return { winners: winners, drinkers: drinkers, high: high, low: low };
  }

  function newState(players, rnd){
    var G = { players: players, offline: {}, round: 0, phase: null, part: [], points: {}, drinks: {}, wins: {}, bids: {}, finalBids: {}, res: null, stake: '', stakeLog: [] };
    resetMatch(G);
    startRound(G, rnd);
    return G;
  }
  function resetMatch(G){
    G.round = 0; G.points = {}; G.drinks = {}; G.wins = {};
    G.players.forEach(function(p){ G.points[p.id] = POINTS; G.drinks[p.id] = 0; G.wins[p.id] = 0; });
  }
  function startRound(G, rnd){
    G.part = G.players.map(function(p){ return p.id; }).filter(function(id){ return !G.offline[id]; });
    G.round++; G.phase = 'bid'; G.bids = {}; G.finalBids = {}; G.res = null;
    G.stake = STAKES[rnd(STAKES.length)];
  }
  function maybeAdvance(G){
    if(G.phase !== 'bid') return;
    var act = activeIds(G);
    if(act.length && act.every(function(id){ return G.bids[id] != null; })) finish(G);
  }
  function finish(G){
    // 未入力(切断など)の人は棄権。入力された入札をそのまま集計する
    G.res = resolve(G.bids); G.finalBids = JSON.parse(JSON.stringify(G.bids)); G.phase = 'result';
    Object.keys(G.bids).forEach(function(id){ G.points[id] -= G.bids[id]; });   // 全員支払い
    G.res.drinkers.forEach(function(id){ G.drinks[id]++; });
    G.res.winners.forEach(function(id){ G.wins[id]++; });
  }
  function act(G, pid, a, rnd){
    if(!a || typeof a !== 'object') return { error: '操作が不正です' };
    if(a.t === 'bid'){
      if(G.phase !== 'bid' || !inPart(G, pid)) return { error: '今は入札できません' };
      var n = a.n;
      if(typeof n !== 'number' || n % 1 !== 0 || n < 0) return { error: '点数が不正です' };
      if(n > G.points[pid]) return { error: '持ち点を超えています' };
      G.bids[pid] = n; maybeAdvance(G); return { ok: true };
    }
    if(a.t === 'next'){
      if(pid !== 'p0' || G.phase !== 'result' || G.round >= ROUNDS) return { error: '今は進められません' };
      startRound(G, rnd); return { ok: true };
    }
    if(a.t === 'restart'){
      if(pid !== 'p0' || G.phase !== 'result' || G.round < ROUNDS) return { error: '今は始められません' };
      resetMatch(G); startRound(G, rnd); return { ok: true };
    }
    return { error: '未対応の操作' };
  }
  function force(G){ if(G.phase === 'bid') finish(G); }
  function waiting(G){ return G.phase === 'bid' ? activeIds(G).filter(function(id){ return G.bids[id] == null; }) : []; }
  function view(G, pid){
    var v = { phase: G.phase, round: G.round, rounds: ROUNDS, stake: G.stake, part: G.part, points: G.points, drinks: G.drinks, wins: G.wins, inPart: inPart(G, pid) };
    if(G.phase === 'bid'){ v.myBid = G.bids[pid] == null ? null : G.bids[pid]; v.submitted = Object.keys(G.bids); }   // 他人の入札値は送らない
    else { v.bids = G.finalBids; v.winners = G.res.winners; v.drinkers = G.res.drinkers; v.high = G.res.high; v.low = G.res.low; v.last = G.round >= ROUNDS; }
    return v;
  }
  var game = { newState: newState, act: act, view: view, waiting: waiting, force: force, sync: maybeAdvance };
  /* PURE-END */

  function render(root, ctx){
    var v = ctx.view, esc = ctx.esc, me = ctx.me, h = '';
    function btn(id, label, cls){ return '<button class="' + (cls || 'btn-primary') + '" id="' + id + '">' + label + '</button>'; }
    function names(ids){ return ids.length ? ids.map(function(id){ return esc(ctx.nameOf(id)); }).join('・') : 'なし'; }
    function board(){
      var rows = ctx.players.map(function(p){
        return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">' + ctx.chip(p.id) +
          '<span style="margin-left:auto;font-size:12px;color:var(--text-muted)">持ち点 <b style="font-size:17px;color:var(--text)">' + v.points[p.id] + '</b> / 勝ち ' + (v.wins[p.id] || 0) + ' / 飲んだ <b style="font-size:17px;color:var(--text)">' + (v.drinks[p.id] || 0) + '</b></span></div>';
      }).join('');
      return '<div class="section-label">ここまでの記録</div><div style="background:var(--bg-surface);border:1px solid var(--line);border-radius:14px;padding:2px 14px">' + rows + '</div>';
    }
    var top = '<div class="eyebrow">ROUND ' + v.round + ' / ' + v.rounds + '</div>';
    var myPts = v.points[me];
    if(!v.inPart && v.phase === 'bid'){
      h = top + '<div class="card-ui"><div class="big-text">このラウンドは観戦中</div><div class="sub-text">途中で入り直したので、次のラウンドから参加できます。</div></div>' + board() + ctx.waitHtml();
    } else if(v.phase === 'bid'){
      var cur = ctx.local.bid != null ? ctx.local.bid : (v.myBid != null ? v.myBid : 0);
      if(cur > myPts) cur = myPts;
      ctx.local.bid = cur;
      var small = 'style="flex:1;padding:12px 0;border-radius:12px;border:1.5px solid var(--line);background:var(--bg-surface);color:var(--text);font-weight:900;font-size:14px"';
      h = top + '<div class="card-ui"><div class="sub-text">今回の飲む量</div><div class="big-text" style="font-size:24px">' + esc(v.stake) + '</div>' +
        '<div class="sub-text">最高入札の人は安全。残りの中で<b>最低入札</b>の人が飲む。入札点は戻らない。</div></div>' +
        '<div style="text-align:center;margin-top:14px"><div class="sub-text">あなたの持ち点 <b>' + myPts + '</b></div>' +
        '<div style="display:flex;align-items:center;justify-content:center;gap:18px;margin-top:6px">' +
        '<button id="bMinus" style="width:56px;height:56px;border-radius:50%;border:2px solid var(--line);background:var(--bg-surface);color:var(--text);font-size:28px;font-weight:900">−</button>' +
        '<div id="bidNum" style="font-size:64px;font-weight:900;min-width:90px;color:var(--accent)">' + cur + '</div>' +
        '<button id="bPlus" style="width:56px;height:56px;border-radius:50%;border:2px solid var(--line);background:var(--bg-surface);color:var(--text);font-size:28px;font-weight:900">＋</button></div>' +
        '<div style="display:flex;gap:8px;margin-top:12px"><button id="bZero" ' + small + '>0</button><button id="bHalf" ' + small + '>半分</button><button id="bAll" ' + small + '>全部</button></div></div>' +
        '<div class="waitbar">' + (v.submitted.length ? '入札済み: ' + names(v.submitted) : '') + '</div>' +
        ctx.waitHtml() + board() + '<div class="spacer"></div><div class="bottombar">' + btn('bBid', v.myBid != null ? '入札を変更する' : 'この点数で入札') + '</div>';
    } else {
      var order = Object.keys(v.bids).sort(function(a, b){ return v.bids[b] - v.bids[a]; });
      var rows = order.map(function(id){
        var win = v.winners.indexOf(id) >= 0, dr = v.drinkers.indexOf(id) >= 0;
        return '<div style="display:flex;align-items:center;gap:10px;background:var(--bg-surface);border:1.5px solid ' + (win ? 'var(--gold)' : dr ? 'var(--danger)' : 'var(--line)') + ';border-radius:14px;padding:10px 12px;margin-top:8px">' +
          '<span style="font-size:26px;font-weight:900;width:38px;text-align:center;color:' + (win ? 'var(--gold)' : 'var(--text)') + '">' + v.bids[id] + '</span>' + ctx.chip(id) +
          '<span style="margin-left:auto;font-size:12px;font-weight:900;color:' + (win ? 'var(--gold)' : dr ? 'var(--danger)' : 'var(--safe)') + '">' + (win ? '👑 最高(安全)' : dr ? '最低 → 飲む' : '安全') + '</span></div>';
      }).join('');
      var head = v.drinkers.length ? '飲むのは: ' + names(v.drinkers) + '(' + esc(v.stake) + ')' : '全員同じ入札。誰も飲まない';
      h = top + '<div class="card-ui"><div class="big-text" style="color:' + (v.drinkers.length ? 'var(--danger)' : 'var(--gold)') + '">' + head + '</div>' +
        '<div class="sub-text">最高入札: ' + names(v.winners) + '(' + v.high + '点)</div></div>' +
        '<div class="section-label">全員の入札</div>' + rows + board() +
        (v.last ? '<div class="card-ui" style="margin-top:12px"><div class="big-text" style="font-size:18px">ゲーム終了!</div><div class="sub-text">いちばん多く飲んだのは: ' + names((function(){ var mx = Math.max.apply(null, ctx.players.map(function(p){ return v.drinks[p.id] || 0; })); return mx > 0 ? ctx.players.filter(function(p){ return (v.drinks[p.id] || 0) === mx; }).map(function(p){ return p.id; }) : []; })()) + '</div></div>' : '') +
        '<div class="spacer"></div><div class="bottombar">' +
        (ctx.isHost ? btn(v.last ? 'bRestart' : 'bNext', v.last ? 'もう一度(持ち点リセット)' : '次のラウンドへ') : '<div class="sub-text" style="text-align:center">ホストが次へ進めるのを待っています…</div>') + '</div>';
    }
    root.innerHTML = h;
    var q = function(id){ return document.getElementById(id); };
    function setBid(n){
      n = Math.max(0, Math.min(myPts, n)); ctx.local.bid = n;
      if(q('bidNum')) q('bidNum').textContent = n;
      ctx.tone(300 + 30 * n, 0.05, 'triangle', 0.07);
    }
    if(q('bMinus')) q('bMinus').onclick = function(){ setBid(ctx.local.bid - 1); };
    if(q('bPlus')) q('bPlus').onclick = function(){ setBid(ctx.local.bid + 1); };
    if(q('bZero')) q('bZero').onclick = function(){ setBid(0); };
    if(q('bHalf')) q('bHalf').onclick = function(){ setBid(Math.floor(myPts / 2)); };
    if(q('bAll')) q('bAll').onclick = function(){ setBid(myPts); };
    if(q('bBid')) q('bBid').onclick = function(){ ctx.send({ t: 'bid', n: ctx.local.bid }); };
    if(q('bNext')) q('bNext').onclick = function(){ ctx.send({ t: 'next' }); };
    if(q('bRestart')) q('bRestart').onclick = function(){ ctx.send({ t: 'restart' }); };
    if(v.phase !== 'bid') ctx.local.bid = null;
  }

  NO.register({
    id: 'gaman', emoji: '🪙', title: '我慢くらべ入札', accent: '#6FCF97', accentInk: '#0B2415', min: 3, max: 8,
    tagline: '持ち点10を5ラウンドに配分。最高入札は安全、残りで一番低い人が飲む。',
    rules: [
      '全員に<b>持ち点10</b>。<b>5ラウンド</b>、毎回みんなが同時に・こっそり点数を入札する(0点もOK)。',
      '<b>一番高く入札した人は安全</b>(同点なら全員安全)。それ以外の中で、<b>一番低く入札した人が飲む</b>(同点なら全員)。',
      '入札した点数は<b>勝っても負けても戻らない</b>。持ち点は使った分だけ減り、次のラウンドに持ち越す。',
      '飲む量(ひと口〜一気)はラウンドごとに抽選。全員が同じ入札なら誰も飲まない。'
    ],
    game: game, render: render
  });
})();
