// 戦闘シミュレータ
//
// 100msティックでリアルタイムに進行する。ターン制ではない。
// 仕様 §6 準拠。

import { JOBS, PASSIVE } from '../data/jobs.js';
import { calcStats, expToNext, gearMultiplier, weaponDamage } from './stats.js';
import {
  makeEnemies, BATTLES_PER_STAGE, BOSS_AOE_INTERVAL, BOSS_AOE_MULTIPLIER,
  goldPerBattle, expPerBattle, PROOF_DROP_STAGE, PROOF_DROP_RATE, METAL,
} from '../data/enemies.js';

export const TICK = 0.1;              // 秒
const BASE_MP_REGEN = 1.0;            // 全員共通のMP自然回復(/秒)
const CURE_THRESHOLD = 0.70;          // 白の自動ケアル閾値
const CURE_MP = 10;
const FIRE_MP = 8;
const TP_PER_HIT = 8;
const WS_MULTIPLIER = 3.0;
const BATTLE_HEAL_RATE = 0.05;        // 戦闘間の自動回復

function rand(a, b) { return a + Math.random() * (b - a); }

export class Battle {
  /**
   * @param {object} save セーブデータ（読み取り＋EXP/ゴールド加算のために保持）
   * @param {object} hooks { onEvent(type, payload) }
   */
  constructor(save, hooks = {}) {
    this.save = save;
    this.hooks = hooks;
    this.time = 0;
    this.startStage(save.stage);
  }

  emit(type, payload) {
    if (this.hooks.onEvent) this.hooks.onEvent(type, payload);
  }

  // --- ステージ／戦闘のセットアップ ---

  startStage(stage) {
    this.save.stage = stage;
    this.battleIndex = 0;
    this.allies = this.save.party.map((jobId, slot) => this.makeAlly(jobId, slot));
    this.spawn();
    this.emit('stage', { stage });
  }

  makeAlly(jobId, slot) {
    const job = JOBS[jobId];
    const jd = this.save.jobs[jobId];
    const st = calcStats(jobId, jd.level, jd.limitBreaks);
    // 装備は未実装なので、到達ステージ相応の装備を着けているものとして扱う
    const gear = gearMultiplier(this.save.maxStage);
    const maxHp = Math.floor(st.hp * gear);

    return {
      slot, jobId, job,
      level: jd.level,
      limitBreaks: jd.limitBreaks,
      stats: st,
      gear,
      weaponD: weaponDamage(this.save.maxStage),
      maxHp, hp: maxHp,
      maxMp: st.mp, mp: st.mp,
      gauge: Math.random() * 0.2,
      tp: 0,
      recastLeft: 0,          // ステージ開始時は全アビが使える
      buffs: { dmgMul: 0, speedMul: 0, invuln: 0 },
      hate: 0,
      alive: true,
    };
  }

  spawn() {
    this.enemies = makeEnemies(this.save.stage, this.battleIndex);
    // VITぶんのヘイトを初期値として入れておく（前衛が素で狙われるようにする）
    for (const a of this.allies) {
      a.hate = a.alive ? a.stats.vit * 10 * a.gear : 0;
    }
    this.emit('battle', { index: this.battleIndex, enemies: this.enemies });
  }

  get isBossBattle() { return this.battleIndex === BATTLES_PER_STAGE - 1; }

  // --- 参照系 ---

  aliveAllies() { return this.allies.filter(a => a.alive); }
  aliveEnemies() { return this.enemies.filter(e => e.alive); }

  allySpeed(a) {
    let sp = a.job.speed;
    if (a.job.passive.id === 'dual_wield') {
      const cut = PASSIVE.dualWield(a.level) / 100;
      sp = sp / (1 - Math.min(0.6, cut));
    }
    if (a.buffs.speedMul > 0) sp *= 3;   // 百烈拳
    return sp;
  }

  enemySpeed(e) {
    let sp = e.speed;
    if (e.debuff) sp *= (1 - e.debuff.speedDown);
    return sp;
  }

  enemyDef(e) {
    let d = e.def;
    if (e.debuff) d *= (1 - e.debuff.defDown);
    return d;
  }

