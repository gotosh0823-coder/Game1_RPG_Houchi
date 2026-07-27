// 遺物（いぶつ）の定義テーブル
//
// 全滅したときにだけ手に入る、永続のコレクション要素。
// 帯（50ステージ）ごとに10種あり、いまは200ステージぶん＝40種を用意している。
//
// **効果は帯をまたいで同じ**。上の帯の遺物が強いわけではない。
// 名前だけが変わる（別物として集める対象になる）ので、
// 「その帯にいるあいだの全滅」に意味が生まれる、という狙い。

export const RELIC_BAND_STAGES = 50;

// 帯の呼び名。FF11の地名を低位から高位へ並べたもの
export const RELIC_BANDS = [
  'ロンフォール',   // 帯1  ステージ  1〜 50
  'ジュノ',         // 帯2  ステージ 51〜100
  'アルテパ',       // 帯3  ステージ101〜150
  'アルタイユ',     // 帯4  ステージ151〜200
];

/**
 * 10種の効果。全帯で共通。
 *
 * 効果量は実測で決めた。受け取ると編成中のジョブレベルが15下がるので、
 * 弱い効果だと「取るほど弱くなる罠」になる。
 * 詰まったステージで受け取る前提で測った到達ステージ：
 *   効果×1 → 44〜48（取らない場合の85より悪い＝罠）
 *   効果×3 → 86〜91
 *   効果×5 → 93〜95  ← 採用
 *   効果×8 → 97〜98（遺物が主軸になりすぎる）
 *
 *   effect … core/relics.js が集計するキー
 *   value  … 1個あたりの効果量
 */
export const RELIC_TYPES = [
  { key: 'hp',        name: '巨人の心臓',       effect: 'hpAdd',        value: 50, desc: '最大HP +50%' },
  { key: 'atk',       name: '戦神の紋章',       effect: 'atkAdd',       value: 50, desc: '攻撃力 +50%' },
  { key: 'vit',       name: '不動の盾核',       effect: 'vitAdd',       value: 50, desc: 'VIT +50%' },
  { key: 'allStats',  name: '五大の結晶',       effect: 'allStatsAdd',  value: 20,  desc: '全ステータス +20%' },
  { key: 'exp',       name: '賢者の石版',       effect: 'expRateAdd',   value: 100, desc: '獲得EXP +100%' },
  { key: 'gold',      name: '黄金の秤',         effect: 'goldRateAdd',  value: 100, desc: '獲得ギル +100%' },
  { key: 'drop',      name: '財宝の羅針盤',     effect: 'dropRateAdd',  value: 30,  desc: '装備ドロップ率 +30%' },
  { key: 'recast',    name: '時忘れの砂時計',   effect: 'recastCut',    value: 40,  desc: 'アビリティのリキャスト -40%' },
  { key: 'speed',     name: '疾風の足環',       effect: 'speedAdd',     value: 30,  desc: '行動速度 +30%' },
  { key: 'damageCut', name: '護りの古印',       effect: 'damageCut',    value: 20,  desc: '被ダメージ -20%' },
];

/** 40種すべて。id は `帯番号:効果キー` */
export const RELICS = [];
RELIC_BANDS.forEach((prefix, i) => {
  const band = i + 1;
  for (const t of RELIC_TYPES) {
    RELICS.push({
      id: `${band}:${t.key}`,
      band,
      name: `${prefix}の${t.name}`,
      typeKey: t.key,
      effect: t.effect,
      value: t.value,
      desc: t.desc,
      stageFrom: i * RELIC_BAND_STAGES + 1,
      stageTo: (i + 1) * RELIC_BAND_STAGES,
    });
  }
});

export const RELIC_MAX_BAND = RELIC_BANDS.length;

/** ステージから帯番号（用意した範囲を超えたら最後の帯に丸める） */
export function relicBandOf(stage) {
  const b = Math.floor(Math.max(0, stage - 1) / RELIC_BAND_STAGES) + 1;
  return Math.min(RELIC_MAX_BAND, b);
}
