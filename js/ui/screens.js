// 冒険以外の画面（編成 / 装備 / 店 / 設定）
//
// 仕様は docs/spec-equipment.md と docs/spec-v0.md §9。
// 描画はすべて「その場で作り直す」方式。項目数がたかだか数百なので、
// 差分更新は入れていない（画面を開いた時と操作した時にしか呼ばれない）。

import {
  JOBS, LEVEL_CAP, ARMOR_GROUP_NAMES, WEAPON_TYPE_NAMES, proofName,
} from '../data/jobs.js';
import { expToNext, totalStats } from '../core/stats.js';
import { limitBreakCost, canLimitBreak, doLimitBreak } from '../core/save.js';
import {
  RARITIES, RARITY, SLOTS, SLOT_NAMES, STAT_NAMES, INVENTORY_CAP,
  GACHA_SINGLE_COST, GACHA_MULTI_COST, GACHA_MULTI_COUNT, GACHA_RATE_TABLE,
  catalogOf, itemStats, isMaxLevel, equippedIds, equip, unequip, equippedStats,
  levelUpCost, levelUp, levelUpMax,
  fuseMaterials, nextRarity, fuseCost, canFuse, fuse,
  candidates, grouped, sellItem, sellPrice, gachaPull,
} from '../core/inventory.js';
import { shortNum } from './render.js';

const el = (id) => document.getElementById(id);

/** 装備の強さの目安（並べ替え用）。表示はしない */
function power(item) {
  const s = itemStats(item);
  return (s.atk || 0) * 8 + (s.hp || 0) * 0.5 + (s.mp || 0) * 0.3
    + ['str', 'dex', 'vit', 'agi', 'int', 'mnd'].reduce((n, k) => n + (s[k] || 0) * 4, 0);
}

