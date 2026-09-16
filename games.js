// 飲み会ゲーム集 - ゲーム一覧の設定ファイル
//
// 新しいゲームを追加する手順:
// 1. games/ フォルダに新しいゲームの html ファイルを追加する
// 2. 下の配列に、そのゲームの情報を1オブジェクト追加する
// 3. git add / git commit / git push すれば GitHub Pages に自動反映される
//
// 各項目の意味:
//   id       : 半角英数字のユニークなID(他のゲームと重複しないこと)
//   title    : ゲーム選択画面に表示されるタイトル
//   tagline  : ゲームの一言説明
//   emoji    : カードに表示するアイコン代わりの絵文字
//   accent   : カードのテーマカラー(そのゲーム自身のHTML内の --accent と合わせると統一感が出る)
//   file     : games/ からの相対パス

window.GAMES = [
  {
    id: 'five-game',
    title: 'ファイブゲーム',
    tagline: '5つのルールを同時に守れ。1つでも破ったらアウト。',
    emoji: '✋',
    accent: '#E8C24A',
    file: 'games/five-game.html'
  },
  {
    id: 'ecohiiki-roulette',
    title: 'えこひいきルーレット',
    tagline: '誰か1人だけ当たる確率アップ、誰か1人だけ当たったら2杯。',
    emoji: '🎯',
    accent: '#FF6B5B',
    file: 'games/ecohiiki-roulette.html'
  },
  {
    id: 'bomb-tap',
    title: '爆弾タップゲーム',
    tagline: '爆発までのタップ回数はランダム。持っていたら負け。',
    emoji: '💣',
    accent: '#FF5A45',
    file: 'games/bomb-tap.html'
  }

  // 新しいゲームはこの下に追加していく
  // {
  //   id: 'new-game',
  //   title: '新しいゲーム名',
  //   tagline: '一言説明',
  //   emoji: '🎲',
  //   accent: '#XXXXXX',
  //   file: 'games/new-game.html'
  // }
];
