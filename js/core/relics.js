// 遺物の入手と集計
//
// 全滅したときにだけ手に入る。**オンライン中の全滅のみ**が対象で、
// オフライン報酬は全滅をシミュレートしないので、放置では増えない。
//
// 入手の流れ
//   1. 全滅する
//   2. いまの帯の未入手の遺物から、ランダムに最大3種を提示する
//   3. プレイヤーが1つ選ぶ
//   4. 遺物が入り、**編成中のジョブのレベルが15下がる**（代償）
//
// その帯の10種を集めきると、以降その帯での全滅では何も起きない
// （＝レベルの代償も発生しない）。壁でひたすら全滅して突破する遊び方を
// 潰さないよう、代償は「遺物を受け取ったときだけ」に閉じてある。

import { RELICS, relicBandOf } from '../data/relics.js';

export const RELIC_CHOICES = 3;        // 1回の全滅で提示する数
export const RELIC_LEVEL_COST = 15;    // 受け取ったときに下がるジョブレベル

const BY_ID = new Map(RELICS.map(r => [r.id, r]));

export function relicById(id) { return BY_ID.get(id); }

export function ownedRelics(state) {
  return RELICS.filter(r => state.relics?.[r.id]);
}

/** その帯で、まだ持っていない遺物 */
export function remainingRelics(state, stage) {
  const band = relicBandOf(stage);
  return RELICS.filter(r => r.band === band && !state.relics?.[r.id]);
}

/**
 * 全滅時の選択肢を引く。
 * @returns 遺物の配列（最大3個）。その帯を集めきっていれば空
 */
export function rollRelicChoices(state, stage) {
  const pool = remainingRelics(state, stage);
  const picked = [];
  const rest = [...pool];
  while (picked.length < RELIC_CHOICES && rest.length > 0) {
    picked.push(...rest.splice(Math.floor(Math.random() * rest.length), 1));
  }
  return picked;
}

/**
 * 遺物を受け取る。代償として編成中のジョブのレベルが下がる。
 * @returns { relic, levelDrops:[{jobId, from, to}] } 受け取れなければ null
 */
export function takeRelic(state, id) {
  const relic = relicById(id);
  if (!relic || state.relics?.[id]) return null;

  if (!state.relics) state.relics = {};
  state.relics[id] = 1;

  // 代償：編成中のジョブのレベルが RELIC_LEVEL_COST 下がる（最低1）。
  // 同じジョブを複数枠に入れていても、ジョブ単位で1回だけ下げる。
  const levelDrops = [];
  for (const jobId of new Set(state.party)) {
    const jd = state.jobs[jobId];
    const from = jd.level;
    const to = Math.max(1, from - RELIC_LEVEL_COST);
    if (to === from) continue;
    jd.level = to;
    jd.exp = 0;
    levelDrops.push({ jobId, from, to });
  }
  return { relic, levelDrops };
}

/**
 * 持っている遺物の効果を合計する。
 * キーは core/achievements.js の bonuses() と揃えてあるので、そのまま足せる。
 */
export function relicBonuses(state) {
  const out = {
    allStatsAdd: 0, hpAdd: 0, atkAdd: 0, vitAdd: 0,
    dropRateAdd: 0, expRateAdd: 0, goldRateAdd: 0,
    recastCut: 0, speedAdd: 0, damageCut: 0,
  };
  if (!state.relics) return out;
  for (const r of RELICS) {
    if (state.relics[r.id]) out[r.effect] += r.value;
  }
  return out;
}

/** 収集状況（遺物画面用）。帯ごとにまとめる */
export function relicProgress(state) {
  const bands = new Map();
  for (const r of RELICS) {
    if (!bands.has(r.band)) {
      bands.set(r.band, { band: r.band, from: r.stageFrom, to: r.stageTo, items: [] });
    }
    bands.get(r.band).items.push({ ...r, owned: !!state.relics?.[r.id] });
  }
  return [...bands.values()];
}

export { relicBandOf };
