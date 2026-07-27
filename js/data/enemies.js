// 敵の数値テーブル
//
// 仕様 §8.1 準拠。敵HPは「戦闘全体の総HP」を敵数で割る方式にしてあるので、
// 敵が何体出ても1戦闘の総量は変わらない。

const NORMAL_ICONS = ['🦇', '🐺', '🕷️', '🐍', '🦂', '🐗', '🧟', '🦀', '🐙', '🦎'];
const BOSS_ICONS = ['👹', '🐉', '👺', '🦖', '👾'];

const NORMAL_NAMES = [
  'コウモリ', 'ワーウルフ', 'クロウラー', 'サーペント', 'スコーピオン',
  'ボア', 'グール', 'クラブ', 'クラーケン', 'リザード',
];
const BOSS_NAMES = ['オーガ', 'ドラゴン', 'テング', 'ベヒーモス', 'アダマンタス'];

// --- 伸び率：すべて「ステージ番号のべき乗」 ---
//
// 以前はすべて指数（1.09^n / 1.16^n など）だった。指数どうしを噛み合わせる設計は
// 定数を 0.01 動かすだけで壁が10ステージ以上ずれるうえ、数値が桁で暴走する。
// 実際、EXPだけ指数を下げ忘れていたせいで、ステージ100の1戦闘の獲得EXPが
// 「Lv1→75に必要な総EXPの6倍」という状態になっていた。
//
// そこで全部を **n^p（べき乗）** に置き換えた。
//   ・伸びが進むほど緩やかになるので、プレイヤーの上限のある強化
//     （レベル75・装備UR Lv50・遺物40個）と噛み合う
//   ・ステージ100でも5〜6桁に収まり、数字が読める
//   ・指数を 0.05 動かしても壁は数ステージしか動かず、調整が効く
//
// 目標：何度か全滅しながら遺物を集め、ステージ100前後に到達する。

// 素の n^p は序盤が急すぎる（ステージ10で22倍）。
// 原点をずらした ((n + SHIFT) / (1 + SHIFT))^p を使うと、
// 序盤はゆるやかで、進むほど相対的な伸びが落ちる形になる。
const SHIFT = 15;

// 実測（各3回・詰まったら遺物を取る方針）
//   指数2.2 → 到達147〜149（緩すぎて15時間かかる）
//   指数2.6 → 到達86〜95
//   指数3.0 → 到達96〜107・全滅14〜28回・遺物10〜20個・Lv75はステージ73  ← 採用
//   指数3.4 → 到達33〜71（不安定）
const HP_EXP = 3.0;     // 総HP。1ステージの所要時間を決める
const ATK_EXP = 3.3;    // 敵ATK。⚠ HPより速い＝進むほど死にやすい（全滅＝遺物の入口）
const GOLD_EXP = 3.0;   // ギル。装備の強化費用の基準なのでHPに合わせる
const EXP_EXP = 3.0;    // EXP。Lv75にいつ届くかを決める

/** ステージ1で1になり、進むほど大きくなる倍率 */
function curve(stage, exp) {
  return Math.pow((stage + SHIFT) / (1 + SHIFT), exp);
}

// 1戦闘あたりの総HP
export function totalHp(stage) {
  return 110 * curve(stage, HP_EXP);
}

// 攻撃力は総HPより速く伸ばす。
// 同じ伸びにすると、進行が止まるときの止まり方が
// 「時間がかかるだけで誰も死なない」になり、全滅がほとんど起きなくなる。
// 遺物は全滅でしか手に入らないので、それでは遺物が開かない。
export function enemyAtk(stage) {
  return 5 * curve(stage, ATK_EXP);
}

// 防御は 100/(100+DEF) で軽減率に効くので、指数で伸ばすと
// プレイヤーの攻撃力がいくら伸びても軽減され続けて詰む。線形にしてある。
export function enemyDef(stage) {
  return 2 + stage * 3;
}
// 命中率の計算に使う。指数で伸ばすと当たらなくなるので線形。
export function enemyAgi(stage) {
  return 2 + stage * 1.2;
}

// ギルは装備の強化費用の基準にもなっている（core/inventory.js の baseCost）。
// 敵と同じ伸びにしておくと、帯が変わっても「1レベル上げるのに何戦ぶん」が変わらない。
export function goldPerBattle(stage) {
  return 8 * curve(stage, GOLD_EXP);
}

