/*
  インディアンポーカー(オンライン版・開発中)
  みんなに1枚ずつトランプが配られる。自分のスマホには自分のカードが大きく出る。
  それを自分は見ないまま、画面を外に向けて額(頭の上)にかざす → 他の人のカードだけが見える状態で、
  「自分のカードは勝てそうか?」を読み合う(誰が強そうか・降りるか勝負するか は、みんなで口頭で決める)。
  アプリがやるのは「配る・見せる・答え合わせ」だけ。勝敗の細かい判定や点数計算はしない(見た目重視)。
  進行: 準備(カードは裏向き。各自「準備OK」→ スマホを立てて額に当てる)→ 全員が額に当てたことを検知 → 5秒カウントダウン → カードが表になる → 答え合わせ(全員のカードと強さ順を公開)
          カウントダウン中に誰かがスマホを下ろしたら、待機に戻る(全員がそろうまで始まらない)。
  公平性: 山札は 52枚(+ジョーカー)を crypto.getRandomValues の棄却サンプリング(randInt)+ Fisher–Yates でシャッフルして
          先頭から1人1枚ずつ配るだけ。同じラウンドで同じカードが重なることはない。配り方・強さの扱いにアプリ側の補正は一切ない。
          カードの強さは 2 < 3 < … < 10 < J < Q < K < A < ジョーカー(Aを弱くする設定も選べる)。同じ強さは「同点」と表示する。
  スマホの傾き: 画面が上を向いている(寝かせている)間は裏向きを表示。スマホを立てて額にかざすと表向きになる。
          加速度センサー(DeviceMotion の重力方向。画面の法線が水平に近いほど「立っている」)で判定する。傾き判定には余裕(ヒステリシス)を持たせている。
          iPhone はセンサーの許可が必要で、「準備OK」や「カウントダウン開始」を押したときに許可を求める。センサーが使えない端末では、手動で表示/裏向きを切り替えるボタンが出る。
  カード交換: 各自1ラウンドに1回だけ、自分のカードを山札の次のカードと交換できる(交換前のカードは捨て札。どちらのカードも自分には見えない)。
          交換した人は全員の画面に表示される。答え合わせでは「交換前→交換後」も公開する。
  注意: 自分のカードは自分の画面に出る。画面を見ないで額にかざすのは、遊ぶ人同士のルール(アプリでは強制できない)。
          スマホを立てて自分の顔の前で眺めれば見えてしまう(センサーは「立っているか」しか分からない)。
    [5] MDN DeviceMotionEvent(加速度センサー): https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent
  参考文献:
    [1] Blind man's bluff(Indian poker): https://en.wikipedia.org/wiki/Blind_man%27s_bluff_(poker)
    [2] Fisher–Yates shuffle(偏りのないシャッフル): https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
    [3] MDN Web Audio API(効果音の合成): https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
    [4] 通信・乱数・参考文献一覧は online-core.js の冒頭を参照
  (オンライン ロビーに登録されるゲーム。通信・部屋・QRは online-core.js が担当)
*/
(function(){
  'use strict';
  var NO = window.NomikaiOnline;

  /* PURE-BEGIN */
  var SUITS = ['♠', '♥', '♦', '♣'];
  var JOKER = 15;
  function activeIds(G){ return G.part.filter(function(id){ return !G.offline[id]; }); }
  function inPart(G, pid){ return G.part.indexOf(pid) >= 0; }
  function shuffle(arr, rnd){                       // Fisher–Yates
    var a = arr.slice();
    for(var i = a.length - 1; i > 0; i--){ var j = rnd(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function makeDeck(joker, rnd){
    var d = [];
    for(var s = 0; s < 4; s++) for(var r = 2; r <= 14; r++) d.push({ r: r, s: s });
    if(joker) d.push({ r: JOKER, s: -1 });
    return shuffle(d, rnd);
  }
  function strength(c, aceHigh){
    if(c.r === JOKER) return 99;
    if(c.r === 14) return aceHigh ? 14 : 1;
    return c.r;
  }

  function newState(players, rnd){
    var G = { players: players, offline: {}, phase: 'setup', joker: false, aceHigh: true, round: 0, part: [], cards: {}, ready: {}, up: {}, countNo: 0, forced: false, deck: [], dpos: 0, swapped: {}, old: {} };
    syncSetup(G);
    return G;
  }
  function syncSetup(G){ G.part = G.players.map(function(p){ return p.id; }).filter(function(id){ return !G.offline[id]; }); }
  function deal(G, rnd){
    syncSetup(G);
    var deck = makeDeck(G.joker, rnd);
    G.cards = {}; G.ready = {}; G.up = {}; G.swapped = {}; G.old = {};
    G.part.forEach(function(id, i){ G.cards[id] = deck[i]; });      // 先頭から1人1枚(重複なし)
    G.deck = deck; G.dpos = G.part.length;                          // 残りの山札(交換用。host の内部だけが持つ)
    G.round++; G.phase = 'ready';
  }
  function startCount(G, forced){ G.phase = 'count'; G.countNo++; G.forced = !!forced; }
  // 全員(接続中の参加者)が「準備OK」かつ「額に当てている」→ カウントダウン開始。カウント中に誰かが下ろしたら待機に戻る
  function allUp(G){ var a = activeIds(G); return a.length >= 2 && a.every(function(id){ return G.ready[id] && G.up[id]; }); }
  function checkStart(G){
    if(G.phase === 'ready' && allUp(G)) startCount(G, false);
    else if(G.phase === 'count' && !G.forced && !allUp(G)) G.phase = 'ready';     // ホストが「待たずに始める」を押した場合は、下ろしてもやり直しにしない
  }
  function act(G, pid, a, rnd){
    if(!a || typeof a !== 'object') return { error: '操作が不正です' };
    var host = pid === 'p0';
    switch(a.t){
      case 'setJoker':
        if(!host || G.phase !== 'setup' || typeof a.v !== 'boolean') return { error: '今は変えられません' };
        G.joker = a.v; return { ok: true };
      case 'setAce':
        if(!host || G.phase !== 'setup' || typeof a.v !== 'boolean') return { error: '今は変えられません' };
        G.aceHigh = a.v; return { ok: true };
      case 'start':
        if(!host || G.phase !== 'setup') return { error: 'ホストだけが始められます' };
        syncSetup(G); if(G.part.length < 2) return { error: '2人以上必要です' };
        G.round = 0; deal(G, rnd); return { ok: true };
      case 'ready':
        if(G.phase !== 'ready' || !inPart(G, pid)) return { error: '今は押せません' };
        G.ready[pid] = true; return { ok: true };
      case 'up':      // 「いま額に当てている(スマホが立っている)」の申告。センサーで検知した結果を各自の端末が送る
        if((G.phase !== 'ready' && G.phase !== 'count') || !inPart(G, pid) || typeof a.v !== 'boolean') return { error: '今は送れません' };
        if(!G.ready[pid]) return { error: '先に準備OKを押してください' };
        G.up[pid] = a.v; checkStart(G); return { ok: true };
      case 'count':     // ホストが待たずに始める(全員がそろわなくても)
        if(!host || G.phase !== 'ready') return { error: '今は始められません' };
        startCount(G, true); return { ok: true };
      case 'countDone':
        if(!host || G.phase !== 'count') return { error: '今は進められません' };
        G.phase = 'show'; return { ok: true };
      case 'swap':
        if(G.phase !== 'show' || !inPart(G, pid)) return { error: '今は交換できません' };
        if(G.swapped[pid]) return { error: '交換は1回だけです' };
        if(G.dpos >= G.deck.length) return { error: '山札がありません' };
        G.old[pid] = G.cards[pid]; G.cards[pid] = G.deck[G.dpos++]; G.swapped[pid] = true;      // 交換前は捨て札。山札の次の1枚と交換
        return { ok: true };
      case 'result':
        if(!host || G.phase !== 'show') return { error: '今は進められません' };
        G.phase = 'result'; return { ok: true };
      case 'next':
        if(!host || G.phase !== 'result') return { error: '今は進められません' };
        deal(G, rnd); return { ok: true };
      case 'resetup':
        if(!host || G.phase !== 'result') return { error: '今は戻れません' };
        G.phase = 'setup'; syncSetup(G); return { ok: true };
    }
    return { error: '未対応の操作' };
  }
  function force(G){
    if(G.phase === 'ready') startCount(G, true);
    else if(G.phase === 'count') G.phase = 'show';
    else if(G.phase === 'show') G.phase = 'result';
  }
  function waiting(G){ return G.phase === 'ready' ? activeIds(G).filter(function(id){ return !(G.ready[id] && G.up[id]); }) : []; }
  function sync(G){ if(G.phase === 'setup') syncSetup(G); else if(G.phase === 'ready' || G.phase === 'count') checkStart(G); }

  function view(G, pid){
    var v = { phase: G.phase, round: G.round, part: G.part, inPart: inPart(G, pid), joker: G.joker, aceHigh: G.aceHigh };
    if(G.phase === 'ready' || G.phase === 'count'){ v.myReady = !!G.ready[pid]; v.myUp = !!G.up[pid]; v.readyCount = Object.keys(G.ready).length; v.upCount = Object.keys(G.up).filter(function(id){ return G.up[id]; }).length; v.n = G.part.length; v.countNo = G.countNo; }
    if(G.phase === 'show'){ v.myCard = inPart(G, pid) ? G.cards[pid] : null; v.mySwapped = !!G.swapped[pid]; v.swapped = Object.keys(G.swapped); }       // 自分のカードだけ(他人のカードは送らない)
    if(G.phase === 'result'){
      var st = {}, mx = -1, mn = 1e9;
      G.part.forEach(function(id){ st[id] = strength(G.cards[id], G.aceHigh); mx = Math.max(mx, st[id]); mn = Math.min(mn, st[id]); });
      v.cards = G.cards; v.strong = st; v.old = G.old; v.swapped = Object.keys(G.swapped);
      v.highest = G.part.filter(function(id){ return st[id] === mx; });
      v.lowest = G.part.filter(function(id){ return st[id] === mn; });
      v.allTie = mx === mn;
    }
    return v;
  }
  var game = { newState: newState, act: act, view: view, waiting: waiting, force: force, sync: sync };
  /* PURE-END */

  /* ---------------- 見た目(カードの描画・演出) ---------------- */
  var LAB = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  function label(c){ return c.r === JOKER ? 'JOKER' : (LAB[c.r] || String(c.r)); }
  var RED = '#D62D20', BLK = '#14161c';
  // 数字札のシンボル配置(標準的なトランプの並び。座標は札の幅・高さに対する%。下半分の記号は上下逆さまに描く)
  var PIPS = {
    2: [[50, 20], [50, 80]], 3: [[50, 20], [50, 50], [50, 80]],
    4: [[30, 20], [70, 20], [30, 80], [70, 80]], 5: [[30, 20], [70, 20], [50, 50], [30, 80], [70, 80]],
    6: [[30, 20], [70, 20], [30, 50], [70, 50], [30, 80], [70, 80]],
    7: [[30, 20], [70, 20], [50, 35], [30, 50], [70, 50], [30, 80], [70, 80]],
    8: [[30, 20], [70, 20], [50, 35], [30, 50], [70, 50], [50, 65], [30, 80], [70, 80]],
    9: [[30, 18], [70, 18], [30, 39], [70, 39], [50, 50], [30, 61], [70, 61], [30, 82], [70, 82]],
    10: [[30, 18], [70, 18], [50, 29], [30, 39], [70, 39], [30, 61], [70, 61], [50, 71], [30, 82], [70, 82]]
  };
  function cardHtml(c, cls, st){
    cls = cls || ''; st = st || '';
    if(!c) return '<div class="ipc back ' + cls + '" style="' + st + '"><div class="bk">🍻</div></div>';
    var col = c.s === 1 || c.s === 2 ? RED : BLK, sy = c.s >= 0 ? SUITS[c.s] : '', L = label(c);
    if(c.r === JOKER){
      return '<div class="ipc ' + cls + '" style="color:#7a2fd0;' + st + '"><div class="jk">🃏</div><div class="jt">JOKER</div>' +
        '<div class="ci tl"><b>★</b></div><div class="ci br"><b>★</b></div></div>';
    }
    var mid = '';
    if(c.r === 14){ mid = '<div class="pip" style="left:50%;top:50%;font-size:calc(var(--w) * .62)">' + sy + '</div>'; }
    else if(c.r >= 11){ mid = '<div class="face"><div class="fl">' + L + '</div><div class="fs">' + sy + '</div></div>'; }
    else {
      mid = PIPS[c.r].map(function(p){
        // 隅の数字と重ならないよう、内側に寄せる。記号は上下逆さまにしない(♥が♠に見えて紛らわしいため)
        return '<div class="pip" style="left:' + (50 + (p[0] - 50) * 0.72).toFixed(1) + '%;top:' + (50 + (p[1] - 50) * 0.82).toFixed(1) + '%">' + sy + '</div>';
      }).join('');
    }
    return '<div class="ipc ' + cls + '" style="color:' + col + ';' + st + '">' + mid +
      '<div class="ci tl"><b>' + L + '</b><span>' + sy + '</span></div><div class="ci br"><b>' + L + '</b><span>' + sy + '</span></div></div>';
  }
  function miniHtml(c){
    if(c.r === JOKER) return '<span style="color:#9b59e6;font-weight:900">🃏 JOKER</span>';
    return '<span style="font-weight:900;color:' + (c.s === 1 || c.s === 2 ? '#ff6b5b' : '#e8e8ee') + '">' + SUITS[c.s] + label(c) + '</span>';
  }

  var CSS_ID = 'indian-css';
  var CSS = [
    '.ipw{--w:max(120px,min(80vw,calc((100vh - 310px) * .714)));display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1 1 auto;min-height:0;padding:14px 0;overflow:hidden;}',
    '@supports(height:100dvh){.ipw{--w:max(120px,min(80vw,calc((100dvh - 310px) * .714)));}.ipw.rdy{--w:max(120px,min(72vw,calc((100dvh - 400px) * .714)));}}',
    '.ipw.rdy{--w:max(120px,min(72vw,calc((100vh - 400px) * .714)));}',
    '.ipc{position:relative;width:var(--w);aspect-ratio:5/7;border-radius:calc(var(--w) * .06);background:linear-gradient(160deg,#ffffff 0%,#f3efe6 100%);box-shadow:0 14px 40px rgba(0,0,0,.55),inset 0 0 0 calc(var(--w) * .012) #d8d1c0;flex:0 0 auto;overflow:hidden;font-family:Georgia,"Times New Roman","Hiragino Mincho ProN",serif;}',
    '.ipc.mini{--w:64px;}',
    '.ipc.fillc{position:absolute;left:0;top:0;width:100%;height:100%;}',
    '.ci{position:absolute;display:flex;flex-direction:column;align-items:center;line-height:1;}',
    '.ci b{font-size:calc(var(--w) * .21);font-weight:900;letter-spacing:-.04em;}.ci span{font-size:calc(var(--w) * .17);margin-top:calc(var(--w) * .01);}',
    '.ci.tl{left:calc(var(--w) * .05);top:calc(var(--w) * .04);}.ci.br{right:calc(var(--w) * .05);bottom:calc(var(--w) * .04);}',
    '.pip{position:absolute;transform:translate(-50%,-50%);font-size:calc(var(--w) * .22);line-height:1;}',
    '.face{position:absolute;left:22%;right:22%;top:14%;bottom:14%;border:calc(var(--w) * .012) solid currentColor;border-radius:calc(var(--w) * .04);display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.03);}',
    '.face .fl{font-size:calc(var(--w) * .46);font-weight:900;line-height:1;}.face .fs{font-size:calc(var(--w) * .26);line-height:1;margin-top:calc(var(--w) * .02);}',
    '.jk{position:absolute;left:0;right:0;top:20%;text-align:center;font-size:calc(var(--w) * .5);}',
    '.jt{position:absolute;left:0;right:0;bottom:16%;text-align:center;font-size:calc(var(--w) * .1);font-weight:900;letter-spacing:.2em;}',
    '.ipc.back{background:repeating-linear-gradient(45deg,#7c1423 0 12px,#5e0f1b 12px 24px);box-shadow:0 14px 40px rgba(0,0,0,.55),inset 0 0 0 calc(var(--w) * .035) #f3efe6;display:flex;align-items:center;justify-content:center;}',
    '.ipc.back .bk{font-size:calc(var(--w) * .4);opacity:.9;}',
    '.ipf{position:relative;width:var(--w);aspect-ratio:5/7;perspective:1100px;flex:0 0 auto;}',
    '.ipf>.ipc,.ipfi>.ipc{position:absolute;left:0;top:0;width:100%;height:100%;backface-visibility:hidden;-webkit-backface-visibility:hidden;}',
    '.ipfi{position:absolute;inset:0;transform-style:preserve-3d;transform-origin:50% 55%;}',
    '.ipfi.f{transform:rotateY(180deg);}.ipfi>.ipc.fr{transform:rotateY(180deg);}',
    '.ipfi.pl{animation:ipPeel .75s cubic-bezier(.3,.7,.3,1) both;}.ipfi.un{animation:ipUnpeel .6s ease-in-out both;}',
    '.ipribbon{position:absolute;left:50%;top:-13px;transform:translateX(-50%);z-index:5;background:linear-gradient(180deg,#ffd98a,#f0a93a);color:#3a2300;font-weight:900;font-size:13px;padding:3px 14px;border-radius:999px;box-shadow:0 4px 12px rgba(0,0,0,.5);white-space:nowrap;}',
    '.ipswb{position:absolute;left:50%;top:50%;z-index:6;transform:translate(-50%,-50%);font-size:min(9vw,34px);font-weight:900;color:#fff;background:rgba(229,72,77,.92);padding:8px 22px;border-radius:14px;white-space:nowrap;box-shadow:0 8px 30px rgba(0,0,0,.6);opacity:0;pointer-events:none;}',
    '.ipglow{position:absolute;inset:-6px;border-radius:14px;box-shadow:0 0 0 3px #ffd98a,0 0 36px 8px rgba(255,200,90,.85);opacity:0;pointer-events:none;z-index:4;}',
    '@keyframes ipPeel{0%{transform:rotateY(0);}28%{transform:rotateY(-62deg) rotateX(10deg) translateY(-7%) scale(1.06);}100%{transform:rotateY(-180deg);}}',
    '@keyframes ipUnpeel{0%{transform:rotateY(-180deg);}100%{transform:rotateY(0);}}',
    '@keyframes ipOut{0%{transform:none;opacity:1;}100%{transform:translate(-135%,40%) rotate(-28deg) scale(.8);opacity:0;}}',
    '@keyframes ipIn{0%{transform:translate(135%,-45%) rotate(24deg) scale(.7);opacity:0;}15%{opacity:1;}70%{transform:translate(0,0) rotate(-2deg) scale(1.04);opacity:1;}100%{transform:none;opacity:1;}}',
    '@keyframes ipBan{0%{opacity:0;transform:translate(-50%,-50%) scale(.4);}20%{opacity:1;transform:translate(-50%,-50%) scale(1.12);}35%{transform:translate(-50%,-50%) scale(1);}80%{opacity:1;}100%{opacity:0;transform:translate(-50%,-50%) scale(1);}}',
    '@keyframes ipGlow{0%{opacity:0;}25%{opacity:1;}100%{opacity:0;}}',
    '@keyframes ipRib{0%{opacity:0;transform:translateX(-50%) translateY(-14px) scale(.6);}100%{opacity:1;transform:translateX(-50%);}}',
    '@keyframes ipFlip{0%{transform:rotateY(90deg) scale(.9);}60%{transform:rotateY(-8deg) scale(1.04);}100%{transform:rotateY(0) scale(1);}}',
    '@keyframes ipNum{0%{transform:scale(2.2);opacity:0;}30%{transform:scale(1);opacity:1;}85%{transform:scale(.95);opacity:1;}100%{transform:scale(.6);opacity:0;}}',
    '@keyframes ipFlash{0%{opacity:.9;}100%{opacity:0;}}',
    '@keyframes ipPulse{0%,100%{transform:scale(1);}50%{transform:scale(1.03);}}',
    '.ipcount{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;}',
    '.ipcount b{position:absolute;font-size:min(46vw,30vh);font-weight:900;color:#fff;text-shadow:0 0 30px rgba(255,200,90,.9),0 6px 18px rgba(0,0,0,.7);opacity:0;}',
    '.ipflash{position:fixed;inset:0;z-index:50;pointer-events:none;background:radial-gradient(circle,#fff,rgba(255,236,170,.6) 50%,rgba(0,0,0,0) 80%);opacity:0;}',
    '.ipmsg{text-align:center;font-weight:900;font-size:15px;line-height:1.6;color:#ffd98a;margin:2px 0 6px;}',
    '.ipsm{font-size:12px;color:var(--text-muted);text-align:center;line-height:1.7;}'
  ].join('\n');
  function injectCss(){
    if(document.getElementById(CSS_ID)) return;
    var st = document.createElement('style'); st.id = CSS_ID; st.textContent = CSS; document.head.appendChild(st);
  }
  // 効果音(Web Audio API で合成。参考: MDN Web Audio API https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
  function whoosh(sfx){
    var a = sfx.ac, t0 = a.currentTime + 0.01, n = Math.floor(a.sampleRate * 0.3), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for(var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / n);
    var src = a.createBufferSource(); src.buffer = buf;
    var bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8; bp.frequency.setValueAtTime(600, t0); bp.frequency.exponentialRampToValueAtTime(3600, t0 + 0.28);
    var g = a.createGain(); g.gain.value = 0.5; src.connect(bp); bp.connect(g); g.connect(sfx.out); src.start(t0);
  }

  /* ---- スマホの傾き(立てているか寝かせているか) ----
   * devicemotion の accelerationIncludingGravity から、画面の法線方向(z)に重力がどれだけかかっているかを見る。
   * |z|/|g| が小さい = 画面が垂直に近い(立てている)。大きい = 画面が上(または下)を向いている(寝かせている)。
   * 小さい値(0.40未満)で「立てた」、大きい値(0.55超)で「寝かせた」とし、間は前の状態を保つ(ヒステリシス)。符号は使わないので機種差の影響を受けない。
   * 参考: MDN DeviceMotionEvent https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent */
  var TILT = { mode: 'wait', up: false, upAt: 0, z: null, manual: false, card: null, started: false, perm: '', ctx: null, canSend: false, vUp: false, sentWant: null };
  function showFace(){ return TILT.mode === 'sensor' ? TILT.up : TILT.manual; }
  function ribbon(anim){ return TILT.swapped ? '<div class="ipribbon"' + (anim ? ' style="animation:' + anim + '"' : '') + '>🔁 交換済</div>' : ''; }
  // 交換の演出(約1.9秒): 今の札が左下へ飛んでいき → 山札から新しい札が右上から滑り込む → 「交換!」バナーと光 → 額に当てているなら、ぺろっと表に返る。
  // 再描画されても途中から続けられるよう、経過時間ぶん animation-delay を負にずらす。札の中身は裏向きか、すでに他人から見えている札だけを使う(自分の札は見せない)
  var SW_MS = 1950;
  function stageHtml(face, el){
    var d = function(t){ return (t - el).toFixed(2) + 's'; };
    var oldC = face && TILT.prev ? cardHtml(TILT.prev) : cardHtml(null);
    if(face && TILT.prev) oldC = cardHtml(TILT.prev);
    return '<div class="ipf">' +
      '<div style="position:absolute;inset:0;animation:ipOut .55s ease-in ' + d(0) + ' both">' + oldC.replace('class="ipc', 'class="ipc fillc') + '</div>' +
      '<div style="position:absolute;inset:0;animation:ipIn .62s cubic-bezier(.2,.9,.3,1) ' + d(0.4) + ' both"><div class="ipfi' + '" style="' + (face ? 'animation:ipPeel .75s cubic-bezier(.3,.7,.3,1) ' + d(1.15) + ' both' : '') + '">' +
        cardHtml(null) + cardHtml(TILT.card, 'fr') + '</div></div>' +
      '<div class="ipglow" style="animation:ipGlow .9s ease-out ' + d(0.95) + ' both"></div>' +
      '<div class="ipswb" style="animation:ipBan 1.25s ease-out ' + d(0.8) + ' both">🔁 交換!</div>' +
      ribbon('ipRib .4s ease-out ' + d(1.3) + ' both') + '</div>';
  }
  function paintSlot(){
    var slot = document.getElementById('ipSlot'); if(!slot || !TILT.card) return;
    var face = showFace(), cardKey = TILT.card.r + '-' + TILT.card.s + (TILT.swapped ? 's' : '');
    var el = TILT.swAt ? Date.now() - TILT.swAt : 1e9;
    if(el < SW_MS){
      var sk = 'sw' + TILT.swAt;
      if(slot.dataset.key !== sk){
        slot.dataset.key = sk; slot.dataset.face = '';
        slot.innerHTML = stageHtml(TILT.swFace, el / 1000);
        clearTimeout(TILT.swT); TILT.swT = setTimeout(paintSlot, SW_MS - el + 30);
      }
    } else {
      var inner = slot.querySelector('.ipfi'), same = inner && slot.dataset.key === cardKey;
      if(!same){
        slot.dataset.key = cardKey; slot.dataset.face = face ? '1' : '0';
        slot.innerHTML = '<div class="ipf"><div class="ipfi' + (face ? ' f' : '') + '">' + cardHtml(null) + cardHtml(TILT.card, 'fr') + '</div>' + ribbon() + '</div>';
      } else if(slot.dataset.face !== (face ? '1' : '0')){        // 表⇄裏は、ぺろっと返す
        slot.dataset.face = face ? '1' : '0';
        inner.className = 'ipfi ' + (face ? 'f pl' : 'un');
        if(!face) inner.style.transform = 'rotateY(0)';
        else inner.style.transform = '';
      }
    }
    var m = document.getElementById('ipMsg');
    if(m) m.innerHTML = face ? '🙌 そのまま額にかざして! 自分では見ない!' : '📱 いまは裏向き。<b>スマホを立てて</b>額にかざすと表になる';
    var mb = document.getElementById('ipManual');
    if(mb){
      if(TILT.mode === 'manual'){
        mb.innerHTML = '<button class="btn-ghost" id="ipTog" style="margin-top:6px">' + (TILT.manual ? '🙈 裏向きにする' : '👁 カードを表にする') + '(センサーが使えないため手動)</button>';
        var tg = document.getElementById('ipTog'); if(tg) tg.onclick = function(){ TILT.manual = !TILT.manual; paintSlot(); };
      } else mb.innerHTML = '';
    }
  }
  function onMotion(e){
    var g = e && e.accelerationIncludingGravity;
    if(!g || g.x == null || g.y == null || g.z == null) return;
    var mag = Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z); if(!(mag > 1)) return;
    var az = Math.abs(g.z) / mag;
    TILT.mode = 'sensor'; TILT.z = TILT.z == null ? az : TILT.z * 0.7 + az * 0.3;
    var up = TILT.up;
    if(TILT.z < 0.40) up = true; else if(TILT.z > 0.55) up = false;
    if(up !== TILT.up || TILT.modeChanged){
      TILT.up = up; TILT.modeChanged = false; TILT.upAt = up ? Date.now() : 0;
      paintSlot();
      if(up) setTimeout(syncUp, 1050); else syncUp();      // 立てて1秒たったら「額に当てた」と申告。下ろしたらすぐ申告
    }
  }
  // 「額に当てている」の申告用。立てた状態が1秒続いたら true(ふらつき・持ち替えで誤検知しないため)
  function stableUp(){
    if(TILT.mode === 'sensor') return TILT.up && TILT.upAt > 0 && Date.now() - TILT.upAt >= 1000;
    if(TILT.mode === 'manual') return TILT.manual;
    return false;
  }
  function syncUp(){
    var c = TILT.ctx; if(!c || !TILT.canSend) return;
    var want = stableUp();
    if(want !== TILT.vUp && want !== TILT.sentWant){ TILT.sentWant = want; c.send({ t: 'up', v: want }); }
  }
  function startTilt(){
    if(TILT.started) return; TILT.started = true;
    try{ window.addEventListener('devicemotion', onMotion); }catch(e){}
  }
  function askMotion(){        // iPhone は、ユーザーのタップ操作の中でセンサーの許可を求める必要がある
    startTilt();
    try{
      if(typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function'){
        DeviceMotionEvent.requestPermission().then(function(r){ TILT.perm = r; }).catch(function(){ TILT.perm = 'denied'; });
      }
    }catch(e){}
  }

  function render(root, ctx){
    injectCss();
    var v = ctx.view, esc = ctx.esc, me = ctx.me, h = '';
    var q = function(id){ return document.getElementById(id); };
    function btn(id, label2, cls){ return '<button class="' + (cls || 'btn-primary') + '" id="' + id + '">' + label2 + '</button>'; }
    var top = '<div class="eyebrow">INDIAN POKER' + (v.round ? ' ・ ' + v.round + '枚目' : '') + '</div>';

    /* ---- 設定 ---- */
    if(v.phase === 'setup'){
      var seg = function(id, text, on){
        return '<button id="' + id + '" ' + (ctx.isHost ? '' : 'disabled ') + 'style="flex:1;padding:14px 0;border-radius:12px;border:2px solid ' + (on ? 'var(--accent)' : 'var(--line)') + ';background:' + (on ? 'rgba(229,72,77,.14)' : 'var(--bg-surface)') + ';color:' + (on ? 'var(--accent)' : 'var(--text)') + ';font-weight:900;font-size:14px">' + text + '</button>';
      };
      h = top + '<div class="card-ui"><div class="big-text" style="font-size:20px">インディアンポーカー</div>' +
        '<div class="sub-text">自分のスマホに自分のカードが出る。<b>自分は見ずに</b>、画面を外に向けて<b>額にかざす</b>。みんなのカードだけを見て、自分が勝てるかを読み合おう。</div></div>' +
        '<div class="section-label">ジョーカー</div><div style="display:flex;gap:8px">' + seg('sJ0', 'なし', !v.joker) + seg('sJ1', 'あり(最強)', v.joker) + '</div>' +
        '<div class="section-label">エース(A)</div><div style="display:flex;gap:8px">' + seg('sAH', 'Aが最強', v.aceHigh) + seg('sAL', 'Aが最弱(=1)', !v.aceHigh) + '</div>' +
        '<div class="sub-text" style="margin-top:12px">勝敗の判定はみんなで決める。アプリは配って見せて、最後に答え合わせをするだけ。</div>' +
        '<div class="spacer"></div><div class="bottombar">' + (ctx.isHost ? btn('sStart', '配る') : '<div class="sub-text" style="text-align:center">ホストが配るのを待っています…</div>') + '</div>';
      root.innerHTML = h;
      if(q('sJ0')) q('sJ0').onclick = function(){ ctx.send({ t: 'setJoker', v: false }); };
      if(q('sJ1')) q('sJ1').onclick = function(){ ctx.send({ t: 'setJoker', v: true }); };
      if(q('sAH')) q('sAH').onclick = function(){ ctx.send({ t: 'setAce', v: true }); };
      if(q('sAL')) q('sAL').onclick = function(){ ctx.send({ t: 'setAce', v: false }); };
      if(q('sStart')) q('sStart').onclick = function(){ ctx.send({ t: 'start' }); };
      return;
    }
    if(!v.inPart && v.phase !== 'result'){
      root.innerHTML = top + '<div class="card-ui"><div class="big-text">今回は観戦中</div><div class="sub-text">途中で入り直したので、次のカードから参加できます。</div></div>';
      return;
    }

    /* ---- 準備(カードは裏向き。各自「準備OK」→ スマホを立てて額に当てる) ---- */
    function upUi(){
      var mb = document.getElementById('ipManual2'); if(!mb) return;
      if(TILT.mode === 'manual' && v.myReady){
        mb.innerHTML = '<button class="btn-ghost" id="ipUpTog" style="margin-top:6px">' + (TILT.manual ? '🙈 下ろした' : '✋ 額に当てた') + '(センサーが使えないため手動)</button>';
        var t = document.getElementById('ipUpTog'); if(t) t.onclick = function(){ TILT.manual = !TILT.manual; upUi(); syncUp(); };
      } else mb.innerHTML = '';
    }
    function armUp(){      // 描画のたびに、いまの申告状態を覚えて、食い違っていれば送る
      TILT.ctx = ctx; TILT.canSend = !!v.myReady; TILT.vUp = !!v.myUp; TILT.sentWant = null; startTilt();
      if(v.myReady && TILT.mode === 'wait' && !TILT.waitTimer){
        TILT.waitTimer = setTimeout(function(){ TILT.waitTimer = 0; if(TILT.mode === 'wait'){ TILT.mode = 'manual'; upUi(); } }, 1500);   // センサーの値が来なければ手動
      }
      upUi(); syncUp();
    }
    if(v.phase === 'ready'){
      var Lr = ctx.local;
      if(Lr.rdy !== 'r' + v.round){ Lr.rdy = 'r' + v.round; TILT.manual = false; }
      var big = v.myReady ? (v.myUp ? '✅ OK! そのまま動かないで' : '📱 スマホを立てて額に当てて!') : 'まず「準備OK」を押す';
      root.innerHTML = top + '<div class="ipw rdy">' + cardHtml(null) + '</div>' +
        '<div class="ipmsg" style="font-size:19px">' + big + '</div>' +
        '<div class="ipsm">額に当てた人 <b style="font-size:20px;color:var(--text)">' + v.upCount + ' / ' + v.n + '</b> 人<br>全員が当てると、5秒後にカードが表になります</div>' +
        (v.myReady ? '' : '<div class="ipsm" style="margin-top:6px">「準備OK」でスマホの傾きセンサーを使います(許可を求められたら許可)</div>') +
        '<div id="ipManual2"></div>' + ctx.waitHtml() +
        '<div class="bottombar">' + (v.myReady ? '' : btn('rReady', '準備OK')) +
        (ctx.isHost ? btn('rCount', '待たずに始める', 'btn-ghost') : '') + '</div>';
      if(q('rReady')) q('rReady').onclick = function(){ askMotion(); ctx.send({ t: 'ready' }); ctx.tone(660, 0.08, 'triangle', 0.1); };
      if(q('rCount')) q('rCount').onclick = function(){ askMotion(); ctx.send({ t: 'count' }); };
      armUp();
      return;
    }

    /* ---- カウントダウン(5秒)。全員が額に当てている間だけ進む ---- */
    if(v.phase === 'count'){
      var L = ctx.local, rk = 'count:' + v.round + ':' + v.countNo;
      if(L.rkey !== rk){ L.rkey = rk; L.t0 = Date.now(); L.played = false; L.sent = false; }
      var el = (Date.now() - L.t0) / 1000;
      var A = function(name, dur, ease, delay){ return name + ' ' + dur + 's ' + ease + ' ' + (delay - el).toFixed(2) + 's 1 both'; };
      root.innerHTML = top + '<div class="ipw" style="position:relative;--w:max(120px,min(72vw,calc((100vh - 340px) * .714)))">' + cardHtml(null) +
        '<div class="ipcount">' + [5, 4, 3, 2, 1].map(function(n, i){ return '<b style="animation:' + A('ipNum', 0.95, 'ease-out', 0.2 + i) + '">' + n + '</b>'; }).join('') + '</div></div>' +
        '<div class="ipmsg">全員そろった! そのまま額に当てて、見ないで!</div>' +
        '<div id="ipManual2"></div>' +
        '<div class="bottombar"><div class="sub-text" style="text-align:center">誰かが下ろすと、最初からやり直しです</div></div>';
      if(!L.played){
        L.played = true;
        [0.2, 1.2, 2.2, 3.2, 4.2].forEach(function(t, i){ setTimeout(function(){ ctx.tone(440 + 50 * i, 0.12, 'triangle', 0.14); if(navigator.vibrate) try{ navigator.vibrate(30); }catch(e){} }, t * 1000); });
      }
      if(ctx.isHost){
        ctx.every(function(){ if(!L.sent && (Date.now() - L.t0) / 1000 >= 5.45){ L.sent = true; ctx.send({ t: 'countDone' }); } }, 300);
      }
      armUp();
      return;
    }

    /* ---- カード表示(額にかざす) ---- */
    if(v.phase === 'show'){
      var Ls = ctx.local, sk = 'show:' + v.round;
      var first = Ls.skey !== sk; if(first){ Ls.skey = sk; Ls.t0 = Date.now(); Ls.played = false; Ls.confirmAt = 0; TILT.manual = false; TILT.modeChanged = true; }
      var nowSw = !!v.mySwapped;
      if(first){ Ls.wasSw = nowSw; Ls.swSet = v.swapped.slice(); TILT.swAt = 0; TILT.prev = null; TILT.swapped = nowSw; }
      else {
        if(nowSw && !Ls.wasSw){        // 自分が交換した
          TILT.prev = TILT.card; TILT.swFace = showFace(); TILT.swAt = Date.now(); TILT.swapped = true;
          ctx.tone(300, 0.1, 'sawtooth', 0.1); [520, 700, 940].forEach(function(f, i){ setTimeout(function(){ ctx.tone(f, 0.14, 'triangle', 0.12); }, 450 + i * 110); });
          var sf2 = ctx.sfx && ctx.sfx(); if(sf2) whoosh(sf2);
          if(navigator.vibrate) try{ navigator.vibrate([40, 60, 40, 60, 80]); }catch(e){}
        }
        v.swapped.forEach(function(id){          // 他の人が交換したら知らせる
          if(id !== me && Ls.swSet.indexOf(id) < 0){ ctx.toast('🔁 ' + ctx.nameOf(id) + ' がカードを交換した!'); ctx.tone(620, 0.1, 'triangle', 0.1); if(navigator.vibrate) try{ navigator.vibrate(40); }catch(e){} }
        });
        Ls.wasSw = nowSw; Ls.swSet = v.swapped.slice();
      }
      TILT.card = v.myCard; TILT.canSend = false; startTilt();
      var swNames = v.swapped.length ? '🔁 交換した人: ' + v.swapped.map(function(id){ return esc(ctx.nameOf(id)); }).join('・') : '';
      var confirming = Ls.confirmAt && Date.now() - Ls.confirmAt < 3500;
      var swapBtn = v.mySwapped ? '<div class="sub-text" style="text-align:center;margin-bottom:6px">🔁 交換は使い切りました</div>'
        : '<button class="' + (confirming ? 'btn-danger' : 'btn-ghost') + '" id="sSwap" style="margin-bottom:8px">' + (confirming ? 'もう一度押すと交換(取り消せません)' : '🔁 カードを交換する(1回だけ)') + '</button>';
      root.innerHTML = '<div class="ipflash" id="ipFlash"></div>' +
        '<div class="ipmsg" id="ipMsg" style="margin-top:0"></div>' +
        '<div class="ipw" id="ipSlot"></div><div id="ipManual"></div>' +
        '<div class="ipsm" style="min-height:20px">' + swNames + '</div>' +
        '<div class="bottombar">' + swapBtn + (ctx.isHost ? btn('sResult', '答え合わせ(全員のカードを公開)', 'btn-ghost') : '<div class="sub-text" style="text-align:center">答え合わせはホストが始めます</div>') + '</div>';
      paintSlot();
      if(!Ls.played){
        Ls.played = true;
        var fl = q('ipFlash'); if(fl) fl.style.animation = 'ipFlash .6s ease-out both';
        var sf = ctx.sfx && ctx.sfx(); if(sf) whoosh(sf);
        [784, 988, 1319].forEach(function(f, i){ setTimeout(function(){ ctx.tone(f, 0.18, 'triangle', 0.12); }, 120 + i * 90); });
        if(navigator.vibrate) try{ navigator.vibrate([60, 40, 90]); }catch(e){}
        // 1.5秒たってもセンサーの値が来なければ、手動の切り替えボタンを出す(PCや、許可しなかった端末向け)
        setTimeout(function(){ if(TILT.mode === 'wait'){ TILT.mode = 'manual'; paintSlot(); } }, 1500);
      }
      if(q('sSwap')) q('sSwap').onclick = function(){
        if(Ls.confirmAt && Date.now() - Ls.confirmAt < 3500){ Ls.confirmAt = 0; ctx.send({ t: 'swap' }); ctx.tone(440, 0.12, 'sawtooth', 0.1); }
        else { Ls.confirmAt = Date.now(); ctx.toast('もう一度押すと交換します'); render(root, ctx); }
      };
      if(q('sResult')) q('sResult').onclick = function(){ ctx.send({ t: 'result' }); };
      return;
    }

    /* ---- 答え合わせ ---- */
    var order = v.part.slice().sort(function(a, b){ return v.strong[b] - v.strong[a]; });
    var rows = order.map(function(id){
      var hi = v.highest.indexOf(id) >= 0 && !v.allTie, lo = v.lowest.indexOf(id) >= 0 && !v.allTie;
      return '<div style="display:flex;align-items:center;gap:12px;background:var(--bg-surface);border:1.5px solid ' + (hi ? 'var(--gold)' : lo ? 'var(--danger)' : 'var(--line)') + ';border-radius:14px;padding:8px 12px;margin-top:8px">' +
        '<div style="flex:0 0 auto">' + cardHtml(v.cards[id], 'mini') + '</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start">' + ctx.chip(id) +
        '<span style="font-size:12px;font-weight:900;color:' + (hi ? 'var(--gold)' : lo ? 'var(--danger)' : 'var(--text-muted)') + '">' + (hi ? '👑 いちばん強い' : lo ? 'いちばん弱い' : '') + '</span>' +
        (v.old && v.old[id] ? '<span style="font-size:11px;color:var(--text-muted)">🔁 交換: ' + miniHtml(v.old[id]) + ' → ' + miniHtml(v.cards[id]) + '</span>' : '') + '</div>' +
        '<span style="margin-left:auto;font-size:15px">' + miniHtml(v.cards[id]) + '</span></div>';
    }).join('');
    var mine = v.cards[me];
    h = top + '<div class="card-ui"><div class="big-text" style="font-size:20px">答え合わせ</div>' +
      '<div class="sub-text">' + (v.allTie ? '全員同じ強さ(引き分け)' : '強い順に並べました。' + (v.aceHigh ? '(Aが最強' : '(Aが最弱') + (v.joker ? '・ジョーカーあり)' : ')')) + '</div></div>' +
      (mine ? '<div class="sub-text" style="text-align:center;margin-top:8px">あなたのカードは ' + miniHtml(mine) + ' でした</div>' : '') + rows +
      '<div class="spacer"></div><div class="bottombar">' + (ctx.isHost ? btn('rNext', '次のカードを配る') + btn('rSetup', '設定に戻る', 'btn-ghost') : '<div class="sub-text" style="text-align:center">ホストが次へ進めるのを待っています…</div>') + '</div>';
    root.innerHTML = h;
    if(q('rNext')) q('rNext').onclick = function(){ ctx.send({ t: 'next' }); };
    if(q('rSetup')) q('rSetup').onclick = function(){ ctx.send({ t: 'resetup' }); };
  }

  // 開発中モード用のCPU(「準備OK」を押すだけ)
  function bot(v, me, rnd){
    if(v.inPart && v.phase === 'ready' && !v.myReady) return { t: 'ready' };
    if(v.inPart && (v.phase === 'ready' || v.phase === 'count') && v.myReady && !v.myUp) return { t: 'up', v: true };
    if(v.inPart && v.phase === 'show' && !v.mySwapped && rnd(3) === 0) return { t: 'swap' };     // ときどき交換する(動作確認用)
    return null;
  }

  NO.register({
    id: 'indian', emoji: '🃏', title: 'インディアンポーカー', accent: '#E5484D', accentInk: '#fff', min: 2, max: 10,
    tagline: '全員が額にスマホを当てると5秒後にカードが表に。自分のカードは見えない。1回だけ交換もできる。',
    rules: [
      'みんなに<b>トランプを1枚ずつ配る</b>。自分のスマホには<b>自分のカードが大きく表示される</b>。',
      '各自「準備OK」を押して、スマホを立てて<b>額(頭の上)に当てる</b>。<b>全員が当てたことをセンサーで検知</b>すると、<b>5秒のカウントダウン</b>のあとにカードが表になる(途中で誰かが下ろしたらやり直し)。自分は画面を見ない!',
      '見えるのは<b>他の人のカードだけ</b>。みんなのカードを見て、自分のカードが勝てそうか読み合う。勝負するか降りるか、飲むのは誰かは<b>みんなで決める</b>(アプリは判定しない)。',
      '<b>スマホが寝ている(画面が上向き)間は裏向き</b>。スマホを立てて額にかざすと表になる(iPhoneはセンサーの許可が必要)。',
      '各自<b>1回だけカードを交換</b>できる(山札の次のカードと入れ替え。どちらも自分には見えない)。交換した人は全員に表示される。',
      '最後に<b>答え合わせ</b>で全員のカードと強さ順を公開。強さは 2 &lt; … &lt; K &lt; A(Aを最弱にもできる)、ジョーカーありなら最強。'
    ],
    game: game, bot: bot, render: render
  });
})();
