/*
  最小ユニーク(オンライン版・開発中)
  全員が1〜(人数+2)の数字を秘密で選び、「誰とも被らなかった最小の数字」の人が勝ち、被った人が飲む。
  誰も被らなかったとき(全員の数字がバラバラ)は、いちばん大きい数字を選んだ人がアウト(飲む)。
  公平性: アプリは選ばれた数字をそのまま集計するだけ(補正・加工なし)。乱数は使わない(数字は各自が選ぶ)。
  参考文献:
    [1] Östling, Wang, Chou, Camerer (2011) "Testing Game Theory in the Field: Swedish LUPI Lottery Games"
        American Economic Journal: Microeconomics 3(3)  (Lowest Unique Positive Integer ゲームの均衡と実データの比較)
        https://resolver.caltech.edu/CaltechAUTHORS:20110215-080914315
        PDF: https://www.stat.berkeley.edu/~aldous/157/Papers/ostling.pdf
    [2] 通信・乱数・参考文献一覧は online-core.js の冒頭を参照
  (オンライン ロビーに登録されるゲーム。通信・部屋・QRは online-core.js が担当)
*/
(function(){
  'use strict';
  var NO = window.NomikaiOnline;

  /* PURE-BEGIN */
  function activeIds(G){ return G.part.filter(function(id){ return !G.offline[id]; }); }
  function inPart(G, pid){ return G.part.indexOf(pid) >= 0; }
  function rangeFor(nPlayers){ return nPlayers + 2; }       // 選べる数字は 1〜(参加人数+2)

  // picks: { playerId: 数字 }  →  各数字の人数、ユニークな数字、勝者、飲む人(数字が他の人と被った人)
  function resolve(picks){
    var ids = Object.keys(picks), counts = {};
    ids.forEach(function(id){ var n = picks[id]; counts[n] = (counts[n] || 0) + 1; });
    var uniques = Object.keys(counts).map(Number).filter(function(n){ return counts[n] === 1; }).sort(function(a, b){ return a - b; });
    var winnerNum = uniques.length ? uniques[0] : null;
    var winner = null;
    if(winnerNum !== null) ids.forEach(function(id){ if(picks[id] === winnerNum) winner = id; });
    var drinkers = ids.filter(function(id){ return counts[picks[id]] >= 2; });   // 被った人が飲む
    // 誰も被らなかったとき(2人以上)は、いちばん大きい数字を選んだ人がアウト。数字が全員違うので、該当者は必ず1人
    var noDup = drinkers.length === 0 && ids.length >= 2, maxOut = null;
    if(noDup){
      var mx = Math.max.apply(null, ids.map(function(id){ return picks[id]; }));
      ids.forEach(function(id){ if(picks[id] === mx) maxOut = id; });
      drinkers = [maxOut];
    }
    return { counts: counts, uniques: uniques, winnerNum: winnerNum, winner: winner, drinkers: drinkers, noDup: noDup, maxOut: maxOut };
  }

  function newState(players, rnd){
    var G = { players: players, offline: {}, round: 0, drinks: {}, wins: {}, phase: null, part: [], N: 0, picks: {}, res: null, finalPicks: {} };
    players.forEach(function(p){ G.drinks[p.id] = 0; G.wins[p.id] = 0; });
    startRound(G);
    return G;
  }
  function startRound(G){
    G.part = G.players.map(function(p){ return p.id; }).filter(function(id){ return !G.offline[id]; });
    G.N = rangeFor(G.part.length);
    G.round++; G.phase = 'pick'; G.picks = {}; G.res = null; G.finalPicks = {};
  }
  function maybeAdvance(G){
    if(G.phase !== 'pick') return;
    var act = activeIds(G);
    if(act.length && act.every(function(id){ return G.picks[id] != null; })) finish(G);
  }
  function finish(G){
    // 未入力(切断など)の人は棄権。入力された数字をそのまま集計する
    G.res = resolve(G.picks); G.finalPicks = JSON.parse(JSON.stringify(G.picks)); G.phase = 'result';
    G.res.drinkers.forEach(function(id){ G.drinks[id]++; });
    if(G.res.winner) G.wins[G.res.winner]++;
  }
  function act(G, pid, a, rnd){
    if(!a || typeof a !== 'object') return { error: '操作が不正です' };
    if(a.t === 'pick'){
      if(G.phase !== 'pick' || !inPart(G, pid)) return { error: '今は選べません' };
      var n = a.n;
      if(typeof n !== 'number' || n % 1 !== 0 || n < 1 || n > G.N) return { error: '数字が範囲外です' };
      G.picks[pid] = n; maybeAdvance(G); return { ok: true };
    }
    if(a.t === 'next'){
      if(pid !== 'p0' || G.phase !== 'result') return { error: 'ホストだけが進められます' };
      startRound(G); return { ok: true };
    }
    return { error: '未対応の操作' };
  }
  function force(G){ if(G.phase === 'pick') finish(G); }
  function waiting(G){ return G.phase === 'pick' ? activeIds(G).filter(function(id){ return G.picks[id] == null; }) : []; }
  function view(G, pid){
    var v = { phase: G.phase, round: G.round, N: G.N, part: G.part, drinks: G.drinks, wins: G.wins, inPart: inPart(G, pid) };
    if(G.phase === 'pick'){ v.myPick = G.picks[pid] || null; v.picked = Object.keys(G.picks); }
    else { v.picks = G.finalPicks; v.counts = G.res.counts; v.uniques = G.res.uniques; v.winner = G.res.winner; v.winnerNum = G.res.winnerNum; v.drinkers = G.res.drinkers; v.noDup = G.res.noDup; v.maxOut = G.res.maxOut; }
    return v;
  }
  var game = { newState: newState, act: act, view: view, waiting: waiting, force: force, sync: maybeAdvance };
  /* PURE-END */

  function render(root, ctx){
    var v = ctx.view, esc = ctx.esc, me = ctx.me, h = '';
    function btn(id, label, cls){ return '<button class="' + (cls || 'btn-primary') + '" id="' + id + '">' + label + '</button>'; }
    function board(){
      var rows = ctx.players.map(function(p){
        return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">' + ctx.chip(p.id) +
          '<span style="margin-left:auto;font-size:12px;color:var(--text-muted)">勝ち ' + (v.wins[p.id] || 0) + ' / 飲んだ <b style="font-size:17px;color:var(--text)">' + (v.drinks[p.id] || 0) + '</b></span></div>';
      }).join('');
      return '<div class="section-label">ここまでの記録</div><div style="background:var(--bg-surface);border:1px solid var(--line);border-radius:14px;padding:2px 14px">' + rows + '</div>';
    }
    var top = '<div class="eyebrow">ROUND ' + v.round + '</div>';
    if(!v.inPart && v.phase === 'pick'){
      h = top + '<div class="card-ui"><div class="big-text">このラウンドは観戦中</div><div class="sub-text">途中で入り直したので、次のラウンドから参加できます。</div></div>' + ctx.waitHtml();
    } else if(v.phase === 'pick'){
      var cells = '';
      for(var i = 1; i <= v.N; i++){
        var sel = (ctx.local.pick || v.myPick) === i;
        cells += '<button data-n="' + i + '" style="aspect-ratio:1;border-radius:14px;font-size:26px;font-weight:900;border:2px solid ' + (sel ? 'var(--accent)' : 'var(--line)') + ';background:' + (sel ? 'rgba(79,195,217,.16)' : 'var(--bg-surface)') + ';color:' + (sel ? 'var(--accent)' : 'var(--text)') + '">' + i + '</button>';
      }
      h = top + '<div class="card-ui"><div class="big-text" style="font-size:19px">誰とも被らない、いちばん小さい数字を選べ</div>' +
        '<div class="sub-text">1〜' + v.N + ' から1つ。<b>誰とも被らなかった数字のうち最小</b>を選んだ人が勝ち。被った人は飲む。<b>誰も被らなかったら、いちばん大きい数字の人が飲む。</b></div></div>' +
        '<div style="display:grid;grid-template-columns:repeat(' + (v.N <= 6 ? 3 : 4) + ',1fr);gap:10px;margin-top:14px">' + cells + '</div>' +
        '<div class="waitbar">' + (v.picked.length ? '選択済み: ' + v.picked.map(function(id){ return esc(ctx.nameOf(id)); }).join('・') : '') + '</div>' +
        ctx.waitHtml() + '<div class="spacer"></div><div class="bottombar">' + btn('bPick', v.myPick ? '数字を変更する' : 'この数字に決定') + '</div>';
    } else {
      var order = Object.keys(v.picks).sort(function(a, b){ return v.picks[a] - v.picks[b]; });
      var rows = order.map(function(id){
        var n = v.picks[id], dup = v.counts[n] >= 2, win = (id === v.winner), out = (id === v.maxOut);
        return '<div style="display:flex;align-items:center;gap:10px;background:var(--bg-surface);border:1.5px solid ' + (win ? 'var(--gold)' : (dup || out) ? 'var(--danger)' : 'var(--line)') + ';border-radius:14px;padding:10px 12px;margin-top:8px">' +
          '<span style="font-size:26px;font-weight:900;width:34px;text-align:center;color:' + (win ? 'var(--gold)' : 'var(--text)') + '">' + n + '</span>' + ctx.chip(id) +
          '<span style="margin-left:auto;font-size:12px;font-weight:900;color:' + (win ? 'var(--gold)' : (dup || out) ? 'var(--danger)' : 'var(--safe)') + '">' + (win && out ? '👑 勝ち / 最大 → 飲む' : win ? '👑 勝ち' : dup ? '被り → 飲む' : out ? '最大 → 飲む' : 'ユニーク') + '</span></div>';
      }).join('');
      h = top + '<div class="card-ui"><div class="big-text" style="color:' + (v.winner ? 'var(--gold)' : 'var(--danger)') + '">' +
        (v.winner ? '勝者: ' + esc(ctx.nameOf(v.winner)) + '(' + v.winnerNum + ')' : '全員被り。勝者なし') + '</div>' +
        '<div class="sub-text">' + (v.noDup ? '誰も被らなかったので、いちばん大きい数字の人がアウト。<br>' : '') + '飲むのは: ' + (v.drinkers.length ? v.drinkers.map(function(id){ return esc(ctx.nameOf(id)); }).join('・') : 'なし') + '</div></div>' +
        '<div class="section-label">全員の数字</div>' + rows + board() + '<div class="spacer"></div><div class="bottombar">' +
        (ctx.isHost ? btn('bNext', '次のラウンドへ') : '<div class="sub-text" style="text-align:center">ホストが次へ進めるのを待っています…</div>') + '</div>';
    }
    root.innerHTML = h;
    var q = function(id){ return document.getElementById(id); };
    root.querySelectorAll('[data-n]').forEach(function(b){ b.onclick = function(){
      ctx.local.pick = parseInt(b.dataset.n, 10);
      root.querySelectorAll('[data-n]').forEach(function(x){ x.style.borderColor = 'var(--line)'; x.style.background = 'var(--bg-surface)'; x.style.color = 'var(--text)'; });
      b.style.borderColor = 'var(--accent)'; b.style.background = 'rgba(79,195,217,.16)'; b.style.color = 'var(--accent)';
      ctx.tone(440 + 40 * ctx.local.pick, 0.06, 'triangle', 0.08);
    }; });
    if(q('bPick')) q('bPick').onclick = function(){
      var n = ctx.local.pick || v.myPick;
      if(!n){ ctx.toast('数字を選んでください'); return; }
      ctx.send({ t: 'pick', n: n });
    };
    if(q('bNext')) q('bNext').onclick = function(){ ctx.send({ t: 'next' }); };
    if(v.phase !== 'pick') ctx.local.pick = null;
  }

  // 開発中モード用のCPU(ランダムに選ぶだけ)
  function bot(v, me, rnd){
    if(!v.inPart || v.phase !== 'pick' || v.myPick) return null;
    return { t: 'pick', n: 1 + rnd(v.N) };
  }

  NO.register({
    id: 'lupi', emoji: '🔢', title: '最小ユニーク', accent: '#E8C24A', accentInk: '#2B2108', min: 3, max: 8,
    tagline: '誰とも被らない、いちばん小さい数字を選んだ人が勝ち。被った人は飲む。誰も被らなければ最大の人が飲む。',
    rules: [
      '全員が <b>1〜(人数+2)</b> の数字を、他の人に見えないように1つ選ぶ。',
      '全員が選び終わったら一斉に公開。<b>誰とも被らなかった数字のうち、いちばん小さい数字</b>を選んだ人が勝ち。',
      '<b>数字が他の人と被った人は飲む。</b>誰とも被らなかった人は安全(勝ちは最小の1人だけ)。',
      '<b>誰も被らなかったとき</b>(全員の数字がバラバラ)は、<b>いちばん大きい数字を選んだ人がアウト</b>で飲む。',
      '全員が被ったら勝者なしで、全員飲む。'
    ],
    game: game, bot: bot, render: render
  });
})();
