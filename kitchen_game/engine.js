/* ============================================================
 * engine.js —— 虚拟机（解释器）
 * ============================================================ */
const VM = (function () {
  let DATA = null;
  let state = null;
  let outEl = null;
  let timer = null;

  function out(text, cls) {
    const line = document.createElement("div");
    line.className = "line" + (cls ? " " + cls : "");
    line.textContent = text;
    outEl.appendChild(line);
    outEl.scrollTop = outEl.scrollHeight;
  }

  function getPath(obj, path) {
    if (!obj || !path) return undefined;
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  
  function setPath(obj, path, val) {
    const keys = path.split(".");
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (cur[keys[i]] == null) cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = val;
  }

  function render(text, ctx) {
    if (text == null) return "";
    return String(text).replace(/\{([^}]+)\}/g, (_, expr) => {
      expr = expr.trim();
      if (expr === "inventory") {
        if (!state.inv.length) return "（空）";
        return state.inv.map(i => {
          const def = DATA.items[i.id] || {};
          const stateDef = (def.states || {})[i.state] || {};
          return stateDef.desc || def.name || i.id;
        }).join("、");
      }
      if (expr === "money") return String(Number(state.money.toFixed(2)));
      if (expr === "room.name") return DATA.rooms[state.room]?.name || state.room;
      if (expr === "room.desc") return DATA.rooms[state.room]?.desc || "";
      const v = getPath(ctx, expr) ?? getPath(state, expr);
      return v == null ? "" : String(v);
    });
  }

  const CMP = {
    ">=": (a, b) => a >= b, "<=": (a, b) => a <= b, ">": (a, b) => a > b,
    "<": (a, b) => a < b, "==": (a, b) => a === b, "!=": (a, b) => a !== b
  };

  function evalCond(cond, ctx) {
    if (cond == null) return true;
    if (typeof cond === "boolean") return cond;
    if (cond.and) return cond.and.every(c => evalCond(c, ctx));
    if (cond.or)  return cond.or.some(c => evalCond(c, ctx));
    if (cond.not) return !evalCond(cond.not, ctx);
    if (cond.has !== undefined) return state.inv.some(i => i.id === cond.has);
    if (cond.state !== undefined) {
      const val = getPath(ctx, cond.state) ?? getPath(state, cond.state);
      const op = Object.keys(cond).find(k => CMP[k]);
      if (!op) return val != null;
      return CMP[op](val, cond[op]);
    }
    return Object.keys(cond).every(k => {
      const val = getPath(ctx, k) ?? getPath(state, k);
      return val === cond[k];
    });
  }

  const OPS = {
    say(ctx, ins) { out(render(ins.text, ctx)); },
    
    give(ctx, ins) {
      const def = DATA.items[ins.item] || {};
      const newItem = { id: ins.item, name: def.name || ins.item, state: ins.state || "raw" };
      if (ins.to === "table") {
        state.items[ins.item] = newItem;
        out(`[台面] 多了一个 ${def.name || ins.item}`);
      } else {
        state.inv.push(newItem);
        out(`[背包] 获得了 ${def.name || ins.item}`);
      }
    },

    remove(ctx, ins) {
      const itemId = ins.item || (ctx.target ? ctx.target.id : null);
      if (!itemId) return;
      if (ins.from === "table") delete state.items[itemId];
      else {
        const i = state.inv.findIndex(item => item.id === itemId);
        if (i >= 0) state.inv.splice(i, 1);
      }
    },

    place(ctx, ins) {
      const itemId = ins.item || (ctx.target ? ctx.target.id : null);
      if (!itemId) return;
      if (state.items[itemId]) {
        out(`台面上已经有 ${DATA.items[itemId]?.name || itemId} 了。`, "sys");
        return;
      }
      const i = state.inv.findIndex(item => item.id === itemId);
      if (i >= 0) {
        const item = state.inv[i];
        state.items[itemId] = item;
        state.inv.splice(i, 1);
        const def = DATA.items[itemId] || {};
        const stateDef = (def.states || {})[item.state] || {};
        out(`[台面] 把 ${stateDef.desc || def.name || itemId} 放在了台面上。`, "sys");
      }
    },    
    
    pick(ctx, ins) {
      const itemId = ins.item || (ctx.target ? ctx.target.id : null);
      if (!itemId) return;
      
      if (state.items[itemId]) {
        const item = state.items[itemId];
        state.inv.push(item);
        delete state.items[itemId];
        
        const def = DATA.items[itemId] || {};
        const stateDef = (def.states || {})[item.state] || {};
        out(`[背包] 把 ${stateDef.desc || def.name || itemId} 收回了背包。`, "sys");
      }
    },

    set(ctx, ins) {
      if (ins.path.startsWith("target.") && ctx.target) {
        setPath(ctx.target, ins.path.slice(7), ins.value);
      } else {
        setPath(state, ins.path, ins.value);
      }
    },
    
    add(ctx, ins) {
      const cur = getPath(state, ins.path) || 0;
      setPath(state, ins.path, cur + ins.value);
    },

    if(ctx, ins) { run(evalCond(ins.cond, ctx) ? ins.then : ins.else, ctx); },
    
    goto(ctx, ins) {
      state.room = ins.room;
      const room = DATA.rooms[ins.room];
      if (room) {
        out(`—— ${room.name} ——`, "sys");
        if (room.desc) out(render(room.desc, ctx), "sys");
        if (room.onEnter) run(room.onEnter, makeCtx({ room }));
      }
    },

        spawn(ctx, ins) {
      let npcId = ins.npc;
      
      // 如果没有指定具体 NPC，或者指定了 "random"，就随机抽一个
      if (!npcId || npcId === "random") {
        const keys = Object.keys(DATA.npcs);
        npcId = keys[Math.floor(Math.random() * keys.length)];
      }

      const def = DATA.npcs[npcId];
      if (!def) return;
      
      // 检查是否有已解锁的菜谱
      if (state.unlockedRecipes.length === 0) {
        out(`${def.name || npcId}推门进来，看了看空荡荡的菜单：“不是咋没菜，走了走了。”`, "sys");
        return;
      }

      // 随机取一个解锁的菜谱
      const randomIndex = Math.floor(Math.random() * state.unlockedRecipes.length);
      const randomRecipeId = state.unlockedRecipes[randomIndex];
      const recipeDef = DATA.recipes[randomRecipeId];
      
      const npc = { 
        id: npcId, 
        name: def.name || npcId, 
        patience: def.patience ?? 60,
        order: randomRecipeId,
        orderName: recipeDef ? recipeDef.name : randomRecipeId
      };
      
      state.npcs.push(npc);
      if (def.onSpawn) run(def.onSpawn, makeCtx({ self: npc }));
    },

    wait(ctx, ins) {
      setTimeout(() => run(ins.then, ctx), (ins.sec || 1) * 1000);
    },

    craft(ctx, ins) {
      for (const rId in DATA.recipes) {
        const r = DATA.recipes[rId];
        if (!state.unlockedRecipes.includes(rId)) continue;
        
        let match = true;
        const reqKeys = Object.keys(r.ingredients);
        const tableKeys = Object.keys(state.items);

        if (reqKeys.length !== tableKeys.length) match = false;
        else {
          for (const ingId of reqKeys) {
            if (!state.items[ingId] || state.items[ingId].state !== r.ingredients[ingId]) {
              match = false; break;
            }
          }
        }
        
        if (match) {
          for (const ingId in r.ingredients) delete state.items[ingId];
          const resDef = DATA.items[r.result] || {};
          state.items[r.result] = { id: r.result, name: resDef.name || r.result, state: "dish" };
          out(`[装盘成功] 你做了一份 ${resDef.name || rId}！`, "sys");
          return;
        }
      }
      out("台面上的食材组合不满足任何【已解锁】的菜谱。", "sys");
    },

    research(ctx, ins) {
      const itemsOnTable = Object.keys(state.items);
      if (itemsOnTable.length === 0) {
        out("台面上没有食材，无法研发。", "sys");
        return;
      }

      let matchedRecipeId = null;
      let isAlreadyUnlocked = false;

      for (const rId in DATA.recipes) {
        const r = DATA.recipes[rId];
        const reqKeys = Object.keys(r.ingredients);
        
        let match = true;
        if (reqKeys.length !== itemsOnTable.length) {
          match = false;
        } else {
          for (const ingId of reqKeys) {
            if (!state.items[ingId] || state.items[ingId].state !== r.ingredients[ingId]) {
              match = false; break;
            }
          }
        }

        if (match) {
          if (state.unlockedRecipes.includes(rId)) {
            isAlreadyUnlocked = true;
          } else {
            matchedRecipeId = rId;
          }
          break;
        }
      }

      if (matchedRecipeId) {
        const r = DATA.recipes[matchedRecipeId];
        for (const ingId in r.ingredients) delete state.items[ingId];
        state.unlockedRecipes.push(matchedRecipeId);
        
        const resDef = DATA.items[r.result] || {};
        state.items[r.result] = { id: r.result, name: resDef.name || r.result, state: "dish" };
        
        out(`你把这堆食材下锅试了试，尝了一口，惊呼：“绝了！”`, "sys");
        out(`[研发成功] 掌握了【${r.name}】的做法，并直接做了一份！`, "sys");
      } else if (isAlreadyUnlocked) {
        out("这个配方你早就背熟了，别浪费食材了，直接去点【装盘】！", "sys");
      } else {
        for (const ingId of itemsOnTable) delete state.items[ingId];
        out("你尝了一口……yue！这什么黑暗料理！", "sys");
        out("[研发失败] 浪费了台面上的所有食材（不返还）。", "sys");
      }
    },

    end() {}
  };

  function run(program, ctx) {
    if (!program) return;
    if (!Array.isArray(program)) program = [program];
    for (const ins of program) {
      if (!ins || !ins.op) continue;
      const fn = OPS[ins.op];
      if (!fn) { out(`[未知指令: ${ins.op}]`, "sys"); continue; }
      try { fn(ctx, ins); } catch (e) { out(`[出错 ${ins.op}: ${e.message}]`, "sys"); }
    }
  }

  function makeCtx(extra) {
    return Object.assign({ state, room: DATA.rooms[state.room], target: null, self: null }, extra || {});
  }

  function resolveItem(name) {
    if (!name) return null;
    if (state.items[name]) return state.items[name];
    for (const id in DATA.items) {
      if (DATA.items[id].name === name && state.items[id]) return state.items[id];
    }
    if (state.inv.some(i => i.id === name)) return { id: name };
    return null;
  }

  function initState(data) {
    const start = data.config?.start || {};
    const s = {
      room: start.room || Object.keys(data.rooms)[0],
      money: start.money ?? 50,
      rating: start.rating ?? 5,
      inv: (start.inv || []).map(id => ({ id, state: "raw" })),
      items: {}, npcs: [], flags: {},
      unlockedRecipes: (start.unlockedRecipes || []).slice()
    };
    if (start.items) {
      for (const id in start.items) {
        const def = data.items[id] || {};
        s.items[id] = Object.assign({ id, name: def.name || id, state: "raw" }, start.items[id]);
      }
    }
    return s;
  }

  function tick() {
    if (!DATA) return;
    const room = DATA.rooms[state.room];
    if (room?.onTick) run(room.onTick, makeCtx({ room }));
    for (const npc of state.npcs.slice()) {
      npc.patience--;
      if (npc.patience <= 0) {
        const def = DATA.npcs[npc.id];
        if (def?.onTimeout) run(def.onTimeout, makeCtx({ self: npc }));
        state.npcs = state.npcs.filter(n => n !== npc);
      }
    }
  }

  function handleInput(text) {
    const raw = String(text).trim();
    if (!raw) return;
    out(`> ${raw}`, "echo");
    const parts = raw.split(/\s+/);
    const verb = parts[0];
    const arg = parts.slice(1).join(" ").trim();

    let cmd = DATA.commands[verb];
    if (!cmd) {
      for (const k in DATA.commands) {
        if ((DATA.commands[k].aliases || []).includes(verb)) { cmd = DATA.commands[k]; break; }
      }
    }
    if (!cmd) { out("你不懂这个命令。"); return; }
    execute(cmd, arg, verb);
  }

  function execute(cmd, arg, verb) {
    const ctx = makeCtx({});
    if (arg) {
      const item = resolveItem(arg);
      if (item) ctx.target = item;
      else if (cmd.needTarget) { out(`这里没有「${arg}」。`); return; }
      else ctx.target = arg;
    }
    if (cmd.needTarget && !ctx.target) {
      out(`你要${verb}什么？例如：「${cmd.example || verb + " 番茄"}」`);
      return;
    }
    run(cmd.program, ctx);
  }

  return {
    boot(data, element) {
      DATA = data; outEl = element; state = initState(data);
      out("==================== 厨房模拟器 ====================", "sys");
      const room = DATA.rooms[state.room];
      if (room) {
        out("", "sys");
        out(`—— ${room.name} ——`, "sys");
        if (room.desc) out(room.desc, "sys");
        if (room.onEnter) run(room.onEnter, makeCtx({ room }));
      }
      timer = setInterval(tick, 1000);
    },
    input: handleInput,
    out,
    getState: () => state,
    getData: () => DATA,
    goto: (roomId) => { if (DATA.rooms[roomId]) OPS.goto(makeCtx({}), { room: roomId }); },
    
    buy: (itemId, price) => {
      if (state.money >= price) {
        state.money -= price;
        const def = DATA.items[itemId] || {};
        state.inv.push({ id: itemId, name: def.name || itemId, state: "raw" });
        out(`[购买成功] 花费 ${price} 元买下 ${def.name || itemId}，已放入背包。`);
        return true;
      } else {
        out(`[购买失败] 余额不足！`, "sys");
        return false;
      }
    },
    
    serve: (npcId, itemId) => {
      const npcIndex = state.npcs.findIndex(n => n.id === npcId);
      if (npcIndex < 0) return;
      const npc = state.npcs[npcIndex];

      const item = state.items[itemId];
      if (!item || item.state !== "dish") {
        out("这还不是成品菜，不能出餐。", "sys");
        return;
      }

      if (item.id === npc.order) {
        const price = DATA.recipes[npc.order]?.price ?? 30;
        state.money += price;
        out(`你把【${item.name}】端给了 ${npc.name}。`, "sys");
        out(`${npc.name}大快朵颐，非常满意！+${price} 元`, "sys");
        delete state.items[itemId];
        state.npcs.splice(npcIndex, 1);
      } else {
        out(`${npc.name}看了一眼【${item.name}】，眉头一皱：“我没点这个啊！”`, "sys");
        npc.patience = Math.max(0, npc.patience - 5);
      }
    },

    // ==================== 新增：多存档系统 ====================
    getSaves: () => {
      const s = localStorage.getItem("kitchen_saves");
      return s ? JSON.parse(s) : [];
    },
    save: (name) => {
      try {
        const saves = VM.getSaves();
        const newSave = {
          id: Date.now().toString(),
          name: name || "无名存档",
          date: new Date().toLocaleString(),
          state: JSON.parse(JSON.stringify(state)) // 深拷贝当前状态
        };
        saves.push(newSave);
        localStorage.setItem("kitchen_saves", JSON.stringify(saves));
        out(`💾 存档【${newSave.name}】保存成功！`, "sys");
        return true;
      } catch (e) {
        out("❌ 保存失败：" + e.message, "sys");
        return false;
      }
    },
    load: (id) => {
      const saves = VM.getSaves();
      const save = saves.find(s => s.id === id);
      if (!save) {
        out("❌ 找不到该存档。", "sys");
        return false;
      }
      state = save.state; // 恢复状态
      out(`📂 成功读取存档【${save.name}】！`, "sys");
      const room = DATA.rooms[state.room];
      if (room) out(`—— ${room.name} ——\n${room.desc}`, "sys");
      return true;
    },
    deleteSave: (id) => {
      let saves = VM.getSaves();
      saves = saves.filter(s => s.id !== id);
      localStorage.setItem("kitchen_saves", JSON.stringify(saves));
      return true;
    }
  };
})();