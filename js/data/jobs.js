// ジョブ定義テーブル
//
// 固有名詞（ジョブ名・アビリティ名）を差し替える場合は、このファイルだけを
// 書き換えれば済むようにしてある。ロジック側は id しか参照しない。

// グレード係数。レベルごとの伸びに掛かる。
// 当初の半分（A+ = 1.00）では味方の伸びが物足りなかったため2倍にしてある。
export const GRADE = {
  'A+': 2.00,
  'A': 1.80,
  'B': 1.60,
  'C': 1.40,
  'D': 1.20,
  'E': 1.00,
  'F': 0.80,
};

export const LEVEL_CAP = 75;

// 固有アビリティのリキャスト基本値（秒）。ジョブごとに個別上書きする。
export const BASE_RECAST = 120;

export const JOBS = {
  war: {
    id: 'war',
    name: '戦士',
    short: '戦士',
    icon: '⚔️',
    color: '#d2603f',
    grades: { hp: 'A', mp: 'F', str: 'A', dex: 'B', vit: 'A', agi: 'C', int: 'E', mnd: 'D', chr: 'C' },
    weaponType: 'axe',
    armorRank: 'heavy',
    speed: 1.00,          // 1秒あたりの行動回数（基準値）
    hateRate: 1.5,        // ヘイト倍率（狙われやすさ）。盾役として前に立たせる
    autoAction: 'physical',
    ability: {
      id: 'mighty_strike',
      name: 'マイティストライク',
      short: 'マイティ',
      recast: 180,
      duration: 20,
      desc: '20秒間 自分の攻撃ダメージ2倍',
    },
    passive: {
      id: 'double_attack',
      name: 'ダブルアタック',
      desc: '通常攻撃時に一定確率で2回攻撃',
    },
  },

  mnk: {
    id: 'mnk',
    name: 'モンク',
    short: 'モンク',
    icon: '👊',
    color: '#c9973a',
    grades: { hp: 'A+', mp: 'F', str: 'A', dex: 'B', vit: 'A+', agi: 'B', int: 'F', mnd: 'C', chr: 'C' },
    weaponType: 'h2h',
    armorRank: 'medium',
    speed: 1.30,
    hateRate: 1.0,        // ヘイト倍率（狙われやすさ）
    autoAction: 'physical',
    ability: {
      id: 'hundred_fists',
      name: '百烈拳',
      short: '百烈拳',
      recast: 300,
      duration: 20,
      desc: '20秒間 攻撃間隔が1/3',
    },
    passive: {
      id: 'counter',
      name: 'カウンター',
      desc: '被弾時に一定確率で反撃',
    },
  },

  whm: {
    id: 'whm',
    name: '白魔道士',
    short: '白魔',
    icon: '✨',
    color: '#d8d2c0',
    grades: { hp: 'D', mp: 'A', str: 'D', dex: 'D', vit: 'C', agi: 'D', int: 'C', mnd: 'A+', chr: 'B' },
    weaponType: 'pole',
    armorRank: 'light',
    speed: 0.90,
    hateRate: 1.0,        // ヘイト倍率（狙われやすさ）
    autoAction: 'heal',   // HP70%未満の味方がいればケアル、いなければ物理
    ability: {
      id: 'benediction',
      name: '女神の祝福',
      short: '祝福',
      recast: 300,
      duration: 0,
      desc: '味方全員のHPとMPを全回復',
    },
    passive: {
      id: 'goddess_robe',
      name: '女神の羽衣',
      desc: '自分が受ける全体攻撃のダメージをカット',
    },
  },

  blm: {
    id: 'blm',
    name: '黒魔道士',
    short: '黒魔',
    icon: '🔮',
    color: '#8a6fd0',
    grades: { hp: 'E', mp: 'A+', str: 'E', dex: 'D', vit: 'D', agi: 'D', int: 'A+', mnd: 'C', chr: 'D' },
    weaponType: 'rod',
    armorRank: 'light',
    speed: 0.80,
    hateRate: 1.0,        // ヘイト倍率（狙われやすさ）
    autoAction: 'magic',  // ファイア。MPが尽きたら杖で殴る
    ability: {
      id: 'manafont',
      name: '魔力の泉',
      short: '魔力の泉',
      recast: 180,
      duration: 0,
      desc: '敵全体に通常魔法の20倍のダメージ',
    },
    passive: {
      id: 'clear_mind',
      name: 'クリアマインド',
      desc: 'MPの自然回復が増える',
    },
  },

  rdm: {
    id: 'rdm',
    name: '赤魔道士',
    short: '赤魔',
    icon: '🗡',
    color: '#c0506a',
    grades: { hp: 'C', mp: 'B', str: 'C', dex: 'B', vit: 'C', agi: 'B', int: 'B', mnd: 'B', chr: 'B' },
    weaponType: 'sword',
    armorRank: 'medium',
    speed: 1.10,
    hateRate: 1.0,        // ヘイト倍率（狙われやすさ）
    autoAction: 'physical',
    ability: {
      id: 'chainspell',
      name: '連続魔',
      short: '連続魔',
      recast: 120,
      duration: 30,
      desc: '敵全体を30秒間 防御-30% / 行動速度-30%',
    },
    passive: {
      id: 'dual_wield',
      name: '二刀流',
      desc: '自分の攻撃間隔が短くなる',
    },
  },

  thf: {
    id: 'thf',
    name: 'シーフ',
    short: 'シーフ',
    icon: '🏹',
    color: '#5aa46a',
    grades: { hp: 'C', mp: 'E', str: 'C', dex: 'A+', vit: 'C', agi: 'A', int: 'D', mnd: 'D', chr: 'B' },
    weaponType: 'dagger',
    armorRank: 'light',
    speed: 1.20,
    hateRate: 1.0,        // ヘイト倍率（狙われやすさ）
    autoAction: 'physical',
    ability: {
      id: 'perfect_dodge',
      name: '絶対回避',
      short: '絶対回避',
      recast: 240,
      duration: 15,
      desc: '15秒間 自分とランダムな味方1人の被ダメージ0',
    },
    passive: {
      id: 'treasure_hunter',
      name: 'トレジャーハンター',
      desc: '獲得ゴールドが増える',
    },
  },
};

export const JOB_IDS = Object.keys(JOBS);

// ヘイト倍率の既定値（ジョブに hateRate が無い場合に使う）
export const DEFAULT_HATE_RATE = 1.0;

// 限界突破に必要なアイテム名
export function proofName(jobId) {
  return `偉大な${JOBS[jobId].name}の証`;
}

// --- パッシブの効果量（すべてジョブレベル依存） ---

export const PASSIVE = {
  // 戦士：ダブルアタック発動率(%)
  doubleAttack: (lv) => 5 + lv * 0.2,
  // モンク：カウンター発動率(%)
  counter: (lv) => 5 + lv * 0.15,
  // 黒：クリアマインド MP自然回復の追加量(/秒)
  clearMind: (lv) => 1 + lv * 0.04,
  // 白：女神の羽衣 全体攻撃の被ダメカット(%)
  goddessRobe: (lv) => Math.min(80, 20 + lv * 0.4),
  // シーフ：トレジャーハンター 獲得ゴールド(%)
  treasureHunter: (lv) => 10 + lv * 0.8,
  // 赤：二刀流 攻撃間隔の短縮(%)
  dualWield: (lv) => 10 + lv * 0.2,
};
