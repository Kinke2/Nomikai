/*
  秘密指名ゲーム(オンライン版・開発中)
  お題に当てはまる人を各自がこっそり指名し、最多得票の人が飲む。誰が誰に投票したかは各端末に送らない。
  公平性: お題の順番は crypto.getRandomValues による Fisher-Yates シャッフル。票は件数をそのまま数えるだけで補正しない。
          同票トップは全員が飲む。全員が同じ票数(例: 全員が1票ずつ)のときはノーカウント。
  参考文献:
    [1] 通信・乱数・参考文献一覧は online-core.js の冒頭を参照(お題は本作オリジナル)
    [2] Fisher-Yates shuffle https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
  (オンライン ロビーに登録されるゲーム。通信・部屋・QRは online-core.js が担当)
*/
(function(){
  'use strict';
  var NO = window.NomikaiOnline;

  /* PURE-BEGIN */
  var THEMES = [
    '一番、遅刻しそうな人','一番、酔うと泣きそうな人','一番、結婚が早そうな人','一番、無人島で生き残れそうな人',
    '一番、実はモテそうな人','一番、お金持ちになりそうな人','一番、隠し事が多そうな人','一番、怒ると怖そうな人',
    '一番、方向音痴そうな人','一番、電車で寝過ごしそうな人','一番、変わった趣味がありそうな人','一番、将来有名になりそうな人',
    '一番、今日たくさん飲みそうな人','一番、最初に潰れそうな人','一番、二日酔いになりそうな人','一番、面倒見がよさそうな人',
    '一番、秘密を守れなさそうな人','一番、一人旅が似合いそうな人','一番、スマホを手放せなさそうな人','一番、料理がうまそうな人',
    '一番、動物に好かれそうな人','一番、朝が弱そうな人','一番、最後まで残っていそうな人','一番、初対面でも緊張しなさそうな人',
    '一番、ドッキリに引っかかりそうな人','一番、嘘が下手そうな人','一番、嘘がうまそうな人','一番、お化け屋敷で叫びそうな人',
    '一番、人生を楽しんでいそうな人','一番、歌がうまそうな人','一番、運動神経がよさそうな人','一番、部屋が散らかっていそうな人',
    '一番、約束を忘れそうな人','一番、ロマンチストそうな人','一番、子どもに好かれそうな人','一番、ケチそうな人',
    '一番、太っ腹そうな人','一番、老後も元気そうな人','一番、勢いで大きな買い物をしそうな人','一番、突然ふらっと旅に出そうな人'
  ];
  function activeIds(G){ return G.part.filter(function(id){ return !G.offline[id]; }); }
  function inPart(G, pid){ return G.part.indexOf(pid) >= 0; }

  // votes: { 投票者: 指名先 }, cands: 指名されうる人。最多得票の人(同数なら全員)が飲む。
  // 全員が同じ票数(例: 全員が1票ずつ)のときは、誰も飲まないノーカウント。
  function resolve(votes, cands){
    var counts = {}; cands.forEach(function(id){ counts[id] = 0; });
    Object.keys(votes).forEach(function(v){ var t = votes[v]; if(counts[t] != null) counts[t]++; });
    var max = Math.max.apply(null, cands.map(function(id){ return counts[id]; }));
    var tops = cands.filter(function(id){ return counts[id] === max; });
    var allEqual = (tops.length === cands.length);
    return { counts: counts, max: max, tops: tops, allEqual: allEqual, drinkers: allEqual ? [] : tops };
  }

  function newState(players, rnd){
    var G = { players: players, offline: {}, round: 0, drinks: {}, deck: [], deckPos: 0, phase: null, part: [], theme: '', votes: {}, res: null };
    players.forEach(function(p){ G.drinks[p.id] = 0; });
    startRound(G, rnd);
    return G;
  }
  function startRound(G, rnd){
    if(G.deckPos >= G.deck.length){
      var a = []; for(var i = 0; i < THEMES.length; i++) a.push(i);
      for(var k = a.length - 1; k > 0; k--){ var j = rnd(k + 1); var t = a[k]; a[k] = a[j]; a[j] = t; }
      G.deck = a; G.deckPos = 0;
    }
    G.theme = THEMES[G.deck[G.deckPos++]];
    G.part = G.players.map(function(p){ return p.id; }).filter(function(id){ return !G.offline[id]; });
    G.round++; G.phase = 'vote'; G.votes = {}; G.res = null;
  }
  function maybeAdvance(G){
    if(G.phase !== 'vote') return;
    var act = activeIds(G);
    if(act.length && act.every(function(id){ return G.votes[id] != null; })) finish(G);
  }
  function finish(G){
    G.res = resolve(G.votes, G.part); G.phase = 'result';
    G.res.drinkers.forEach(function(id){ G.drinks[id]++; });
  }
  function act(G, pid, a, rnd){
    if(!a || typeof a !== 'object') return { error: '操作が不正です' };
    if(a.t === 'vote'){
      if(G.phase !== 'vote' || !inPart(G, pid)) return { error: '今は投票できません' };
      if(G.part.indexOf(a.target) < 0 || a.target === pid) return { error: 'その人は選べません' };
      G.votes[pid] = a.target; maybeAdvance(G); return { ok: true };
    }
    if(a.t === 'next'){
      if(pid !== 'p0' || G.phase !== 'result') return { error: 'ホストだけが進められます' };
      startRound(G, rnd); return { ok: true };
    }
    return { error: '未対応の操作' };
  }
  function force(G){ if(G.phase === 'vote') finish(G); }
  function waiting(G){ return G.phase === 'vote' ? activeIds(G).filter(function(id){ return G.votes[id] == null; }) : []; }
  function view(G, pid){
    var v = { phase: G.phase, round: G.round, theme: G.theme, part: G.part, drinks: G.drinks, inPart: inPart(G, pid) };
    if(G.phase === 'vote'){ v.myVote = G.votes[pid] || null; v.voted = Object.keys(G.votes); }
    else { v.counts = G.res.counts; v.tops = G.res.tops; v.allEqual = G.res.allEqual; v.drinkers = G.res.drinkers; }   // 誰が誰に入れたかは含めない
    return v;
  }
  var game = { newState: newState, act: act, view: view, waiting: waiting, force: force, sync: maybeAdvance };
  /* PURE-END */

  function render(root, ctx){
    var v = ctx.view, esc = ctx.esc, me = ctx.me, h = '';
    function btn(id, label, cls){ return '<button class="' + (cls || 'btn-primary') + '" id="' + id + '">' + label + '</button>'; }
    var top = '<div class="eyebrow">ROUND ' + v.round + '</div>';
    if(v.phase === 'vote' && !v.inPart){
      h = top + '<div class="card-ui"><div class="big-text">このラウンドは観戦中</div><div class="sub-text">途中で入り直したので、次のラウンドから参加できます。</div></div>' + ctx.waitHtml();
    } else if(v.phase === 'vote'){
      var cur = ctx.local.pick || v.myVote;
      h = top + '<div class="card-ui"><div class="sub-text" style="margin:0 0 8px">お題</div><div class="big-text">' + esc(v.theme) + '</div>' +
        '<div class="sub-text">自分以外から1人を選ぶ。誰が誰に入れたかは公開されません(票数だけ発表)。</div></div>' +
        '<div style="display:flex;flex-direction:column;gap:10px;margin-top:14px">' +
        v.part.filter(function(id){ return id !== me; }).map(function(id){
          var sel = cur === id;
          return '<button class="btn-ghost" data-v="' + id + '" style="margin:0;text-align:left;display:flex;align-items:center;gap:10px;padding:12px 14px;' + (sel ? 'border-color:var(--accent);background:rgba(79,195,217,.12);color:var(--text)' : '') + '">' + ctx.chip(id) + '</button>';
        }).join('') + '</div>' +
        '<div class="waitbar">' + (v.voted.length ? '投票済み: ' + v.voted.map(function(id){ return esc(ctx.nameOf(id)); }).join('・') : '') + '</div>' +
        ctx.waitHtml() + '<div class="spacer"></div><div class="bottombar">' + btn('bVoteOk', v.myVote ? '投票を変更する' : '投票する') + '</div>';
    } else {
      var order = v.part.slice().sort(function(a, b){ return v.counts[b] - v.counts[a]; });
      var rows = order.map(function(id){
        var c = v.counts[id], dr = v.drinkers.indexOf(id) >= 0;
        return '<div style="display:flex;align-items:center;gap:10px;background:var(--bg-surface);border:1.5px solid ' + (dr ? 'var(--danger)' : 'var(--line)') + ';border-radius:14px;padding:10px 12px;margin-top:8px">' +
          ctx.chip(id) + '<span style="margin-left:auto;font-size:22px;font-weight:900;color:' + (dr ? 'var(--danger)' : 'var(--text)') + '">' + c + '<span style="font-size:11px;color:var(--text-muted)"> 票</span></span>' +
          '<span style="width:44px;text-align:right;font-size:12px;font-weight:900;color:var(--danger)">' + (dr ? '飲む' : '') + '</span></div>';
      }).join('');
      var board = ctx.players.map(function(p){ return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">' + ctx.chip(p.id) +
        '<span style="margin-left:auto;font-size:18px;font-weight:900">' + (v.drinks[p.id] || 0) + '<span style="font-size:11px;color:var(--text-muted)"> 杯</span></span></div>'; }).join('');
      h = top + '<div class="card-ui"><div class="sub-text" style="margin:0 0 8px">' + esc(v.theme) + '</div>' +
        (v.allEqual ? '<div class="big-text" style="color:var(--gold)">全員同票。ノーカウント</div>'
          : '<div class="big-text" style="color:var(--danger)">' + v.drinkers.map(function(id){ return esc(ctx.nameOf(id)); }).join('・') + ' が飲む</div>' +
            (v.tops.length > 1 ? '<div class="sub-text">同票トップは全員飲む</div>' : '')) + '</div>' +
        '<div class="section-label">得票数</div>' + rows +
        '<div class="section-label">ここまでの飲んだ回数</div><div style="background:var(--bg-surface);border:1px solid var(--line);border-radius:14px;padding:2px 14px">' + board + '</div>' +
        '<div class="spacer"></div><div class="bottombar">' +
        (ctx.isHost ? btn('bNext', '次のお題へ') : '<div class="sub-text" style="text-align:center">ホストが次へ進めるのを待っています…</div>') + '</div>';
    }
    root.innerHTML = h;
    var q = function(id){ return document.getElementById(id); };
    root.querySelectorAll('[data-v]').forEach(function(b){ b.onclick = function(){
      ctx.local.pick = b.dataset.v;
      root.querySelectorAll('[data-v]').forEach(function(x){ x.style.borderColor = ''; x.style.background = ''; x.style.color = ''; });
      b.style.borderColor = 'var(--accent)'; b.style.background = 'rgba(79,195,217,.12)'; b.style.color = 'var(--text)';
    }; });
    if(q('bVoteOk')) q('bVoteOk').onclick = function(){
      var t = ctx.local.pick || v.myVote;
      if(!t){ ctx.toast('投票先を選んでください'); return; }
      ctx.send({ t: 'vote', target: t }); ctx.tone(520, 0.08, 'triangle', 0.1);
    };
    if(q('bNext')) q('bNext').onclick = function(){ ctx.send({ t: 'next' }); };
    if(v.phase !== 'vote') ctx.local.pick = null;
  }

  NO.register({
    id: 'shimei', emoji: '🫵', title: '秘密指名ゲーム', accent: '#FF8A5B', accentInk: '#2B1006', min: 3, max: 10,
    tagline: 'お題に当てはまる人を、こっそり指名。いちばん指名された人が飲む。誰が入れたかは内緒。',
    rules: [
      'お題(例:「一番、遅刻しそうな人」)が出る。',
      '全員が、自分以外から1人を<b>こっそり</b>指名する。',
      '全員の投票がそろったら票数だけを発表。<b>最多得票の人が飲む</b>(同票トップは全員)。',
      '誰が誰に入れたかは、アプリ上では公開されない。全員が同じ票数ならノーカウント。'
    ],
    game: game, render: render
  });
})();
