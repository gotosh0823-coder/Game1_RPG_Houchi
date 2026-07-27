// ステータス計算
//
// 仕様 §3.4 準拠。
//   限界突破回数を N とすると 成長ボーナス = 1 + 0.05 * N

import { JOBS, GRADE, LEVEL_CAP } from '../data/jobs.js';
import { equippedStats, equippedEffects } from './inventory.js';
import { bonuses } from './achievements.js';
import { relicBonuses } from './relics.js';

// 基礎値。仕様の初期案（HP30 / MP0）ではLv1が脆すぎて1ステージ目のボスで
// 詰まるため、実際に動かして調整した値を入れてある。
const HP_BASE = 150;
const MP_BASE = 40;

// レベルごとの伸び。
// 当初はHP12 / ステータス1.1 / MP7だったが、レベルだけで味方が強くなりすぎ、
// 敵の攻撃がまったく脅威にならなかったため半分程度まで落としてある。
const HP_PER_LEVEL = 6;
const MP_PER_LEVEL = 3.5;
const STAT_PER_LEVEL = 0.55;

export function calcStats(jobId, level, limitBreaks = 0) {
  const job = JOBS[jobId];
  const g = job.grades;
  const bonus = 1 + 0.05 * limitBreaks;
  const lv = level - 1;

  // MPグレードFのジョブ（戦士・モンク）はMPを持たない
  const hasMp = g.mp !== 'F';
  const mpCoef = hasMp ? GRADE[g.mp] : 0;

  const s = {
    hp: Math.floor((HP_BASE + GRADE[g.hp] * HP_PER_LEVEL * lv) * bonus) + 5 * limitBreaks,
    mp: hasMp
      ? Math.floor((MP_BASE + mpCoef * MP_PER_LEVEL * lv) * bonus) + 5 * limitBreaks
      : 0,
  };
  for (const k of ['str', 'dex', 'vit', 'agi', 'int', 'mnd', 'chr']) {
    s[k] = Math.floor((5 + GRADE[g[k]] * STAT_PER_LEVEL * lv) * bonus) + 1 * limitBreaks;
  }
  return s;
}

// Lv75までの総量は約83万EXP。
// 係数は40だったが、獲得EXPを指数からべき乗に落とした時点で桁が合わなくなり、
// Lv75に一生届かなくなった（ステージ33でLv17）。
// 「ステージ85前後でLv75」に合わせて 9 に下げてある。
export function expToNext(level) {
  if (level >= LEVEL_CAP) return Infinity;
  return Math.floor(9 * Math.pow(level, 1.9));
}

// --- 装備込みの合計ステータス ---
//
// 装備は「いま実際に着けている4本」の補正を加算する（js/core/inventory.js）。
// 到達ステージから自動で装備を決めていた暫定仕様は廃止した。
//
// プレイヤー側の強化は、どれも上限がある。
//   1. ジョブレベル … Lv75で打ち止め
//   2. 装備のレア度×レベル … N Lv1 → UR Lv50 で約17.5倍が上限
//   3. 実績・遺物 … すべて加算%。段階数が有限なので合計にも上限がある
// そのため敵側も指数ではなくべき乗にしてある（docs/balance.md §4）。
// 上限のある強化を指数の相手にすると、いつか必ず詰む。

const STAT_KEYS = ['hp', 'mp', 'str', 'dex', 'vit', 'agi', 'int', 'mnd', 'chr'];

/**
 * レベルぶん（素のステータス）と装備ぶんを合算して返す。
 * atk は武器の攻撃力で、ステータスとは別枠。
 *
 * @param {object} state セーブデータ（所持装備・実績を参照する）
 * @param {string} jobId
 */
export function totalStats(state, jobId) {
  const jd = state.jobs[jobId];
  const base = calcStats(jobId, jd.level, jd.limitBreaks);
  const gear = equippedStats(state, jobId);
  const effects = equippedEffects(state, jobId);

  // 実績ボーナス（加算%と乗算）＋ 遺物（加算%のみ）
  const b = bonuses(state, jobId);
  const r = relicBonuses(state);
  const allMul = (1 + (b.allStatsAdd + r.allStatsAdd) / 100) * b.allStatsMul;

  const out = {
    atk: gear.atk * allMul * (1 + (b.atkAdd + r.atkAdd) / 100),
    effects,
  };
  for (const k of STAT_KEYS) {
    // MPを持たないジョブには装備のMPも乗せない
    if (k === 'mp' && base.mp === 0) { out.mp = 0; continue; }
    let v = (base[k] + (gear[k] || 0)) * allMul;
    if (k === 'hp') v *= 1 + (b.hpAdd + r.hpAdd) / 100;
    if (k === 'vit') v *= 1 + (b.vitAdd + r.vitAdd) / 100;
    out[k] = Math.floor(v);
  }
  return out;
}
