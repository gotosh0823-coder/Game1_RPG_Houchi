// パーティ（4人のキャラクター）
//
// ジョブレベルは**キャラクターごと**に持つ。
// FF11 と同じで、1人のキャラクターが全ジョブぶんのレベルを別々に持ち、
// ジョブを変えるとそのジョブのレベルに切り替わる。
//
// 以前はレベルをジョブ側（state.jobs）に置いていたため、
// 同じジョブを2枠に入れると2人が同じレベル・同じ装備を共有していた。
// 装備は1本を2人が同時に着けられないので、そもそも破綻していた。

import { JOB_IDS, JOBS } from '../data/jobs.js';

export const PARTY_SIZE = 4;

/** 初期編成。ジョブが4つとも違うようにしてある */
export const DEFAULT_JOBS = ['war', 'mnk', 'whm', 'blm'];

export function newJobRecord() {
  return { level: 1, exp: 0, limitBreaks: 0, proofs: 0 };
}

export function newChar(index, job) {
  const jobs = {};
  for (const id of JOB_IDS) jobs[id] = newJobRecord();
  return { name: `キャラ${index + 1}`, job, jobs };
}

export function newParty() {
  return DEFAULT_JOBS.map((job, i) => newChar(i, job));
}

/** そのキャラのいまのジョブID */
export function charJob(state, ci) {
  return state.chars[ci]?.job ?? DEFAULT_JOBS[0];
}

/** そのキャラのいまのジョブの育成データ（level / exp / limitBreaks / proofs） */
export function jobData(state, ci, jobId = null) {
  const c = state.chars[ci];
  return c.jobs[jobId ?? c.job];
}

/** 編成中のジョブID4つ（重複あり得る） */
export function partyJobs(state) {
  return state.chars.map(c => c.job);
}

/**
 * ジョブを変える。
 * 武器はジョブ専用なので、変えると着けられなくなるものが出る。
 * その場で外して、所持品に戻す。
 * @param unequipIncompatible (state, ci) => void  外す処理（inventory側）
 */
export function setJob(state, ci, jobId, unequipIncompatible) {
  if (!JOBS[jobId]) return false;
  state.chars[ci].job = jobId;
  if (unequipIncompatible) unequipIncompatible(state, ci);
  return true;
}

/** 実績用：全キャラ・全ジョブの限界突破の合計 */
export function totalLimitBreaks(state) {
  let n = 0;
  for (const c of state.chars) {
    for (const id of JOB_IDS) n += c.jobs[id]?.limitBreaks ?? 0;
  }
  return n;
}

/** 実績用：そのジョブの、全キャラ中で一番高いレベル */
export function maxJobLevel(state, jobId) {
  let lv = 0;
  for (const c of state.chars) lv = Math.max(lv, c.jobs[jobId]?.level ?? 0);
  return lv;
}
