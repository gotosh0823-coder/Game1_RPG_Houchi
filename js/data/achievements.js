// 実績の定義テーブル
//
// リストの原本は data/achievements.csv（Excelで編集可）。
// ここはそれをコードに落としたもの。値を変えたら両方を更新すること。
//
// 報酬は「アレキサンドライト」と「永続のステータス補正」の2本立て。
// 補正はすべて加算%（form:'add'）。
// 乗算（form:'mul'）の仕組みは残してあるが、いまは誰も使っていない
// ── 敵をべき乗カーブに変えたときに、最後の乗算だった「大陸踏破」を加算に戻した。

import { JOB_IDS, JOBS, LEVEL_CAP } from './jobs.js';

// 補正の種類
export const BONUS = {
  allStats: '全ステータス',
  hp: '最大HP',
  atk: '攻撃力',
  vit: 'VIT',
  dropRate: '装備ドロップ率',
  expRate: '獲得EXP',
  goldRate: '獲得ギル',
};

/**
 * 段階制の実績。
 *   metric … 何を数えるか（core/achievements.js の計測値のキー）
 *   start / step / tiers … start から step 刻みで tiers 段階
 *   alex … 1段階あたりのアレキサンドライト
 *   bonus … 1段階あたりのステータス補正
 */
const TIERED = [
  {
    id: 'kills', name: 'モンスターハンター', metric: 'kills',
    start: 100, step: 100, tiers: 50,
    alex: 5, bonus: { type: 'allStats', value: 0.2, form: 'add' },
    desc: (n) => `敵を ${n} 体倒す`,
  },
  {
    // 敵が指数（1.45/ステージ）だった頃は、50ステージごとに ×17.5 という
    // 乗算をここだけに持たせていた。装備が帯をまたいで積み上がらない設計の
    // 埋め合わせだったが、敵をべき乗に変えた時点で過剰になったので加算に戻した。
    // これでゲーム内に「ステージに対する指数」は1つも残っていない。
    // 50ステージ刻みだと、次の踏破まで20〜40ステージ何の後押しも無い区間ができ、
    // ステージ40前後で「越えられるかどうかがガチャ運次第」になっていた（6回中3回が停止）。
    // 10ステージ刻みにして、常に近い目標が1つある状態にしてある。
    id: 'stage', name: '大陸踏破', metric: 'maxStage',
    start: 10, step: 10, tiers: 20,
    alex: 150, bonus: { type: 'allStats', value: 30, form: 'add' },
    desc: (n) => `ステージ ${n} に到達`,
  },
  {
    id: 'limitBreak', name: '限界の先へ', metric: 'limitBreaks',
    start: 1, step: 1, tiers: 20,
    alex: 50, bonus: { type: 'hp', value: 1.0, form: 'add' },
    desc: (n) => `限界突破 ${n} 回`,
  },
  {
    id: 'fusions', name: '鍛冶の道', metric: 'fusions',
    start: 5, step: 5, tiers: 20,
    alex: 20, bonus: { type: 'atk', value: 0.5, form: 'add' },
    desc: (n) => `装備を ${n} 回合成`,
  },
  {
    id: 'abilityUses', name: '歴戦の指揮官', metric: 'abilityUses',
    start: 100, step: 100, tiers: 20,
    alex: 30, bonus: { type: 'allStats', value: 1.0, form: 'add' },
    desc: (n) => `アビリティを ${n} 回使用`,
  },
  {
    id: 'manualClears', name: 'オート封印', metric: 'manualStageClears',
    start: 5, step: 5, tiers: 10,
    alex: 50, bonus: { type: 'allStats', value: 2.0, form: 'add' },
    desc: (n) => `オートを使わずにステージを ${n} 回クリア`,
  },
  {
    id: 'wipes', name: '不屈', metric: 'wipes',
    start: 10, step: 10, tiers: 10,
    alex: 30, bonus: { type: 'hp', value: 2.0, form: 'add' },
    desc: (n) => `全滅 ${n} 回`,
  },
  {
    id: 'metalKills', name: 'メタルハンター', metric: 'metalKills',
    start: 10, step: 10, tiers: 20,
    alex: 30, bonus: { type: 'expRate', value: 2.0, form: 'add' },
    desc: (n) => `メタルスライムを ${n} 体撃破`,
  },
  {
    id: 'bossKills', name: 'ボスキラー', metric: 'bossKills',
    start: 50, step: 50, tiers: 20,
    alex: 20, bonus: { type: 'dropRate', value: 1.0, form: 'add' },
    desc: (n) => `ボスを ${n} 体撃破`,
  },
  {
    id: 'gachaPulls', name: 'モグの常連', metric: 'gachaPulls',
    start: 10, step: 10, tiers: 20,
    alex: 0, bonus: { type: 'allStats', value: 0.5, form: 'add' },
    desc: (n) => `モグボナンザを ${n} 回引く`,
  },
  {
    id: 'flawless', name: '無傷の行軍', metric: 'flawlessStageClears',
    start: 3, step: 3, tiers: 10,
    alex: 50, bonus: { type: 'vit', value: 2.0, form: 'add' },
    desc: (n) => `誰も倒れずにステージを ${n} 回クリア`,
  },
  {
    id: 'uniqueEquip', name: '蒐集家', metric: 'uniqueEquipOwned',
    start: 5, step: 5, tiers: 10,
    alex: 40, bonus: { type: 'dropRate', value: 1.0, form: 'add' },
    desc: (n) => `${n} 種類の装備を所持`,
  },
];

