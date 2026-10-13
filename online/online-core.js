/*
 * 飲み会ゲーム集 オンライン版 共通基盤 (online-core.js)  ※開発中
 *   使い方: 各ゲームのJS(g-*.js)が NomikaiOnline.register({...}) でゲームを登録し、online/index.html が startHub() を呼ぶ。
 *   QRコードで部屋に参加 → ロビーでゲームを選ぶ → ロビーに戻って別のゲームを選ぶ、を同じ部屋のまま繰り返せる。
 *
 * 仕組み:
 *   - ホスト(部屋を作った人)の端末が「ゲームの正しい状態」を1つだけ持つ(ホスト権威型)。
 *   - 参加者はQRコード/部屋コードでホストに接続し、操作(action)をホストへ送る。
 *   - ホストは操作を受けて状態を更新し、「その人に見せてよい情報だけ」を各端末に送り返す(秘密の数字・お題などは本人にだけ届く)。
 *   - 通信は WebRTC(PeerJS)。ページの配信は GitHub Pages のまま。
 *   - ホスト端末は自分の画面に出る情報も見えるため、ホストが改造すれば不正は可能(身内の飲み会用の前提)。
 *
 * 公平性・ノイズ処理について:
 *   - 乱数は crypto.getRandomValues + 棄却サンプリング(剰余バイアスなし)のみ。Math.random は使わない。
 *   - 通信層は受け取った操作をそのまま状態に反映するだけで、値の補正・間引き・並べ替えは一切しない。
 *   - 部屋コードも同じ乱数で生成。
 *
 * 参考文献:
 *   [1] PeerJS (WebRTC のラッパー / 無料クラウドのシグナリングサーバーを使用)
 *       https://peerjs.com/  /  FAQ: https://peerjs.com/client/faq
 *   [2] MDN: WebRTC API  https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API
 *   [3] qrcode-generator (QRコード生成, MIT)  https://github.com/kazuhikoarase/qrcode-generator
 *   [4] MDN Crypto.getRandomValues()  https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues
 *   [5] Fisher-Yates shuffle  https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
 *   [6] MDN: Pointer events / setPointerCapture
 *       https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture
 *   [7] MDN: Web Audio API  https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
 *   [8] 参考にしたゲームの原型: Keynesian beauty contest https://en.wikipedia.org/wiki/Keynesian_beauty_contest
 */
