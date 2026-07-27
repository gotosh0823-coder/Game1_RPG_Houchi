// 実績の計測・判定・報酬
//
// 報酬は自動取得。達成した瞬間にアレキサンドライトとステータス補正が入り、
// 通知（トースト）が出る。受け取り操作は無い。

import { ACHIEVEMENTS } from '../data/achievements.js';
import { JOB_IDS, LEVEL_CAP } from '../data/jobs.js';

/** セーブに持たせる計測値の初期値 */
export function newStats() {
  return {
    kills: 0,
    bossKills: 0,
    metalKills: 0,
    wipes: 0,
    abilityUses: 0,
    manualStageClears: 0,
    flawlessStageClears: 0,
    totalGold: 0,
    // 装備がらみ（core/inventory.js が更新する）
    fusions: 0,
    gachaPulls: 0,
    uniqueEquipOwned: 0,
    firstRarity: {},      // { N:1, R:1, ... } 初回入手
    rarityCount: {},      // { N:120, R:34, ... } 累計入手数（売却しても減らない）
    job4clear: {},        // { war:1, ... }
  };
}

/**
 * 実績の判定に使う値を取り出す。
 * セーブに直接ある計測値と、他から導ける値（最高ステージ・レベルなど）を混ぜて扱う。
 */
function metricValue(state, metric) {
  if (metric === 'maxStage') return state.maxStage;
  if (metric === 'limitBreaks') {
    return JOB_IDS.reduce((sum, id) => sum + (state.jobs[id]?.limitBreaks ?? 0), 0);
  }
  if (metric.startsWith('jobLevel.')) {
    return state.jobs[metric.slice(9)]?.level ?? 0;
  }
  if (metric.startsWith('firstRarity.')) {
    return state.stats.firstRarity?.[metric.slice(12)] ?? 0;
  }
  if (metric.startsWith('rarityCount.')) {
    return state.stats.rarityCount?.[metric.slice(12)] ?? 0;
  }
  if (metric.startsWith('job4clear.')) {
    return state.stats.job4clear?.[metric.slice(10)] ?? 0;
  }
  return state.stats[metric] ?? 0;
}

/**
 * 達成していて未取得のものを取得する。
 * @returns 新しく達成した実績の配列（通知用）
 */
export function claim(state) {
  if (!state.achievements) state.achievements = {};
  const unlocked = [];

  for (const a of ACHIEVEMENTS) {
    if (state.achievements[a.key]) continue;
    if (metricValue(state, a.metric) < a.threshold) continue;

    state.achievements[a.key] = 1;
    if (a.alex > 0) state.alexandrite = (state.alexandrite ?? 0) + a.alex;
    unlocked.push(a);
  }
  return unlocked;
}

/**
 * 取得済みの実績から、いま効いている補正を集計する。
 *
 *   add … 加算%。同じ種類どうしを足す
 *   mul … 乗算。掛け合わせる（ステージ踏破のみ）
 *
 * job が指定された補正は、そのジョブにしか乗らない。
 */
export function bonuses(state, jobId = null) {
  const out = {
    allStatsAdd: 0, allStatsMul: 1,
    hpAdd: 0, atkAdd: 0, vitAdd: 0,
    dropRateAdd: 0, expRateAdd: 0, goldRateAdd: 0,
  };
  if (!state.achievements) return out;

  for (const a of ACHIEVEMENTS) {
    if (!state.achievements[a.key]) continue;
    const b = a.bonus;
    if (b.job && b.job !== jobId) continue;

    if (b.form === 'mul') {
      if (b.type === 'allStats') out.allStatsMul *= b.value;
      continue;
    }
    switch (b.type) {
      case 'allStats': out.allStatsAdd += b.value; break;
      case 'hp': out.hpAdd += b.value; break;
      case 'atk': out.atkAdd += b.value; break;
      case 'vit': out.vitAdd += b.value; break;
      case 'dropRate': out.dropRateAdd += b.value; break;
      case 'expRate': out.expRateAdd += b.value; break;
      case 'goldRate': out.goldRateAdd += b.value; break;
    }
  }
  return out;
}

/** 進捗の一覧（実績画面用）。グループごとに「いくつ達成したか」を返す */
export function progress(state) {
  const groups = new Map();
  for (const a of ACHIEVEMENTS) {
    if (!groups.has(a.group)) {
      groups.set(a.group, { group: a.group, name: a.name.replace(/ \d+$/, ''), done: 0, total: 0, next: null });
    }
    const g = groups.get(a.group);
    g.total++;
    if (state.achievements?.[a.key]) g.done++;
    else if (!g.next) {
      g.next = { desc: a.desc, now: metricValue(state, a.metric), need: a.threshold };
    }
  }
  return [...groups.values()];
}

export { LEVEL_CAP };
