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
//
// ※ メニューには、この配列の並び順どおりに表示される。

window.GAMES = [
  {
    id: 'ecohiiki-roulette',
    title: 'えこひいきルーレット',
    tagline: '誰か1人だけ当たる確率アップ、誰か1人だけ当たったら2杯。',
    emoji: '🎯',
    accent: '#FF6B5B',
    file: 'games/ecohiiki-roulette.html'
  },
  {
    id: 'chinchiro',
    title: 'チンチロ',
    tagline: 'サイコロをお椀に投げ入れて出目を決める。',
    emoji: '🎲',
    accent: '#E8C24A',
    file: 'games/chinchiro.html'
  },
  {
    id: 'mine-babanuki',
    title: 'マインスイーパ',
    tagline: 'マスを順にめくる。地雷はたった1つ。引いたら、暗転。',
    emoji: '🚩',
    accent: '#5FD0A8',
    file: 'games/mine-babanuki.html'
  },
  {
    id: 'last-tap',
    title: '秒数ぴった',
    tagline: '指を置いて、目標の秒数で離せ。いちばんズレた人が飲む。',
    emoji: '⏱️',
    accent: '#8B8FF0',
    file: 'games/last-tap.html'
  },
  {
    id: 'five-game',
    title: 'ファイブゲーム',
    tagline: '5つのルールを同時に守れ。1つでも破ったらアウト。',
    emoji: '✋',
    accent: '#E8C24A',
    file: 'games/five-game.html'
  },
  {
    id: 'high-low',
    title: 'ハイ&ロー',
    tagline: '次のカードは今より強い?弱い?トランプ1デッキで対戦。',
    emoji: '🃏',
    accent: '#C8283C',
    file: 'games/high-low.html'
  },
  {
    id: 'bomb-tap',
    title: '爆弾タップゲーム',
    tagline: '爆発までのタップ回数はランダム。持っていたら負け。',
    emoji: '💣',
    accent: '#FF5A45',
    file: 'games/bomb-tap.html'
  },
  {
    id: 'horse-race',
    title: '競馬',
    tagline: '頭数を決めてスタート。ビリになった馬の番号を発表。',
    emoji: '🐎',
    accent: '#5BAE6B',
    file: 'games/horse-race.html'
  },
  {
    id: 'nanja-monja',
    title: 'なんじゃもんじゃ',
    tagline: '得体の知れない生物に名付けて、再登場したら早い者勝ち。',
    emoji: '👾',
    accent: '#C792EA',
    file: 'games/nanja-monja.html'
  },
  {
    id: 'kankaku-narabe',
    title: '感覚ならべ',
    tagline: 'お題に合う言葉だけで数字を伝えて、小さい順に並ぶ。いちばんズレた人が飲む。',
    emoji: '📏',
    accent: '#F17FB1',
    file: 'games/kankaku-narabe.html'
  },
  {
    id: 'itsuwari-tasuuketsu',
    title: '偽りの多数決',
    tagline: 'GO!!の合図で指の本数を出す。「みんなが選びそうな答え」から外れた人が飲む。',
    emoji: '🗳️',
    accent: '#4FC3D9',
    file: 'games/itsuwari-tasuuketsu.html'
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

// ------------------------------------------------------------
// オンライン版(開発中)。各自のスマホで遊ぶ。上の安定版(window.GAMES)とは別枠で、メニューの下段に表示される。
// ------------------------------------------------------------
window.ONLINE_GAMES = [
  {
    id: 'online-lobby',
    title: 'オンライン ロビー',
    tagline: 'QRで1度参加すれば、ワードウルフ・最小ユニーク・秘密指名ゲーム・感覚ならべ・我慢くらべ入札・ワンナイト人狼を選んで遊べる。',
    emoji: '📱',
    accent: '#4FC3D9',
    file: 'online/index.html'
  }
];
