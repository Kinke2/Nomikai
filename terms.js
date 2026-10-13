/* Nomikai Games - 利用規約への初回同意画面
 * 初めてアクセスしたとき(同意が保存されていないとき)だけ表示する。
 * 利用規約の本文は TERMS.txt(このファイルと同じフォルダ)。
 * 同意状況は localStorage に保存。保存できない環境ではページを開くたびに表示する(同意を省略しない)。 */
(function () {
  var KEY = 'nomikai_terms_agreed_v1';
  var base = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/[^\/]*$/, '') : '';
  })();
  var TERMS_URL = base + 'TERMS.txt';
  function agreed() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function save() { try { localStorage.setItem(KEY, '1'); } catch (e) {} }
  if (agreed()) return;

  var css = document.createElement('style');
  css.textContent =
    '#nmkTerms{position:fixed;inset:0;z-index:2147483000;background:rgba(10,12,20,.94);display:flex;align-items:center;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif;color:#f2f2f7}' +
    '#nmkTerms .b{background:#1c1c2a;border:1px solid #3a3a55;border-radius:16px;max-width:460px;width:100%;max-height:92vh;overflow:auto;padding:20px;box-sizing:border-box}' +
    '#nmkTerms h2{margin:0 0 10px;font-size:19px}' +
    '#nmkTerms .key{background:#3a1d24;border:1px solid #c0485f;border-radius:10px;padding:12px;font-size:16px;font-weight:700;line-height:1.6;margin:10px 0}' +
    '#nmkTerms p{font-size:13.5px;line-height:1.7;margin:8px 0;color:#d0d0dc}' +
    '#nmkTerms pre{white-space:pre-wrap;word-break:break-word;font:12px/1.7 inherit;font-family:inherit;background:#12121c;border:1px solid #333350;border-radius:10px;padding:12px;max-height:42vh;overflow:auto;margin:8px 0}' +
    '#nmkTerms button,#nmkTerms a.btn{display:block;width:100%;box-sizing:border-box;text-align:center;border:0;border-radius:12px;padding:13px;font-size:15px;font-weight:700;margin-top:10px;cursor:pointer;text-decoration:none;font-family:inherit}' +
    '#nmkTerms .ok{background:#ff7a2f;color:#fff}' +
    '#nmkTerms .sub{background:#2a2a40;color:#f2f2f7}' +
    '#nmkTerms .no{background:transparent;color:#9a9ab0;font-weight:500;font-size:13px}' +
    '#nmkTerms label{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.5;margin-top:12px}' +
    '#nmkTerms input[type=checkbox]{width:20px;height:20px;flex:0 0 auto;margin:1px 0 0}' +
    '#nmkTerms .ok[disabled]{opacity:.4;cursor:not-allowed}';
  document.head.appendChild(css);

  var box = document.createElement('div');
  box.id = 'nmkTerms';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.innerHTML =
    '<div class="b">' +
    '<h2>🍻 ご利用前にお読みください</h2>' +
    '<div class="key">いかなる責任もプレイヤー自身に帰属します。<br>' +
    '<span style="font-weight:500;font-size:14px">人・お店・スマホなど、このゲームによって生じた損害について、製作者は一切責任を負いません。</span></div>' +
    '<p style="font-weight:700;color:#ffd9a8;font-size:14.5px">🍺 お酒は楽しく飲むものです。強要や無理な飲酒はやめましょう。</p>' +
    '<p>ゲームの結果に従う義務はありません。ノンアルコールへの読み替えもOKです。</p>' +
    '<div id="nmkBody"></div>' +
    '<button class="sub" id="nmkRead">📄 利用規約を読む</button>' +
    '<label><input type="checkbox" id="nmkChk"><span>利用規約を理解し、すべての責任を自分自身が負うことに同意します</span></label>' +
    '<button class="ok" id="nmkOk" disabled>同意して始める</button>' +
    '<button class="no" id="nmkNo">同意しない</button>' +
    '</div>';

  function mount() {
    document.body.appendChild(box);
    var body = box.querySelector('#nmkBody'), read = box.querySelector('#nmkRead');
    var chk = box.querySelector('#nmkChk'), ok = box.querySelector('#nmkOk');
    function fallback() {
      body.innerHTML = '<p>規約を表示できませんでした。下のリンクから開いてください。</p>' +
        '<a class="btn sub" target="_blank" rel="noopener" href="' + TERMS_URL + '">TERMS.txt を開く</a>';
    }
    read.onclick = function () {
      if (body.firstChild) { body.innerHTML = ''; read.textContent = '📄 利用規約を読む'; return; }
      read.textContent = '📄 利用規約を閉じる';
      body.innerHTML = '<p>読み込み中…</p>';
      fetch(TERMS_URL, { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.text();
      }).then(function (t) {
        var pre = document.createElement('pre'); pre.textContent = t;
        body.innerHTML = ''; body.appendChild(pre);
        var a = document.createElement('a');
        a.className = 'btn sub'; a.target = '_blank'; a.rel = 'noopener'; a.href = TERMS_URL;
        a.textContent = 'TERMS.txt を別タブで開く'; body.appendChild(a);
      }).catch(fallback);
    };
    chk.onchange = function () { ok.disabled = !chk.checked; };
    ok.onclick = function () { if (!chk.checked) return; save(); box.remove(); };
    box.querySelector('#nmkNo').onclick = function () {
      body.innerHTML = '<p style="color:#ff9aa8;font-weight:700">同意いただけない場合は、本サービスをご利用いただけません。このページを閉じてください。</p>';
    };
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
