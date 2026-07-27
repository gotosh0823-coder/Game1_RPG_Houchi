// 戦闘シミュレータ
//
// 100msティックでリアルタイムに進行する。ターン制ではない。
// 仕様 §6 準拠。

import { JOBS, PASSIVE, DEFAULT_HATE_RATE } from '../data/jobs.js';
import { totalStats, expToNext } from './stats.js';
import {
  makeEnemies, BATTLES_PER_STAGE, BOSS_AOE_INTERVAL, BOSS_AOE_MULTIPLIER,
  goldPerBattle, expPerBattle, PROOF_DROP_STAGE, PROOF_DROP_RATE, METAL,
} from '../data/enemies.js';
import { ALEX_PER_BOSS } from './save.js';
import { rollDrops } from './inventory.js';
import { bonuses } from './achievements.js';
import { relicBonuses, rollRelicChoices } from './relics.js';
import { jobData, partyJobs } from './party.js';

export const TICK = 0.1;              // 秒
export const BASE_DROP_RATE = 20;     // ボスの装備ドロップ率(%)。100%超は複数ドロップ
const BASE_MP_REGEN = 1.0;            // 全員共通のMP自然回復(/秒)
const CURE_THRESHOLD = 0.70;          // 白の自動ケアル閾値
const CURE_MP = 10;
const FIRE_MP = 8;
const TP_PER_HIT = 8;
const WS_MULTIPLIER = 3.0;
const BATTLE_HEAL_RATE = 0.05;        // 戦闘間の自動回復
const MIN_HATE_SHARE = 5;             // 誰でも最低これだけは狙われる(%)
const VIT_DEFENSE = 2;                // 被ダメージ計算でVITに掛かる係数

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
    // 遺物の効果はステージ中に変わらないので、ここで1回だけ集計しておく
    this.relic = relicBonuses(this.save);
    // 実績用：このステージ中にオートを使ったか／誰か倒れたか
    this.autoUsedThisStage = false;
    this.anyDownThisStage = false;
    this.allies = this.save.chars.map((c, slot) => this.makeAlly(slot));
    this.spawn();
    this.emit('stage', { stage });
  }

  makeAlly(slot) {
    const c = this.save.chars[slot];
    const jobId = c.job;
    const job = JOBS[jobId];
    const jd = jobData(this.save, slot);
    // 素のステータス＋いま着けている装備4本の補正
    const st = totalStats(this.save, slot);
    const maxHp = st.hp;

    return {
      slot, jobId, job, name: c.name,
      level: jd.level,
      limitBreaks: jd.limitBreaks,
      stats: st,
      eff: st.effects,        // ガチャ装備の特殊効果（無ければ空）
      maxHp, hp: maxHp,
      maxMp: st.mp, mp: st.mp,
      gauge: Math.random() * 0.2,
      tp: 0,
      recastLeft: 0,          // ステージ開始時は全アビが使える
      recastFull: job.ability.recast,   // ゲージ表示用（遺物で短縮された後の値）
      buffs: { dmgMul: 0, speedMul: 0, invuln: 0 },
      hate: 0,
      alive: true,
    };
  }

  spawn() {
    this.enemies = makeEnemies(this.save.stage, this.battleIndex);
    // VITぶんのヘイトを初期値として入れておく（前衛が素で狙われるようにする）
    for (const a of this.allies) {
      a.hate = a.alive ? a.stats.vit * 10 : 0;
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
    // 装備（攻撃間隔短縮／行動速度）と遺物
    sp *= 1 + ((a.eff.speed ?? 0) + this.relic.speedAdd) / 100;
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

  // 攻撃力・魔力・回復量。装備のステータス補正はすでに合算済みで、
  // ここで乗るのはガチャ装備の特殊効果（％）だけ
  attackPower(a) { return a.stats.atk + a.stats.str * 0.5; }
  magicPower(a) { return a.stats.int * 1.8 * (1 + (a.eff.magicDamage ?? 0) / 100); }
  healPower(a) { return a.stats.mnd * 2.5 * (1 + (a.eff.healPower ?? 0) / 100); }

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

      let regen = BASE_MP_REGEN + (a.eff.mpRegen ?? 0);
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

    // ダブルアタック（パッシブ＋装備）
    const daRate = (a.job.passive.id === 'double_attack' ? PASSIVE.doubleAttack(a.level) : 0)
      + (a.eff.doubleAttack ?? 0);
    if (daRate > 0 && Math.random() * 100 < daRate) {
      this.swing(a, target.alive ? target : this.lowestEnemy());
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
      this.save.stats.kills++;
      if (target.isMetal) {
        this.save.stats.metalKills++;
        this.grantMetalReward(target);
      }
      this.emit('kill', { target });
    }
  }

  healAlly(target, amount) {
    amount = Math.max(1, Math.floor(amount));
    target.hp = Math.min(target.maxHp, target.hp + amount);
    this.emit('heal', { target, amount });
  }

  /**
   * 味方が受けるダメージ。
   *
   *   被ダメージ = 敵ATK × 敵ATK / (敵ATK + VIT × 2)
   *
   * 以前の `100 / (100 + VIT×2)` は、VITがレベルぶんしか伸びない前提の式だった。
   * 装備でVITが指数的に伸びるようになると軽減率が100%に近づき、
   * 味方が事実上無敵になってしまう。
   * 上の式は敵ATKとVITが同じ速さで伸びるかぎり軽減率が一定に保たれる。
   */
  incomingDamage(rawAtk, target) {
    const raw = rawAtk * rawAtk / (rawAtk + target.stats.vit * VIT_DEFENSE);
    const cut = (target.eff.damageCut ?? 0) + this.relic.damageCut;
    return raw * (1 - Math.min(0.8, cut / 100));
  }

  // --- 敵の行動 ---

  enemyAct(e) {
    const target = this.rollTarget();
    if (!target) return;

    const hitRate = Math.max(20, Math.min(95,
      75 + (e.agi - target.stats.agi) * 0.5 - (target.eff.evasion ?? 0)));
    if (Math.random() * 100 >= hitRate) {
      this.emit('miss', { unit: target });
      return;
    }

    this.damageAlly(target, this.incomingDamage(e.atk, target) * rand(0.9, 1.1));

    // カウンター（パッシブ＋装備）
    const ctRate = (target.job.passive.id === 'counter' ? PASSIVE.counter(target.level) : 0)
      + (target.eff.counter ?? 0);
    if (target.alive && ctRate > 0 && Math.random() * 100 < ctRate) {
      this.swing(target, e);
    }
  }

  enemyAoe(e) {
    this.emit('aoe', { enemy: e });
    for (const a of this.aliveAllies()) {
      let dmg = this.incomingDamage(e.atk * BOSS_AOE_MULTIPLIER, a);
      // 白：女神の羽衣（本人のみ）
      if (a.job.passive.id === 'goddess_robe') {
        dmg *= (1 - PASSIVE.goddessRobe(a.level) / 100);
      }
      this.damageAlly(a, dmg);
    }
  }

  /**
   * ヘイトを「狙われる確率(%)」に変換する。
   *
   * 最大ヘイトの1人を必ず狙う方式だと、盾役以外に一切攻撃が飛ばず、
   * 後衛が減らないので回復も緊張も意味を持たなくなる。
   * そこでヘイトの比率をそのまま抽選確率にし、全員に最低 MIN_HATE_SHARE% を保証する。
   *
   * 例）戦士30 / モンク50 / 白10 / 黒10 → その比率で狙われる
   *
   * 返り値は aliveAllies() と同じ並びの配列（合計100）。
   */
  hateShares(list = this.aliveAllies()) {
    const n = list.length;
    if (n === 0) return [];
    if (n === 1) return [100];

    // 全員に最低保証を配れない人数のときは均等割り
    if (MIN_HATE_SHARE * n >= 100) return list.map(() => 100 / n);

    // ジョブごとのヘイト倍率を掛けたうえで比率を出す
    const weights = list.map(a => Math.max(0, a.hate) * this.hateRate(a));
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total <= 0) return list.map(() => 100 / n);

    const shares = weights.map(w => w / total * 100);

    // 最低保証を下回るぶんを、上回っている側から比例して分けてもらう
    const deficit = shares.reduce((sum, w) => sum + Math.max(0, MIN_HATE_SHARE - w), 0);
    if (deficit <= 0) return shares;

    const surplus = shares.reduce((sum, w) => sum + Math.max(0, w - MIN_HATE_SHARE), 0);
    if (surplus <= 0) return list.map(() => 100 / n);

    return shares.map(w => (
      w < MIN_HATE_SHARE
        ? MIN_HATE_SHARE
        : w - deficit * (w - MIN_HATE_SHARE) / surplus
    ));
  }

  hateRate(a) {
    return (a.job.hateRate ?? DEFAULT_HATE_RATE) + (a.eff.hate ?? 0);
  }

  /** ヘイトの比率で狙う相手を抽選する */
  rollTarget() {
    const list = this.aliveAllies();
    if (list.length === 0) return null;

    const shares = this.hateShares(list);
    let roll = Math.random() * 100;
    for (let i = 0; i < list.length; i++) {
      roll -= shares[i];
      if (roll <= 0) return list[i];
    }
    return list[list.length - 1];
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
      this.anyDownThisStage = true;
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
    a.recastLeft = ab.recast * (1 - Math.min(0.8, this.relic.recastCut / 100));
    a.recastFull = a.recastLeft;

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

    this.save.stats.abilityUses++;
    this.emit('ability', { unit: a, ability: ab });
    return true;
  }

  autoUse() {
    for (let i = 0; i < this.allies.length; i++) {
      if (this.canUse(i)) {
        this.autoUsedThisStage = true;
        this.useAbility(i);
      }
    }
  }

  // --- 戦闘結果 ---

  // メタルスライムを倒した時の報酬（戦闘終了を待たずその場で入る）
  grantMetalReward() {
    const stage = this.save.stage;
    const gold = goldPerBattle(stage) * METAL.goldMultiplier * (1 + this.treasureBonus() / 100);
    this.save.gold += gold;
    this.save.stats.totalGold += gold;

    const exp = expPerBattle(stage) * METAL.expMultiplier;
    for (let ci = 0; ci < this.save.chars.length; ci++) this.gainExp(ci, exp);

    this.emit('metal', { gold, exp });
  }

  treasureBonus() {
    let bonus = 0;
    for (const a of this.allies) {
      if (a.job.passive.id === 'treasure_hunter') bonus += PASSIVE.treasureHunter(a.level);
    }
    return bonus;
  }

  /**
   * ボスの装備ドロップ率(%)。100%を超えたぶんは複数ドロップになる。
   *   基本20% ＋ トレジャーハンターの半分 ＋ 実績ボーナス ＋ 装備の特殊効果
   * トレジャーハンターがゴールドに全額、ドロップに半額効くのは仕様どおり
   * （シーフは稼ぎに強く、ボス戦そのものには強くない、という位置づけ）。
   */
  dropRate() {
    let rate = BASE_DROP_RATE + this.treasureBonus() * 0.5;
    rate += bonuses(this.save).dropRateAdd + this.relic.dropRateAdd;
    for (const a of this.allies) rate += a.eff.dropRate ?? 0;
    return rate;
  }

  winBattle() {
    const stage = this.save.stage;
    const isBoss = this.isBossBattle;

    // ゴールド（トレジャーハンターは編成に入っている枠ぶん加算）
    const gold = goldPerBattle(stage) * (isBoss ? 5 : 1)
      * (1 + this.treasureBonus() / 100)
      * (1 + (bonuses(this.save).goldRateAdd + this.relic.goldRateAdd) / 100);
    this.save.gold += gold;
    this.save.stats.totalGold += gold;
    if (isBoss) {
      this.save.stats.bossKills++;
      // A：ボス撃破ごとにアレキサンドライト
      this.save.alexandrite = (this.save.alexandrite ?? 0) + ALEX_PER_BOSS;
    }

    // EXPはキャラごとに入る。
    // 以前はジョブ単位で1回だけ配っていたが（同じジョブを2枠に入れても
    // 倍にならないように）、レベルをキャラごとに持つようにしたので
    // そのままキャラの人数ぶん配ればよくなった。
    for (let ci = 0; ci < this.save.chars.length; ci++) {
      this.gainExp(ci, expPerBattle(stage) * (isBoss ? 5 : 1));
    }

    this.emit('win', { gold, isBoss });

    if (isBoss) {
      if (stage >= PROOF_DROP_STAGE) this.rollProofs();
      const drops = rollDrops(this.save, stage, this.dropRate());
      if (drops.length > 0) this.emit('drop', { items: drops });
      this.recordStageClear(stage);
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

  /** ステージをクリアしたときの実績カウント */
  recordStageClear(stage) {
    const st = this.save.stats;
    if (!this.autoUsedThisStage) st.manualStageClears++;
    if (!this.anyDownThisStage) st.flawlessStageClears++;

    // 同ジョブ4人でステージ50以上をクリア
    if (stage >= 50) {
      const jobs = partyJobs(this.save);
      if (jobs.every(id => id === jobs[0])) st.job4clear[jobs[0]] = 1;
    }
  }

  /** 「偉大な〇〇の証」。キャラごとに、いま就いているジョブの証が落ちる */
  rollProofs() {
    this.save.chars.forEach((c, ci) => {
      if (Math.random() < PROOF_DROP_RATE) {
        c.jobs[c.job].proofs++;
        this.emit('proof', { ci, jobId: c.job });
      }
    });
  }

  gainExp(ci, amount) {
    const c = this.save.chars[ci];
    const jd = jobData(this.save, ci);
    const mult = (1 + 0.5 * jd.limitBreaks)
      * (1 + (bonuses(this.save).expRateAdd + this.relic.expRateAdd) / 100);
    jd.exp += amount * mult;

    for (;;) {
      const need = expToNext(jd.level);
      if (!isFinite(need) || jd.exp < need) break;
      jd.exp -= need;
      jd.level++;
      this.emit('levelup', { ci, jobId: c.job, level: jd.level });
    }
  }

  wipe() {
    this.save.stats.wipes++;
    // 遺物はオンラインの全滅でのみ手に入る。
    // その帯を集めきっていれば空配列になり、何も起きない
    const relics = rollRelicChoices(this.save, this.save.stage);
    this.emit('wipe', { stage: this.save.stage, relics });
    this.startStage(this.save.stage);
  }
}