(function(global){
  'use strict';

  /* ---------------- 乱数 [4][5] ---------------- */
  function randInt(n){
    var range = 4294967296, limit = range - (range % n), buf = new Uint32Array(1);
    do { global.crypto.getRandomValues(buf); } while(buf[0] >= limit);
    return buf[0] % n;
  }
  function shuffle(arr, rnd){
    rnd = rnd || randInt;
    var a = arr.slice();
    for(var i = a.length - 1; i > 0; i--){
      var j = rnd(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 紛らわしい 0/O, 1/I を除く
  function makeCode(){
    var s = '';
    for(var i = 0; i < 5; i++) s += CODE_CHARS.charAt(randInt(CODE_CHARS.length));
    return s;
  }
  function makeToken(){
    var s = '';
    for(var i = 0; i < 16; i++) s += CODE_CHARS.charAt(randInt(CODE_CHARS.length));
    return s;
  }
  function esc(s){
    return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
  }

  /* ---------------- 通信層 [1][2] ----------------
   * transport.host(code, cb)   -> { send(connId, msg), close() }
   *   cb: onReady(), onError(kind), onConnect(connId), onMessage(connId, msg), onClose(connId)
   * transport.client(code, cb) -> { send(msg), close() }
   *   cb: onOpen(), onMessage(msg), onClose(), onError(kind)
   * テストでは window.NOMIKAI_TRANSPORT で差し替えられる。 */
  var PEER_PREFIX = 'nomikai-';
  var peerTransport = {
    host: function(code, cb){
      var peer = new global.Peer(PEER_PREFIX + code, global.NOMIKAI_PEER_OPTIONS || {});
      var conns = {};
      peer.on('open', function(){ cb.onReady(); });
      peer.on('error', function(e){ cb.onError(e && e.type === 'unavailable-id' ? 'collision' : ((e && e.type) || 'error')); });
      peer.on('connection', function(conn){
        var id = conn.peer;
        conns[id] = conn;
        conn.on('open', function(){ cb.onConnect(id); });
        conn.on('data', function(d){ cb.onMessage(id, d); });
        conn.on('close', function(){ if(conns[id] === conn){ delete conns[id]; } cb.onClose(id); });
        conn.on('error', function(){ });
      });
      return {
        send: function(id, msg){ var c = conns[id]; if(c && c.open){ try{ c.send(msg); }catch(e){} } },
        close: function(){ try{ peer.destroy(); }catch(e){} }
      };
    },
    client: function(code, cb){
      var peer = new global.Peer(global.NOMIKAI_PEER_OPTIONS || {});
      var conn = null, opened = false;
      peer.on('open', function(){
        conn = peer.connect(PEER_PREFIX + code, { reliable: true });
        conn.on('open', function(){ opened = true; cb.onOpen(); });
        conn.on('data', function(d){ cb.onMessage(d); });
        conn.on('close', function(){ cb.onClose(); });
        conn.on('error', function(){ });
      });
      peer.on('error', function(e){
        var t = e && e.type;
        cb.onError(t === 'peer-unavailable' ? 'noroom' : (t || 'error'));
      });
      return {
        send: function(msg){ if(conn && conn.open){ try{ conn.send(msg); }catch(e){} } },
        close: function(){ try{ peer.destroy(); }catch(e){} }
      };
    }
  };
  function getTransport(){ return global.NOMIKAI_TRANSPORT || peerTransport; }

  /* ---------------- 共通CSS ---------------- */
  var CSS = [
    ':root{--bg-base:#14121A;--bg-surface:#1E1B26;--bg-raised:#282330;--line:#3A3444;--text:#F3F1EE;--text-muted:#9A93A6;',
    '--accent:#4FC3D9;--accent-ink:#06222A;--danger:#FF5A45;--gold:#E8C24A;--safe:#5FD0A8;--radius-card:18px;}',
    '*{box-sizing:border-box;}html,body{margin:0;padding:0;height:100%;overscroll-behavior:none;background:var(--bg-base);}',
    "body{color:var(--text);font-family:'Zen Kaku Gothic New',sans-serif;-webkit-tap-highlight-color:transparent;overflow:hidden;}",
    'h1,h2,h3{margin:0;}button{font-family:inherit;cursor:pointer;border:none;touch-action:manipulation;}button:disabled{opacity:.35;cursor:default;}',
    'input{font-family:inherit;}',
    '#app{width:100%;max-width:460px;margin:0 auto;height:100vh;height:100dvh;display:flex;flex-direction:column;position:relative;}',
    '.screen{display:none;flex-direction:column;flex:1;min-height:0;padding:22px 20px 0;overflow-y:auto;animation:fadeIn .25s ease;}',
    '.screen.active{display:flex;}@keyframes fadeIn{from{opacity:0;}to{opacity:1;}}',
    '.eyebrow{color:var(--text-muted);font-size:12px;letter-spacing:.05em;margin-bottom:8px;}',
    '.title{font-size:28px;font-weight:900;}.tagline{color:var(--text-muted);font-size:13.5px;margin-top:12px;line-height:1.8;}',
    '.badge-dev{display:inline-block;font-size:10.5px;font-weight:900;color:var(--gold);border:1px solid var(--gold);border-radius:6px;padding:1px 6px;margin-left:8px;vertical-align:middle;}',
    '.section-label{font-size:12px;color:var(--text-muted);margin:20px 0 8px;}',
    '.spacer{flex:1;min-height:12px;}.bottombar{padding:14px 0 calc(14px + env(safe-area-inset-bottom));}',
    '.btn-primary{width:100%;background:var(--accent);color:var(--accent-ink);border-radius:14px;padding:15px;font-size:15.5px;font-weight:900;}',
    '.btn-ghost{width:100%;background:transparent;color:var(--text-muted);border:1px solid var(--line);border-radius:14px;padding:12px;font-size:13.5px;font-weight:700;margin-top:9px;}',
    '.btn-danger{background:var(--danger);color:#fff;}',
    '.field{width:100%;background:var(--bg-surface);color:var(--text);border:1.5px solid var(--line);border-radius:12px;padding:13px 14px;font-size:16px;font-weight:700;}',
    '.field:focus{outline:none;border-color:var(--accent);}',
    '.rule-card{background:var(--bg-surface);border:1px solid var(--line);border-radius:var(--radius-card);padding:8px 16px;margin-top:16px;}',
    '.rule-row{display:flex;gap:12px;padding:8px 0;border-bottom:1px solid var(--line);}.rule-row:last-child{border-bottom:none;}',
    '.rule-num{width:22px;height:22px;border-radius:6px;background:var(--bg-raised);color:var(--text-muted);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;}',
    '.rule-text{font-size:13px;line-height:1.6;}.notice{font-size:11px;color:var(--text-muted);margin-top:12px;line-height:1.7;}',
    '.chip{display:inline-flex;align-items:center;justify-content:center;min-height:30px;padding:3px 10px;border-radius:10px;color:#14121A;font-weight:900;font-size:14px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.chip.off{opacity:.4;}',
    '.card-ui{background:var(--bg-surface);border:1.5px solid var(--line);border-radius:20px;padding:20px 16px;text-align:center;margin-top:6px;}',
    '.big-text{font-size:22px;font-weight:900;line-height:1.5;}.sub-text{font-size:12.5px;color:var(--text-muted);margin-top:8px;line-height:1.7;}',
    '.plist{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;}',
    '.qr{background:#fff;border-radius:16px;padding:10px;width:208px;height:208px;margin:14px auto 0;display:flex;align-items:center;justify-content:center;}',
    '.qr svg,.qr img{width:100%;height:100%;display:block;}',
    '.code{font-size:40px;font-weight:900;letter-spacing:.18em;text-align:center;margin-top:12px;font-variant-numeric:tabular-nums;}',
    '.link{font-size:11px;color:var(--text-muted);text-align:center;word-break:break-all;margin-top:6px;}',
    '.topbar{display:none;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--line);background:var(--bg-surface);font-size:12px;color:var(--text-muted);}',
    '.topbar.on{display:flex;}.topbar .rc{font-weight:900;color:var(--text);letter-spacing:.12em;}.topbar .grow{flex:1;}',
    '.topbar button{background:var(--bg-raised);color:var(--text-muted);border:1px solid var(--line);border-radius:8px;padding:5px 9px;font-size:12px;font-weight:700;}',
    '.waitbar{font-size:12px;color:var(--text-muted);text-align:center;margin-top:12px;line-height:1.7;min-height:20px;}',
    '.menu{position:absolute;right:10px;top:46px;z-index:20;background:var(--bg-raised);border:1px solid var(--line);border-radius:12px;padding:6px;display:none;min-width:180px;box-shadow:0 10px 26px rgba(0,0,0,.5);}',
    '.menu.on{display:block;}.menu button{display:block;width:100%;text-align:left;background:transparent;color:var(--text);padding:11px 12px;font-size:13.5px;font-weight:700;border-radius:8px;}',
    '.menu button:disabled{opacity:.35;}',
    '.errbox{background:rgba(255,90,69,.12);border:1px solid var(--danger);border-radius:14px;padding:14px;font-size:13.5px;line-height:1.7;margin-top:18px;}',
    /* 並べ替えリスト */
    '#gameRoot{display:flex;flex-direction:column;flex:1;min-height:0;}',
    '.glist{display:flex;flex-direction:column;gap:10px;margin-top:4px;}',
    '.gcard{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:var(--bg-surface);color:var(--text);border:1.5px solid var(--line);border-radius:16px;padding:12px;}',
    '.gcard:not(:disabled):active{background:var(--bg-raised);border-color:var(--gc);}',
    '.gcard .gi{width:46px;height:46px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;}',
    '.gcard .gt{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;}.gcard .gt b{font-size:15px;font-weight:900;}',
    '.gcard .gs{font-size:12px;color:var(--text-muted);line-height:1.5;}.gcard .gp{font-size:11px;color:var(--text-muted);}',
    '.gcard .gc{color:var(--text-muted);font-size:20px;}.gcard:disabled{opacity:.5;cursor:default;}',
    '.sl{position:relative;}.sl .slotbg{position:absolute;left:0;right:0;border:1px dashed var(--line);border-radius:12px;display:flex;align-items:center;}',
    '.sl .slotbg .sn{width:30px;text-align:center;color:var(--text-muted);font-weight:900;font-size:14px;}',
    '.sl .scard{position:absolute;left:30px;right:0;top:0;border-radius:12px;background:var(--bg-surface);border:1px solid var(--line);display:flex;align-items:center;gap:10px;padding:0 14px 0 10px;cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;transition:transform .24s cubic-bezier(.2,.8,.2,1),box-shadow .15s,border-color .15s;will-change:transform;z-index:1;}',
    '.sl .scard .grip{margin-left:auto;color:var(--text-muted);font-size:20px;letter-spacing:-2px;}',
    '.sl .scard.dragging{transition:box-shadow .15s,border-color .15s;z-index:10;cursor:grabbing;border-color:var(--accent);box-shadow:0 12px 26px rgba(0,0,0,.55);}',
    '.sl .scard.locked{cursor:default;}'
  ].join('\n');

  /* ---------------- 音 [7] ---------------- */
  var actx = null, master = null, muted = false;
  function audio(){
    if(muted) return null;
    try{
      if(!actx){
        var AC = global.AudioContext || global.webkitAudioContext;
        if(!AC) return null;
        actx = new AC(); master = actx.createDynamicsCompressor(); master.connect(actx.destination);
      }
      if(actx.state === 'suspended') actx.resume();
      return actx;
    }catch(e){ return null; }
  }
  function tone(freq, dur, type, vol, delay){
    var a = audio(); if(!a) return;
    var t0 = a.currentTime + (delay || 0);
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  }

  /* ---------------- 並べ替えリスト(ドラッグ) [6] ----------------
   * 掴んだカードは指に追従し、通過したスロットの分だけ他のカードが滑らかにずれる。
   * 離した位置(最終位置)だけを onDrop(id, toIndex) で通知する。途中経過は通信しない。 */
  function moveItem(arr, from, to){
    var a = arr.slice(); var x = a.splice(from, 1)[0]; a.splice(to, 0, x); return a;
  }
  function indexFromY(y, step, n){
    var i = Math.round(y / step);
    return Math.max(0, Math.min(n - 1, i));
  }
  function sortList(container, opts){
    var ROW_H = opts.rowH || 52, GAP = 8, STEP = ROW_H + GAP;
    var items = opts.items.slice();          // [{id, html}]
    var order = items.map(function(x){ return x.id; });
    var byId = {}; items.forEach(function(x){ byId[x.id] = x; });
    var cards = {}, drag = null, pending = null, locked = !!opts.locked;
    var box = document.createElement('div'); box.className = 'sl';
    box.style.height = (items.length * STEP - GAP) + 'px';
    container.innerHTML = ''; container.appendChild(box);
    for(var i = 0; i < items.length; i++){
      var bg = document.createElement('div'); bg.className = 'slotbg';
      bg.style.top = (i * STEP) + 'px'; bg.style.height = ROW_H + 'px';
      bg.innerHTML = '<div class="sn">' + (i + 1) + '</div>'; box.appendChild(bg);
    }
    items.forEach(function(x){
      var c = document.createElement('div'); c.className = 'scard' + (locked ? ' locked' : '');
      c.style.height = ROW_H + 'px'; c.dataset.id = x.id;
      c.innerHTML = x.html + (locked ? '' : '<span class="grip">≡</span>');
      box.appendChild(c); cards[x.id] = c;
    });
    function layout(skip, instant){
      order.forEach(function(id, idx){
        if(id === skip) return;
        var el = cards[id];
        if(instant) el.style.transition = 'none';
        el.style.transform = 'translateY(' + (idx * STEP) + 'px)';
        if(instant){ void el.offsetHeight; el.style.transition = ''; }
      });
    }
    layout(null, true);
    box.addEventListener('pointerdown', function(e){
      if(locked) return;
      var c = e.target.closest ? e.target.closest('.scard') : null;
      if(!c || drag) return;
      e.preventDefault();
      var id = c.dataset.id, idx = order.indexOf(id);
      try{ c.setPointerCapture(e.pointerId); }catch(err){}
      drag = { id: id, el: c, pid: e.pointerId, startY: e.clientY, startTop: idx * STEP, idx: idx, from: idx };
      c.classList.add('dragging');
      c.style.transform = 'translateY(' + drag.startTop + 'px) scale(1.03)';
      if(opts.onGrab) opts.onGrab();
    });
    box.addEventListener('pointermove', function(e){
      if(!drag || e.pointerId !== drag.pid) return;
      var maxY = (items.length - 1) * STEP;
      var y = Math.max(0, Math.min(maxY, drag.startTop + (e.clientY - drag.startY)));
      drag.el.style.transform = 'translateY(' + y + 'px) scale(1.03)';
      var target = indexFromY(y, STEP, items.length);
      if(target !== drag.idx){
        order = moveItem(order, drag.idx, target); drag.idx = target;
        layout(drag.id, false);
      }
    });
    function end(e){
      if(!drag || e.pointerId !== drag.pid) return;
      var d = drag; drag = null;
      d.el.classList.remove('dragging');
      d.el.style.transform = 'translateY(' + (d.idx * STEP) + 'px)';
      if(d.idx !== d.from && opts.onDrop) opts.onDrop(d.id, d.idx);
      if(pending){ var p = pending; pending = null; api.update(p); }
    }
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function(ev){ box.addEventListener(ev, end); });
    box.addEventListener('contextmenu', function(e){ e.preventDefault(); });
    var api = {
      isDragging: function(){ return !!drag; },
      getOrder: function(){ return order.slice(); },
      // 外部(ホスト)から届いた並びに合わせる。掴んでいる間は保留して、離したあとに反映する
      update: function(newOrder){
        if(drag){ pending = newOrder.slice(); return; }
        order = newOrder.slice(); layout(null, false);
      }
    };
    return api;
  }

  /* ---------------- QRコード [3] ---------------- */
  function qrHtml(url){
    try{
      if(typeof global.qrcode !== 'function') return null;
      var qr = global.qrcode(0, 'M'); qr.addData(url); qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    }catch(e){ return null; }
  }

  /* ---------------- 本体 ---------------- */
  var COLORS = ['#F17FB1','#4FC3D9','#E8C24A','#8B8FF0','#5FD0A8','#FF8A5B','#C792EA','#9ED36A','#F0A0C0','#6FB1F5'];
  var HUB_ACCENT = '#4FC3D9', HUB_INK = '#06222A', HUB_MAX = 10;

  /* ゲームの登録。各ゲームのJSが register({ id, title, tagline, emoji, accent, accentInk, min, max, rules, game, render }) を呼ぶ。
   *   game  = { newState(players, rnd), act(G, pid, action, rnd), view(G, pid), waiting(G), force(G), sync(G) }  ← 通信や画面に依存しない純粋な処理
   *   render(root, ctx) = 画面の描画 */
  var REGISTRY = {}, ORDER = [];
  function register(def){ REGISTRY[def.id] = def; if(ORDER.indexOf(def.id) < 0) ORDER.push(def.id); }

  function startHub(){
    var app = document.getElementById('app');
    var styleEl = document.createElement('style'); styleEl.textContent = CSS;
    document.head.appendChild(styleEl);
    document.title = 'オンライン ロビー - 飲み会ゲーム集';
    function setAccent(a, ink){
      document.documentElement.style.setProperty('--accent', a || HUB_ACCENT);
      document.documentElement.style.setProperty('--accent-ink', ink || HUB_INK);
    }
    setAccent();
    app.innerHTML =
      '<div class="topbar" id="topbar"><span>ROOM</span><span class="rc" id="tbCode">-</span><span class="grow" id="tbInfo"></span>' +
      '<button id="tbMute" aria-label="音">🔊</button><button id="tbMenu" aria-label="メニュー">⋯</button></div>' +
      '<div class="menu" id="menu"><button id="mForce">待たずに進める(未入力は棄権)</button><button id="mLobby">ロビーに戻る(ゲームを選び直す)</button><button id="mLeave">退出する</button></div>' +
      '<section class="screen active" id="c-entry"></section>' +
      '<section class="screen" id="c-lobby"></section>' +
      '<section class="screen" id="c-rules"></section>' +
      '<section class="screen" id="c-game"><div id="gameRoot"></div></section>' +
      '<section class="screen" id="c-error"></section>';
    var $ = function(id){ return document.getElementById(id); };
    function show(id){
      document.querySelectorAll('#app .screen').forEach(function(s){ s.classList.remove('active'); });
      $(id).classList.add('active');
      $('topbar').classList.toggle('on', id === 'c-lobby' || id === 'c-rules' || id === 'c-game');
    }
    function chipHtml(p, players){
      var info = players.filter(function(x){ return x.id === p; })[0];
      var idx = players.indexOf(info);
      var name = info ? info.name : '?';
      return '<span class="chip' + (info && !info.connected ? ' off' : '') + '" style="background:' + COLORS[(idx < 0 ? 0 : idx) % COLORS.length] + '">' + esc(name) + '</span>';
    }
    function lsGet(k){ try{ return global.localStorage.getItem(k); }catch(e){ return null; } }
    function lsSet(k, v){ try{ global.localStorage.setItem(k, v); }catch(e){} }
    function ssGet(k){ try{ return global.sessionStorage.getItem(k); }catch(e){ return null; } }
    function ssSet(k, v){ try{ global.sessionStorage.setItem(k, v); }catch(e){} }
    function hexA(hex, a){
      var h = hex.replace('#', '');
      return 'rgba(' + parseInt(h.substring(0, 2), 16) + ',' + parseInt(h.substring(2, 4), 16) + ',' + parseInt(h.substring(4, 6), 16) + ',' + a + ')';
    }

    var params = new URLSearchParams(global.location.search);
    var urlRoom = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

    var S = {
      role: null,            // 'host' | 'client'
      code: null, me: null, players: [], mode: 'entry',   // entry | lobby | rules | game
      link: null, waiting: [], lastKey: '', local: {}, tickers: [], gameId: null, lastGame: null,
      H: null,               // ホストだけが持つ
      conn: null, token: null, name: '', retries: 0
    };
    function curDef(){ return REGISTRY[S.gameId] || null; }

    /* ---- 入口画面 ---- */
    function renderEntry(){
      var saved = lsGet('nomikai_name') || '';
      var joinOnly = !!urlRoom;
      var list = ORDER.map(function(id){ var d = REGISTRY[id]; return '<div class="rule-row"><div class="rule-num">' + d.emoji + '</div><div class="rule-text"><b>' + esc(d.title) + '</b>(' + d.min + '〜' + d.max + '人)<br><span style="color:var(--text-muted)">' + esc(d.tagline) + '</span></div></div>'; }).join('');
      $('c-entry').innerHTML =
        '<div class="eyebrow">NOMIKAI GAMES ONLINE</div>' +
        '<h1 class="title">オンライン ロビー<span class="badge-dev">開発中</span></h1>' +
        '<p class="tagline">各自のスマホで遊ぶ。ホストが部屋をつくってQRコードを見せ、みんなが参加してから、ゲームを選ぶ。ゲームは何度でも選び直せる。</p>' +
        '<div class="rule-card">' + list + '</div>' +
        '<div class="section-label">あなたの名前</div>' +
        '<input class="field" id="inName" maxlength="8" placeholder="8文字まで" value="' + esc(saved) + '" autocomplete="off">' +
        (joinOnly
          ? '<div class="sub-text" style="text-align:center">部屋 <b>' + esc(urlRoom) + '</b> に参加します</div>'
          : '<div class="section-label">部屋コードで参加する場合</div><input class="field" id="inCode" maxlength="5" placeholder="例: K7M2P" autocapitalize="characters" autocomplete="off" style="text-transform:uppercase;letter-spacing:.2em">') +
        '<div class="notice">全員のスマホで同じページを開きます。通信は端末同士の直接通信(WebRTC)で、ゲームの状態はホストの端末が管理します。' +
        'ホストの端末には全員分の通信内容が届くため、身内で遊ぶ前提です。</div>' +
        '<div class="spacer"></div>' +
        '<div class="bottombar">' +
        (joinOnly
          ? '<button class="btn-primary" id="btnJoin">参加する</button><button class="btn-ghost" id="btnMake">自分で部屋をつくる</button>'
          : '<button class="btn-primary" id="btnMake">部屋をつくる(ホストになる)</button><button class="btn-ghost" id="btnJoin">コードで参加する</button>') +
        '</div>';
      $('btnMake').onclick = function(){ audio(); startHost(readName()); };
      $('btnJoin').onclick = function(){
        audio();
        var code = joinOnly ? urlRoom : ($('inCode').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if(code.length !== 5){ alert('部屋コードは5文字です'); return; }
        startClient(code, readName());
      };
      show('c-entry');
    }
    function readName(){
      var v = ($('inName').value || '').trim().slice(0, 8);
      if(v) lsSet('nomikai_name', v);
      return v;
    }
    function showError(msg, retryLabel, retryFn){
      $('c-error').innerHTML = '<div class="eyebrow">NOMIKAI GAMES ONLINE</div><h2 class="title" style="font-size:22px">つながりませんでした</h2>' +
        '<div class="errbox">' + msg + '</div><div class="spacer"></div><div class="bottombar">' +
        (retryFn ? '<button class="btn-primary" id="errRetry">' + retryLabel + '</button>' : '') +
        '<button class="btn-ghost" id="errBack">最初に戻る</button></div>';
      if(retryFn) $('errRetry').onclick = retryFn;
      $('errBack').onclick = function(){ cleanup(); renderEntry(); };
      show('c-error');
    }

    /* ---- ホスト ----
     * H.phase: 'lobby'(ゲーム選択前) → 'rules'(ルール確認) → 'play'(ゲーム中)。ロビーに戻れば何度でもゲームを選び直せる。 */
    function uniqueName(name, players){
      var n = 2, cand = name;
      var taken = function(x){ return players.some(function(p){ return p.name === x; }); };
      while(taken(cand)){ cand = name + n; n++; }
      return cand;
    }
    function startHost(name, attempt){
      attempt = attempt || 0;
      var code = makeCode();
      var H = { code: code, players: [], G: null, phase: 'lobby', gameId: null, nextId: 1, tr: null, connToPid: {} };
      H.players.push({ id: 'p0', name: name || 'ホスト', token: null, connId: null, connected: true, host: true });
      S.role = 'host'; S.code = code; S.me = 'p0'; S.H = H;
      var settled = false;
      H.tr = getTransport().host(code, {
        onReady: function(){
          settled = true;
          S.link = global.location.origin + global.location.pathname + '?room=' + code;
          enterLobby();
        },
        onError: function(kind){
          if(!settled && kind === 'collision' && attempt < 5){ try{ H.tr.close(); }catch(e){} startHost(name, attempt + 1); return; }
          if(!settled){
            showError('部屋をつくれませんでした(' + esc(kind) + ')。ネットワークを確認してもう一度試してください。', 'もう一度', function(){ startHost(name); });
          }
        },
        onConnect: function(){ },
        onMessage: function(connId, msg){ hostOnMessage(connId, msg); },
        onClose: function(connId){ hostOnClose(connId); }
      });
    }
    function hostPublicPlayers(){
      return S.H.players.map(function(p){ return { id: p.id, name: p.name, connected: p.connected, host: !!p.host }; });
    }
    function hostSend(pid, msg){
      var p = S.H.players.filter(function(x){ return x.id === pid; })[0];
      if(!p) return;
      if(p.host){ localReceive(msg); }
      else if(p.connId){ S.H.tr.send(p.connId, msg); }
    }
    function hostOfflineMap(){
      var m = {}; S.H.players.forEach(function(p){ if(!p.connected) m[p.id] = true; }); return m;
    }
    function hostBroadcast(){
      var H = S.H, players = hostPublicPlayers();
      var gd = H.gameId ? REGISTRY[H.gameId] : null;
      if(H.phase === 'lobby'){
        H.players.forEach(function(p){ hostSend(p.id, { t: 'lobby', code: H.code, players: players, me: p.id, last: S.lastGame }); });
      } else if(H.phase === 'rules'){
        H.players.forEach(function(p){ hostSend(p.id, { t: 'rules', game: H.gameId, players: players, me: p.id }); });
      } else {
        H.G.offline = hostOfflineMap();
        var waiting = gd.game.waiting ? gd.game.waiting(H.G) : [];
        H.players.forEach(function(p){
          hostSend(p.id, { t: 'view', game: H.gameId, view: gd.game.view(H.G, p.id), players: players, waiting: waiting, me: p.id });
        });
      }
    }
    function hostOnMessage(connId, msg){
      var H = S.H;
      if(!msg || typeof msg !== 'object') return;
      if(msg.t === 'hello'){
        var token = String(msg.token || '').slice(0, 32);
        var existing = H.players.filter(function(p){ return !p.host && token && p.token === token; })[0];
        if(existing){
          existing.connId = connId; existing.connected = true; H.connToPid[connId] = existing.id;
          if(H.phase === 'play' && H.G){ var gd0 = REGISTRY[H.gameId]; H.G.offline = hostOfflineMap(); if(gd0.game.sync) gd0.game.sync(H.G); }
        } else {
          if(H.phase === 'play'){ H.tr.send(connId, { t: 'reject', reason: 'ゲーム中のため参加できません。ホストがロビーに戻るまで待ってください。' }); return; }
          if(H.players.length >= HUB_MAX){ H.tr.send(connId, { t: 'reject', reason: '満員です(最大' + HUB_MAX + '人)。' }); return; }
          var name = String(msg.name || '').trim().slice(0, 8) || ('ゲスト' + H.nextId);
          var pid = 'p' + (H.nextId++);
          H.players.push({ id: pid, name: uniqueName(name, H.players), token: token, connId: connId, connected: true, host: false });
          H.connToPid[connId] = pid;
        }
        hostBroadcast(); refreshHostUi();
        return;
      }
      var pid2 = H.connToPid[connId];
      if(!pid2) return;
      if(msg.t === 'act' && H.phase === 'play' && H.G) hostAct(pid2, msg.a);
    }
    function hostAct(pid, action){
      var H = S.H;
      if(H.phase !== 'play' || !H.G) return;
      var gd = REGISTRY[H.gameId];
      H.G.offline = hostOfflineMap();
      var res;
      try{ res = gd.game.act(H.G, pid, action, randInt); }catch(e){ res = { error: '内部エラー' }; }
      if(res && res.error){ hostSend(pid, { t: 'err', msg: res.error }); return; }
      hostBroadcast();
    }
    function hostOnClose(connId){
      var H = S.H; if(!H) return;
      var pid = H.connToPid[connId]; if(!pid) return;
      var p = H.players.filter(function(x){ return x.id === pid; })[0];
      if(!p || p.connId !== connId) return;       // 再接続済みの古い接続の close は無視
      p.connected = false;
      if(H.phase !== 'play'){
        H.players = H.players.filter(function(x){ return x.id !== pid; });   // ロビー/ルール確認中に抜けたら名簿から外す
      } else if(H.G){
        var gd = REGISTRY[H.gameId];
        H.G.offline = hostOfflineMap(); if(gd.game.sync) gd.game.sync(H.G);
      }
      hostBroadcast(); refreshHostUi();
    }
    function hostSelectGame(id){
      var H = S.H, d = REGISTRY[id];
      if(!d || H.phase !== 'lobby') return;
      var n = H.players.filter(function(p){ return p.connected; }).length;
      if(n < d.min || n > d.max) return;
      H.gameId = id; H.phase = 'rules';
      hostBroadcast();
    }
    function hostStartGame(){
      var H = S.H, d = REGISTRY[H.gameId];
      if(H.phase !== 'rules' || !d) return;
      var act = H.players.filter(function(p){ return p.connected; });
      if(act.length < d.min || act.length > d.max) return;
      H.phase = 'play';
      H.G = d.game.newState(act.map(function(p){ return { id: p.id, name: p.name }; }), randInt);
      H.G.offline = hostOfflineMap();
      S.lastKey = ''; S.local = {};
      hostBroadcast();
    }
    function hostBackToLobby(){
      var H = S.H;
      if(H.gameId) S.lastGame = REGISTRY[H.gameId].title;
      H.phase = 'lobby'; H.G = null; H.gameId = null;
      H.players = H.players.filter(function(p){ return p.connected; });
      S.lastKey = ''; S.local = {};
      hostBroadcast();
    }
    function hostForce(){
      var H = S.H; if(H.phase !== 'play' || !H.G) return;
      var gd = REGISTRY[H.gameId]; if(!gd.game.force) return;
      H.G.offline = hostOfflineMap();
      gd.game.force(H.G); hostBroadcast();
    }
    function refreshHostUi(){ if(S.mode === 'lobby') renderLobby(); }

    /* ---- クライアント ---- */
    function startClient(code, name){
      S.role = 'client'; S.code = code; S.name = name; S.retries = 0;
      S.token = ssGet('nomikai_token_' + code);
      if(!S.token){ S.token = makeToken(); ssSet('nomikai_token_' + code, S.token); }
      connectClient();
    }
    function connectClient(){
      var settled = false;
      var timer = setTimeout(function(){
        if(!settled){
          settled = true; try{ S.conn.close(); }catch(e){}
          showError('部屋が見つからないか、接続できませんでした。部屋コード(' + esc(S.code) + ')を確認してください。' +
            '会場のWi-Fiや回線の種類によっては、端末同士がつながらないことがあります。', 'もう一度つなぐ', function(){ connectClient(); });
        }
      }, 15000);
      S.conn = getTransport().client(S.code, {
        onOpen: function(){
          settled = true; clearTimeout(timer); S.retries = 0;
          S.conn.send({ t: 'hello', name: S.name, token: S.token });
        },
        onMessage: function(msg){ clientOnMessage(msg); },
        onClose: function(){
          if(S.role !== 'client') return;
          if(S.retries < 3){      // 切れたら数回、自動で再接続する
            S.retries++;
            setTimeout(function(){ if(S.role === 'client'){ try{ S.conn.close(); }catch(e){} connectClient(); } }, 1500);
          } else {
            showError('ホストとの接続が切れました。', '再接続する', function(){ S.retries = 0; connectClient(); });
          }
        },
        onError: function(kind){
          if(settled) return;
          settled = true; clearTimeout(timer);
          showError(kind === 'noroom'
            ? '部屋 ' + esc(S.code) + ' が見つかりません。コードを確認するか、ホストの画面を確認してください。'
            : '接続エラーです(' + esc(kind) + ')。もう一度試してください。', 'もう一度つなぐ', function(){ connectClient(); });
        }
      });
    }
    function clientOnMessage(msg){
      if(!msg || typeof msg !== 'object') return;
      if(msg.t === 'reject'){ cleanup(); showError(esc(msg.reason || '参加できませんでした。'), null, null); return; }
      localReceive(msg);
    }

    /* ---- 共通の受信(ホスト自身の表示にも使う) ---- */
    function localReceive(msg){
      if(msg.t === 'lobby'){
        S.players = msg.players; S.me = msg.me; S.code = msg.code; S.waiting = []; S.gameId = null;
        if(msg.last !== undefined && S.role !== 'host') S.lastGame = msg.last;
        if(!S.link) S.link = global.location.origin + global.location.pathname + '?room=' + msg.code;
        S.lastKey = ''; S.local = {}; clearTickers(); setAccent();
        enterLobby();
      } else if(msg.t === 'rules'){
        S.players = msg.players; S.me = msg.me; S.gameId = msg.game; S.waiting = [];
        S.lastKey = ''; S.local = {}; clearTickers();
        enterRules();
      } else if(msg.t === 'view'){
        S.players = msg.players; S.me = msg.me; S.waiting = msg.waiting || [];
        if(S.gameId !== msg.game || S.mode !== 'game'){
          S.gameId = msg.game; S.mode = 'game'; S.lastKey = ''; S.local = {};
          var d = curDef(); setAccent(d.accent, d.accentInk); show('c-game');
        }
        renderGame(msg.view);
        updateTopbar();
      } else if(msg.t === 'err'){
        toast(msg.msg);
      }
    }
    function toast(text){
      var t = document.createElement('div');
      t.textContent = text;
      t.style.cssText = 'position:absolute;left:50%;bottom:90px;transform:translateX(-50%);background:var(--bg-raised);border:1px solid var(--line);padding:10px 16px;border-radius:12px;font-size:13px;font-weight:700;z-index:30;max-width:90%;text-align:center;';
      app.appendChild(t); setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); }, 2600);
    }

    /* ---- ロビー(QR参加 → ゲーム選択) ---- */
    function enterLobby(){
      S.mode = 'lobby';
      if(S.role === 'host'){ S.players = hostPublicPlayers(); }
      renderLobby(); updateTopbar(); show('c-lobby');
    }
    function renderLobby(){
      var players = S.role === 'host' ? hostPublicPlayers() : S.players;
      S.players = players;
      var online = players.filter(function(p){ return p.connected; }).length;
      var qr = qrHtml(S.link);
      var plist = players.map(function(p){ return chipHtml(p.id, players) + ''; }).join('');
      var isHost = S.role === 'host';
      var cards = ORDER.map(function(id){
        var d = REGISTRY[id];
        var ok = online >= d.min && online <= d.max;
        var why = online < d.min ? 'あと' + (d.min - online) + '人必要' : (online > d.max ? d.max + '人まで' : '');
        return '<button class="gcard" data-g="' + id + '"' + ((isHost && ok) ? '' : ' disabled') + ' style="--gc:' + d.accent + '">' +
          '<span class="gi" style="background:' + hexA(d.accent, 0.16) + ';color:' + d.accent + '">' + d.emoji + '</span>' +
          '<span class="gt"><b>' + esc(d.title) + '</b><span class="gs">' + esc(d.tagline) + '</span>' +
          '<span class="gp">' + d.min + '〜' + d.max + '人' + (why ? ' / ' + why : '') + '</span></span>' +
          (isHost && ok ? '<span class="gc">›</span>' : '') + '</button>';
      }).join('');
      $('c-lobby').innerHTML =
        '<div class="eyebrow">ロビー</div><h2 class="title" style="font-size:22px">オンライン ロビー<span class="badge-dev">開発中</span></h2>' +
        '<div class="sub-text" style="margin-top:6px">QRコードを読み取る/部屋コードを入力して参加。全員そろったらホストがゲームを選ぶ。</div>' +
        '<div class="qr" id="qrBox">' + (qr || '<span style="color:#333;font-size:12px;text-align:center;padding:10px">QRを表示できませんでした。下のコードかリンクを共有してください。</span>') + '</div>' +
        '<div class="code" id="roomCode">' + esc(S.code) + '</div>' +
        '<div class="link" id="roomLink">' + esc(S.link || '') + '</div>' +
        '<button class="btn-ghost" id="copyLink" style="margin-top:12px">リンクをコピー</button>' +
        '<div class="section-label">参加者(' + players.length + '/' + HUB_MAX + '人)</div><div class="plist" id="plist">' + plist + '</div>' +
        '<div class="section-label">' + (isHost ? 'ゲームを選ぶ' : 'ゲーム一覧(ホストが選びます)') + '</div>' +
        '<div class="glist" id="glist">' + cards + '</div>' +
        (S.lastGame ? '<div class="sub-text" style="text-align:center">さっき遊んだゲーム: ' + esc(S.lastGame) + '</div>' : '') +
        '<div style="height:18px"></div>';
      $('copyLink').onclick = function(){
        try{ global.navigator.clipboard.writeText(S.link); toast('リンクをコピーしました'); }catch(e){ toast('コピーできませんでした。リンクを長押しでコピーしてください'); }
      };
      if(isHost){
        $('c-lobby').querySelectorAll('.gcard').forEach(function(b){ b.onclick = function(){ hostSelectGame(b.dataset.g); }; });
      }
    }

    /* ---- ルール確認 ---- */
    function enterRules(){
      S.mode = 'rules';
      var d = curDef(); setAccent(d.accent, d.accentInk);
      var rules = (d.rules || []).map(function(r, i){
        return '<div class="rule-row"><div class="rule-num">' + (i + 1) + '</div><div class="rule-text">' + r + '</div></div>';
      }).join('');
      var online = S.players.filter(function(p){ return p.connected; });
      $('c-rules').innerHTML =
        '<div class="eyebrow">ルール確認</div><h2 class="title">' + esc(d.title) + '</h2>' +
        '<p class="tagline">' + esc(d.tagline) + '</p><div class="rule-card">' + rules + '</div>' +
        '<div class="section-label">参加者</div><div class="plist">' + online.map(function(p){ return chipHtml(p.id, S.players); }).join('') + '</div>' +
        '<div class="spacer"></div><div class="bottombar">' +
        (S.role === 'host'
          ? '<button class="btn-primary" id="rStart">このメンバーで始める</button><button class="btn-ghost" id="rBack">ロビーに戻る(ゲームを選び直す)</button>'
          : '<div class="sub-text" style="text-align:center">ホストが始めるのを待っています…</div>') + '</div>';
      if(S.role === 'host'){
        $('rStart').onclick = function(){ hostStartGame(); };
        $('rBack').onclick = function(){ hostBackToLobby(); };
      }
      updateTopbar(); show('c-rules');
    }

    /* ---- トップバー ---- */
    function updateTopbar(){
      $('tbCode').textContent = S.code || '-';
      var on = S.players.filter(function(p){ return p.connected; }).length;
      $('tbInfo').textContent = on + '/' + S.players.length + '人 接続中';
      $('mForce').style.display = (S.role === 'host' && S.mode === 'game') ? 'block' : 'none';
      $('mLobby').style.display = (S.role === 'host' && S.mode !== 'lobby') ? 'block' : 'none';
    }
    $('tbMute').onclick = function(){ muted = !muted; $('tbMute').textContent = muted ? '🔇' : '🔊'; };
    $('tbMenu').onclick = function(e){ e.stopPropagation(); $('menu').classList.toggle('on'); };
    document.addEventListener('click', function(){ $('menu').classList.remove('on'); });
    $('mForce').onclick = function(){ hostForce(); };
    $('mLobby').onclick = function(){
      if(S.mode === 'game' && !global.confirm('ロビーに戻りますか?(いまのゲームは終了します)')) return;
      hostBackToLobby();
    };
    $('mLeave').onclick = function(){ if(global.confirm('退出しますか?')){ cleanup(); global.location.href = global.location.pathname; } };

    /* ---- ゲーム画面 ---- */
    function clearTickers(){ S.tickers.forEach(clearInterval); S.tickers = []; }
    function send(action){
      if(S.role === 'host') hostAct('p0', action);
      else if(S.conn) S.conn.send({ t: 'act', a: action });
    }
    function renderGame(view){
      var d = curDef(); if(!d) return;
      var key = JSON.stringify([S.gameId, view, S.players, S.waiting]);
      if(key === S.lastKey) return;
      S.lastKey = key;
      var root = $('gameRoot');
      // 入力中の欄(フォーカス・文字・カーソル位置)を、再描画しても保つ
      var ae = document.activeElement, keep = null;
      if(ae && ae.id && root.contains(ae) && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')){
        keep = { id: ae.id, value: ae.value, s: ae.selectionStart, e: ae.selectionEnd };
      }
      clearTickers();
      var ctx = {
        view: view, me: S.me, players: S.players, isHost: S.role === 'host', waiting: S.waiting, local: S.local,
        send: send, esc: esc, chip: function(pid){ return chipHtml(pid, S.players); },
        nameOf: function(pid){ var p = S.players.filter(function(x){ return x.id === pid; })[0]; return p ? p.name : '?'; },
        every: function(fn, ms){ var id = setInterval(fn, ms); S.tickers.push(id); fn(); return id; },
        tone: tone, toast: toast, sortList: sortList, root: root,
        waitHtml: function(){
          if(!S.waiting.length) return '<div class="waitbar"></div>';
          var names = S.waiting.map(function(pid){ return ctx.nameOf(pid); }).join('・');
          return '<div class="waitbar">待っている人: ' + esc(names) + '</div>';
        }
      };
      d.render(root, ctx);
      if(keep){
        var el = document.getElementById(keep.id);
        if(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')){
          if(el.value !== keep.value && !el.dataset.noRestore) el.value = keep.value;
          el.focus(); try{ el.setSelectionRange(keep.s, keep.e); }catch(e){}
        }
      }
    }

    function cleanup(){
      clearTickers();
      if(S.role === 'host' && S.H && S.H.tr){ try{ S.H.tr.close(); }catch(e){} }
      if(S.role === 'client' && S.conn){ var c = S.conn; S.role = null; try{ c.close(); }catch(e){} }
      S.role = null; S.H = null; S.conn = null; S.mode = 'entry'; S.lastKey = ''; S.local = {}; S.players = []; S.gameId = null;
      setAccent();
    }

    global.NOMIKAI_DEBUG = { state: S };   // テスト用に状態を覗けるようにしてあるだけ(書き換えには使わない)
    renderEntry();
  }

  global.NomikaiOnline = {
    register: register, startHub: startHub, randInt: randInt, shuffle: shuffle, esc: esc, moveItem: moveItem, indexFromY: indexFromY,
    makeCode: makeCode, COLORS: COLORS
  };
})(typeof window !== 'undefined' ? window : globalThis);
