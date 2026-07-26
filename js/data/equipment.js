// 装備テーブル
//
// 4部位（武器 / 鎧 / 脚 / アクセサリ）。装備はステータスを「加算」する。
//
// 以前は装備を抽象的な倍率（GEAR_GROWTH）で表現していたが、
// それを廃止して実際のアイテムに置き換えた。
// プレイヤー側で指数的に伸びる軸は、いまはこの装備だけが担っている。

export const SLOTS = [
  { id: 'weapon', name: '武器' },
  { id: 'armor', name: '鎧' },
  { id: 'legs', name: '脚' },
  { id: 'acc', name: 'アクセサリ' },
];

// --- ティア ---
//
// 敵は1ステージごとに ×1.45〜1.46 で伸びるので、
// 装備も同じ速さで伸びないと数ステージで置いていかれる。
//   STAGES_PER_TIER ステージごとに1ティア上がり、そのたびに EQUIP_GROWTH 倍になる
//   釣り合う値は 1.45 ^ STAGES_PER_TIER（2ステージなら約2.10）
// これより小さくすると、進むほど不利になって壁ができる。

export const STAGES_PER_TIER = 2;

// 火力側（攻撃力・STR・DEX・AGI・INT）の伸び。
// 敵HPの伸び 1.45^2 = 2.10 に近いほど、1ステージの所要時間が一定に保たれる。
export const EQUIP_GROWTH = 2.06;

// 耐久側（HP・VIT・MND）の伸び。火力側よりわずかに小さくしてある。
// 単一の伸びだと「時間だけ延びて誰も死なない」か「全滅が止まらない」の
// どちらかにしかならなかったため、耐久だけを先に遅らせて壁を作っている。
export const EQUIP_DEF_GROWTH = 1.90;

// 耐久側として扱うステータス（MNDは回復量なので耐久に含める）
const DEF_STATS = ['hp', 'vit', 'mnd'];

export function tierOf(maxStage) {
  return Math.floor(Math.max(0, maxStage - 1) / STAGES_PER_TIER) + 1;
}

export function tierScale(tier) {
  return Math.pow(EQUIP_GROWTH, tier - 1);
}

export function tierDefScale(tier) {
  return Math.pow(EQUIP_DEF_GROWTH, tier - 1);
}

// --- 武器（ジョブの武器種ごと） ---

const WEAPONS = {
  axe: {
    label: '斧',
    names: ['ブロンズアクス', 'アイアンアクス', 'ミスリルアクス', 'ダマスカスアクス', 'アダマンアクス'],
    base: { atk: 9, str: 4 },
  },
  h2h: {
    label: '格闘',
    names: ['ブロンズナックル', 'アイアンナックル', 'ミスリルナックル', 'ダマスカスナックル', 'アダマンナックル'],
    base: { atk: 6, str: 3, vit: 2 },
  },
  pole: {
    label: '棍',
    names: ['オークポール', 'アッシュポール', 'ホーリーポール', 'エルダーポール', 'ディヴァインポール'],
    base: { atk: 4, mnd: 6 },
  },
  rod: {
    label: '杖',
    names: ['メイプルロッド', 'エルムロッド', 'ソーサラーロッド', 'ウィザードロッド', 'アークロッド'],
    base: { atk: 3, int: 6 },
  },
  sword: {
    label: '片手剣',
    names: ['ブロンズソード', 'アイアンソード', 'ミスリルソード', 'ダマスカスソード', 'アダマンソード'],
    base: { atk: 7, str: 2, int: 2, mnd: 2 },
  },
  dagger: {
    label: '短剣',
    names: ['ブロンズナイフ', 'アイアンナイフ', 'ミスリルナイフ', 'ダマスカスナイフ', 'アダマンナイフ'],
    base: { atk: 6, dex: 4, agi: 2 },
  },
};

// --- 鎧・脚（防具ランクごと） ---

const ARMORS = {
  heavy: {
    names: ['ブロンズハーネス', 'アイアンプレート', 'ミスリルプレート', 'ダマスカスプレート', 'アダマンプレート'],
    base: { hp: 70, vit: 5 },
  },
  medium: {
    names: ['レザーベスト', 'スケイルメイル', 'ミスリルシャツ', 'ドラゴンメイル', 'アダマンベスト'],
    base: { hp: 50, vit: 4, dex: 2 },
  },
  light: {
    names: ['コットンローブ', 'ウールローブ', 'シルクローブ', 'ホーリーローブ', 'アークローブ'],
    base: { hp: 35, mp: 15, int: 2, mnd: 2 },
  },
};

const LEGS = {
  heavy: {
    names: ['ブロンズグリーヴ', 'アイアンキュイス', 'ミスリルキュイス', 'ダマスカスキュイス', 'アダマンキュイス'],
    base: { hp: 40, vit: 3 },
  },
  medium: {
    names: ['レザートラウザ', 'スケイルクウィス', 'ミスリルホーズ', 'ドラゴンホーズ', 'アダマンホーズ'],
    base: { hp: 30, agi: 3, dex: 2 },
  },
  light: {
    names: ['コットンスロップス', 'ウールスロップス', 'シルクスロップス', 'ホーリースロップス', 'アークスロップス'],
    base: { hp: 20, mp: 10, agi: 2, mnd: 2 },
  },
};

// --- アクセサリ（全ジョブ共通・全ステータスを薄く底上げ） ---

const ACCESSORIES = {
  names: ['カッパーリング', 'シルバーリング', 'ゴールドリング', 'ミスリルリング', 'ダイヤリング'],
  base: { hp: 20, mp: 10, str: 2, dex: 2, vit: 2, agi: 2, int: 2, mnd: 2 },
};

// --- 生成 ---

function nameFor(names, tier) {
  const i = (tier - 1) % names.length;
  const cycle = Math.floor((tier - 1) / names.length);
  return cycle === 0 ? names[i] : `${names[i]}+${cycle}`;
}

function makeItem(slot, family, tier) {
  const scale = tierScale(tier);
  const defScale = tierDefScale(tier);
  const stats = {};
  for (const [k, v] of Object.entries(family.base)) {
    stats[k] = Math.max(1, Math.floor(v * (DEF_STATS.includes(k) ? defScale : scale)));
  }
  return { slot, name: nameFor(family.names, tier), tier, stats };
}

/**
 * そのジョブが、その到達ステージ時点で身に着けている4部位を返す。
 *
 * 店が未実装のため、v0では「到達ステージ相応の装備を自動的に着けている」扱い。
 * 店を作るときは、ここを所持品の参照に差し替える（アイテムの中身は変わらない）。
 */
export function equipmentFor(job, maxStage) {
  const tier = tierOf(maxStage);
  const rank = job.armorRank;
  return {
    weapon: makeItem('weapon', WEAPONS[job.weaponType], tier),
    armor: makeItem('armor', ARMORS[rank], tier),
    legs: makeItem('legs', LEGS[rank], tier),
    acc: makeItem('acc', ACCESSORIES, tier),
  };
}

/** 4部位の補正を合計する。atk は武器の攻撃力 */
export function equipmentStats(job, maxStage) {
  const sum = { atk: 0, hp: 0, mp: 0, str: 0, dex: 0, vit: 0, agi: 0, int: 0, mnd: 0, chr: 0 };
  for (const item of Object.values(equipmentFor(job, maxStage))) {
    for (const [k, v] of Object.entries(item.stats)) sum[k] += v;
  }
  return sum;
}

export function weaponLabel(job) {
  return WEAPONS[job.weaponType].label;
}