function statsLine(stats) {
  return Object.entries(stats)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${STAT_NAMES[k] ?? k} +${shortNum(v)}`)
    .join(' / ');
}

function itemLabel(item) {
  return `${item.name} <span class="rr r-${item.rarity}">${item.rarity}</span> `
    + `<span class="lv">Lv${item.level}/${RARITY[item.rarity].cap}</span>`;
}

export class Screens {
  /**
   * @param {object} state セーブデータ
   * @param {object} hooks { onChange(), onPartyChange(), toast(text) }
   */
  constructor(state, hooks = {}) {
    this.state = state;
    this.hooks = hooks;
    this.equipJob = state.party[0];
    this.partySlot = 0;

    this.sheet = el('sheet');
    this.sheetTitle = el('sheet-title');
    this.sheetBody = el('sheet-body');
    el('sheet-close').addEventListener('click', () => this.closeSheet());
    this.sheet.addEventListener('click', (e) => {
      if (e.target === this.sheet) this.closeSheet();
    });

    this.initSettings();
    this.initShop();
  }

  toast(text) { if (this.hooks.toast) this.hooks.toast(text); }
  changed() { if (this.hooks.onChange) this.hooks.onChange(); }
  /** 編成・装備が変わった＝戦闘中のステータスを組み直す必要がある */
  rebuild() { if (this.hooks.onPartyChange) this.hooks.onPartyChange(); }

  // --- 共通シート ---

  openSheet(title, build) {
    this.sheetTitle.textContent = title;
    this.sheetBody.innerHTML = '';
    build(this.sheetBody);
    this.sheet.classList.remove('hidden');
  }

  closeSheet() { this.sheet.classList.add('hidden'); }

  // ============================================================ 編成

  renderParty() {
    const root = el('party-slots');
    root.innerHTML = '';
    this.state.party.forEach((jobId, i) => {
      const job = JOBS[jobId];
      const jd = this.state.jobs[jobId];
      const b = document.createElement('button');
      b.className = 'slot' + (i === this.partySlot ? ' is-active' : '');
      b.style.setProperty('--job-color', job.color);
      b.innerHTML = `
        <span class="slot-no">${i + 1}</span>
        <span class="slot-icon">${job.icon}</span>
        <span class="slot-name">${job.short}</span>
        <span class="slot-lv">Lv${jd.level}${jd.limitBreaks ? ` ★${jd.limitBreaks}` : ''}</span>`;
      b.addEventListener('click', () => { this.partySlot = i; this.renderParty(); });
      root.appendChild(b);
    });

    const list = el('party-jobs');
    list.innerHTML = '';
    for (const jobId of this.state.unlockedJobs) {
      const job = JOBS[jobId];
      const jd = this.state.jobs[jobId];
      const inParty = this.state.party.filter(id => id === jobId).length;
      const card = document.createElement('button');
      card.className = 'card job-card' + (inParty ? ' is-in' : '');
      card.style.setProperty('--job-color', job.color);
      card.innerHTML = `
        <div class="card-head">
          <span class="ic">${job.icon}</span>
          <span class="nm">${job.name}</span>
          <span class="tag">Lv${jd.level}${jd.limitBreaks ? ` ★${jd.limitBreaks}` : ''}</span>
          ${inParty ? `<span class="tag in">編成中${inParty > 1 ? ` ×${inParty}` : ''}</span>` : ''}
        </div>
        <div class="card-sub">${job.ability.name}／${job.passive.name}</div>
        <div class="card-sub dim">${WEAPON_TYPE_NAMES[job.weaponType]}・${ARMOR_GROUP_NAMES[job.armorGroup]}防具</div>`;
      card.addEventListener('click', () => {
        this.state.party[this.partySlot] = jobId;
        this.partySlot = (this.partySlot + 1) % 4;
        this.rebuild();
        this.renderParty();
      });
      list.appendChild(card);
    }

    this.renderJobDetail();
  }

  renderJobDetail() {
    const jobId = this.state.party[this.partySlot];
    const job = JOBS[jobId];
    const jd = this.state.jobs[jobId];
    const st = totalStats(this.state, jobId);
    const cost = limitBreakCost(this.state, jobId);
    const ok = canLimitBreak(this.state, jobId);
    const need = expToNext(jd.level);

    const root = el('party-detail');
    root.innerHTML = `
      <h3 class="sub-title">${job.icon} ${job.name}<span class="hint">枠 ${this.partySlot + 1}</span></h3>
      <div class="panel">
        <div class="kv"><span>ジョブレベル</span><b>Lv${jd.level} / ${LEVEL_CAP}</b></div>
        <div class="kv"><span>次のレベルまで</span><b>${isFinite(need) ? `${shortNum(need - jd.exp)} EXP` : '—'}</b></div>
        <div class="kv"><span>限界突破</span><b>${jd.limitBreaks} 回</b></div>
        <div class="kv"><span>${proofName(jobId)}</span><b>${jd.proofs} 個</b></div>
        <hr>
        <div class="kv"><span>HP</span><b>${shortNum(st.hp)}</b></div>
        <div class="kv"><span>攻撃力</span><b>${shortNum(st.atk)}</b></div>
        ${['str', 'dex', 'vit', 'agi', 'int', 'mnd'].map(k =>
          `<div class="kv"><span>${STAT_NAMES[k]}</span><b>${shortNum(st[k])}</b></div>`).join('')}
        <hr>
        <div class="kv"><span>固有 ${job.ability.name}</span><b>${job.ability.recast}秒</b></div>
        <div class="card-sub">${job.ability.desc}</div>
        <div class="kv"><span>パッシブ ${job.passive.name}</span></div>
        <div class="card-sub">${job.passive.desc}</div>
      </div>
      <div class="panel">
        <div class="kv"><span>限界突破の条件</span></div>
        <div class="card-sub">
          Lv${LEVEL_CAP} ／ ${shortNum(cost.gold)} ギル ／
          ${proofName(jobId)} ${cost.proofs}個<br>
          達成するとLv1に戻り、HP・MP+5、他ステータス+1、獲得EXP+50%が永久に付く
        </div>
        <button class="primary" id="btn-lb" ${ok ? '' : 'disabled'}>限界突破する</button>
      </div>`;

    el('btn-lb').addEventListener('click', () => {
      if (!doLimitBreak(this.state, jobId)) return;
      this.toast(`${job.name} 限界突破！`);
      this.rebuild();
      this.renderParty();
      this.changed();
    });
  }

  // ============================================================ 装備

  renderEquip() {
    const tabs = el('equip-tabs');
    tabs.innerHTML = '';
    for (const jobId of this.state.unlockedJobs) {
      const job = JOBS[jobId];
      const b = document.createElement('button');
      b.className = 'tab' + (jobId === this.equipJob ? ' is-active' : '')
        + (this.state.party.includes(jobId) ? ' is-in' : '');
      b.innerHTML = `${job.icon}<span>${job.short}</span>`;
      b.addEventListener('click', () => { this.equipJob = jobId; this.renderEquip(); });
      tabs.appendChild(b);
    }

    const jobId = this.equipJob;
    const slots = equippedIds(this.state, jobId);
    const root = el('equip-slots');
    root.innerHTML = '';

    for (const slot of SLOTS) {
      const item = (this.state.inv.items.find(i => i.id === slots[slot])) || null;
      const card = document.createElement('div');
      card.className = 'card equip-slot' + (item ? '' : ' is-empty');
      if (item) {
        const cat = catalogOf(item.name);
        card.innerHTML = `
          <div class="card-head">
            <span class="tag slot">${SLOT_NAMES[slot]}</span>
            <span class="nm">${itemLabel(item)}</span>
          </div>
          <div class="card-sub">${statsLine(itemStats(item))}</div>
          ${cat && cat.effect ? `<div class="card-sub eff">${cat.effectName} +${cat.effectValue}</div>` : ''}
          <div class="card-actions">
            <button data-act="up">強化</button>
            <button data-act="swap">付替</button>
            <button data-act="off">外す</button>
          </div>`;
        card.querySelector('[data-act="up"]').addEventListener('click', () => this.openItem(item.id));
        card.querySelector('[data-act="off"]').addEventListener('click', () => {
          unequip(this.state, jobId, slot);
          this.rebuild(); this.renderEquip(); this.changed();
        });
      } else {
        card.innerHTML = `
          <div class="card-head">
            <span class="tag slot">${SLOT_NAMES[slot]}</span>
            <span class="nm dim">未装備</span>
          </div>
          <div class="card-actions"><button data-act="swap">選ぶ</button></div>`;
      }
      card.querySelector('[data-act="swap"]').addEventListener('click', () => this.openPicker(jobId, slot));
      root.appendChild(card);
    }

    // 合計
    const sum = equippedStats(this.state, jobId);
    const total = document.createElement('div');
    total.className = 'panel';
    total.innerHTML = `<div class="kv"><span>装備の合計</span></div>
      <div class="card-sub">${statsLine(sum) || 'なし'}</div>`;
    root.appendChild(total);

    this.renderBag();
  }

  /** 所持品一覧。名称＋レア度でまとめ、合成できるものは合成ボタンを出す */
  renderBag() {
    el('equip-count').textContent = `${this.state.inv.items.length} / ${INVENTORY_CAP}`;
    const root = el('equip-bag');
    root.innerHTML = '';

    const groups = grouped(this.state);
    if (groups.length === 0) {
      root.innerHTML = '<p class="lead">装備を持っていない。ボスを倒すか、店で引く。</p>';
      return;
    }

    for (const g of groups) {
      const cat = catalogOf(g.name);
      const need = RARITY[g.rarity].fuse;
      const mats = fuseMaterials(this.state, g.name, g.rarity).length;
      const up = nextRarity(g.rarity);
      const row = document.createElement('div');
      row.className = 'card bag-row';
      const cost = need && up ? fuseCost(g.name, g.rarity) : 0;
      row.innerHTML = `
        <div class="card-head">
          <span class="nm">${g.name} <span class="rr r-${g.rarity}">${g.rarity}</span></span>
          <span class="tag">×${g.items.length}</span>
          <span class="tag dim">${SLOT_NAMES[cat?.slot] ?? ''}${cat?.pool === 'gacha' ? '・限定' : ''}</span>
        </div>
        <div class="card-sub">${g.items.map(i => `Lv${i.level}`).join(' / ')}</div>
        ${need && up
          ? `<div class="card-sub ${mats >= need ? 'ok' : 'dim'}">合成 → ${up}：上限Lvの素材 ${mats}/${need}・${shortNum(cost)} ギル</div>`
          : '<div class="card-sub dim">これ以上は合成できない</div>'}
        <div class="card-actions">
          <button data-act="detail">個別</button>
          ${need && up ? `<button data-act="fuse" ${canFuse(this.state, g.name, g.rarity) ? '' : 'disabled'}>合成</button>` : ''}
        </div>`;
      row.querySelector('[data-act="detail"]').addEventListener('click', () => this.openGroup(g));
      const fb = row.querySelector('[data-act="fuse"]');
      if (fb) {
        fb.addEventListener('click', () => {
          const made = fuse(this.state, g.name, g.rarity);
          if (!made) return;
          this.toast(`${made.name} が ${made.rarity} になった`);
          this.rebuild(); this.renderEquip(); this.changed();
        });
      }
      root.appendChild(row);
    }
  }

  /** 部位ごとの付け替え */
  openPicker(jobId, slot) {
    const list = candidates(this.state, jobId, slot)
      .sort((a, b) => power(b) - power(a));
    const cur = equippedIds(this.state, jobId)[slot];

    this.openSheet(`${JOBS[jobId].name}／${SLOT_NAMES[slot]}`, (body) => {
      if (list.length === 0) {
        body.innerHTML = '<p class="lead">着けられる装備を持っていない。</p>';
        return;
      }
      for (const item of list) {
        const cat = catalogOf(item.name);
        const worn = this.wornBy(item.id);
        const b = document.createElement('button');
        b.className = 'card pick' + (item.id === cur ? ' is-active' : '');
        b.innerHTML = `
          <div class="card-head"><span class="nm">${itemLabel(item)}</span>
            ${worn && worn !== jobId ? `<span class="tag warn">${JOBS[worn].short}が装備中</span>` : ''}</div>
          <div class="card-sub">${statsLine(itemStats(item))}</div>
          ${cat && cat.effect ? `<div class="card-sub eff">${cat.effectName} +${cat.effectValue}</div>` : ''}`;
        b.addEventListener('click', () => {
          equip(this.state, jobId, item.id);
          this.closeSheet();
          this.rebuild(); this.renderEquip(); this.changed();
        });
        body.appendChild(b);
      }
    });
  }

  /** その装備を着けているジョブ（いなければ null） */
  wornBy(itemId) {
    for (const [jid, slots] of Object.entries(this.state.inv.equipped)) {
      if (Object.values(slots).includes(itemId)) return jid;
    }
    return null;
  }

  /** 同名・同レア度のまとまりを開く */
  openGroup(g) {
    this.openSheet(`${g.name}（${g.rarity}）`, (body) => {
      for (const item of [...g.items].sort((a, b) => b.level - a.level)) {
        body.appendChild(this.itemPanel(item));
      }
    });
  }

  openItem(itemId) {
    const item = this.state.inv.items.find(i => i.id === itemId);
    if (!item) return;
    this.openSheet(item.name, (body) => body.appendChild(this.itemPanel(item)));
  }

  /** 装備1本ぶんのパネル（強化・売却） */
  itemPanel(item) {
    const cat = catalogOf(item.name);
    const box = document.createElement('div');
    box.className = 'panel';
    const worn = this.wornBy(item.id);
    const maxed = isMaxLevel(item);
    const cost = maxed ? 0 : levelUpCost(item);

    box.innerHTML = `
      <div class="card-head"><span class="nm">${itemLabel(item)}</span>
        ${worn ? `<span class="tag in">${JOBS[worn].short}が装備中</span>` : ''}</div>
      <div class="card-sub">${statsLine(itemStats(item))}</div>
      ${cat && cat.effect ? `<div class="card-sub eff">${cat.effectName} +${cat.effectValue}</div>` : ''}
      <div class="card-sub dim">${maxed
        ? '上限レベル。同じ名称を集めれば合成できる'
        : `次のレベルまで ${shortNum(cost)} ギル`}</div>
      <div class="card-actions">
        <button data-act="up1" ${maxed || this.state.gold < cost ? 'disabled' : ''}>強化 +1</button>
        <button data-act="upmax" ${maxed || this.state.gold < cost ? 'disabled' : ''}>払えるだけ</button>
        <button data-act="sell" class="danger" ${worn ? 'disabled' : ''}>売却 ${shortNum(sellPrice(item.name, item.rarity, item.level))}</button>
      </div>`;

    const refresh = () => {
      const parent = box.parentNode;
      const next = this.itemPanel(item);
      if (parent) parent.replaceChild(next, box);
    };

    box.querySelector('[data-act="up1"]').addEventListener('click', () => {
      if (!levelUp(this.state, item.id)) return;
      this.rebuild(); this.changed(); this.renderEquip(); refresh();
    });
    box.querySelector('[data-act="upmax"]').addEventListener('click', () => {
      const n = levelUpMax(this.state, item.id);
      if (n > 0) this.toast(`${item.name} を Lv${item.level} まで強化`);
      this.rebuild(); this.changed(); this.renderEquip(); refresh();
    });
    box.querySelector('[data-act="sell"]').addEventListener('click', () => {
      const price = sellItem(this.state, item.id);
      if (price <= 0) return;
      this.toast(`売却 +${shortNum(price)} ギル`);
      this.closeSheet();
      this.renderEquip(); this.changed();
    });
    return box;
  }

  // ============================================================ 店

  initShop() {
    const root = el('shop-actions');
    root.innerHTML = `
      <button class="primary" data-n="1">単発　💎${GACHA_SINGLE_COST}</button>
      <button class="primary" data-n="11">${GACHA_MULTI_COUNT}連　💎${GACHA_MULTI_COST}<span class="sub">SR以上1枠確定</span></button>`;
    root.querySelector('[data-n="1"]').addEventListener('click', () => this.pull(false));
    root.querySelector('[data-n="11"]').addEventListener('click', () => this.pull(true));

    el('shop-rates').innerHTML = GACHA_RATE_TABLE
      .map(([r, p]) => `<div class="kv"><span class="rr r-${r}">${r}</span><b>${(p * 100).toFixed(1)}%</b></div>`)
      .join('');
  }

  renderShop() {
    const root = el('shop-actions');
    for (const b of root.querySelectorAll('button')) {
      const cost = b.dataset.n === '1' ? GACHA_SINGLE_COST : GACHA_MULTI_COST;
      b.disabled = (this.state.alexandrite ?? 0) < cost;
    }
  }

  pull(multi) {
    const out = gachaPull(this.state, multi);
    if (!out) { this.toast('アレキサンドライトが足りない'); return; }

    const root = el('shop-result');
    root.innerHTML = '';
    for (const r of out) {
      const d = document.createElement('div');
      d.className = `gacha-item r-${r.rarity}` + (r.sold ? ' is-sold' : '');
      d.innerHTML = `<span class="rr r-${r.rarity}">${r.rarity}</span>
        <span class="nm">${r.name}</span>
        ${r.sold ? '<span class="tag dim">自動売却</span>' : ''}`;
      root.appendChild(d);
    }
    const best = out.reduce((m, r) =>
      (RARITIES.indexOf(r.rarity) > RARITIES.indexOf(m) ? r.rarity : m), 'N');
    this.toast(`モグボナンザ：最高 ${best}`);
    this.renderShop();
    this.renderEquip();
    this.changed();
  }

  // ============================================================ 設定

  initSettings() {
    const sel = el('autosell');
    sel.innerHTML = '<option value="">しない</option>'
      + RARITIES.slice(0, 4).map(r => `<option value="${r}">${r} 以下</option>`).join('');
    sel.value = this.state.inv.autoSell || '';
    sel.addEventListener('change', () => {
      this.state.inv.autoSell = sel.value;
      this.changed();
    });
  }
}
