// ステータス計算
//
// 仕様 §3.4 準拠。
//   限界突破回数を N とすると 成長ボーナス = 1 + 0.05 * N

import { JOBS, GRADE, LEVEL_CAP } from '../data/jobs.js';

// 基礎値。仕様の初期案（HP30 / MP0）ではLv1が脆すぎて1ステージ目のボスで
// 詰まるため、実際に動かして調整した値を入れてある。
const HP_BASE = 150;
const MP_BASE = 40;

export function calcStats(jobId, level, limitBreaks = 0) {
  const job = JOBS[jobId];
  const g = job.grades;
  const bonus = 1 + 0.05 * limitBreaks;
  const lv = level - 1;

  // MPグレードFのジョブ（戦士・モンク）はMPを持たない
  const hasMp = g.mp !== 'F';
  const mpCoef = hasMp ? GRADE[g.mp] : 0;

  const s = {
    hp: Math.floor((HP_BASE + GRADE[g.hp] * 12 * lv) * bonus) + 5 * limitBreaks,
    mp: hasMp
      ? Math.floor((MP_BASE + mpCoef * 7 * lv) * bonus) + 5 * limitBreaks
      : 0,
  };
  for (const k of ['str', 'dex', 'vit', 'agi', 'int', 'mnd', 'chr']) {
    s[k] = Math.floor((5 + GRADE[g[k]] * 1.1 * lv) * bonus) + 1 * limitBreaks;
  }
  return s;
}

export function expToNext(level) {
  if (level >= LEVEL_CAP) return Infinity;
  return Math.floor(40 * Math.pow(level, 1.9));
}

// --- 装備（暫定スケーリング） ---
//
// 店が未実装のため、v0では「最高到達ステージ相応の装備を全員が自動的に
// 身に着けている」ものとして扱う。
//
// 仕様 §7.3 の「10ステージごとに新ティア（×1.42）」は、敵の伸び（×1.45/ステージ）
// に対して桁が足りず、実際に動かすと数ステージで一切勝てなくなる。
// そのためここでは、装備の強さをステージに対して連続的に伸ばしている。
//   倍率 1.43 は敵HPの伸び 1.45 よりわずかに小さい
//   → 進むほどゆっくり不利になり、レベルと限界突破で押し返す形になる
// 店を実装する際は、この曲線を装備ティアの価格・性能に落とし込む必要がある。

export const GEAR_GROWTH = 1.43;
const WEAPON_BASE = 6;

export function gearMultiplier(maxStage) {
  return Math.pow(GEAR_GROWTH, Math.max(0, maxStage - 1));
}

export function weaponDamage(maxStage) {
  return WEAPON_BASE * gearMultiplier(maxStage);
}