  // 攻撃力・魔力・回復量はいずれも装備倍率が乗る
  attackPower(a) { return a.weaponD + a.stats.str * 0.5 * a.gear; }
  magicPower(a) { return a.stats.int * 1.8 * a.gear; }
  healPower(a) { return a.stats.mnd * 2.5 * a.gear; }

  // --- メインループ ---

  tick() {
    const dt = TICK;
    this.time += dt;

    this.updateTimers(dt);

    // 味方の行動
    for (const a of this.allies) {
      if (!a.alive) continue;
      a.gauge += this.allySpeed(a) * dt;
      while (a.gauge >= 1) {
        a.gauge -= 1;
        this.allyAct(a);
        if (this.aliveEnemies().length === 0) break;
      }
    }

    if (this.aliveEnemies().length === 0) {
      this.winBattle();
      return;
    }

    // 敵の行動
    for (const e of this.enemies) {
      if (!e.alive) continue;
      // メタルスライムは一定時間で逃げる
      if (e.isMetal) {
        e.escapeIn -= dt;
        if (e.escapeIn <= 0) {
          e.alive = false;
          e.escaped = true;
          this.emit('escape', { target: e });
        }
        continue;   // 行動はしない
      }
      if (e.isBoss) {
        e.aoeTimer -= dt;
        if (e.aoeTimer <= 0) {
          e.aoeTimer = BOSS_AOE_INTERVAL;
          this.enemyAoe(e);
        }
      }
      e.gauge += this.enemySpeed(e) * dt;
      while (e.gauge >= 1) {
        e.gauge -= 1;
        this.enemyAct(e);
      }
    }

    if (this.aliveAllies().length === 0) this.wipe();
  }

  updateTimers(dt) {
    for (const a of this.allies) {
      if (a.recastLeft > 0) a.recastLeft = Math.max(0, a.recastLeft - dt);
      if (!a.alive) continue;

      let regen = BASE_MP_REGEN;
      if (a.job.passive.id === 'clear_mind') regen += PASSIVE.clearMind(a.level);
      a.mp = Math.min(a.maxMp, a.mp + regen * dt);

      for (const k of ['dmgMul', 'speedMul', 'invuln']) {
        if (a.buffs[k] > 0) a.buffs[k] = Math.max(0, a.buffs[k] - dt);
      }
    }
    for (const e of this.enemies) {
      if (e.debuff) {
        e.debuff.left -= dt;
        if (e.debuff.left <= 0) e.debuff = null;
      }
    }
  }

  // --- 味方の通常行動 ---

  allyAct(a) {
    const kind = a.job.autoAction;

    if (kind === 'heal') {
      const hurt = this.aliveAllies()
        .filter(t => t.hp / t.maxHp < CURE_THRESHOLD)
        .sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp)[0];
      if (hurt && a.mp >= CURE_MP) {
        a.mp -= CURE_MP;
        const heal = this.healPower(a);
        this.healAlly(hurt, heal);
        a.hate += heal * 0.5;
        return;
      }
      this.physical(a);
      return;
    }

    if (kind === 'magic') {
      const target = this.lowestEnemy();
      if (!target) return;
      // 魔法が通らない相手（メタルスライム）には、撃たずに杖で殴る
      if (target.magicImmune) { this.physical(a); return; }
      if (a.mp >= FIRE_MP) {
        a.mp -= FIRE_MP;
        const dmg = this.magicPower(a) * 100 / (100 + target.mdef);
        this.damageEnemy(a, target, dmg, 'magic');
        return;
      }
      this.physical(a);   // MP切れ：杖で殴る
      return;
    }

