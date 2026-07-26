// ステータス計算
//
// 仕様 §3.4 準拠。
//   限界突破回数を N とすると 成長ボーナス = 1 + 0.05 * N

import { JOBS, GRADE, LEVEL_CAP } from '../data/jobs.js';
import { equipmentStats } from '../data/equipment.js';
import { bonuses } from './achievements.js';

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

export function expToNext(level) {
  if (level >= LEVEL_CAP) return Infinity;
  return Math.floor(40 * Math.pow(level, 1.9));
}

// --- 装備込みの合計ステータス ---
//
// 装備はステータスを「加算」する（js/data/equipment.js）。
// 以前あった抽象的な装備倍率（GEAR_GROWTH）は廃止した。
// プレイヤー側で指数的に伸びる軸は、いまは装備ティアだけが担っている。

const STAT_KEYS = ['hp', 'mp', 'str', 'dex', 'vit', 'agi', 'int', 'mnd', 'chr'];

/**
 * レベルぶん（素のステータス）と装備ぶんを合算して返す。
 * atk は武器の攻撃力で、ステータスとは別枠。
 */
export function totalStats(jobId, level, limitBreaks, maxStage, state = null) {
  const job = JOBS[jobId];
  const base = calcStats(jobId, level, limitBreaks);
  const gear = equipmentStats(job, maxStage);

  // 実績ボーナス（加算%と乗算）
  const b = state ? bonuses(state, jobId) : null;
  const allMul = b ? (1 + b.allStatsAdd / 100) * b.allStatsMul : 1;

  const out = { atk: gear.atk * allMul * (b ? 1 + b.atkAdd / 100 : 1) };
  for (const k of STAT_KEYS) {
    // MPを持たないジョブには装備のMPも乗せない
    if (k === 'mp' && base.mp === 0) { out.mp = 0; continue; }
    let v = (base[k] + gear[k]) * allMul;
    if (b && k === 'hp') v *= 1 + b.hpAdd / 100;
    if (b && k === 'vit') v *= 1 + b.vitAdd / 100;
    out[k] = Math.floor(v);
  }
  return out;
}
