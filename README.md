# 飲み会ゲーム集

飲み会で使うミニゲーム集。GitHub Pages でそのままホストできます。

## 公開URL

```
https://kinke2.github.io/Nomikai/
```

## フォルダ構成

```
.
├── index.html      ← ゲーム選択画面(トップページ)
├── games.js        ← ゲーム一覧の設定ファイル(ここに追記すると選択画面に増える)
├── README.md
└── games/
    ├── five-game.html
    └── ecohiiki-roulette.html
```

- `index.html` は `games.js` を読み込んで、ゲームカードを自動で並べているだけなので、
  自体は基本的に編集不要です。
- ゲーム本体は `games/` の中に、1ゲーム=1ファイルで置いてあります。

## 新しいゲームを追加する方法

1. `games/` フォルダに新しいゲームの html ファイルを追加する
   (例: `games/janken-roulette.html`)
2. `games.js` の配列の最後に、そのゲームの情報を追記する

   ```js
   {
     id: 'janken-roulette',
     title: 'じゃんけんルーレット',
     tagline: '一言説明をここに',
     emoji: '✊',
     accent: '#XXXXXX',
     file: 'games/janken-roulette.html'
   }
   ```

3. 保存して Git に反映する

   ```bash
   git add .
   git commit -m "add じゃんけんルーレット"
   git push
   ```

4. 数分待てば GitHub Pages に自動で反映され、トップページのゲーム一覧に
   新しいゲームが増えています。

## GitHub Pages の設定(初回のみ)

リポジトリの `Settings → Pages` で

- Source: `Deploy from a branch`
- Branch: `main` / `(root)`

になっていればOKです。ルートの `index.html` が自動でトップページとして表示されます。

## ローカルで確認したいとき

このフォルダをそのままブラウザで開いても動きます(`index.html` をダブルクリック)。
`games.js` は `<script src="games.js">` で読み込んでいるだけなので、
ローカルのファイルを直接開いた場合でも問題なく動作します。

## オンライン版(開発中)

`online/` 以下は、各自のスマホで遊ぶオンライン版(開発中)です。安定版(`games/`)とは完全に別で、安定版のファイルは変更していません。
メニュー(index.html)の下段に「オンライン版(開発中)」として並びます(`games.js` の `window.ONLINE_GAMES`)。

- 遊び方: ホストが部屋をつくるとQRコードと部屋コードが出る → 参加者がQRを読み取る(またはコードを入力) → ホストが開始。
- 通信: WebRTC(PeerJS)。ホスト端末がゲームの状態を持ち、各端末にはその人に見せてよい情報だけを送る。
- 必要なもの: 外部スクリプトを2つ読み込む(PeerJS: unpkg、QR生成: jsDelivr)。インターネット接続が必要。
- 注意: 会場の回線によっては端末同士がつながらないことがある。ホストの画面には全員分の通信が処理されるので身内用の想定。
- ゲーム: `wolf.html`(ワードウルフ) / `lupi.html`(最小ユニーク) / `shimei.html`(秘密指名ゲーム) / `kankaku.html`(感覚ならべ オンライン版)
- 共通部分: `online-core.js`(部屋・通信・QR・並べ替えUI)。新しいオンラインゲームは `NomikaiOnline.start({...})` に
  `game`(newState/act/view/waiting/force)と `render` を渡すだけで作れる。