    this.physical(a);
  }

  physical(a) {
    const target = this.lowestEnemy();
    if (!target) return;

    this.swing(a, target);

    // ダブルアタック
    if (a.job.passive.id === 'double_attack') {
      if (Math.random() * 100 < PASSIVE.doubleAttack(a.level)) {
        this.swing(a, target.alive ? target : this.lowestEnemy());
      }
    }
  }

  swing(a, target) {
    if (!target || !target.alive) return;

    const hitRate = Math.max(20, Math.min(95, 75 + (a.stats.dex - target.agi) * 0.5));
    if (Math.random() * 100 >= hitRate) {
      this.emit('miss', { unit: a });
      return;
    }

    const atk = this.attackPower(a);
    let dmg = atk * 100 / (100 + this.enemyDef(target)) * rand(0.9, 1.1);
    if (a.buffs.dmgMul > 0) dmg *= 2;    // マイティストライク

    this.damageEnemy(a, target, dmg, 'physical');

    // TP蓄積 → 100%でウェポンスキル自動発動
    a.tp = Math.min(100, a.tp + TP_PER_HIT);
    if (a.tp >= 100) {
      a.tp = 0;
      let ws = atk * WS_MULTIPLIER * 100 / (100 + this.enemyDef(target));
      if (a.buffs.dmgMul > 0) ws *= 2;
      this.damageEnemy(a, target, ws, 'ws');
    }
  }

  lowestEnemy() {
    const list = this.aliveEnemies();
    if (list.length === 0) return null;
    return list.reduce((m, e) => (e.hp < m.hp ? e : m), list[0]);
  }

  damageEnemy(source, target, dmg, kind) {
    // 倒した相手に追撃が入ることがある（ウェポンスキルは通常攻撃と同じ
    // swing の中で撃たれるため）。撃破処理が二重に走るので弾く。
    if (!target.alive) return;

    // メタルスライム：魔法は一切通らない
    if (target.magicImmune && kind === 'magic') {
      this.emit('immune', { target });
      return;
    }
    // メタルスライム：物理は当たっても1ダメージ固定
    dmg = target.flatDamage != null
      ? target.flatDamage
      : Math.max(1, Math.floor(dmg));
    target.hp -= dmg;
    source.hate += dmg;
    this.emit('damage', { side: 'enemy', target, dmg, kind });
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      if (target.isMetal) this.grantMetalReward(target);
      this.emit('kill', { target });
    }
  }

  healAlly(target, amount) {
    amount = Math.max(1, Math.floor(amount));
    target.hp = Math.min(target.maxHp, target.hp + amount);
    this.emit('heal', { target, amount });
  }

  // --- 敵の行動 ---

  enemyAct(e) {
    const target = this.topHate();
    if (!target) return;

    const hitRate = Math.max(20, Math.min(95, 75 + (e.agi - target.stats.agi) * 0.5));
    if (Math.random() * 100 >= hitRate) {
      this.emit('miss', { unit: target });
      return;
    }

    const dmg = e.atk * 100 / (100 + target.stats.vit * 2) * rand(0.9, 1.1);
    this.damageAlly(target, dmg);

    // カウンター
    if (target.alive && target.job.passive.id === 'counter') {
      if (Math.random() * 100 < PASSIVE.counter(target.level)) {
        this.swing(target, e);
      }
    }
  }

  enemyAoe(e) {
    this.emit('aoe', { enemy: e });
    for (const a of this.aliveAllies()) {
      let dmg = e.atk * BOSS_AOE_MULTIPLIER * 100 / (100 + a.stats.vit * 2);
      // 白：女神の羽衣（本人のみ）
      if (a.job.passive.id === 'goddess_robe') {
        dmg *= (1 - PASSIVE.goddessRobe(a.level) / 100);
      }
      this.damageAlly(a, dmg);
    }
  }

  topHate() {
    const list = this.aliveAllies();
    if (list.length === 0) return null;
    return list.reduce((m, a) => (a.hate > m.hate ? a : m), list[0]);
  }

  damageAlly(target, dmg) {
    if (target.buffs.invuln > 0) {     // 絶対回避
      this.emit('damage', { side: 'ally', target, dmg: 0, kind: 'block' });
      return;
    }
    dmg = Math.max(1, Math.floor(dmg));
    target.hp -= dmg;
    this.emit('damage', { side: 'ally', target, dmg, kind: 'physical' });
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.hate = 0;
      this.emit('down', { target });
    }
  }

  // --- 固有アビリティ ---

  canUse(slot) {
    const a = this.allies[slot];
    return a && a.alive && a.recastLeft <= 0;
  }

  useAbility(slot) {
    if (!this.canUse(slot)) return false;
    const a = this.allies[slot];
    const ab = a.job.ability;
    a.recastLeft = ab.recast;

    switch (ab.id) {
      case 'mighty_strike':
        a.buffs.dmgMul = ab.duration;
        break;

      case 'hundred_fists':
        a.buffs.speedMul = ab.duration;
        break;

      case 'benediction':
        for (const t of this.aliveAllies()) {
          t.hp = t.maxHp;
          t.mp = t.maxMp;
          this.emit('heal', { target: t, amount: 0, full: true });
        }
        a.hate += a.maxHp * 0.5;
        break;

      case 'manafont': {
        const dmgBase = this.magicPower(a) * 20;
        for (const e of this.aliveEnemies()) {
          this.damageEnemy(a, e, dmgBase * 100 / (100 + e.mdef), 'magic');
        }
        break;
      }

      case 'chainspell':
        for (const e of this.aliveEnemies()) {
          e.debuff = { defDown: 0.30, speedDown: 0.30, left: ab.duration };
          a.hate += e.hp * 0.02;
        }
        break;

      case 'perfect_dodge': {
        a.buffs.invuln = ab.duration;
        const others = this.aliveAllies().filter(t => t !== a);
        if (others.length > 0) {
          const pick = others[Math.floor(Math.random() * others.length)];
          pick.buffs.invuln = ab.duration;
        }
        break;
      }
    }

    this.emit('ability', { unit: a, ability: ab });
    return true;
  }

  autoUse() {
    for (let i = 0; i < this.allies.length; i++) {
      if (this.canUse(i)) this.useAbility(i);
    }
  }

  // --- 戦闘結果 ---

  // メタルスライムを倒した時の報酬（戦闘終了を待たずその場で入る）
  grantMetalReward() {
    const stage = this.save.stage;
    const gold = goldPerBattle(stage) * METAL.goldMultiplier * (1 + this.treasureBonus() / 100);
    this.save.gold += gold;

    const exp = expPerBattle(stage) * METAL.expMultiplier;
    for (const id of [...new Set(this.save.party)]) this.gainExp(id, exp);

    this.emit('metal', { gold, exp });
  }

  treasureBonus() {
    let bonus = 0;
    for (const a of this.allies) {
      if (a.job.passive.id === 'treasure_hunter') bonus += PASSIVE.treasureHunter(a.level);
    }
    return bonus;
  }

  winBattle() {
    const stage = this.save.stage;
    const isBoss = this.isBossBattle;

    // ゴールド（トレジャーハンターは編成に入っている枠ぶん加算）
    const gold = goldPerBattle(stage) * (isBoss ? 5 : 1) * (1 + this.treasureBonus() / 100);
    this.save.gold += gold;

    // EXP（ジョブ単位で1回だけ。重複編成でも倍にはならない）
    const jobIds = [...new Set(this.save.party)];
    for (const id of jobIds) {
      this.gainExp(id, expPerBattle(stage) * (isBoss ? 5 : 1));
    }

    this.emit('win', { gold, isBoss });

    if (isBoss) {
      if (stage >= PROOF_DROP_STAGE) this.rollProofs();
      this.save.maxStage = Math.max(this.save.maxStage, stage + 1);
      this.startStage(stage + 1);
      return;
    }

    // 戦闘間の自動回復はHP5%のみ。MPとリキャストは持ち越し
    for (const a of this.aliveAllies()) {
      a.hp = Math.min(a.maxHp, a.hp + a.maxHp * BATTLE_HEAL_RATE);
    }
    this.battleIndex++;
    this.spawn();
  }

  rollProofs() {
    const jobIds = [...new Set(this.save.party)];
    for (const id of jobIds) {
      if (Math.random() < PROOF_DROP_RATE) {
        this.save.jobs[id].proofs++;
        this.emit('proof', { jobId: id });
      }
    }
  }

  gainExp(jobId, amount) {
    const jd = this.save.jobs[jobId];
    const mult = 1 + 0.5 * jd.limitBreaks;
    jd.exp += amount * mult;

    for (;;) {
      const need = expToNext(jd.level);
      if (!isFinite(need) || jd.exp < need) break;
      jd.exp -= need;
      jd.level++;
      this.emit('levelup', { jobId, level: jd.level });
    }
  }

  wipe() {
    this.emit('wipe', { stage: this.save.stage });
    this.startStage(this.save.stage);
  }
}
