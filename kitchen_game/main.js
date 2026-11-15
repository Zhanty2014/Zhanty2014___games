(async function () {
  const FILES = ["config", "rooms", "items", "recipes", "npcs", "commands"];
  const DATA = {};
  const screen = document.getElementById("screen");

  try {
    const results = await Promise.all(FILES.map(f => fetch(`./data/${f}.json`).then(r => { if (!r.ok) throw new Error(`data/${f}.json —— HTTP ${r.status}`); return r.json(); })));
    FILES.forEach((f, i) => (DATA[f] = results[i]));
  } catch (e) {
    screen.innerHTML = `<div style="color:#f85149;padding:20px;white-space:normal">⚠ 数据加载失败：${e.message}<br>请用 localhost 打开。</div>`;
    return;
  }

  VM.boot(DATA, screen);

  const itemsBar = document.getElementById("items-bar"), invBar = document.getElementById("inventory-bar"), commandsBar = document.getElementById("commands-bar"), sceneActionsBar = document.getElementById("scene-actions-bar"), hintEl = document.getElementById("hint"), mapBar = document.getElementById("map-bar"), shopSection = document.getElementById("shop-section"), shopBar = document.getElementById("shop-bar"), npcsSection = document.getElementById("npcs-section"), npcsBar = document.getElementById("npcs-bar");

  let selectedItemId = null, selectedNpcId = null;

  function renderMap() {
    const data = VM.getData(), state = VM.getState(); mapBar.innerHTML = "";
    for (const id in data.rooms) {
      const room = data.rooms[id], btn = document.createElement("button");
      btn.className = "map-btn" + (state.room === id ? " active" : ""); btn.textContent = room.name;
      btn.onclick = () => {
        if (state.room !== id) { VM.goto(id); selectedItemId = null; selectedNpcId = null; renderMap(); renderShop(); renderNpcs(); renderItems(); renderInventory(); renderCommands(); updateHint(); }
      };
      mapBar.appendChild(btn);
    }
  }

  function renderNpcs() {
    const state = VM.getState();
    if (state.room !== "dining" || state.npcs.length === 0) { npcsSection.style.display = "none"; selectedNpcId = null; return; }
    npcsSection.style.display = "block"; npcsBar.innerHTML = "";
    for (const npc of state.npcs) {
      const btn = document.createElement("button"); btn.className = "item-btn" + (selectedNpcId === npc.id ? " selected" : ""); btn.textContent = `${npc.name} (等 ${npc.patience}s) 想吃：${npc.orderName}`;
      btn.onclick = () => { selectedNpcId = (selectedNpcId === npc.id) ? null : npc.id; renderNpcs(); updateHint(); };
      npcsBar.appendChild(btn);
    }
  }

  function renderShop() {
    const state = VM.getState(), data = VM.getData();
    if (state.room !== "market") { shopSection.style.display = "none"; return; }
    shopSection.style.display = "block"; shopBar.innerHTML = "";
    const shopItems = data.rooms.market?.shop || [];
    if (shopItems.length === 0) { shopBar.innerHTML = '<span class="empty">今天没有商品。</span>'; return; }
    for (const item of shopItems) {
      const def = data.items[item.id] || {}, btn = document.createElement("button"); btn.className = "item-btn"; btn.textContent = `买 ${def.name || item.id} (${item.price}元)`;
      btn.onclick = () => { if (VM.buy(item.id, item.price)) renderInventory(); };
      shopBar.appendChild(btn);
    }
  }

  function renderItems() {
    const state = VM.getState(), data = VM.getData(); itemsBar.innerHTML = "";
    const ids = Object.keys(state.items);
    if (ids.length === 0) { itemsBar.innerHTML = '<span class="empty">台面上什么也没有</span>'; return; }
    for (const id of ids) {
      const inst = state.items[id], def = data.items[id] || {}, stateDef = (def.states || {})[inst.state] || {};
      const btn = document.createElement("button"); btn.className = "item-btn" + (selectedItemId === id ? " selected" : ""); btn.textContent = stateDef.desc || `${def.name || id}（${inst.state}）`;
      btn.onclick = () => { selectedItemId = (selectedItemId === id) ? null : id; renderItems(); renderCommands(); updateHint(); };
      itemsBar.appendChild(btn);
    }
  }

  function renderInventory() {
    const state = VM.getState(), data = VM.getData(); invBar.innerHTML = "";
    if (state.inv.length === 0) { invBar.innerHTML = '<span class="empty">（空）</span>'; return; }
    const counts = {};
    for (const item of state.inv) { const key = `${item.id}_${item.state || 'default'}`; if (!counts[key]) counts[key] = { ...item, count: 0 }; counts[key].count++; }
    for (const key in counts) {
      const item = counts[key], def = data.items[item.id] || {}, stateDef = (def.states || {})[item.state] || {};
      const btn = document.createElement("button"); btn.className = "item-btn"; btn.textContent = `${stateDef.desc || def.name || item.id} *${item.count}`;
      if (!!def.states) {
        btn.title = "点击放到台面";
        btn.onclick = () => { selectedItemId = null; VM.input(`放上台面 ${item.id}`); renderItems(); renderInventory(); renderCommands(); updateHint(); };
      } else { btn.title = "工具"; btn.style.opacity = "0.7"; btn.style.cursor = "default"; }
      invBar.appendChild(btn);
    }
  }

  function renderCommands() {
    const data = VM.getData(), state = VM.getState(); commandsBar.innerHTML = ""; sceneActionsBar.innerHTML = "";

    // 动态场景动作
    if (selectedItemId && state.items[selectedItemId]) {
      const itemInst = state.items[selectedItemId], itemDef = data.items[itemInst.id] || {}, stateDef = (itemDef.states || {})[itemInst.state] || {}, actions = stateDef.actions || {};
      for (const actionName in actions) {
        const actionCfg = actions[actionName];
        let reqTools = typeof actionCfg === 'object' ? actionCfg.requireTools : null, hasAllTools = true, missingTools = [];
        if (reqTools) { for (const t of reqTools) { if (!state.inv.some(i => i.id === t)) { missingTools.push(data.items[t]?.name || t); hasAllTools = false; } } }
        const btn = document.createElement("button"); btn.className = "cmd-btn scene-btn"; btn.textContent = actionName;
        if (!hasAllTools) {
          btn.disabled = true; btn.style.opacity = "0.4"; btn.style.cursor = "not-allowed"; btn.title = `缺少工具：${missingTools.join("、")}`;
        } else {
          btn.onclick = () => { VM.doAction(selectedItemId, actionName); renderItems(); renderInventory(); updateHint(); };
        }
        sceneActionsBar.appendChild(btn);
      }
    }

    // 基础操作
    for (const verb in data.commands) {
      const cmd = data.commands[verb];
      if (cmd.room && cmd.room !== state.room) continue;
      if (cmd.isSceneAction) continue;

      let missingTools = [];
      if (cmd.requireTools) { for (const t of cmd.requireTools) { if (!state.inv.some(i => i.id === t)) missingTools.push(data.items[t]?.name || t); } }
      const hasAllTools = missingTools.length === 0;

      const btn = document.createElement("button"); btn.textContent = verb; btn.className = "cmd-btn";
      if (!hasAllTools) {
        btn.disabled = true; btn.style.opacity = "0.4"; btn.style.cursor = "not-allowed"; btn.title = `缺少工具：${missingTools.join("、")}`;
      } else {
        btn.onclick = () => {
          if (verb === "出餐") {
            if (!selectedNpcId) return VM.out("请先在顾客列表选中要交菜的顾客！", "sys");
            if (!selectedItemId) return VM.out("请先在台面选中你要端上去的菜！", "sys");
            VM.serve(selectedNpcId, selectedItemId);
            selectedItemId = null; selectedNpcId = null;
            renderNpcs(); renderItems(); renderInventory(); renderCommands(); updateHint(); return;
          }
          let text = verb;
          if (cmd.needTarget) {
            if (!selectedItemId) return VM.out(`先在上面选一个物品，再点「${verb}」。`, "sys");
            text = `${verb} ${data.items[selectedItemId]?.name || selectedItemId}`;
          }
          VM.input(text); renderItems(); renderInventory(); renderCommands(); updateHint();
        };
      }
      commandsBar.appendChild(btn);
    }
  }

  function updateHint() {
    if (selectedNpcId) {
      const state = VM.getState(), npc = state.npcs.find(n => n.id === selectedNpcId);
      if (!npc) { selectedNpcId = null; return updateHint(); }
      hintEl.textContent = (selectedItemId && state.items[selectedItemId]) ? `准备把【${state.items[selectedItemId].name}】给 ${npc.name}，请点击基础操作里的【出餐】按钮。` : `已选中顾客：${npc.name}。请在台面选中做好的菜。`;
      return;
    }
    if (!selectedItemId) return hintEl.textContent = "提示：点击台面物品选中，下方自动出现可用动作。点击背包食材放上台面。";
    const data = VM.getData(), inst = VM.getState().items[selectedItemId];
    if (!inst) { selectedItemId = null; return updateHint(); }
    const def = data.items[selectedItemId] || {}, stateDef = (def.states || {})[inst.state] || {};
    hintEl.textContent = `已选中台面：${stateDef.desc || def.name || selectedItemId}（再次点击取消选中）`;
  }

  renderMap(); renderShop(); renderNpcs(); renderItems(); renderInventory(); renderCommands(); updateHint();
  setInterval(() => { renderMap(); renderShop(); renderNpcs(); renderItems(); renderInventory(); renderCommands(); updateHint(); }, 800);

  // ==================== 存读档 ====================
  const modal = document.getElementById("save-modal"), modalTitle = document.getElementById("modal-title"), saveInputArea = document.getElementById("save-input-area"), saveListArea = document.getElementById("save-list-area"), saveNameInput = document.getElementById("save-name-input");
  document.getElementById("btn-close-modal").onclick = () => modal.style.display = "none";
  document.getElementById("btn-open-save").onclick = () => { modal.style.display = "flex"; modalTitle.textContent = "保存进度"; saveInputArea.style.display = "block"; saveListArea.style.display = "none"; saveNameInput.value = `存档 - ${new Date().toLocaleTimeString()}`; };
  document.getElementById("btn-do-save").onclick = () => { if (VM.save(saveNameInput.value.trim())) modal.style.display = "none"; };
  document.getElementById("btn-open-load").onclick = () => { modal.style.display = "flex"; modalTitle.textContent = "读取存档"; saveInputArea.style.display = "none"; saveListArea.style.display = "block"; renderSaveList(); };
  
  function renderSaveList() {
    const saves = VM.getSaves(); saveListArea.innerHTML = "";
    if (saves.length === 0) return saveListArea.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:10px;">暂无存档</div>';
    saves.reverse().forEach(s => {
      const item = document.createElement("div"); item.className = "save-list-item";
      item.innerHTML = `<div class="save-list-info"><div class="save-list-name">${s.name}</div><div class="save-list-date">${s.date}</div></div><div class="save-list-actions"><button class="cmd-btn btn-load" style="color:var(--accent-green); border-color:var(--accent-green);">读取</button><button class="cmd-btn btn-del" style="color:#f85149; border-color:#f85149;">删除</button></div>`;
      item.querySelector(".btn-load").onclick = () => {
        if (VM.load(s.id)) { modal.style.display = "none"; selectedItemId = null; selectedNpcId = null; renderMap(); renderShop(); renderNpcs(); renderItems(); renderInventory(); renderCommands(); updateHint(); }
      };
      item.querySelector(".btn-del").onclick = () => { if (confirm("确定删除该存档吗？")) { VM.deleteSave(s.id); renderSaveList(); } };
      saveListArea.appendChild(item);
    });
  }

  // ==================== 主题切换 ====================
  const themeBtn = document.getElementById("theme-btn");
  function initTheme() {
    if (localStorage.getItem("kitchen_theme") === "dark") { document.documentElement.setAttribute("data-theme", "dark"); themeBtn.textContent = "☀️ 浅色模式"; }
    else { document.documentElement.removeAttribute("data-theme"); themeBtn.textContent = "🌙 深色模式"; }
  }
  themeBtn.onclick = () => {
    if (document.documentElement.getAttribute("data-theme") === "dark") { document.documentElement.removeAttribute("data-theme"); themeBtn.textContent = "🌙 深色模式"; localStorage.setItem("kitchen_theme", "light"); }
    else { document.documentElement.setAttribute("data-theme", "dark"); themeBtn.textContent = "☀️ 浅色模式"; localStorage.setItem("kitchen_theme", "dark"); }
  };
  initTheme();

  // ==================== 封面 ====================
  const cover = document.getElementById("cover"), startBtn = document.getElementById("start-btn");
  startBtn.onclick = () => { cover.classList.add("hidden"); setTimeout(() => cover.remove(), 500); };
})();