// 必要EXPは 40 × Lv^1.9（Lv75までの総量は約370万）。
// 収入もべき乗にしたので、レベルは最後まで「じわじわ上がるもの」であり続ける。
// 指数だった頃は終盤の1戦闘でLv75ぶんが丸ごと入り、
// 遺物のレベル代償（-15）が無意味になっていた。
export function expPerBattle(stage) {
  return 9 * curve(stage, EXP_EXP);
}

// --- レア枠：メタルスライム ---
//
// 魔法は一切通らず、物理は当たっても1ダメージ固定。
// つまり「攻撃力」ではなく「手数」だけが意味を持つ敵になる。
// 一定時間で逃げるので、手数の足りない編成は取り逃がす。

export const METAL = {
  icon: '🩶',
  name: 'メタルスライム',
  rate: 0.01,        // 通常戦闘に出現する確率
  hp: 10,            // ステージに依らず固定（物理1ダメージなので実質「必要な手数」）
  escapeIn: 10,      // 秒。これを過ぎると逃げる
  expMultiplier: 25, // 1戦闘ぶんのEXPに対する倍率
  goldMultiplier: 3,
};

function makeMetalSlime() {
  return {
    id: 'metal',
    isBoss: false,
    isMetal: true,
    magicImmune: true,   // 魔法を一切受け付けない
    flatDamage: 1,       // 物理は必ず1ダメージ
    icon: METAL.icon,
    name: METAL.name,
    maxHp: METAL.hp,
    hp: METAL.hp,
    atk: 0,              // 攻撃してこない
    def: 0,
    mdef: 0,
    agi: 0,
    speed: 0,            // 行動しない
    gauge: 0,
    aoeTimer: Infinity,
    escapeIn: METAL.escapeIn,
    debuff: null,
    alive: true,
  };
}

export const BATTLES_PER_STAGE = 10;
export const BOSS_HP_MULTIPLIER = 15;
export const BOSS_AOE_INTERVAL = 20;   // 秒
export const BOSS_AOE_MULTIPLIER = 1.5;
export const PROOF_DROP_STAGE = 25;
export const PROOF_DROP_RATE = 0.08;

// その戦闘に出る敵の数（ステージが上がるほど多めに寄る）
export function rollEnemyCount(stage) {
  const bias = Math.min(2, (stage - 1) / 15);
  const roll = Math.random() * (3 + bias) + 1 + bias * 0.5;
  return Math.max(1, Math.min(5, Math.round(roll)));
}

export function makeEnemies(stage, battleIndex) {
  const isBoss = battleIndex === BATTLES_PER_STAGE - 1;
  // ボス戦にはメタルスライムは出さない
  const withMetal = !isBoss && Math.random() < METAL.rate;
  // 画面に並ぶのは最大5体なので、混ざる時は通常敵を4体までにする
  const count = isBoss ? 1 : Math.min(rollEnemyCount(stage), withMetal ? 4 : 5);
  const total = totalHp(stage) * (isBoss ? BOSS_HP_MULTIPLIER : 1);
  const hpEach = total / count;
  const pool = Math.floor((stage - 1) / 3);

  const list = [];
  for (let i = 0; i < count; i++) {
    const idx = (pool + i) % NORMAL_ICONS.length;
    const bidx = Math.floor((stage - 1) / 5) % BOSS_ICONS.length;
    list.push({
      id: `e${i}`,
      isBoss,
      icon: isBoss ? BOSS_ICONS[bidx] : NORMAL_ICONS[idx],
      name: isBoss ? BOSS_NAMES[bidx] : NORMAL_NAMES[idx],
      maxHp: hpEach,
      hp: hpEach,
      atk: enemyAtk(stage) * (isBoss ? 1.2 : 1),
      def: enemyDef(stage),
      mdef: enemyDef(stage),
      agi: enemyAgi(stage),
      speed: isBoss ? 0.9 : 0.8,
      gauge: Math.random() * 0.3,
      aoeTimer: BOSS_AOE_INTERVAL,
      debuff: null,        // { defDown, speedDown, left }
      alive: true,
    });
  }
  if (withMetal) list.push(makeMetalSlime());
  return list;
}
