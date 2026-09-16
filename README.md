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
