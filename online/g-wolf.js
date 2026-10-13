/*
  ワードウルフ(オンライン版・開発中)
  各自のスマホに別々のワードが届く。ウルフ(1人だけ違うワード)を話し合いと投票で探す。
  公平性: ウルフの選出・どちらを多数派ワードにするか・お題の順番は、すべて crypto.getRandomValues による一様乱数(Fisher-Yates)。
          投票は件数をそのまま数えるだけ。同数は決選投票(1回)、再び同数ならウルフの勝ち(恣意的な選び方はしない)。
  参考文献:
    [1] 「ワードウルフ」(同名の既存の会話型パーティーゲーム。ルールを参考に、お題・実装は本作オリジナル)
        https://ja.wikipedia.org/wiki/%E3%83%AF%E3%83%BC%E3%83%89%E3%82%A6%E3%83%AB%E3%83%95
    [2] 通信・乱数・参考文献一覧は online-core.js の冒頭を参照
  (オンライン ロビーに登録されるゲーム。通信・部屋・QRは online-core.js が担当)
*/
(function(){
  'use strict';
  var NO = window.NomikaiOnline;

  /* PURE-BEGIN */
  // お題: [多数派ワード候補A, 少数派ワード候補B]。どちらが多数派になるかは毎回乱数で決める
  var PAIRS = [
    ['海','プール'],['ビール','チューハイ'],['寿司','刺身'],['カレー','シチュー'],['猫','ライオン'],
    ['電車','バス'],['スマホ','タブレット'],['サッカー','フットサル'],['ピアノ','オルガン'],['学校','塾'],
    ['雪','氷'],['夏休み','冬休み'],['映画館','劇場'],['コンビニ','スーパー'],['ハンバーガー','サンドイッチ'],
    ['焼肉','ステーキ'],['温泉','銭湯'],['キャンプ','バーベキュー'],['マラソン','ジョギング'],['カフェ','喫茶店'],
    ['ディズニー','遊園地'],['先生','教授'],['財布','ポーチ'],['帽子','ヘルメット'],['腕時計','スマートウォッチ'],
    ['パスタ','そば'],['餃子','シュウマイ'],['桜','梅'],['花火','線香花火'],['お化け屋敷','ホラー映画'],
    ['カラオケ','ライブ'],['自転車','バイク'],['飛行機','新幹線'],['炊飯器','電子レンジ'],['ケーキ','プリン'],
    ['チョコ','キャラメル'],['日本酒','焼酎'],['ワイン','シャンパン'],['居酒屋','バー'],['タクシー','レンタカー']
  ];
  function activeIds(G){ return G.part.filter(function(id){ return !G.offline[id]; }); }
  function inPart(G, pid){ return G.part.indexOf(pid) >= 0; }

  function newState(players, rnd){
    var G = { players: players, offline: {}, round: 0, drinks: {}, deck: [], deckPos: 0, minutes: 3,
              phase: null, part: [], wolf: null, wordMaj: '', wordMin: '', ready: {}, votes: {}, cands: null,
              revoted: false, accused: null, guess: '', outcome: null, reason: '', drinkers: [], finalVotes: {}, endAt: 0 };
    players.forEach(function(p){ G.drinks[p.id] = 0; });
    startRound(G, rnd);
    return G;
  }
  function shuffleIdx(n, rnd){
    var a = []; for(var i = 0; i < n; i++) a.push(i);
    for(var k = n - 1; k > 0; k--){ var j = rnd(k + 1); var t = a[k]; a[k] = a[j]; a[j] = t; }
    return a;
  }
  function startRound(G, rnd){
    if(G.deckPos >= G.deck.length){ G.deck = shuffleIdx(PAIRS.length, rnd); G.deckPos = 0; }
    var pair = PAIRS[G.deck[G.deckPos++]];
    var swap = rnd(2);                                   // どちらが多数派か(一様)
    G.wordMaj = pair[swap]; G.wordMin = pair[1 - swap];
    G.part = G.players.map(function(p){ return p.id; }).filter(function(id){ return !G.offline[id]; });
    G.wolf = G.part[rnd(G.part.length)];                 // ウルフは参加者から一様に1人
    G.round++; G.phase = 'reveal'; G.ready = {}; G.votes = {}; G.cands = null; G.revoted = false;
    G.accused = null; G.guess = ''; G.outcome = null; G.reason = ''; G.drinkers = []; G.finalVotes = {}; G.endAt = 0;
  }
  function wordOf(G, pid){ return pid === G.wolf ? G.wordMin : G.wordMaj; }

  function maybeAdvance(G){
    if(G.phase === 'reveal'){
      if(activeIds(G).every(function(id){ return G.ready[id]; })) toTalk(G);
    } else if(G.phase === 'vote'){
      if(activeIds(G).every(function(id){ return G.votes[id] != null; })) resolveVote(G);
    }
  }
  function toTalk(G){ G.phase = 'talk'; G.endAt = Date.now() + G.minutes * 60000; }
  function toVote(G){ G.phase = 'vote'; G.votes = {}; if(!G.cands) G.cands = G.part.slice(); }
  function resolveVote(G){
    var cnt = {}; G.cands.forEach(function(id){ cnt[id] = 0; });
    Object.keys(G.votes).forEach(function(v){ var t = G.votes[v]; if(cnt[t] != null) cnt[t]++; });
    var max = Math.max.apply(null, G.cands.map(function(id){ return cnt[id]; }));
    var tops = G.cands.filter(function(id){ return cnt[id] === max; });
    G.finalVotes = JSON.parse(JSON.stringify(G.votes));
    if(tops.length === 1){
      G.accused = tops[0];
      if(G.accused === G.wolf){ G.phase = 'guess'; }
      else finish(G, 'wolf', 'missed');
    } else if(!G.revoted){
      G.revoted = true; G.cands = tops; G.votes = {};    // 同数 → その人たちだけで決選投票(1回だけ)
    } else {
      finish(G, 'wolf', 'tie');                          // 決選でも同数 → ウルフの勝ち
    }
  }
  function finish(G, outcome, reason){
    G.phase = 'result'; G.outcome = outcome; G.reason = reason;
    // 負けた側が飲む。ウルフの勝ち → ウルフ以外の参加者全員、村の勝ち → ウルフ
    G.drinkers = (outcome === 'wolf') ? G.part.filter(function(id){ return id !== G.wolf; }) : [G.wolf];
    G.drinkers.forEach(function(id){ G.drinks[id]++; });
  }

  function act(G, pid, a, rnd){
    if(!a || typeof a !== 'object') return { error: '操作が不正です' };
    var host = (pid === 'p0');
    switch(a.t){
      case 'setMinutes':
        if(!host || G.phase !== 'reveal') return { error: '今は変えられません' };
        if([2,3,5].indexOf(a.m) < 0) return { error: '時間が不正です' };
        G.minutes = a.m; return { ok: true };
      case 'ready':
        if(G.phase !== 'reveal' || !inPart(G, pid)) return { error: '今は押せません' };
        G.ready[pid] = true; maybeAdvance(G); return { ok: true };
      case 'toVote':
        if(G.phase !== 'talk' || !inPart(G, pid)) return { error: '今は押せません' };
        toVote(G); maybeAdvance(G); return { ok: true };
      case 'vote':
        if(G.phase !== 'vote' || !inPart(G, pid)) return { error: '今は投票できません' };
        if(G.cands.indexOf(a.target) < 0 || a.target === pid) return { error: 'その人には投票できません' };
        G.votes[pid] = a.target; maybeAdvance(G); return { ok: true };
      case 'guess':
        if(G.phase !== 'guess' || pid !== G.wolf) return { error: '今は答えられません' };
        G.guess = String(a.text || '').trim().slice(0, 20);
        G.phase = 'judge'; return { ok: true };
      case 'judge':
        if(G.phase !== 'judge' || !inPart(G, pid) || pid === G.wolf) return { error: 'あなたは判定できません' };
        finish(G, a.ok ? 'wolf' : 'village', a.ok ? 'guessed' : 'caught'); return { ok: true };
      case 'next':
        if(!host || G.phase !== 'result') return { error: 'ホストだけが進められます' };
        startRound(G, rnd); return { ok: true };
    }
    return { error: '未対応の操作' };
  }
  function force(G){
    if(G.phase === 'reveal'){ activeIds(G).forEach(function(id){ G.ready[id] = true; }); toTalk(G); }
    else if(G.phase === 'talk'){ toVote(G); }
    else if(G.phase === 'vote'){ resolveVote(G); }
    else if(G.phase === 'guess'){ G.guess = ''; G.phase = 'judge'; }
    else if(G.phase === 'judge'){ finish(G, 'village', 'caught'); }
  }
  function waiting(G){
    if(G.phase === 'reveal') return activeIds(G).filter(function(id){ return !G.ready[id]; });
    if(G.phase === 'vote') return activeIds(G).filter(function(id){ return G.votes[id] == null; });
    if(G.phase === 'guess') return [G.wolf];
    return [];
  }
  function view(G, pid){
    var part = inPart(G, pid);
    var v = { phase: G.phase, round: G.round, part: G.part, drinks: G.drinks, inPart: part, minutes: G.minutes };
    if(G.phase === 'reveal'){ v.word = part ? wordOf(G, pid) : null; v.iAmReady = !!G.ready[pid]; v.readyCount = Object.keys(G.ready).length; }
    else if(G.phase === 'talk'){ v.word = part ? wordOf(G, pid) : null; v.remainMs = Math.max(0, G.endAt - Date.now()); }
    else if(G.phase === 'vote'){ v.cands = G.cands; v.myVote = G.votes[pid] || null; v.voted = Object.keys(G.votes); v.revoted = G.revoted; }
    else if(G.phase === 'guess'){ v.isWolf = (pid === G.wolf); v.accused = G.accused; }
    else if(G.phase === 'judge'){ v.isWolf = (pid === G.wolf); v.guess = G.guess;
      v.majorityWord = (pid === G.wolf) ? null : G.wordMaj; v.canJudge = part && pid !== G.wolf; }
    else if(G.phase === 'result'){
      v.outcome = G.outcome; v.reason = G.reason; v.wolf = G.wolf; v.accused = G.accused; v.wordMaj = G.wordMaj; v.wordMin = G.wordMin;
      v.votes = G.finalVotes; v.drinkers = G.drinkers; v.guess = G.guess; v.revoted = G.revoted;
    }
    return v;
  }
  var game = { newState: newState, act: act, view: view, waiting: waiting, force: force, sync: maybeAdvance };
  /* PURE-END */

  /* ---------------- 画面 ---------------- */
  function render(root, ctx){
    var v = ctx.view, h = '', esc = ctx.esc, me = ctx.me;
    function btn(id, label, cls){ return '<button class="' + (cls || 'btn-primary') + '" id="' + id + '">' + label + '</button>'; }
    function scoreboard(){
      var rows = ctx.players.map(function(p){ return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">' +
        ctx.chip(p.id) + '<span style="margin-left:auto;font-size:18px;font-weight:900">' + (v.drinks[p.id] || 0) + '<span style="font-size:11px;color:var(--text-muted)"> 杯</span></span></div>'; }).join('');
      return '<div class="section-label">ここまでの飲んだ回数</div><div style="background:var(--bg-surface);border:1px solid var(--line);border-radius:14px;padding:2px 14px">' + rows + '</div>';
    }
    var top = '<div class="eyebrow">ROUND ' + v.round + '</div>';
    if(!v.inPart && v.phase !== 'result'){
      h = top + '<div class="card-ui"><div class="big-text">このラウンドは観戦中</div><div class="sub-text">途中で入り直したので、次のラウンドから参加できます。</div></div>' + ctx.waitHtml();
    } else if(v.phase === 'reveal'){
      h = top + '<div class="card-ui"><div class="sub-text" style="margin:0 0 10px">あなたのワード(他の人に見せない)</div><div class="big-text" style="font-size:38px;color:var(--accent)">' + esc(v.word) + '</div>' +
        '<div class="sub-text">みんなほぼ同じワードですが、<b>1人だけ違うワード</b>の人(ウルフ)がいます。自分がウルフかどうかは分かりません。</div></div>' +
        (ctx.isHost ? '<div class="section-label">話し合いの時間(ホストが決める)</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' +
          [2,3,5].map(function(m){ return '<button class="btn-ghost" data-min="' + m + '" style="margin:0;' + (v.minutes === m ? 'border-color:var(--accent);color:var(--accent)' : '') + '">' + m + '分</button>'; }).join('') + '</div>'
          : '<div class="sub-text" style="text-align:center;margin-top:14px">話し合い: ' + v.minutes + '分</div>') +
        ctx.waitHtml() + '<div class="spacer"></div><div class="bottombar">' + (v.iAmReady ? '<button class="btn-primary" disabled>みんなを待っています…</button>' : btn('bReady', 'ワードを覚えた')) + '</div>';
    } else if(v.phase === 'talk'){
      h = top + '<div class="card-ui"><div class="sub-text" style="margin:0 0 6px">あなたのワード</div><div class="big-text" style="font-size:30px;color:var(--accent)">' + esc(v.word) + '</div></div>' +
        '<div class="card-ui" style="margin-top:12px"><div class="sub-text" style="margin:0">残り時間</div><div class="big-text" style="font-size:46px;font-variant-numeric:tabular-nums" id="clock">--:--</div></div>' +
        '<div class="sub-text" style="text-align:center;margin-top:12px">自分のワードを直接言わずに、順番にヒントを出し合う。<br>ウルフだと思う人を探そう。</div>' +
        '<div class="spacer"></div><div class="bottombar">' + btn('bVote', '投票に進む') + '</div>';
    } else if(v.phase === 'vote'){
      var you = v.myVote;
      h = top + '<div class="card-ui"><div class="big-text" style="font-size:19px">' + (v.revoted ? '決選投票!同数だった人だけから選ぶ' : 'ウルフだと思う人に投票') + '</div>' +
        '<div class="sub-text">自分以外から1人選ぶ。投票先は他の人には見えません(結果発表で公開)。</div></div>' +
        '<div style="display:flex;flex-direction:column;gap:10px;margin-top:14px">' +
        v.cands.filter(function(id){ return id !== me; }).map(function(id){
          var sel = (ctx.local.pick || you) === id;
          return '<button class="btn-ghost" data-v="' + id + '" style="margin:0;text-align:left;display:flex;align-items:center;gap:10px;padding:12px 14px;' + (sel ? 'border-color:var(--accent);background:rgba(79,195,217,.12);color:var(--text)' : '') + '">' + ctx.chip(id) + (sel ? '<span style="margin-left:auto;color:var(--accent)">選択中</span>' : '') + '</button>';
        }).join('') + '</div>' +
        '<div class="waitbar">' + (v.voted.length ? '投票済み: ' + v.voted.map(function(id){ return esc(ctx.nameOf(id)); }).join('・') : '') + '</div>' +
        ctx.waitHtml() + '<div class="spacer"></div><div class="bottombar">' + btn('bVoteOk', you ? '投票を変更する' : '投票する') + '</div>';
    } else if(v.phase === 'guess'){
      h = top + '<div class="card-ui"><div class="big-text">' + ctx.chip(v.accused) + ' が指名された</div></div>' +
        (v.isWolf
          ? '<div class="card-ui" style="margin-top:12px;border-color:var(--danger)"><div class="big-text" style="color:var(--danger)">あなたがウルフ!</div><div class="sub-text">逆転のチャンス。みんなのワード(多数派ワード)を当てれば勝ち。</div></div>' +
            '<input class="field" id="inGuess" maxlength="20" placeholder="多数派のワードは?" style="margin-top:14px" autocomplete="off">' +
            '<div class="spacer"></div><div class="bottombar">' + btn('bGuess', 'この答えで勝負') + '</div>'
          : '<div class="sub-text" style="text-align:center;margin-top:16px">ウルフが多数派のワードを当てるか、考えています…</div>' + ctx.waitHtml());
    } else if(v.phase === 'judge'){
      h = top + '<div class="card-ui"><div class="sub-text" style="margin:0 0 6px">ウルフの答え</div><div class="big-text" style="font-size:30px">' + (esc(v.guess) || '(未入力)') + '</div></div>' +
        (v.canJudge
          ? '<div class="card-ui" style="margin-top:12px"><div class="sub-text" style="margin:0 0 6px">本当の多数派ワード</div><div class="big-text" style="font-size:26px;color:var(--accent)">' + esc(v.majorityWord) + '</div>' +
            '<div class="sub-text">表記ゆれ(ひらがな/カタカナ等)もあるので、みんなで見て判定する。</div></div>' +
            '<div class="spacer"></div><div class="bottombar">' + btn('bJudgeOk', '正解にする(ウルフの逆転)') + btn('bJudgeNg', '不正解にする', 'btn-ghost') + '</div>'
          : '<div class="sub-text" style="text-align:center;margin-top:16px">' + (v.isWolf ? 'みんなが判定しています…' : '') + '</div>');
    } else if(v.phase === 'result'){
      var reasonText = { missed: 'ウルフは見つからなかった', tie: '決選でも同数。ウルフが逃げ切った', guessed: 'ウルフが多数派ワードを当てて逆転', caught: 'ウルフを見破った' }[v.reason];
      var lines = Object.keys(v.votes).map(function(a){ return '<div style="font-size:12.5px;padding:3px 0">' + ctx.chip(a) + ' → ' + ctx.chip(v.votes[a]) + '</div>'; }).join('');
      h = top + '<div class="card-ui"><div class="eyebrow" style="margin-bottom:6px">' + esc(reasonText) + '</div>' +
        '<div class="big-text" style="color:' + (v.outcome === 'wolf' ? 'var(--danger)' : 'var(--safe)') + '">' + (v.outcome === 'wolf' ? 'ウルフの勝ち' : '村人の勝ち') + '</div>' +
        '<div class="sub-text">ウルフ: ' + ctx.chip(v.wolf) + '<br>多数派ワード「' + esc(v.wordMaj) + '」 / ウルフのワード「' + esc(v.wordMin) + '」</div></div>' +
        '<div class="card-ui" style="margin-top:12px"><div class="big-text" style="font-size:18px;color:var(--danger)">飲むのは: ' + v.drinkers.map(function(id){ return esc(ctx.nameOf(id)); }).join('・') + '</div></div>' +
        '<div class="section-label">投票の内訳' + (v.revoted ? '(決選投票)' : '') + '</div><div style="background:var(--bg-surface);border:1px solid var(--line);border-radius:14px;padding:8px 14px">' + (lines || '-') + '</div>' +
        scoreboard() + '<div class="spacer"></div><div class="bottombar">' +
        (ctx.isHost ? btn('bNext', '次のラウンドへ') : '<div class="sub-text" style="text-align:center">ホストが次へ進めるのを待っています…</div>') + '</div>';
    }
    root.innerHTML = h;
    var q = function(id){ return document.getElementById(id); };
    if(q('bReady')) q('bReady').onclick = function(){ ctx.send({ t: 'ready' }); };
    if(q('bVote')) q('bVote').onclick = function(){ ctx.send({ t: 'toVote' }); };
    if(q('bNext')) q('bNext').onclick = function(){ ctx.send({ t: 'next' }); };
    if(q('bGuess')) q('bGuess').onclick = function(){ ctx.send({ t: 'guess', text: q('inGuess').value }); };
    if(q('bJudgeOk')) q('bJudgeOk').onclick = function(){ ctx.send({ t: 'judge', ok: true }); };
    if(q('bJudgeNg')) q('bJudgeNg').onclick = function(){ ctx.send({ t: 'judge', ok: false }); };
    root.querySelectorAll('[data-min]').forEach(function(b){ b.onclick = function(){ ctx.send({ t: 'setMinutes', m: parseInt(b.dataset.min, 10) }); }; });
    root.querySelectorAll('[data-v]').forEach(function(b){ b.onclick = function(){
      ctx.local.pick = b.dataset.v;
      root.querySelectorAll('[data-v]').forEach(function(x){ x.style.borderColor = ''; x.style.background = ''; x.style.color = ''; var s = x.querySelector('span:last-child'); });
      b.style.borderColor = 'var(--accent)'; b.style.background = 'rgba(79,195,217,.12)'; b.style.color = 'var(--text)';
    }; });
    if(q('bVoteOk')) q('bVoteOk').onclick = function(){
      var t = ctx.local.pick || v.myVote;
      if(!t){ ctx.toast('投票先を選んでください'); return; }
      ctx.send({ t: 'vote', target: t }); ctx.tone(520, 0.08, 'triangle', 0.1);
    };
    if(v.phase === 'talk'){
      var endsAt = Date.now() + v.remainMs;
      ctx.every(function(){
        var r = Math.max(0, endsAt - Date.now()), s = Math.ceil(r / 1000);
        var c = document.getElementById('clock'); if(!c) return;
        c.textContent = (r === 0) ? '時間切れ' : (('0' + Math.floor(s / 60)).slice(-2) + ':' + ('0' + (s % 60)).slice(-2));
        if(r === 0) c.style.color = 'var(--danger)';
      }, 500);
    }
    if(v.phase !== 'vote') ctx.local.pick = null;
  }

  // 開発中モード用のCPU(1人で動作確認するためのもの)。自分に見えている情報(view)だけで、ランダムに操作する。ゲーム結果への補正はしない。
  function bot(v, me, rnd){
    if(!v.inPart) return null;
    if(v.phase === 'reveal') return v.iAmReady ? null : { t: 'ready' };
    if(v.phase === 'vote'){
      if(v.myVote) return null;
      var c = (v.cands || []).filter(function(x){ return x !== me; });
      return c.length ? { t: 'vote', target: c[rnd(c.length)] } : null;
    }
    if(v.phase === 'guess') return v.isWolf ? { t: 'guess', text: 'うーん、なんだろう' } : null;
    if(v.phase === 'judge') return v.canJudge ? { t: 'judge', ok: rnd(2) === 1 } : null;
    return null;
  }

  NO.register({
    id: 'wolf', emoji: '🐺', title: 'ワードウルフ', accent: '#C792EA', accentInk: '#1E0C2B', min: 3, max: 8,
    tagline: 'みんなに少し違うワードが配られる。1人だけ違うワードの「ウルフ」を話し合いで探し出せ。',
    rules: [
      '全員に同じワードが配られるが、<b>1人だけ違うワード</b>(ウルフ)。自分がどちらかは分からない。',
      '時間内に、ワードを直接言わずにヒントを出し合って話し合う。',
      '全員で投票。<b>最多得票の人がウルフなら村の勝ち</b>。同数なら決選投票(1回だけ)。',
      'ウルフを当てても、ウルフが<b>多数派のワードを当てたら逆転</b>。',
      '負けた側が飲む(ウルフの勝ち → 村人全員、村の勝ち → ウルフ)。'
    ],
    game: game, bot: bot, render: render
  });
})();
