/* ============================================================
 * main.js —— 加载数据 + 启动 VM + 渲染 UI
 * ============================================================ */
(async function () {
  const FILES = ["config", "rooms", "items", "recipes", "npcs", "commands"];
  const DATA = {};
  const screen = document.getElementById("screen");

  try {
    const results = await Promise.all(
      FILES.map(f => fetch(`./data/${f}.json`).then(r => {
        if (!r.ok) throw new Error(`data/${f}.json —— HTTP ${r.status}`);
        return r.json();
      }))
    );
    FILES.forEach((f, i) => (DATA[f] = results[i]));
  } catch (e) {
    screen.innerHTML = `<div style="color:#f85149;padding:20px;white-space:normal">⚠ 数据加载失败：${e.message}<br>请用 localhost 打开。</div>`;
    return;
  }

  VM.boot(DATA, screen);

  const itemsBar    = document.getElementById("items-bar");
  const invBar      = document.getElementById("inventory-bar");
  const commandsBar = document.getElementById("commands-bar");
  const sceneActionsBar = document.getElementById("scene-actions-bar");
  const hintEl      = document.getElementById("hint");
  const mapBar      = document.getElementById("map-bar");
  const shopSection = document.getElementById("shop-section");
  const shopBar     = document.getElementById("shop-bar");
  const npcsSection = document.getElementById("npcs-section");
  const npcsBar     = document.getElementById("npcs-bar");

  let selectedItemId = null;
  let selectedNpcId  = null; // 记录选中的顾客

  function renderMap() {
    const data = VM.getData();
    const state = VM.getState();
    mapBar.innerHTML = "";
    for (const id in data.rooms) {
      const room = data.rooms[id];
      const btn = document.createElement("button");
      btn.className = "map-btn" + (state.room === id ? " active" : "");
      btn.textContent = room.name;
      btn.onclick = () => {
        if (state.room !== id) {
          VM.goto(id);
          renderMap();
          renderShop(); 
          renderNpcs();
          renderItems();
          renderInventory();
          renderCommands();
          updateHint();
        }
      };
      mapBar.appendChild(btn);
    }
  }

  /* ---------- 渲染：顾客列表 ---------- */
  function renderNpcs() {
    const state = VM.getState();
    
    if (state.room !== "dining" || state.npcs.length === 0) {
      npcsSection.style.display = "none";
      selectedNpcId = null;
      return;
    }
    
    npcsSection.style.display = "block";
    npcsBar.innerHTML = "";

    for (const npc of state.npcs) {
      const btn = document.createElement("button");
      btn.className = "item-btn" + (selectedNpcId === npc.id ? " selected" : "");
      // 这里直接读 npc.orderName
      btn.textContent = `${npc.name} (等 ${npc.patience}s) 想吃：${npc.orderName}`;
      
      btn.onclick = () => {
        selectedNpcId = (selectedNpcId === npc.id) ? null : npc.id;
        renderNpcs();
        updateHint();
      };
      npcsBar.appendChild(btn);
    }
  }

  function renderShop() {
    const state = VM.getState();
    const data = VM.getData();
    if (state.room !== "market") {
      shopSection.style.display = "none";
      return;
    }
    shopSection.style.display = "block";
    shopBar.innerHTML = "";
    const shopItems = data.rooms.market?.shop || [];
    if (shopItems.length === 0) {
      shopBar.innerHTML = '<span class="empty">今天没有商品。</span>';
      return;
    }
    for (const item of shopItems) {
      const def = data.items[item.id] || {};
      const btn = document.createElement("button");
      btn.className = "item-btn";
      btn.textContent = `买 ${def.name || item.id} (${item.price}元)`;
      btn.onclick = () => {
        const success = VM.buy(item.id, item.price);
        if (success) renderInventory();
      };
      shopBar.appendChild(btn);
    }
  }

  function renderItems() {
    const state = VM.getState();
    const data  = VM.getData();
    itemsBar.innerHTML = "";
    const ids = Object.keys(state.items);
    if (ids.length === 0) {
      itemsBar.innerHTML = '<span class="empty">台面上什么也没有</span>';
      return;
    }
    for (const id of ids) {
      const inst = state.items[id];
      const def  = data.items[id] || {};
      const stateDef = (def.states || {})[inst.state] || {};
      const label = stateDef.desc || `${def.name || id}（${inst.state}）`;
      const btn = document.createElement("button");
      btn.className = "item-btn" + (selectedItemId === id ? " selected" : "");
      btn.textContent = label;
      btn.onclick = () => {
        selectedItemId = (selectedItemId === id) ? null : id;
        renderItems();
        updateHint();
      };
      itemsBar.appendChild(btn);
    }
  }

  function renderInventory() {
    const state = VM.getState();
    const data  = VM.getData();
    invBar.innerHTML = "";
    if (state.inv.length === 0) {
      invBar.innerHTML = '<span class="empty">（空）</span>';
      return;
    }
    const counts = {};
    for (const item of state.inv) {
      const key = `${item.id}_${item.state || 'default'}`;
      if (!counts[key]) counts[key] = { ...item, count: 0 };
      counts[key].count++;
    }
    for (const key in counts) {
      const item = counts[key];
      const def = data.items[item.id] || {};
      const stateDef = (def.states || {})[item.state] || {};
      const label = stateDef.desc || def.name || item.id;
      const isIngredient = !!def.states;
      const btn = document.createElement("button");
      btn.className = "item-btn";
      btn.textContent = `${label} *${item.count}`;
      if (isIngredient) {
        btn.title = "点击放到台面";
        btn.onclick = () => {
          selectedItemId = null;
          VM.input(`放上台面 ${item.id}`);
          renderItems();
          renderInventory();
          updateHint();
        };
      } else {
        btn.title = "工具";
        btn.style.opacity = "0.7";
        btn.style.cursor = "default";
      }
      invBar.appendChild(btn);
    }
  }

  function renderCommands() {
    const data = VM.getData();
    const state = VM.getState();
    commandsBar.innerHTML = "";
    sceneActionsBar.innerHTML = "";

    for (const verb in data.commands) {
      const cmd = data.commands[verb];
      if (cmd.room && cmd.room !== state.room) continue;

      let missingTools = [];
      if (cmd.requireTools) {
        for (const t of cmd.requireTools) {
          if (!state.inv.some(i => i.id === t)) missingTools.push(data.items[t]?.name || t);
        }
      }
      const hasAllTools = missingTools.length === 0;

      const btn = document.createElement("button");
      btn.textContent = verb;
      btn.className = cmd.isSceneAction ? "cmd-btn scene-btn" : "cmd-btn";

      if (!hasAllTools) {
        btn.disabled = true;
        btn.style.opacity = "0.4";
        btn.style.cursor = "not-allowed";
        btn.title = `缺少工具：${missingTools.join("、")}`;
      } else {
        btn.onclick = () => {
          // 拦截出餐命令
          if (verb === "出餐") {
            if (!selectedNpcId) {
              VM.out("请先在顾客列表选中要交菜的顾客！", "sys");
              return;
            }
            if (!selectedItemId) {
              VM.out("请先在台面选中你要端上去的菜！", "sys");
              return;
            }
            VM.serve(selectedNpcId, selectedItemId);
            selectedItemId = null;
            selectedNpcId = null;
            renderNpcs();
            renderItems();
            renderInventory();
            updateHint();
            return;
          }

          let text = verb;
          if (cmd.needTarget) {
            if (!selectedItemId) {
              VM.out(`先在上面选一个物品，再点「${verb}」。`, "sys");
              return;
            }
            const def = data.items[selectedItemId];
            text = `${verb} ${def?.name || selectedItemId}`;
          }
          VM.input(text);
          renderItems();
          renderInventory();
          updateHint();
        };
      }

      if (cmd.isSceneAction) sceneActionsBar.appendChild(btn);
      else commandsBar.appendChild(btn);
    }
  }

  function updateHint() {
    if (selectedNpcId) {
      const state = VM.getState();
      const npc = state.npcs.find(n => n.id === selectedNpcId);
      if (selectedItemId) {
        const item = state.items[selectedItemId];
        hintEl.textContent = `准备把【${item.name}】给 ${npc.name}，请点击上方【出餐】按钮。`;
      } else {
        hintEl.textContent = `已选中顾客：${npc.name}。请在台面选中做好的菜。`;
      }
      return;
    }

    if (!selectedItemId) {
      hintEl.textContent = "提示：先点台面物品选中，再点操作。点击背包里的食材可以直接放到台面。";
      return;
    }
    const data = VM.getData();
    const inst = VM.getState().items[selectedItemId];
    const def  = data.items[selectedItemId] || {};
    const stateDef = (def.states || {})[inst.state] || {};
    hintEl.textContent = `已选中台面：${stateDef.desc || def.name || selectedItemId}（再次点击取消）`;
  }

  // 初始渲染
  renderMap();
  renderShop(); 
  renderNpcs();
  renderItems();
  renderInventory();
  renderCommands();
  updateHint();

  // 定时刷新 UI
  setInterval(() => {
    renderMap();
    renderShop(); 
    renderNpcs();
    renderItems();
    renderInventory();
    renderCommands();
    updateHint();
  }, 800);

  // ==================== 新增：存读档 UI 逻辑 ====================
  const modal = document.getElementById("save-modal");
  const modalTitle = document.getElementById("modal-title");
  const saveInputArea = document.getElementById("save-input-area");
  const saveListArea = document.getElementById("save-list-area");
  const saveNameInput = document.getElementById("save-name-input");

  // 关闭弹窗
  document.getElementById("btn-close-modal").onclick = () => {
    modal.style.display = "none";
  };

  // 打开存档弹窗
  document.getElementById("btn-open-save").onclick = () => {
    modal.style.display = "flex";
    modalTitle.textContent = "保存游戏进度";
    saveInputArea.style.display = "block";
    saveListArea.style.display = "none";
    // 默认名字
    saveNameInput.value = `厨房历险 - ${new Date().toLocaleTimeString()}`;
  };

  // 确认存档
  document.getElementById("btn-do-save").onclick = () => {
    const name = saveNameInput.value.trim();
    if (VM.save(name)) {
      modal.style.display = "none";
    }
  };

  // 打开读档弹窗
  document.getElementById("btn-open-load").onclick = () => {
    modal.style.display = "flex";
    modalTitle.textContent = "选择要读取的存档";
    saveInputArea.style.display = "none";
    saveListArea.style.display = "block";
    renderSaveList();
  };

  // 渲染存档列表
  function renderSaveList() {
    const saves = VM.getSaves();
    saveListArea.innerHTML = "";
    if (saves.length === 0) {
      saveListArea.innerHTML = '<div style="color:#8b949e;text-align:center;padding:10px;">暂无存档</div>';
      return;
    }

    // 倒序显示（最新的在最上面）
    saves.reverse().forEach(s => {
      const item = document.createElement("div");
      item.className = "save-list-item";
      item.innerHTML = `
        <div class="save-list-info">
          <div class="save-list-name">${s.name}</div>
          <div class="save-list-date">${s.date}</div>
        </div>
        <div class="save-list-actions">
          <button class="cmd-btn btn-load" style="color:#3fb950; border-color:#3fb950;">读取</button>
          <button class="cmd-btn btn-del" style="color:#f85149; border-color:#f85149;">删除</button>
        </div>
      `;
      
      // 读取按钮
      item.querySelector(".btn-load").onclick = () => {
        if (VM.load(s.id)) {
          modal.style.display = "none";
          // 读档后必须刷新整个页面 UI
          renderMap();
          renderShop();
          renderNpcs();
          renderItems();
          renderInventory();
          renderCommands();
          updateHint();
        }
      };

      // 删除按钮
      item.querySelector(".btn-del").onclick = () => {
        if (confirm("确定要删除这个存档吗？")) {
          VM.deleteSave(s.id);
          renderSaveList(); // 重新渲染列表
        }
      };

      saveListArea.appendChild(item);
    });
  }

  // ==================== 封面开始逻辑 ====================
  const cover = document.getElementById("cover");
  const startBtn = document.getElementById("start-btn");
  startBtn.onclick = () => {
    cover.classList.add("hidden");
    setTimeout(() => cover.remove(), 500);
  };
})();