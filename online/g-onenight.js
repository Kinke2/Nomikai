/*
  ワンナイト人狼(オンライン版・開発中)
  役職カードが各自のスマホにだけ配られ、夜の行動(占う・交換する等)を全員が同時に入力 → 朝に話し合い → 一斉に投票。
  配布・夜の処理・集計・勝敗判定はアプリが自動で行う。1ゲーム5〜10分。役職の種類と枚数はホストが選べる(残りは村人)。
  公平性: 役職カードの配り方は crypto.getRandomValues による Fisher-Yates シャッフル(プレイヤー+中央3枚)。
          夜の処理・投票の集計・勝敗はルール通りに機械的に計算するだけで、結果の補正・加工は一切しない。
  勝敗条件は One Night Ultimate Werewolf のルールに従う(下記[1])。同票は全員処刑、全員1票以下なら誰も処刑されない。
    - 村人陣営: 人狼が1人でも処刑されれば勝ち。プレイヤーに人狼がいないときは、誰も処刑されなければ勝ち。
    - 人狼陣営: プレイヤーに人狼がいて、人狼が1人も処刑されず、てるてるも処刑されなければ勝ち。
      狂人: 人狼がいるときは人狼陣営と同じ条件。人狼がプレイヤーにいないときは、狂人以外の誰かが処刑されれば勝ち。
    - てるてる: 処刑されれば単独で勝ち(同時に人狼も処刑されれば村人陣営も勝ち)。
    - 狩人: 処刑されたとき、自分が投票した相手も一緒に処刑される。
    - 負けた陣営の人が飲む。
  パン屋(日本の人狼系ゲームの役職を、ワンナイト用に本作で翻案したもの): 村人陣営。
      夜のはじめに誰か1人を選んでパンを届ける。パンが届いた人は、朝を迎える前に(夜のうちに)知らされる(誰からかは分からない)。
      パンは「届けられた人」に付き、カードが夜のうちに交換されても変わらない。
  参考文献:
    [1] One Night Ultimate Werewolf ルール(夜の順番・各役職・勝敗条件): https://rulespal.com/one-night-ultimate-werewolf/rulebook
    [2] 藤田, ワンナイト人狼の役職(人狼・村人・占い師・怪盗)と投票・同票処理: https://www.info.kindai.ac.jp/~takasi-i/thesis/2020_17-1-037-0142_N_Fujita_thesis.pdf
    [3] 人狼の役職説明(パン屋・狂人・占い師): https://dic.pixiv.net/a/SKNewRoles
    [4] 人狼系ゲームの「てるてる坊主」(自分が追放されると単独勝利): https://gamepedia.jp/archives/95444
    [5] Fisher-Yates shuffle: https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
    [6] 通信・乱数・参考文献一覧は online-core.js の冒頭を参照
  (オンライン ロビーに登録されるゲーム。通信・部屋・QRは online-core.js が担当)
*/
(function(){
  'use strict';
  var NO = window.NomikaiOnline;

  /* PURE-BEGIN */
  // team: village / wolf / minion / tanner。夜の順番(o)は One Night Ultimate Werewolf の起こす順。
  var ROLES = {
    villager: { name: '村人',     emoji: '🧑‍🌾', team: 'village', max: 99, o: 99, desc: '能力なし。人狼を見つけて投票する。' },
    wolf:     { name: '人狼',     emoji: '🐺',   team: 'wolf',    max: 2,  o: 1,  desc: '夜に仲間の人狼を確認。1人だけなら中央のカードを1枚見られる。' },
    minion:   { name: '狂人',     emoji: '🎭',   team: 'minion',  max: 1,  o: 2,  desc: '人狼が誰か分かる(人狼からは分からない)。人狼陣営。' },
    mason:    { name: '共有者',   emoji: '🤝',   team: 'village', max: 2,  o: 3,  desc: '2枚1組。もう1人の共有者が誰か分かる。' },
    seer:     { name: '占い師',   emoji: '🔮',   team: 'village', max: 1,  o: 4,  desc: '他の1人のカード、または中央のカード2枚を見る。' },
    robber:   { name: '怪盗',     emoji: '🦹',   team: 'village', max: 1,  o: 5,  desc: '他の1人とカードを交換して新しいカードを見る。以後は新しい役職の陣営。' },
    trouble:  { name: '怪人',     emoji: '🃏',   team: 'village', max: 1,  o: 6,  desc: '自分以外の2人のカードを、見ずに入れ替える。' },
    drunk:    { name: '酔っぱらい', emoji: '🍺', team: 'village', max: 1,  o: 7,  desc: '自分のカードを中央の1枚と見ずに交換する。自分が何になったか分からない。' },
    insomniac:{ name: '不眠症',   emoji: '😵',   team: 'village', max: 1,  o: 8,  desc: '夜の最後に自分のカードを確認する(交換されたか分かる)。' },
    hunter:   { name: '狩人',     emoji: '🏹',   team: 'village', max: 1,  o: 9,  desc: '処刑されたとき、自分が投票した相手も道連れにする。' },
    tanner:   { name: 'てるてる', emoji: '🧸',   team: 'tanner',  max: 1,  o: 10, desc: '処刑されたい人。処刑されれば単独で勝ち。' },
    baker:    { name: 'パン屋',   emoji: '🥖',   team: 'village', max: 1,  o: 0,  desc: '夜に誰か1人を選んでパンを届ける。届いた人は朝を迎える前に知らされる(誰からかは分からない)。' }
  };
  var TEAMS = {
    village: { name: '村人陣営', win: '人狼を1人でも処刑できれば勝ち(プレイヤーに人狼がいないときは、誰も処刑されなければ勝ち)' },
    wolf:    { name: '人狼陣営', win: '人狼が1人も処刑されなければ勝ち(てるてるが処刑された場合は勝てない)' },
    minion:  { name: '人狼陣営(狂人)', win: '人狼がいるときは人狼陣営と同じ。人狼がプレイヤーにいないときは、自分以外の誰かが処刑されれば勝ち' },
    tanner:  { name: '第三陣営', win: '自分が処刑されれば単独で勝ち' }
  };
  var ORDER = ['villager', 'wolf', 'minion', 'mason', 'seer', 'robber', 'trouble', 'drunk', 'insomniac', 'hunter', 'tanner', 'baker'];
  var MINUTES = [3, 5, 8];

  function activeIds(G){ return G.part.filter(function(id){ return !G.offline[id]; }); }
  function inPart(G, pid){ return G.part.indexOf(pid) >= 0; }
  function nm(G, id){ for(var i = 0; i < G.players.length; i++) if(G.players[i].id === id) return G.players[i].name; return id; }
  function rn(r){ return ROLES[r].name; }
  function cnt(arr, f){ return arr.filter(f).length; }

  function defaultSel(){ return { wolf: 2, seer: 1, robber: 1, trouble: 1 }; }
  // 村人以外の選択 sel から、全カード(人数+3枚)の内訳を作る。村人は残りを自動で埋める。足りなければ null。
  function deckCounts(sel, total){
    var c = {}, sum = 0;
    ORDER.forEach(function(r){ if(r !== 'villager'){ c[r] = sel[r] || 0; sum += c[r]; } });
    if(sum > total) return null;
    c.villager = total - sum; return c;
  }
  function checkSel(sel, total){
    if(!(sel.wolf >= 1)) return '人狼を1枚以上入れてください';
    if(sel.mason === 1) return '共有者は2枚1組です(0枚か2枚)';
    if(!deckCounts(sel, total)) return '役職が多すぎます(全部で' + total + '枚まで。村人は残りを自動で入れます)';
    return null;
  }

  function newState(players, rnd){
    var G = { players: players, offline: {}, round: 0, drinks: {}, wins: {}, phase: 'setup', part: [], sel: defaultSel(), minutes: 5,
      cards: {}, center: [], fcards: {}, fcenter: [], done: {}, info: {}, acts: {}, log: [], rv: {}, votes: {}, res: null, endAt: 0 };
    players.forEach(function(p){ G.drinks[p.id] = 0; G.wins[p.id] = 0; });
    G.part = players.map(function(p){ return p.id; });
    return G;
  }

  function deal(G, rnd){
    G.part = G.players.map(function(p){ return p.id; }).filter(function(id){ return !G.offline[id]; });
    var n = G.part.length, c = deckCounts(G.sel, n + 3), deck = [];
    ORDER.forEach(function(r){ for(var i = 0; i < c[r]; i++) deck.push(r); });
    for(var k = deck.length - 1; k > 0; k--){ var j = rnd(k + 1); var t = deck[k]; deck[k] = deck[j]; deck[j] = t; }   // Fisher-Yates
    G.cards = {}; G.part.forEach(function(id, i){ G.cards[id] = deck[i]; });
    G.center = [deck[n], deck[n + 1], deck[n + 2]]; G.deckCounts = c;
    G.round++; G.phase = 'night'; G.done = {}; G.info = {}; G.acts = {}; G.log = []; G.rv = {}; G.votes = {}; G.res = null; G.endAt = 0;
    G.fcards = {}; G.fcenter = [];
    initInfo(G);
  }
  // 夜のはじめに各自が知る情報(人狼の仲間・狂人が見る人狼・共有者の相方)
  function initInfo(G){
    var wolvesP = G.part.filter(function(id){ return G.cards[id] === 'wolf'; });
    G.part.forEach(function(id){
      var r = G.cards[id], L = [];
      if(r === 'wolf'){
        var o = wolvesP.filter(function(x){ return x !== id; });
        L.push(o.length ? '仲間の人狼: ' + o.map(function(x){ return nm(G, x); }).join('・') : '仲間の人狼はいません(あなたが唯一の人狼)');
      } else if(r === 'minion'){
        L.push(wolvesP.length ? '人狼は: ' + wolvesP.map(function(x){ return nm(G, x); }).join('・') + '(人狼からあなたは見えていません)' : '人狼はプレイヤーの中にいません(中央のカードにいます)');
      } else if(r === 'mason'){
        var m = G.part.filter(function(x){ return G.cards[x] === 'mason' && x !== id; });
        L.push(m.length ? 'もう1人の共有者: ' + nm(G, m[0]) : 'もう1人の共有者は中央のカードの中です');
      }
      G.info[id] = L;
    });
  }
  function needKind(G, pid){
    var r = G.cards[pid];
    if(r === 'wolf') return cnt(G.part, function(id){ return G.cards[id] === 'wolf'; }) === 1 ? 'peek-opt' : 'ack';
    if(r === 'seer') return 'seer';
    if(r === 'robber') return 'rob-opt';
    if(r === 'trouble') return 'swap';
    if(r === 'drunk') return 'drunk';
    if(r === 'baker') return 'bake';
    return 'ack';
  }

  function maybeAdvance(G){
    var act = activeIds(G);
    if(G.phase === 'setup'){ G.part = G.players.map(function(p){ return p.id; }).filter(function(id){ return !G.offline[id]; }); return; }
    if(G.phase === 'night'){ if(act.length && act.every(function(id){ return G.done[id]; })) resolveNight(G); }
    else if(G.phase === 'day'){ if(act.length && act.every(function(id){ return G.rv[id]; })) toVote(G); }
    else if(G.phase === 'vote'){ if(act.length && act.every(function(id){ return G.votes[id] != null; })) resolveVote(G); }
  }
  function resolveNight(G){
    var fc = JSON.parse(JSON.stringify(G.cards)), fz = G.center.slice(), a = G.acts;
    function swapP(x, y){ var t = fc[x]; fc[x] = fc[y]; fc[y] = t; }
    if(a.rob) swapP(a.rob.by, a.rob.target);                                            // 怪盗 → 怪人 → 酔っぱらい の順に処理
    if(a.swap) swapP(a.swap.a, a.swap.b);
    if(a.drunk){ var t = fc[a.drunk.by]; fc[a.drunk.by] = fz[a.drunk.c]; fz[a.drunk.c] = t; }
    G.part.forEach(function(id){
      if(G.cards[id] === 'insomniac') G.info[id].push('あなたの最終カード: ' + rn(fc[id]) + (fc[id] === 'insomniac' ? '(交換されていません)' : '(夜のうちに交換されました)'));
    });
    G.fcards = fc; G.fcenter = fz;
    G.log.sort(function(x, y){ return x.o - y.o; });
    G.phase = 'day'; G.rv = {}; G.endAt = Date.now() + G.minutes * 60000;
  }
  function toVote(G){ G.phase = 'vote'; G.votes = {}; }
  function resolveVote(G){
    var fc = G.fcards, counts = {};
    G.part.forEach(function(id){ counts[id] = 0; });
    Object.keys(G.votes).forEach(function(v){ var t = G.votes[v]; if(counts[t] != null) counts[t]++; });
    var max = Math.max.apply(null, G.part.map(function(id){ return counts[id]; }));
    var dead = max >= 2 ? G.part.filter(function(id){ return counts[id] === max; }) : [];   // 全員が1票以下なら誰も処刑されない
    var hunterKill = null;
    dead.slice().forEach(function(id){
      if(fc[id] === 'hunter' && G.votes[id] && dead.indexOf(G.votes[id]) < 0){ hunterKill = { hunter: id, target: G.votes[id] }; dead.push(G.votes[id]); }
    });
    var anyWolf = G.part.some(function(id){ return fc[id] === 'wolf'; });
    var wolfDied = dead.some(function(id){ return fc[id] === 'wolf'; });
    var tannerDied = dead.some(function(id){ return fc[id] === 'tanner'; });
    var village = anyWolf ? wolfDied : dead.length === 0;
    var wolfTeam = anyWolf && !wolfDied && !tannerDied;
    var minionWin = anyWolf ? (!wolfDied && !tannerDied) : dead.some(function(id){ return fc[id] !== 'minion'; });
    var win = {};
    G.part.forEach(function(id){
      var tm = ROLES[fc[id]].team;
      win[id] = tm === 'village' ? village : tm === 'wolf' ? wolfTeam : tm === 'minion' ? minionWin : dead.indexOf(id) >= 0;
    });
    var drinkers = G.part.filter(function(id){ return !win[id]; });
    drinkers.forEach(function(id){ G.drinks[id]++; });
    G.part.forEach(function(id){ if(win[id]) G.wins[id]++; });
    G.res = { votes: JSON.parse(JSON.stringify(G.votes)), counts: counts, dead: dead, hunterKill: hunterKill, village: village, wolfTeam: wolfTeam, minionWin: minionWin, anyWolf: anyWolf, win: win, drinkers: drinkers };
    G.phase = 'result';
  }

  function act(G, pid, a, rnd){
    if(!a || typeof a !== 'object') return { error: '操作が不正です' };
    var host = (pid === 'p0');
    switch(a.t){
      case 'setSel': {
        if(!host || G.phase !== 'setup') return { error: '今は変えられません' };
        var r = a.role;
        if(!ROLES[r] || r === 'villager') return { error: '役職が不正です' };
        if(typeof a.n !== 'number' || a.n % 1 !== 0 || a.n < 0 || a.n > ROLES[r].max) return { error: '枚数が不正です' };
        G.sel[r] = a.n; return { ok: true };
      }
      case 'preset':
        if(!host || G.phase !== 'setup') return { error: '今は変えられません' };
        G.sel = defaultSel(); return { ok: true };
      case 'setMinutes':
        if(!host || G.phase !== 'setup' || MINUTES.indexOf(a.m) < 0) return { error: '時間が不正です' };
        G.minutes = a.m; return { ok: true };
      case 'deal': {
        if(!host || G.phase !== 'setup') return { error: 'ホストだけが配れます' };
        G.part = G.players.map(function(p){ return p.id; }).filter(function(id){ return !G.offline[id]; });
        var e = checkSel(G.sel, G.part.length + 3); if(e) return { error: e };
        deal(G, rnd); return { ok: true };
      }
      case 'night': return nightAct(G, pid, a);
      case 'toVote': {
        if(G.phase !== 'day' || !inPart(G, pid)) return { error: '今は進めません' };
        G.rv[pid] = true;
        if(host || Date.now() >= G.endAt) toVote(G); else maybeAdvance(G);
        return { ok: true };
      }
      case 'vote':
        if(G.phase !== 'vote' || !inPart(G, pid)) return { error: '今は投票できません' };
        if(!inPart(G, a.target) || a.target === pid) return { error: 'その人には投票できません' };
        G.votes[pid] = a.target; maybeAdvance(G); return { ok: true };
      case 'again': {
        if(!host || G.phase !== 'result') return { error: 'ホストだけが進められます' };
        var np = G.players.map(function(p){ return p.id; }).filter(function(id){ return !G.offline[id]; });
        if(checkSel(G.sel, np.length + 3)){ G.phase = 'setup'; G.part = np; return { ok: true }; }   // 人数が変わって合わなければ役職選びへ
        deal(G, rnd); return { ok: true };
      }
      case 'resetup':
        if(!host || G.phase !== 'result') return { error: 'ホストだけが進められます' };
        G.phase = 'setup'; G.part = G.players.map(function(p){ return p.id; }).filter(function(id){ return !G.offline[id]; }); return { ok: true };
    }
    return { error: '未対応の操作' };
  }
  function nightAct(G, pid, a){
    if(G.phase !== 'night' || !inPart(G, pid)) return { error: '今は行動できません' };
    if(G.done[pid]) return { error: 'もう行動を終えています' };
    var need = needKind(G, pid), role = G.cards[pid], me = nm(G, pid), o = ROLES[role].o;
    function okIdx(c){ return typeof c === 'number' && c % 1 === 0 && c >= 0 && c <= 2; }
    function okP(x){ return typeof x === 'string' && inPart(G, x) && x !== pid; }
    switch(a.k){
      case 'ack': if(need !== 'ack') return { error: '行動を選んでください' }; break;
      case 'skip': if(need !== 'peek-opt' && need !== 'rob-opt') return { error: 'スキップできません' }; break;
      case 'peek':
        if(need !== 'peek-opt' || !okIdx(a.c)) return { error: '操作が不正です' };
        G.info[pid].push('中央' + (a.c + 1) + 'のカード: ' + rn(G.center[a.c])); G.log.push({ o: o, s: '人狼(' + me + ')が中央' + (a.c + 1) + 'を見た' }); break;
      case 'seerP':
        if(need !== 'seer' || !okP(a.target)) return { error: '操作が不正です' };
        G.info[pid].push(nm(G, a.target) + 'のカード: ' + rn(G.cards[a.target])); G.log.push({ o: o, s: '占い師(' + me + ')が' + nm(G, a.target) + 'を見た' }); break;
      case 'seerC':
        if(need !== 'seer' || !Array.isArray(a.cs) || a.cs.length !== 2 || !okIdx(a.cs[0]) || !okIdx(a.cs[1]) || a.cs[0] === a.cs[1]) return { error: '操作が不正です' };
        G.info[pid].push('中央' + (a.cs[0] + 1) + ': ' + rn(G.center[a.cs[0]]) + ' / 中央' + (a.cs[1] + 1) + ': ' + rn(G.center[a.cs[1]]));
        G.log.push({ o: o, s: '占い師(' + me + ')が中央' + (a.cs[0] + 1) + 'と' + (a.cs[1] + 1) + 'を見た' }); break;
      case 'rob':
        if(need !== 'rob-opt' || !okP(a.target)) return { error: '操作が不正です' };
        G.acts.rob = { by: pid, target: a.target };
        G.info[pid].push(nm(G, a.target) + 'とカードを交換。あなたの新しいカード: ' + rn(G.cards[a.target]));
        G.log.push({ o: o, s: '怪盗(' + me + ')が' + nm(G, a.target) + 'とカードを交換した' }); break;
      case 'swap':
        if(need !== 'swap' || !okP(a.a) || !okP(a.b) || a.a === a.b) return { error: '操作が不正です' };
        G.acts.swap = { by: pid, a: a.a, b: a.b };
        G.info[pid].push(nm(G, a.a) + 'と' + nm(G, a.b) + 'のカードを入れ替えました(中身は見ていません)');
        G.log.push({ o: o, s: '怪人(' + me + ')が' + nm(G, a.a) + 'と' + nm(G, a.b) + 'のカードを入れ替えた' }); break;
      case 'bake':
        if(need !== 'bake' || !okP(a.target)) return { error: '操作が不正です' };
        G.info[a.target].push('🥖 パンが届きました(誰からかは分かりません)');
        G.info[pid].push(nm(G, a.target) + 'にパンを届けました');
        G.log.push({ o: o, s: 'パン屋(' + me + ')が' + nm(G, a.target) + 'にパンを届けた' }); break;
      case 'drink':
        if(need !== 'drunk' || !okIdx(a.c)) return { error: '操作が不正です' };
        G.acts.drunk = { by: pid, c: a.c };
        G.info[pid].push('中央' + (a.c + 1) + 'のカードと交換しました(新しいカードは分かりません)');
        G.log.push({ o: o, s: '酔っぱらい(' + me + ')が中央' + (a.c + 1) + 'のカードと交換した' }); break;
      default: return { error: '未対応の操作' };
    }
    G.done[pid] = true; maybeAdvance(G); return { ok: true };
  }
  function force(G){
    if(G.phase === 'night'){ activeIds(G).forEach(function(id){ G.done[id] = true; }); resolveNight(G); }
    else if(G.phase === 'day'){ toVote(G); }
    else if(G.phase === 'vote'){ resolveVote(G); }
  }
  function waiting(G){
    if(G.phase === 'night') return activeIds(G).filter(function(id){ return !G.done[id]; });
    if(G.phase === 'vote') return activeIds(G).filter(function(id){ return G.votes[id] == null; });
    return [];
  }
  function view(G, pid){
    var part = inPart(G, pid);
    var v = { phase: G.phase, round: G.round, part: G.part, drinks: G.drinks, wins: G.wins, inPart: part, minutes: G.minutes, roleOrder: ORDER };
    if(G.phase === 'setup'){
      v.sel = G.sel; v.total = G.part.length + 3; v.err = checkSel(G.sel, v.total); v.deck = v.err ? null : deckCounts(G.sel, v.total);
    } else if(G.phase !== 'result'){
      v.deck = G.deckCounts;
      if(part){
        v.myCard = G.cards[pid]; v.info = G.info[pid] || [];
        if(G.phase === 'night'){ v.need = G.done[pid] ? null : needKind(G, pid); v.done = !!G.done[pid]; v.doneList = Object.keys(G.done);
          v.others = G.part.filter(function(x){ return x !== pid; });
          if(v.need === 'ack' && G.cards[pid] === 'wolf') v.packMates = true; }
        else {
          if(G.phase === 'day'){ v.remainMs = Math.max(0, G.endAt - Date.now()); v.rvCount = Object.keys(G.rv).length; v.iAmRv = !!G.rv[pid]; }
          if(G.phase === 'vote'){ v.myVote = G.votes[pid] || null; v.voted = Object.keys(G.votes); v.others = G.part.filter(function(x){ return x !== pid; }); }
        }
      }
    } else {
      var R = G.res;
      v.deck = G.deckCounts; v.cards = G.cards; v.fcards = G.fcards; v.center = G.center; v.fcenter = G.fcenter; v.log = G.log.map(function(x){ return x.s; });
      v.votes = R.votes; v.counts = R.counts; v.dead = R.dead; v.hunterKill = R.hunterKill; v.village = R.village; v.wolfTeam = R.wolfTeam; v.minionWin = R.minionWin;
      v.anyWolf = R.anyWolf; v.win = R.win; v.drinkers = R.drinkers;
    }
    return v;
  }
  var game = { newState: newState, act: act, view: view, waiting: waiting, force: force, sync: maybeAdvance };
  /* PURE-END */

  /* ---------------- 画面 ---------------- */
  function render(root, ctx){
    var v = ctx.view, esc = ctx.esc, me = ctx.me, h = '', L = ctx.local;
    var key = v.phase + ':' + v.round;
    if(L.key !== key){ L.key = key; L.pick = null; L.sw = []; L.cs = []; L.mode = 'p'; }
    function btn(id, label, cls, extra){ return '<button class="' + (cls || 'btn-primary') + '" id="' + id + '"' + (extra || '') + '>' + label + '</button>'; }
    function names(ids){ return ids.length ? ids.map(function(id){ return esc(ctx.nameOf(id)); }).join('・') : 'なし'; }
    function R(r){ return ROLES[r]; }
    function roleTag(r){ return R(r).emoji + ' ' + R(r).name; }
    function deckChips(deck){
      if(!deck) return '';
      return '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">' + ORDER.filter(function(r){ return deck[r] > 0; }).map(function(r){
        return '<span style="padding:5px 10px;border-radius:999px;background:var(--bg-surface);border:1px solid var(--line);font-size:12px;font-weight:700">' + roleTag(r) + (deck[r] > 1 ? ' ×' + deck[r] : '') + '</span>'; }).join('') + '</div>';
    }
    function board(){
      var rows = ctx.players.map(function(p){
        return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">' + ctx.chip(p.id) +
          '<span style="margin-left:auto;font-size:12px;color:var(--text-muted)">勝ち ' + (v.wins[p.id] || 0) + ' / 飲んだ <b style="font-size:17px;color:var(--text)">' + (v.drinks[p.id] || 0) + '</b></span></div>'; }).join('');
      return '<div class="section-label">ここまでの記録</div><div style="background:var(--bg-surface);border:1px solid var(--line);border-radius:14px;padding:2px 14px">' + rows + '</div>';
    }
    function myCardBox(label){
      return '<div class="card-ui"><div class="sub-text" style="margin:0 0 6px">' + label + '</div><div class="big-text" style="font-size:34px;color:var(--accent)">' + roleTag(v.myCard) + '</div>' +
        '<div class="sub-text">' + esc(R(v.myCard).desc) + '</div></div>';
    }
    function infoBox(){
      if(!v.info || !v.info.length) return '';
      return '<div class="card-ui" style="margin-top:12px"><div class="sub-text" style="margin:0 0 6px">あなたが夜に知ったこと(他の人には見えません)</div>' +
        v.info.map(function(s){ return '<div style="font-weight:700;margin-top:4px">' + esc(s) + '</div>'; }).join('') + '</div>';
    }
    function playerBtns(ids, selected, attr){
      return '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:10px">' + ids.map(function(id){
        var on = selected.indexOf(id) >= 0;
        return '<button ' + attr + '="' + id + '" style="padding:14px 8px;border-radius:14px;font-weight:900;font-size:15px;border:2px solid ' + (on ? 'var(--accent)' : 'var(--line)') + ';background:var(--bg-surface);color:' + (on ? 'var(--accent)' : 'var(--text)') + '">' + esc(ctx.nameOf(id)) + '</button>'; }).join('') + '</div>';
    }
    function centerBtns(selected, attr){
      return '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px">' + [0, 1, 2].map(function(i){
        var on = selected.indexOf(i) >= 0;
        return '<button ' + attr + '="' + i + '" style="padding:18px 6px;border-radius:14px;font-weight:900;font-size:15px;border:2px solid ' + (on ? 'var(--accent)' : 'var(--line)') + ';background:var(--bg-surface);color:' + (on ? 'var(--accent)' : 'var(--text)') + '">🂠 中央' + (i + 1) + '</button>'; }).join('') + '</div>';
    }

    // 役職の説明(今回のゲームに入っている役職だけを、全員のスマホで見られる)
    function helpHtml(){
      var inPlay = [];
      if(v.phase === 'setup'){ ORDER.forEach(function(r){ if(r !== 'villager' && (v.sel[r] || 0) > 0) inPlay.push([r, v.sel[r]]); }); if(v.deck && v.deck.villager > 0) inPlay.unshift(['villager', v.deck.villager]); }
      else if(v.deck){ ORDER.forEach(function(r){ if(v.deck[r] > 0) inPlay.push([r, v.deck[r]]); }); }
      if(!inPlay.length) return '';
      var btnH = '<button id="bHelp" class="btn-ghost" style="margin:8px 0 0;padding:9px 12px;font-size:13px">' + (L.help ? '▲ 役職の説明を閉じる' : '📖 今回の役職の説明を見る') + '</button>';
      if(!L.help) return btnH;
      var cards = inPlay.map(function(x){
        var r = x[0], d = R(r), tm = TEAMS[d.team];
        return '<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div style="display:flex;align-items:center;gap:8px"><b style="font-size:15px">' + roleTag(r) + (x[1] > 1 ? ' ×' + x[1] : '') + '</b>' +
          '<span style="margin-left:auto;font-size:11px;font-weight:900;padding:3px 8px;border-radius:999px;border:1px solid var(--line);color:var(--text-muted)">' + esc(tm.name) + '</span></div>' +
          '<div style="font-size:13px;margin-top:4px">' + esc(d.desc) + '</div>' +
          '<div style="font-size:11px;color:var(--text-muted);margin-top:3px">勝利条件: ' + esc(tm.win) + '</div></div>'; }).join('');
      return btnH + '<div style="background:var(--bg-surface);border:1px solid var(--line);border-radius:14px;padding:2px 14px;margin-top:8px">' + cards + '</div>';
    }
    var top = '<div class="eyebrow">ROUND ' + v.round + '</div>' + helpHtml();
    if(v.phase === 'setup'){
      var rows = ORDER.filter(function(r){ return r !== 'villager'; }).map(function(r){
        var c = v.sel[r] || 0, step = (r === 'mason') ? 2 : 1;
        return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)"><div style="flex:1;min-width:0"><div style="font-weight:900">' + roleTag(r) + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + esc(R(r).desc) + '</div></div>' +
          (ctx.isHost ? '<button data-dn="' + r + '" style="width:36px;height:36px;border-radius:50%;border:1.5px solid var(--line);background:var(--bg-surface);color:var(--text);font-size:20px;font-weight:900">−</button>' +
            '<b style="min-width:20px;text-align:center;font-size:18px">' + c + '</b>' +
            '<button data-up="' + r + '" style="width:36px;height:36px;border-radius:50%;border:1.5px solid var(--line);background:var(--bg-surface);color:var(--text);font-size:20px;font-weight:900">＋</button>'
            : '<b style="font-size:18px">' + c + '</b>') + '</div>'; }).join('');
      h = top + '<div class="card-ui"><div class="big-text" style="font-size:19px">役職を選ぶ' + (ctx.isHost ? '' : '(ホストが選んでいます)') + '</div>' +
        '<div class="sub-text">全部で <b>' + v.total + '枚</b>(人数' + (v.total - 3) + '＋中央3枚)。' + (v.deck ? '村人 <b>' + v.deck.villager + '枚</b>は残りを自動で入れます。' : '') + '</div>' +
        (v.err ? '<div style="color:var(--danger);font-weight:700;margin-top:8px">' + esc(v.err) + '</div>' : '') + '</div>' +
        '<div style="background:var(--bg-surface);border:1px solid var(--line);border-radius:14px;padding:2px 14px;margin-top:12px">' + rows + '</div>' +
        (ctx.isHost ? '<div class="section-label">話し合いの時間</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' +
          MINUTES.map(function(m){ return '<button class="btn-ghost" data-min="' + m + '" style="margin:0;' + (v.minutes === m ? 'border-color:var(--accent);color:var(--accent)' : '') + '">' + m + '分</button>'; }).join('') + '</div>' +
          '<button class="btn-ghost" id="bPreset" style="margin-top:10px">おすすめに戻す</button>'
          : '<div class="sub-text" style="text-align:center;margin-top:12px">話し合い: ' + v.minutes + '分</div>') +
        '<div class="spacer"></div><div class="bottombar">' + (ctx.isHost ? btn('bDeal', '役職を配って始める', 'btn-primary', v.err ? ' disabled' : '') : '<div class="sub-text" style="text-align:center">ホストが始めるのを待っています…</div>') + '</div>';
    } else if(!v.inPart && v.phase !== 'result'){
      h = top + '<div class="card-ui"><div class="big-text">このゲームは観戦中</div><div class="sub-text">途中で入り直したので、次のゲームから参加できます。</div></div>' + ctx.waitHtml();
    } else if(v.phase === 'night'){
      h = top + '<div class="card-ui" style="margin-bottom:12px"><div class="sub-text" style="margin:0">今夜のカード構成(人数+中央3枚)</div>' + deckChips(v.deck) + '</div>' + myCardBox('あなたの役職(他の人に見せない)') + infoBox();
      if(v.done){
        h += '<div class="sub-text" style="text-align:center;margin-top:14px">夜の行動を終えました。みんなを待っています…</div>' + ctx.waitHtml();
      } else if(v.need === 'ack'){
        h += '<div class="spacer"></div><div class="bottombar">' + btn('bAck', '確認した') + '</div>';
      } else if(v.need === 'peek-opt'){
        h += '<div class="section-label">あなたしか人狼がいません。中央のカードを1枚見られます</div>' + centerBtns(L.pick != null ? [L.pick] : [], 'data-c') +
          '<div class="spacer"></div><div class="bottombar">' + btn('bPeek', '見る') + btn('bSkip', '見ない', 'btn-ghost') + '</div>';
      } else if(v.need === 'seer'){
        h += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:12px">' +
          '<button class="btn-ghost" data-mode="p" style="margin:0;' + (L.mode === 'p' ? 'border-color:var(--accent);color:var(--accent)' : '') + '">人を1人見る</button>' +
          '<button class="btn-ghost" data-mode="c" style="margin:0;' + (L.mode === 'c' ? 'border-color:var(--accent);color:var(--accent)' : '') + '">中央を2枚見る</button></div>' +
          (L.mode === 'p' ? playerBtns(v.others, L.pick ? [L.pick] : [], 'data-p') : centerBtns(L.cs, 'data-cs')) +
          '<div class="spacer"></div><div class="bottombar">' + btn('bSeer', '見る') + '</div>';
      } else if(v.need === 'rob-opt'){
        h += '<div class="section-label">カードを交換する相手(交換して新しいカードを見ます)</div>' + playerBtns(v.others, L.pick ? [L.pick] : [], 'data-p') +
          '<div class="spacer"></div><div class="bottombar">' + btn('bRob', '交換する') + btn('bSkip', '交換しない', 'btn-ghost') + '</div>';
      } else if(v.need === 'swap'){
        h += '<div class="section-label">カードを入れ替える2人(中身は見えません)</div>' + playerBtns(v.others, L.sw, 'data-sw') +
          '<div class="spacer"></div><div class="bottombar">' + btn('bSwap', '入れ替える') + '</div>';
      } else if(v.need === 'bake'){
        h += '<div class="section-label">パンを届ける相手(届いた人は夜のうちに知らされます)</div>' + playerBtns(v.others, L.pick ? [L.pick] : [], 'data-p') +
          '<div class="spacer"></div><div class="bottombar">' + btn('bBake', 'パンを届ける') + '</div>';
      } else if(v.need === 'drunk'){
        h += '<div class="section-label">交換する中央のカード(新しいカードは見えません)</div>' + centerBtns(L.pick != null ? [L.pick] : [], 'data-c') +
          '<div class="spacer"></div><div class="bottombar">' + btn('bDrink', '交換する') + '</div>';
      }
    } else if(v.phase === 'day' || v.phase === 'vote'){
      h = top + (v.phase === 'day' ? '<div class="card-ui"><div class="sub-text" style="margin:0">残り時間</div><div class="big-text" style="font-size:46px;font-variant-numeric:tabular-nums" id="clock">--:--</div>' +
        '</div>' : '') +
        '<div style="margin-top:12px">' + myCardBox('あなたが最初に配られた役職') + '</div>' + infoBox() +
        '<div class="card-ui" style="margin-top:12px"><div class="sub-text" style="margin:0">今夜のカード構成</div>' + deckChips(v.deck) + '<div class="sub-text" style="margin-top:8px">夜のうちに交換されて、今の役職は変わっているかもしれません。</div></div>';
      if(v.phase === 'day'){
        h += '<div class="spacer"></div><div class="bottombar">' + (v.iAmRv ? '<button class="btn-primary" disabled>投票に進む(' + v.rvCount + '人)…</button>' : btn('bToVote', ctx.isHost ? '投票に進む' : '投票に進む(' + v.rvCount + '人)')) + '</div>';
      } else {
        h += '<div class="section-label">処刑する人に投票(一斉に公開されます)</div>' + playerBtns(v.others, [L.pick || v.myVote].filter(Boolean), 'data-p') +
          '<div class="waitbar">' + (v.voted.length ? '投票済み: ' + names(v.voted) : '') + '</div>' + ctx.waitHtml() +
          '<div class="spacer"></div><div class="bottombar">' + btn('bVote', v.myVote ? '投票先を変更する' : 'この人に投票') + '</div>';
      }
    } else {
      var ord = v.part;
      var rowsR = ord.map(function(id){
        var win = v.win[id], dead = v.dead.indexOf(id) >= 0, changed = v.cards[id] !== v.fcards[id];
        return '<div style="background:var(--bg-surface);border:1.5px solid ' + (win ? 'var(--gold)' : 'var(--line)') + ';border-radius:14px;padding:10px 12px;margin-top:8px">' +
          '<div style="display:flex;align-items:center;gap:10px">' + ctx.chip(id) + '<span style="margin-left:auto;font-size:12px;font-weight:900;color:' + (win ? 'var(--gold)' : 'var(--danger)') + '">' + (win ? '👑 勝ち' : '負け → 飲む') + '</span></div>' +
          '<div style="margin-top:6px;font-size:14px">配られた: <b>' + roleTag(v.cards[id]) + '</b>' + (changed ? ' → 最終: <b style="color:var(--accent)">' + roleTag(v.fcards[id]) + '</b>' : '') + '</div>' +
          '<div style="font-size:12px;color:var(--text-muted);margin-top:3px">' + (dead ? '☠ 処刑された / ' : '') + v.counts[id] + '票' + (v.votes[id] ? ' / ' + esc(ctx.nameOf(v.votes[id])) + 'に投票' : ' / 棄権') + '</div></div>'; }).join('');
      var verdict = v.dead.length ? '処刑: ' + names(v.dead) : '誰も処刑されなかった(全員1票以下)';
      var cen = [0, 1, 2].map(function(i){ return '中央' + (i + 1) + ': ' + roleTag(v.center[i]) + (v.center[i] !== v.fcenter[i] ? ' → ' + roleTag(v.fcenter[i]) : ''); }).join('<br>');
      h = top + '<div class="card-ui"><div class="big-text" style="font-size:20px;color:var(--gold)">' + verdict + '</div>' +
        '<div class="sub-text">' + (v.hunterKill ? '🏹 狩人(' + esc(ctx.nameOf(v.hunterKill.hunter)) + ')の道連れで ' + esc(ctx.nameOf(v.hunterKill.target)) + ' も処刑。<br>' : '') +
        (v.anyWolf ? '人狼は ' + (v.village ? '処刑された → 村人陣営の勝ち' : '処刑されなかった') : '人狼はプレイヤーの中にいなかった') + '</div>' +
        '<div class="sub-text">飲むのは: ' + names(v.drinkers) + '</div></div>' +
        '<div class="section-label">全員のカード</div>' + rowsR +
        '<div class="card-ui" style="margin-top:12px"><div class="sub-text" style="margin:0 0 4px">中央のカード</div><div style="font-weight:700">' + cen + '</div></div>' +
        (v.log.length ? '<div class="card-ui" style="margin-top:12px"><div class="sub-text" style="margin:0 0 4px">夜に起きたこと</div>' + v.log.map(function(s){ return '<div style="font-weight:700;margin-top:3px">' + esc(s) + '</div>'; }).join('') + '</div>' : '') +
        board() + '<div class="spacer"></div><div class="bottombar">' +
        (ctx.isHost ? btn('bAgain', 'もう一度(同じ役職で配り直す)') + btn('bReSetup', '役職を選び直す', 'btn-ghost') : '<div class="sub-text" style="text-align:center">ホストが次へ進めるのを待っています…</div>') + '</div>';
    }
    root.innerHTML = h;

    var q = function(id){ return document.getElementById(id); };
    if(q('bHelp')) q('bHelp').onclick = function(){ L.help = !L.help; render(root, ctx); };
    function on(sel, f){ root.querySelectorAll(sel).forEach(function(b){ b.onclick = function(){ f(b); }; }); }
    on('[data-up]', function(b){ var r = b.dataset.up, st = (r === 'mason') ? 2 : 1, c = Math.min(R(r).max, (v.sel[r] || 0) + st); ctx.send({ t: 'setSel', role: r, n: c }); });
    on('[data-dn]', function(b){ var r = b.dataset.dn, st = (r === 'mason') ? 2 : 1, c = Math.max(0, (v.sel[r] || 0) - st); ctx.send({ t: 'setSel', role: r, n: c }); });
    on('[data-min]', function(b){ ctx.send({ t: 'setMinutes', m: parseInt(b.dataset.min, 10) }); });
    if(q('bPreset')) q('bPreset').onclick = function(){ ctx.send({ t: 'preset' }); };
    if(q('bDeal')) q('bDeal').onclick = function(){ ctx.send({ t: 'deal' }); };
    function night(o){ o.t = 'night'; ctx.send(o); }
    if(q('bAck')) q('bAck').onclick = function(){ night({ k: 'ack' }); };
    if(q('bSkip')) q('bSkip').onclick = function(){ night({ k: 'skip' }); };
    function mark(group, on_){ group.forEach(function(b){ b.style.borderColor = on_(b) ? 'var(--accent)' : 'var(--line)'; b.style.color = on_(b) ? 'var(--accent)' : 'var(--text)'; }); }
    var gp = root.querySelectorAll('[data-p]'), gc = root.querySelectorAll('[data-c]'), gs = root.querySelectorAll('[data-sw]'), gcs = root.querySelectorAll('[data-cs]');
    gp.forEach(function(b){ b.onclick = function(){ L.pick = b.dataset.p; mark(gp, function(x){ return x.dataset.p === L.pick; }); ctx.tone(500, 0.05, 'triangle', 0.07); }; });
    gc.forEach(function(b){ b.onclick = function(){ L.pick = parseInt(b.dataset.c, 10); mark(gc, function(x){ return parseInt(x.dataset.c, 10) === L.pick; }); ctx.tone(500, 0.05, 'triangle', 0.07); }; });
    gs.forEach(function(b){ b.onclick = function(){
      var id = b.dataset.sw, i = L.sw.indexOf(id);
      if(i >= 0) L.sw.splice(i, 1); else { L.sw.push(id); if(L.sw.length > 2) L.sw.shift(); }
      mark(gs, function(x){ return L.sw.indexOf(x.dataset.sw) >= 0; }); ctx.tone(500, 0.05, 'triangle', 0.07); }; });
    gcs.forEach(function(b){ b.onclick = function(){
      var i = parseInt(b.dataset.cs, 10), k = L.cs.indexOf(i);
      if(k >= 0) L.cs.splice(k, 1); else { L.cs.push(i); if(L.cs.length > 2) L.cs.shift(); }
      mark(gcs, function(x){ return L.cs.indexOf(parseInt(x.dataset.cs, 10)) >= 0; }); ctx.tone(500, 0.05, 'triangle', 0.07); }; });
    on('[data-mode]', function(b){ L.mode = b.dataset.mode; L.pick = null; L.cs = []; render(root, ctx); });   // モード切替は画面の中身が変わるので、描画をやり直す
    if(q('bPeek')) q('bPeek').onclick = function(){ if(L.pick == null){ ctx.toast('見るカードを選んでください'); return; } night({ k: 'peek', c: L.pick }); };
    if(q('bSeer')) q('bSeer').onclick = function(){
      if(L.mode === 'p'){ if(!L.pick){ ctx.toast('見る人を選んでください'); return; } night({ k: 'seerP', target: L.pick }); }
      else { if(L.cs.length !== 2){ ctx.toast('中央のカードを2枚選んでください'); return; } night({ k: 'seerC', cs: L.cs.slice().sort() }); }
    };
    if(q('bRob')) q('bRob').onclick = function(){ if(!L.pick){ ctx.toast('交換する相手を選んでください'); return; } night({ k: 'rob', target: L.pick }); };
    if(q('bSwap')) q('bSwap').onclick = function(){ if(L.sw.length !== 2){ ctx.toast('2人選んでください'); return; } night({ k: 'swap', a: L.sw[0], b: L.sw[1] }); };
    if(q('bBake')) q('bBake').onclick = function(){ if(!L.pick){ ctx.toast('パンを届ける相手を選んでください'); return; } night({ k: 'bake', target: L.pick }); };
    if(q('bDrink')) q('bDrink').onclick = function(){ if(L.pick == null){ ctx.toast('中央のカードを選んでください'); return; } night({ k: 'drink', c: L.pick }); };
    if(q('bToVote')) q('bToVote').onclick = function(){ ctx.send({ t: 'toVote' }); };
    if(q('bVote')) q('bVote').onclick = function(){ var t = L.pick || v.myVote; if(!t){ ctx.toast('投票先を選んでください'); return; } ctx.send({ t: 'vote', target: t }); ctx.tone(520, 0.08, 'triangle', 0.1); };
    if(q('bAgain')) q('bAgain').onclick = function(){ ctx.send({ t: 'again' }); };
    if(q('bReSetup')) q('bReSetup').onclick = function(){ ctx.send({ t: 'resetup' }); };
    if(v.phase === 'day'){
      var endsAt = Date.now() + v.remainMs;
      ctx.every(function(){
        var r = Math.max(0, endsAt - Date.now()), s = Math.ceil(r / 1000), c = document.getElementById('clock'); if(!c) return;
        c.textContent = (r === 0) ? '時間切れ' : (('0' + Math.floor(s / 60)).slice(-2) + ':' + ('0' + (s % 60)).slice(-2));
        if(r === 0) c.style.color = 'var(--danger)';
      }, 500);
    }
  }

  NO.register({
    id: 'onenight', emoji: '🌙', title: 'ワンナイト人狼', accent: '#8C9CFF', accentInk: '#0C1030', min: 3, max: 10,
    tagline: '役職カードがスマホに配られる。一晩で能力を使い、朝に話し合って人狼を処刑しよう。役職はホストが選べる。',
    rules: [
      'ゲーム開始前に、ホストが<b>入れる役職</b>(人狼・狂人・占い師・怪盗・怪人・パン屋・てるてる…)を選ぶ。<b>人数+中央3枚</b>が配られ、残りは村人。今回の役職の説明は、各自のスマホでいつでも見られる。',
      '<b>夜</b>: 全員が同時に、自分の役職の行動をスマホで入力(占う・交換する等)。カードは夜のうちに入れ替わるので、<b>最初の役職が最後も同じとは限らない</b>。',
      '<b>朝</b>: 時間内に話し合い、<b>一斉に投票</b>。最多得票の人(同数なら全員)が処刑される。全員が1票以下なら誰も処刑されない。',
      '<b>村人陣営</b>は人狼を処刑すれば勝ち。<b>人狼陣営</b>は人狼が処刑されなければ勝ち。<b>てるてる</b>は処刑されれば単独で勝ち。',
      '<b>負けた陣営の人が飲む。</b>勝敗は最終的に持っているカードで決まる。'
    ],
    game: game, render: render
  });
})();