// 累計ギルは桁ごと（×10刻み）なので別枠
const GOLD_TIERS = {
  id: 'totalGold', name: '大富豪', metric: 'totalGold',
  tiers: 12, base: 10_000, ratio: 10,
  alex: 50, bonus: { type: 'goldRate', value: 3.0, form: 'add' },
  thresholdAt: (i) => 10_000 * Math.pow(10, i),
  desc: (n) => `累計 ${n} ギルを獲得`,
};

// 初回入手（レア度ごとに報酬が違う）
const FIRST_RARITY = [
  { rarity: 'N', alex: 10, value: 1 },
  { rarity: 'R', alex: 30, value: 2 },
  { rarity: 'SR', alex: 100, value: 3 },
  { rarity: 'SSR', alex: 300, value: 5 },
  { rarity: 'UR', alex: 1000, value: 10 },
];

// 累計入手数（レア度ごと）。
// 1段階あたりの補正は「微量」に留めてある。効くのは積み上がった総量のほう。
// 上のレア度ほど手に入りにくいので、刻みを細かく・1段階の重みを大きくしている。
// 全50段階×5レア度を取り切ると 全ステータス +31%。
//
// カウントは入手した時点で増える（自動売却されたぶんも数える）。
// 拾ったのに実績が進まないと、自動売却を入れた瞬間に損をすることになるため。
const RARITY_COUNT = [
  { rarity: 'N',   step: 25, tiers: 10, alex: 5,   value: 0.1 },
  { rarity: 'R',   step: 10, tiers: 10, alex: 10,  value: 0.2 },
  { rarity: 'SR',  step: 5,  tiers: 10, alex: 20,  value: 0.4 },
  { rarity: 'SSR', step: 2,  tiers: 10, alex: 50,  value: 0.8 },
  { rarity: 'UR',  step: 1,  tiers: 10, alex: 100, value: 1.6 },
];

/** すべての実績を、1段階＝1エントリに展開して返す */
export function buildAchievements() {
  const out = [];

  for (const a of TIERED) {
    for (let i = 0; i < a.tiers; i++) {
      const threshold = a.start + a.step * i;
      out.push({
        key: `${a.id}:${i}`,
        group: a.id,
        name: `${a.name} ${i + 1}`,
        desc: a.desc(threshold),
        metric: a.metric,
        threshold,
        alex: a.alex,
        bonus: a.bonus,
      });
    }
  }

  for (let i = 0; i < GOLD_TIERS.tiers; i++) {
    const threshold = GOLD_TIERS.thresholdAt(i);
    out.push({
      key: `${GOLD_TIERS.id}:${i}`,
      group: GOLD_TIERS.id,
      name: `${GOLD_TIERS.name} ${i + 1}`,
      desc: GOLD_TIERS.desc(threshold.toLocaleString('ja-JP')),
      metric: GOLD_TIERS.metric,
      threshold,
      alex: GOLD_TIERS.alex,
      bonus: GOLD_TIERS.bonus,
    });
  }

  // 初回入手（レア度ごとに報酬が違う）
  FIRST_RARITY.forEach((r, i) => {
    out.push({
      key: `firstRarity:${r.rarity}`,
      group: 'firstRarity',
      name: `初めての ${r.rarity} 装備`,
      desc: `${r.rarity} の装備を初めて入手`,
      metric: `firstRarity.${r.rarity}`,
      threshold: 1,
      alex: r.alex,
      bonus: { type: 'allStats', value: r.value, form: 'add' },
    });
  });

  // 累計入手数（レア度ごと・微量なステータス補正）
  for (const r of RARITY_COUNT) {
    for (let i = 0; i < r.tiers; i++) {
      const threshold = r.step * (i + 1);
      out.push({
        key: `rarityCount:${r.rarity}:${i}`,
        group: `rarityCount:${r.rarity}`,
        name: `${r.rarity} 装備収集 ${i + 1}`,
        desc: `${r.rarity} の装備を累計 ${threshold} 個入手`,
        metric: `rarityCount.${r.rarity}`,
        threshold,
        alex: r.alex,
        bonus: { type: 'allStats', value: r.value, form: 'add' },
      });
    }
  }

  // 各ジョブ Lv75 到達
  for (const id of JOB_IDS) {
    out.push({
      key: `jobMax:${id}`,
      group: 'jobMax',
      name: `極めし ${JOBS[id].name}`,
      desc: `${JOBS[id].name} を Lv${LEVEL_CAP} にする`,
      metric: `jobLevel.${id}`,
      threshold: LEVEL_CAP,
      alex: 200,
      bonus: { type: 'allStats', value: 3.0, form: 'add' },
    });
  }

  // 同ジョブ4人でステージ50クリア
  for (const id of JOB_IDS) {
    out.push({
      key: `job4:${id}`,
      group: 'job4',
      name: `${JOBS[id].name}四重奏`,
      desc: `${JOBS[id].name} 4人でステージ50をクリア`,
      metric: `job4clear.${id}`,
      threshold: 1,
      alex: 300,
      bonus: { type: 'allStats', value: 10.0, form: 'add', job: id },
    });
  }

  return out;
}

export const ACHIEVEMENTS = buildAchievements();
