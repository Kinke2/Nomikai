/*
  感覚ならべ(オンライン版・開発中)
  各自のスマホに1〜100の秘密の数字。「ひとこと」で伝え合い、全員の画面で共有した並びをドラッグで小さい順に並べ替える。
  公平性: 数字の配布・並びの初期状態・お題の順番は crypto.getRandomValues による一様乱数(Fisher-Yates)。
          判定は順位のズレ(Spearman's footrule の1項)を優先し、同率のときだけ数値のズレ幅を使う。それも同じなら全員が同率。補正・調整なし。
  参考文献:
    [1] ito(原型となった協力型の数字ゲーム。ルールを参考に、お題・実装は本作オリジナル)
        https://news.mynavi.jp/article/20240229-2853646/
        https://camphack.nap-camp.com/4371
        https://opinionatedgamers.com/2023/12/05/dale-yu-review-of-ito/
    [2] Diaconis & Graham (1977) Spearman's footrule as a measure of disarray. J. R. Stat. Soc. B 39(2)
        および解説: https://arxiv.org/html/2404.16755v1
    [3] Fisher-Yates shuffle https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
    [4] MDN Pointer events / setPointerCapture https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture
    [5] 通信・乱数・参考文献一覧は online-core.js の冒頭を参照
  (オンライン ロビーに登録されるゲーム。通信・部屋・QRは online-core.js が担当)
*/
(function(){
  'use strict';
  var NO = window.NomikaiOnline;

  var THEMES = [
    ['強そうな生き物','弱そう','強そう'],
    ['かわいい生き物','かわいくない','めちゃくちゃかわいい'],
    ['優しそうな動物','怖そう','優しそう'],
    ['家に置いたら困る生き物','全然困らない','絶対困る'],
    ['生まれ変わったらなりたい生き物','絶対なりたくない','絶対なりたい'],
    ['猫っぽいか、犬っぽいか','超・猫っぽい','超・犬っぽい'],
    ['明日の二日酔いのつらさ','ケロッと元気','起き上がれない'],
    ['飲み会で言われてうれしい一言','微妙','最高にうれしい'],
    ['酔ったときにやりがちなこと(やばさ)','かわいいもの','事件'],
    ['飲み会の幹事の大変さ','楽勝','地獄'],
    ['一気飲みしたくない飲み物','余裕で飲める','絶対ムリ'],
    ['何杯でも飲めそうなお酒','1杯で限界','無限に飲める'],
    ['お酒に合うおつまみ','合わない','最高に合う'],
    ['割り勘で損した気分になる度','お得','大損'],
    ['二次会に行きたい度','帰りたい','朝まで行く'],
    ['終電を逃したときの絶望度','余裕','絶望'],
    ['酔ってるときに送ってはいけないメッセージ','送っても平気','絶対ダメ'],
    ['無人島で役に立つもの','役に立たない','命綱'],
    ['世界を救えそうなもの','無力','救世主'],
    ['家に忘れたら致命傷なもの','なくても余裕','致命傷'],
    ['ラーメンのこってり度','あっさり','ドロドロ'],
    ['辛い食べ物','全然辛くない','地獄の辛さ'],
    ['甘い食べ物','甘くない','激甘'],
    ['夏に食べたい度(食べ物)','冬向き','夏向き'],
    ['最後に取っておきたい食べ物','先に食べたい','絶対に最後'],
    ['お弁当に入っていたらうれしいおかず','がっかり','大喜び'],
    ['カレーに入れたい具','入れたくない','絶対入れたい'],
    ['おにぎりの具の王道度','変わり種','王道'],
    ['お寿司ネタの高級感','庶民的','超高級'],
    ['揚げ物のカロリーが高そうな度','ヘルシー','悪魔'],
    ['コンビニで買うと得した気分になるもの','損した気分','大得'],
    ['社食・学食でテンションが上がるメニュー','下がる','上がる'],
    ['布団から出たくない度','余裕で起きる','絶対出たくない'],
    ['遅刻したときの絶望度','平気','人生終了'],
    ['待たされるとイライラする場所','全然平気','爆発しそう'],
    ['ドキドキする瞬間','落ち着く','心臓が止まりそう'],
    ['怖いもの','怖くない','失神'],
    ['お風呂の温度','ぬるすぎ','熱すぎ'],
    ['部屋の散らかり度','モデルルーム','足の踏み場がない'],
    ['スマホの電池が減ってきたときの焦り度','余裕','絶体絶命'],
    ['SNSで「いいね」がついたときのうれしさ','どうでもいい','飛び跳ねる'],
    ['恥ずかしい失敗','笑える','恥ずかしくて消えたい'],
    ['お金がかかりそうな趣味','ほぼタダ','破産する'],
    ['モテそうな職業','モテなさそう','めっちゃモテそう'],
    ['大変そうな仕事','楽そう','過酷'],
    ['テスト前の絶望感','余裕','もう無理'],
    ['お化け屋敷の怖さ','余裕','絶叫'],
    ['カラオケで歌うのが恥ずかしい曲','平気','公開処刑'],
    ['旅行で行きたい場所の遠さ','近所','地球の裏側'],
    ['ジェットコースターの怖さ','余裕','無理'],
    ['朝っぽいか、夜っぽいか','超・朝っぽい','超・夜っぽい'],
    ['熱いもの','冷たい','燃えている'],
    ['うるさいもの','静か','爆音'],
    ['においが強いもの','無臭','強烈'],
    ['硬いもの','やわらかい','カチカチ'],
    ['速いもの','遅い','光速級'],
    ['高い場所','地面','宇宙'],
    ['古いもの','最新','大昔'],
    ['高そうなもの','100円','100万円'],
    ['眠くなるもの','目が覚める','即・寝る'],
    ['シブいもの','ポップ','シブい'],
    ['ゆるいもの','キッチリ','ゆるゆる'],
    ['汚れていそうなもの','ピカピカ','不潔'],
    ['不思議なもの','普通','謎すぎる'],
    ['ひとりで入りづらいお店','余裕','絶対ムリ'],
    ['恋人にされたら引くこと','平気','ドン引き'],
    ['デートで失敗しにくい場所','危険','安全'],
    ['友達に貸したくないもの','全然OK','絶対貸さない'],
    ['親に見られたくないもの','平気','絶対見られたくない'],
    ['先生に怒られそうなこと','セーフ','大目玉'],
    ['休日にやりたいこと(インドア/アウトドア)','超・インドア','超・アウトドア'],
    ['憂鬱な曜日','最高の日','最悪の日'],
    ['夢に出てきたら嫌なもの','平気','悪夢'],
    ['ずっと見ていられるもの','すぐ飽きる','一生見ていられる'],
    ['もらったら困る量のもの','少なすぎて困る','多すぎて困る'],
    ['ごほうび感があるもの','ふつう','特別なごほうび'],
    ['時間がたつのが早く感じること','長く感じる','あっという間'],
    ['緊張する場面','リラックス','ガチガチ'],
    ['大人になって食べられるようになったもの','今でも苦手','大好物になった'],
    ['雨の日にやりたくないこと','平気','絶対イヤ']
  ];

  /* PURE-BEGIN */
  // Fisher-Yates [2]。j は [0, i] の閉区間(i 未満にすると偏る)
  function shuffle(arr, rand){
    var a = arr.slice();
    for(var i = a.length - 1; i > 0; i--){
      var j = rand(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  // 1〜100 から重複なしで n 個を一様に配る
  function dealNumbers(n, rand){
    var pool = [];
    for(var i = 1; i <= 100; i++) pool.push(i);
    return shuffle(pool, rand).slice(0, n);
  }
  // numbers[p] = プレイヤー p の数字 / order = 「小さい順」と主張された並び(プレイヤー番号の配列)
  // 一番ズレた人の決め方:
  //  1) 順位のズレ = |並べた位置 − 本来の順位|。これが最大の人が「候補」
  //     (Spearman's footrule の1項に相当 [9])。
  //  2) 候補が複数(同率)のときだけ、数値のズレ幅で決める。
  //     数値のズレ幅 = |自分の数字 − 本来その位置に来るはずの数字|
  //     (その位置に来るはずの数字 = 全員の数字を小さい順に並べた、その位置番目の数字)。
  //     候補の中で数値のズレ幅が最大の人が一番ズレた人。
  //  3) それも同じなら、同率の全員が一番ズレた人。
  // 順位のズレが小さい人は、数値のズレ幅が大きくても敗者にならない(あくまで同率のときだけ使う)。
  function scoreOrder(numbers, order){
    var idx = numbers.map(function(v, i){ return i; });
    idx.sort(function(a, b){ return numbers[a] - numbers[b]; });
    var sortedNums = idx.map(function(p){ return numbers[p]; });
    var rank = {};
    idx.forEach(function(p, k){ rank[p] = k + 1; });
    var rows = order.map(function(p, k){
      var pos = k + 1;
      return { player:p, num:numbers[p], pos:pos, rank:rank[p], disp:Math.abs(pos - rank[p]),
               expect:sortedNums[k], gap:Math.abs(numbers[p] - sortedNums[k]), cand:false, worst:false };
    });
    var max = Math.max.apply(null, rows.map(function(r){ return r.disp; }));
    var cands = (max > 0) ? rows.filter(function(r){ return r.disp === max; }) : [];
    cands.forEach(function(r){ r.cand = true; });
    var maxGap = cands.length ? Math.max.apply(null, cands.map(function(r){ return r.gap; })) : 0;
    var worst = cands.filter(function(r){ return r.gap === maxGap; });
    worst.forEach(function(r){ r.worst = true; });
    return {
      rows:rows, max:max, allCorrect:(max === 0),
      tiedByRank:(cands.length > 1),                                   // 順位のズレが同率だった
      decidedByGap:(cands.length > 1 && worst.length < cands.length),  // 数値のズレ幅で絞り込めた
      candidates:cands.map(function(r){ return r.player; })
    };
  }

  // ドラッグ並べ替え用。arr の from 番目を to 番目へ移す(他の要素は順序を保ったままずれる)
  function moveItem(arr, from, to){
    var a = arr.slice();
    var x = a.splice(from, 1)[0];
    a.splice(to, 0, x);
    return a;
  }

  function activeIds(G){ return G.part.filter(function(id){ return !G.offline[id]; }); }
  function inPart(G, pid){ return G.part.indexOf(pid) >= 0; }

  function newState(players, rnd){
    var G = { players: players, offline: {}, round: 0, drinks: {}, deck: [], deckPos: 0, phase: null, part: [],
              theme: null, nums: {}, clues: {}, order: [], res: null };
    players.forEach(function(p){ G.drinks[p.id] = 0; });
    startRound(G, rnd);
    return G;
  }
  function startRound(G, rnd){
    if(G.deckPos >= G.deck.length){
      var a = []; for(var i = 0; i < THEMES.length; i++) a.push(i);
      G.deck = shuffle(a, rnd); G.deckPos = 0;
    }
    G.theme = THEMES[G.deck[G.deckPos++]];
    G.part = G.players.map(function(p){ return p.id; }).filter(function(id){ return !G.offline[id]; });
    var nums = dealNumbers(G.part.length, rnd);            // 1〜100から重複なしで一様に配る
    G.nums = {}; G.part.forEach(function(id, i){ G.nums[id] = nums[i]; });
    G.clues = {};
    G.order = shuffle(G.part, rnd);                        // 並びの初期状態もランダム(番号順などの偏りを作らない)
    G.res = null; G.round++; G.phase = 'clue';
  }
  function reveal(G){
    var numbers = G.part.map(function(id){ return G.nums[id]; });
    var order = G.order.map(function(id){ return G.part.indexOf(id); });
    var r = scoreOrder(numbers, order);
    var rows = r.rows.map(function(x){
      return { id: G.part[x.player], num: x.num, pos: x.pos, rank: x.rank, disp: x.disp, gap: x.gap, cand: x.cand, worst: x.worst };
    });
    G.res = { rows: rows, allCorrect: r.allCorrect, tiedByRank: r.tiedByRank, decidedByGap: r.decidedByGap,
              candidates: r.candidates.map(function(p){ return G.part[p]; }),
              worst: rows.filter(function(x){ return x.worst; }).map(function(x){ return x.id; }) };
    G.res.worst.forEach(function(id){ G.drinks[id]++; });
    G.phase = 'result';
  }
  function act(G, pid, a, rnd){
    if(!a || typeof a !== 'object') return { error: '操作が不正です' };
    switch(a.t){
      case 'clue':
        if(G.phase !== 'clue' || !inPart(G, pid)) return { error: '今は入力できません' };
        G.clues[pid] = String(a.text || '').trim().slice(0, 16); return { ok: true };
      case 'toOrder':
        if(pid !== 'p0' || G.phase !== 'clue') return { error: 'ホストだけが進められます' };
        G.phase = 'order'; return { ok: true };
      case 'move':
        if(G.phase !== 'order' || !inPart(G, pid)) return { error: '今は並べられません' };
        var from = G.order.indexOf(a.id);
        if(from < 0 || typeof a.to !== 'number' || a.to % 1 !== 0 || a.to < 0 || a.to >= G.order.length) return { error: '位置が不正です' };
        G.order = moveItem(G.order, from, a.to); return { ok: true };
      case 'reveal':
        if(pid !== 'p0' || G.phase !== 'order') return { error: 'ホストだけが進められます' };
        reveal(G); return { ok: true };
      case 'next':
        if(pid !== 'p0' || G.phase !== 'result') return { error: 'ホストだけが進められます' };
        startRound(G, rnd); return { ok: true };
    }
    return { error: '未対応の操作' };
  }
  function force(G){ if(G.phase === 'clue') G.phase = 'order'; else if(G.phase === 'order') reveal(G); }
  function waiting(G){ return []; }
  function view(G, pid){
    var v = { phase: G.phase, round: G.round, theme: G.theme, part: G.part, drinks: G.drinks, inPart: inPart(G, pid), clues: G.clues };
    if(G.phase !== 'result'){ v.myNumber = inPart(G, pid) ? G.nums[pid] : null; }     // 自分の数字だけ
    if(G.phase === 'order') v.order = G.order;
    if(G.phase === 'result'){ v.res = G.res; }
    return v;
  }
  var game = { newState: newState, act: act, view: view, waiting: waiting, force: force, sync: function(){} };
  /* PURE-END */

  function render(root, ctx){
    var v = ctx.view, esc = ctx.esc, me = ctx.me, h = '';
    function btn(id, label, cls){ return '<button class="' + (cls || 'btn-primary') + '" id="' + id + '">' + label + '</button>'; }
    var T = v.theme;
    var top = '<div class="eyebrow">ROUND ' + v.round + '</div>';
    function scale(){
      return '<div style="display:flex;align-items:center;gap:8px;margin-top:14px"><div style="flex:1;background:var(--bg-raised);border-radius:12px;padding:8px"><b style="display:block;font-size:17px;color:var(--accent)">1</b><span style="font-size:12px">' + esc(T[1]) + '</span></div>' +
        '<span style="color:var(--text-muted)">⇄</span><div style="flex:1;background:var(--bg-raised);border-radius:12px;padding:8px"><b style="display:block;font-size:17px;color:var(--accent)">100</b><span style="font-size:12px">' + esc(T[2]) + '</span></div></div>';
    }
    var themeCard = '<div class="card-ui"><div class="big-text" style="font-size:24px">' + esc(T[0]) + '</div>' + scale() + '</div>';
    var wasSort = ctx.local.sort && ctx.local.sortRound === v.round && v.phase === 'order';
    if(v.phase === 'order' && wasSort && root.contains(ctx.local.sortBox)){
      ctx.local.sort.update(v.order); return;                    // ドラッグ中でも壊さずに、届いた並びだけ反映する
    }
    ctx.local.sort = null;
    if(v.phase !== 'result' && !v.inPart){
      h = top + themeCard + '<div class="sub-text" style="text-align:center">このラウンドは観戦中です。</div>';
    } else if(v.phase === 'clue'){
      var cl = v.part.map(function(id){
        return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0">' + ctx.chip(id) + '<span style="font-size:14px;font-weight:700">' + (v.clues[id] ? esc(v.clues[id]) : '<span style="color:var(--text-muted);font-weight:400">(未入力)</span>') + '</span></div>';
      }).join('');
      h = top + themeCard +
        '<div class="card-ui" style="margin-top:12px"><div class="sub-text" style="margin:0 0 8px">あなたの数字(押している間だけ表示)</div>' +
        '<div id="hold" style="touch-action:none;-webkit-user-select:none;user-select:none;background:var(--bg-raised);border:2px dashed var(--line);border-radius:18px;padding:18px 0;min-height:96px;display:flex;align-items:center;justify-content:center">' +
        '<span id="holdIdle" style="color:var(--text-muted);font-weight:700">長押しで見る</span><span id="holdNum" style="display:none;font-size:64px;font-weight:900;color:var(--accent);line-height:1">' + v.myNumber + '</span></div>' +
        '<div class="sub-text">数字を言わずに、お題に合う「ひとこと」で大きさを伝える(声でも、下に書いてもOK)。</div></div>' +
        '<div class="section-label">ひとこと(任意・全員に見える)</div>' +
        '<div style="display:flex;gap:8px"><input class="field" id="inClue" maxlength="16" placeholder="16文字まで" autocomplete="off" value="' + esc(v.clues[me] || '') + '"><button class="btn-primary" id="bClue" style="width:auto;padding:0 18px">送る</button></div>' +
        '<div style="margin-top:10px">' + cl + '</div>' +
        '<div class="spacer"></div><div class="bottombar">' + (ctx.isHost ? btn('bOrder', 'みんなで並べる段階へ') : '<div class="sub-text" style="text-align:center">ホストが並べる段階へ進めるのを待っています…</div>') + '</div>';
    } else if(v.phase === 'order'){
      h = top + '<div class="card-ui" style="padding:12px"><div class="big-text" style="font-size:18px">' + esc(T[0]) + '</div></div>' +
        '<div style="text-align:center;font-size:12px;font-weight:700;color:var(--accent);margin:10px 0 6px">▲ 1側(小さい): ' + esc(T[1]) + '</div>' +
        '<div id="slots"></div>' +
        '<div style="text-align:center;font-size:12px;font-weight:700;color:var(--accent);margin:6px 0 4px">' + esc(T[2]) + ' :100側(大きい) ▼</div>' +
        '<div class="sub-text" style="text-align:center">全員の画面で同じ並び。カードをドラッグして、みんなで「小さい順」に並べ直す。<br>自分の数字が合う位置を考えて、話し合いながら動かそう。</div>' +
        '<div class="spacer"></div><div class="bottombar">' + (ctx.isHost ? btn('bReveal', 'この並びで答え合わせ') : '<div class="sub-text" style="text-align:center">ホストが答え合わせするのを待っています…</div>') + '</div>';
    } else {
      var R = v.res;
      var rows = R.rows.map(function(r){
        return '<div style="display:flex;align-items:center;gap:10px;background:var(--bg-surface);border:1.5px solid ' + (r.worst ? 'var(--danger)' : r.disp === 0 ? 'rgba(232,194,74,.6)' : 'var(--line)') + ';border-radius:14px;padding:10px 12px;margin-top:8px' + (r.worst ? ';box-shadow:0 0 18px rgba(255,90,69,.3)' : '') + '">' +
          '<span style="width:18px;text-align:center;color:var(--text-muted);font-weight:900">' + r.pos + '</span>' + ctx.chip(r.id) +
          '<span style="font-size:26px;font-weight:900;flex:1;text-align:center">' + r.num + '</span>' +
          '<span style="font-size:11px;color:var(--text-muted);text-align:right;line-height:1.5;min-width:92px">本来 ' + r.rank + '番目(ズレ' + r.disp + ')<br>数値ズレ ' + r.gap + '</span>' +
          '<span style="width:22px;text-align:center">' + (r.worst ? '💥' : r.disp === 0 ? '✓' : '') + '</span></div>';
      }).join('');
      var names = R.worst.map(function(id){ return esc(ctx.nameOf(id)); }).join('・');
      var sub = '';
      if(R.allCorrect) sub = '全員、ぴったり。見事。';
      else if(R.tiedByRank && R.decidedByGap) sub = '順位のズレが同率(' + R.candidates.map(function(id){ return esc(ctx.nameOf(id)); }).join('・') + ')だったので、数値のズレ幅で決着';
      else if(R.tiedByRank) sub = '順位のズレも数値のズレ幅も同じ(' + R.candidates.map(function(id){ return esc(ctx.nameOf(id)); }).join('・') + ')なので、同率で全員';
      var board = ctx.players.map(function(p){ return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">' + ctx.chip(p.id) +
        '<span style="margin-left:auto;font-size:18px;font-weight:900">' + (v.drinks[p.id] || 0) + '<span style="font-size:11px;color:var(--text-muted)"> 杯</span></span></div>'; }).join('');
      h = top + '<div class="card-ui"><div class="sub-text" style="margin:0 0 6px">' + esc(T[0]) + '</div>' +
        (R.allCorrect ? '<div class="big-text" style="color:var(--gold)">全員正解!誰も飲まない</div>' : '<div class="big-text" style="color:var(--danger)">' + names + ' が一番ズレた。飲む。</div>') +
        '<div class="sub-text">' + sub + '</div></div>' + rows +
        '<div class="section-label">ここまでの飲んだ回数</div><div style="background:var(--bg-surface);border:1px solid var(--line);border-radius:14px;padding:2px 14px">' + board + '</div>' +
        '<div class="spacer"></div><div class="bottombar">' + (ctx.isHost ? btn('bNext', '次のお題へ') : '<div class="sub-text" style="text-align:center">ホストが次へ進めるのを待っています…</div>') + '</div>';
    }
    root.innerHTML = h;
    var q = function(id){ return document.getElementById(id); };
    if(v.phase === 'clue' && v.inPart){
      var hold = q('hold');
      var on = function(e){ e.preventDefault(); q('holdIdle').style.display = 'none'; q('holdNum').style.display = 'block'; hold.style.borderColor = 'var(--accent)'; };
      var off = function(){ q('holdIdle').style.display = ''; q('holdNum').style.display = 'none'; hold.style.borderColor = ''; };
      hold.addEventListener('pointerdown', on);
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function(ev){ hold.addEventListener(ev, off); });
      hold.addEventListener('contextmenu', function(e){ e.preventDefault(); });
      q('bClue').onclick = function(){ ctx.send({ t: 'clue', text: q('inClue').value }); ctx.toast('送りました'); };
      q('inClue').addEventListener('keydown', function(e){ if(e.key === 'Enter') q('bClue').click(); });
    }
    if(q('bOrder')) q('bOrder').onclick = function(){ ctx.send({ t: 'toOrder' }); };
    if(q('bReveal')) q('bReveal').onclick = function(){ ctx.send({ t: 'reveal' }); };
    if(q('bNext')) q('bNext').onclick = function(){ ctx.send({ t: 'next' }); };
    if(v.phase === 'order' && v.inPart){
      var clues = v.clues;
      var items = v.order.map(function(id){ return { id: id, html: ctx.chip(id) + (clues[id] ? '<span style="font-size:12px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(clues[id]) + '</span>' : '') }; });
      // 各カードは固定の並びIDで作り、座標だけを order に合わせる
      var box = q('slots');
      var sort = ctx.sortList(box, {
        items: items, onDrop: function(id, to){ ctx.send({ t: 'move', id: id, to: to }); }
      });
      sort.update(v.order);
      ctx.local.sort = sort; ctx.local.sortRound = v.round; ctx.local.sortBox = box;
    }
  }

  NO.register({
    id: 'kankaku', emoji: '📏', title: '感覚ならべ', accent: '#F17FB1', accentInk: '#2B0A18', min: 3, max: 8,
    tagline: '各自のスマホに秘密の数字。お題に合うひとことで大きさを伝えて、みんなで小さい順に並べる。',
    rules: [
      '全員に <b>1〜100の秘密の数字</b>が1枚ずつ配られる(自分だけが見られる)。',
      'お題に合う「ひとこと」で、数字の大きさをそれとなく伝える。数字そのものは言わない。',
      '全員の画面で同じ並びを共有し、カードを<b>ドラッグして小さい順に並べる</b>。',
      '答え合わせで<b>一番ズレた人が飲む</b>。順位のズレが同率のときだけ数値のズレ幅で決着。それも同じなら同率で全員。'
    ],
    game: game, render: render
  });
})();
