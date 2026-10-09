"use strict";
(() => {
const $ = id => document.getElementById(id);
const STORE = "wordle-helper-v2";
const SYMBOL = {"с":"×", "ж":"↔", "з":"✓", "":"·"};
const CLASS = {"с":"gray", "ж":"yellow", "з":"green", "":""};
const KEYS = {"с":"с", "c":"с", "b":"с", "ж":"ж", "y":"ж", "з":"з", "g":"з"};
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let length = 5, strategy = "answer", sessions = {}, filtered = [], editing = null;
let word = [], colors = [], attempts = [], mode = "word", cursor = 0, showAll = false;
let draftBeforeEdit = null, generation = 0, worker = null, countFrame = 0, toastTimer;
let recommendation = null;
const norm = text => text.toLowerCase().replaceAll("ё", "е");
const blank = () => Array(length).fill("");
const clone = value => JSON.parse(JSON.stringify(value));

// Exact Wordle feedback: greens first, then yellows from the remaining letter counts.
function feedback(answer, guess) {
  const result = Array(guess.length).fill("с"), remaining = {};
  for (let i = 0; i < guess.length; i++) {
    if (answer[i] === guess[i]) result[i] = "з";
    else remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < guess.length; i++) {
    if (result[i] !== "з" && remaining[guess[i]] > 0) {
      result[i] = "ж"; remaining[guess[i]]--;
    }
  }
  return result.join("");
}
function consistent(answer, list) { return list.every(a => feedback(answer, a.word) === a.colors); }
function pool() { return DATA[String(length)] || []; }
function recompute() { filtered = pool().filter(([w]) => consistent(w, attempts)); }
function toast(text) {
  $("toast").textContent = text; $("toast").classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").classList.remove("show"), 3200);
}
function animate(el, name) {
  if (!el || reduced.matches) return;
  el.classList.remove(name); void el.offsetWidth; el.classList.add(name);
  el.addEventListener("animationend", () => el.classList.remove(name), {once:true});
}

document.querySelector(".wrap").innerHTML = `
  <header><div class="logo" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div><h1>Вордли-помощник</h1><div class="sub">От цветных подсказок — к следующему слову</div></div><button class="btn btn-ghost" id="theme-toggle" aria-label="Переключить тему">◐</button></header>
  <div class="length-bar"><div class="card-title">Букв в слове</div><div class="pills" id="pills" role="group" aria-label="Длина слова"></div></div>
  <main class="workspace">
    <section class="card" id="input-card" aria-labelledby="input-title">
      <div class="section-heading"><h2 id="input-title">Новая попытка</h2><span class="info" id="attempt-label"></span></div>
      <p class="step-note" id="step-note"></p>
      <input id="hidden-input" aria-label="Ввод букв слова" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" tabindex="-1">
      <div class="tiles" id="word-row" role="group" aria-label="Буквы слова"></div>
      <div class="tiles" id="color-row" role="group" aria-label="Цвета букв"></div>
      <div class="palette" role="group" aria-label="Назначить цвет выбранной букве">
        <button data-color="с"><span class="dot gray"></span>× Нет</button><button data-color="ж"><span class="dot yellow"></span>↔ Есть, не здесь</button><button data-color="з"><span class="dot green"></span>✓ На месте</button>
      </div>
      <div class="submit-row"><button class="btn btn-primary" id="submit">Подобрать слова</button><button class="btn btn-ghost" id="cancel-edit" hidden>Отмена правки</button></div>
      <p class="legend">Нажмите на букву, чтобы исправить её. Цвета: з / ж / с или g / y / b. Enter — сохранить.</p>
      <div class="actions"><button class="btn btn-ghost small" id="undo">Отменить попытку</button><button class="btn btn-ghost small" id="reset">Новая партия</button></div>
      <div id="history" aria-label="История попыток"></div>
      <div class="knowledge" id="knowledge"></div>
    </section>
    <section class="card" aria-labelledby="results-title">
      <div class="section-heading"><h2 id="results-title">Следующий ход</h2></div>
      <div class="strategy" role="group" aria-label="Стратегия"><button id="strategy-answer" aria-pressed="true">Угадать ответ</button><button id="strategy-explore" aria-pressed="false">Проверить буквы</button></div>
      <div class="recommendation" id="recommendation" aria-live="polite"></div>
      <div class="cands-head"><div class="card-title">Кандидаты <span class="count" id="cand-count">0</span></div><button class="btn btn-ghost small" id="toggle-all" hidden>Показать все</button></div>
      <p class="progress-note" id="progress-note" role="status"></p><div class="progress-track" aria-hidden="true"><div id="progress-bar"></div></div>
      <div class="problem" id="problem" hidden><p id="problem-text"></p><button class="btn btn-ghost" id="fix-last">Исправить последнюю попытку</button></div>
      <div class="chips" id="chips"></div>
      <div class="footnote">Словарь загадываемых слов wordle.belousov.one. Частотность — ориентир, а не вероятность ответа. Наведите на слово, чтобы увидеть её.</div>
    </section>
  </main>
  <details class="card help"><summary>Как пользоваться и как выбирается ход</summary><ol>
    <li>Выберите длину слова. Для каждой длины сохраняется отдельная партия, включая незавершённый ввод.</li>
    <li>Введите слово из игры, затем выберите цвета. Нажатие на клетку выбирает её; кнопка цвета назначает цвет и переводит к следующей клетке.</li>
    <li>Нажмите «Подобрать слова». Любую попытку в истории можно открыть и исправить.</li>
    <li>«Угадать ответ» выбирает наиболее частотного кандидата. «Проверить буквы» максимизирует информацию от возможных цветовых результатов, считая оставшиеся ответы равновероятными.</li>
    <li>При большом словаре оценка приблизительная: сравниваем отобранные слова на равномерной выборке ответов. Проверочное слово может не быть кандидатом. Используется только встроенный словарь.</li>
    <li>Стрелки перемещают выбор по клеткам, Backspace стирает символ. При включённом в системе уменьшении движения анимации отключены.</li>
  </ol></details>`;

function validAttempt(a, n) {
  return a && typeof a.word === "string" && new RegExp(`^[а-я]{${n}}$`).test(a.word) && typeof a.colors === "string" && new RegExp(`^[сжз]{${n}}$`).test(a.colors);
}
function validDraft(a, n) {
  return a && Array.isArray(a.word) && a.word.length === n && a.word.every(c => typeof c === "string" && /^[а-я]?$/.test(c)) && Array.isArray(a.colors) && a.colors.length === n && a.colors.every(c => ["","с","ж","з"].includes(c));
}
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (saved && saved.sessions && typeof saved.sessions === "object") {
      for (const [key, value] of Object.entries(saved.sessions)) {
        if (DATA[key] && value && Array.isArray(value.attempts) && value.attempts.every(a => validAttempt(a, Number(key)))) sessions[key] = value;
      }
      if (DATA[String(saved.length)]) length = Number(saved.length);
      if (saved.strategy === "explore") strategy = "explore";
    } else {
      const old = JSON.parse(localStorage.getItem("wordle-helper-state"));
      if (old && DATA[String(old.length)] && Array.isArray(old.attempts) && old.attempts.every(a => validAttempt(a, Number(old.length)))) {
        length = Number(old.length); sessions[length] = {attempts:old.attempts};
      }
    }
  } catch (_) { /* Storage may be disabled; the app still works in memory. */ }
}
function snapshot() { return {word:[...word], colors:[...colors], mode, cursor}; }
function save() {
  sessions[length] = {attempts:clone(attempts), ...snapshot(), editing, draftBeforeEdit:clone(draftBeforeEdit)};
  try { localStorage.setItem(STORE, JSON.stringify({length, strategy, sessions})); } catch (_) {}
}
function restoreDraft(draft) {
  word = validDraft(draft, length) ? [...draft.word] : blank();
  colors = validDraft(draft, length) ? [...draft.colors] : blank();
  mode = draft?.mode === "color" ? "color" : "word";
  cursor = Number.isInteger(draft?.cursor) ? Math.max(0, Math.min(length-1, draft.cursor)) : 0;
}
function setLength(n, initial = false) {
  if (!initial) save();
  length = n;
  const state = sessions[n] || {attempts:[]};
  attempts = clone(state.attempts); restoreDraft(state);
  editing = Number.isInteger(state.editing) && state.editing >= 0 && state.editing < attempts.length ? state.editing : null;
  draftBeforeEdit = editing !== null && validDraft(state.draftBeforeEdit, n) ? clone(state.draftBeforeEdit) : null;
  showAll = false; buildRows(); recompute(); renderAll(); save();
}
function buildRows() {
  for (const id of ["word-row","color-row"]) {
    const row = $(id); row.replaceChildren(); row.style.setProperty("--length", length);
    for (let i=0; i<length; i++) {
      const button = document.createElement("button"); button.type = "button";
      button.addEventListener("click", () => selectCell(id === "word-row" ? "word" : "color", i));
      row.append(button);
    }
  }
}
function selectCell(nextMode, index) {
  mode = nextMode; cursor = index; renderInput(); save();
  if (mode === "word" && matchMedia("(pointer: coarse)").matches) $("hidden-input").focus({preventScroll:true});
  else $("hidden-input").blur();
}
function renderInput() {
  for (let i=0; i<length; i++) {
    const tile = $("word-row").children[i], cell = $("color-row").children[i];
    tile.textContent = word[i]; tile.className = `tile ${CLASS[colors[i]]} ${mode === "word" && cursor === i ? "selected" : ""}`;
    cell.textContent = SYMBOL[colors[i]]; cell.className = `ccell ${CLASS[colors[i]]} ${mode === "color" && cursor === i ? "selected" : ""}`;
    tile.setAttribute("aria-label", `Буква ${i+1}: ${word[i] || "пусто"}. Изменить букву`);
    cell.setAttribute("aria-label", `Цвет ${i+1}: ${colors[i] === "з" ? "на месте" : colors[i] === "ж" ? "есть, не здесь" : colors[i] === "с" ? "нет" : "не задан"}. Выбрать`);
    tile.setAttribute("aria-pressed", String(mode === "word" && cursor === i));
    cell.setAttribute("aria-pressed", String(mode === "color" && cursor === i));
  }
  $("input-title").textContent = editing === null ? "Новая попытка" : `Правка попытки ${editing+1}`;
  $("attempt-label").textContent = `В истории: ${attempts.length}`;
  $("step-note").textContent = mode === "word" ? `Введите слово · выбрана буква ${cursor+1}` : `Укажите цвета · выбрана позиция ${cursor+1}`;
  $("submit").textContent = editing === null ? "Подобрать слова" : "Сохранить изменения";
  $("cancel-edit").hidden = editing === null; $("undo").disabled = !attempts.length || editing !== null;
}
function inputChar(raw) {
  const c = norm(raw);
  if (mode === "color") { if (KEYS[c]) assignColor(KEYS[c]); return; }
  if (!/^[а-я]$/.test(c)) return;
  const position = cursor;
  if (word[cursor] !== c) colors[cursor] = "";
  word[cursor] = c;
  const nextEmpty = word.findIndex((w,i) => i > cursor && !w);
  if (nextEmpty >= 0) cursor = nextEmpty;
  else if (word.includes("")) cursor = word.indexOf("");
  else { mode = "color"; cursor = Math.max(0, colors.indexOf("")); $("hidden-input").blur(); }
  renderInput(); animate($("word-row").children[position], "pop"); save();
}
function assignColor(c) {
  if (word.includes("")) { toast("Сначала заполните слово"); return; }
  const position = cursor; mode = "color"; colors[position] = c;
  cursor = (position+1)%length;
  renderInput(); animate($("color-row").children[position], "flip"); $("hidden-input").blur(); save();
}
function backspace() {
  const array = mode === "color" ? colors : word;
  if (!array[cursor] && cursor > 0) cursor--;
  else if (mode === "color" && cursor === 0 && !colors[0]) { mode = "word"; cursor = length-1; }
  if (mode === "word") {word[cursor] = ""; colors[cursor] = "";} else colors[cursor] = "";
  renderInput(); save();
}
function insertWord(w) {
  word = w.split(""); colors = blank(); mode = "color"; cursor = 0;
  renderInput(); save(); $("hidden-input").blur();
  $("input-card").scrollIntoView({behavior:reduced.matches ? "instant" : "smooth", block:"nearest"});
  toast(`«${w}» вставлено — укажите цвета из игры`);
}
function submit() {
  if (word.includes("") || colors.includes("")) {
    toast(word.includes("") ? `Нужно слово из ${length} букв` : "Укажите цвет каждой буквы");
    animate($(word.includes("") ? "word-row" : "color-row"), "shake"); return;
  }
  const previous = filtered.length, newAttempt = {word:word.join(""), colors:colors.join("")};
  const index = editing === null ? attempts.length : editing;
  if (editing === null) attempts.push(newAttempt); else attempts[editing] = newAttempt;
  if (editing !== null && draftBeforeEdit) restoreDraft(draftBeforeEdit);
  else {word=blank(); colors=blank(); mode="word"; cursor=0;}
  editing=null; draftBeforeEdit=null; recompute(); renderAll(previous, index); save();
}
function editAttempt(index) {
  if (editing === null) draftBeforeEdit = snapshot();
  editing=index; word=attempts[index].word.split(""); colors=attempts[index].colors.split(""); mode="color"; cursor=0;
  renderInput(); renderHistory(); save(); $("hidden-input").blur();
  $("input-card").scrollIntoView({behavior:reduced.matches ? "instant" : "smooth",block:"start"});
}
function cancelEdit() { restoreDraft(draftBeforeEdit); editing=null; draftBeforeEdit=null; renderInput(); renderHistory(); save(); }
function deleteAttempt(index) {
  const previous=filtered.length;
  if (editing === index) {restoreDraft(draftBeforeEdit); editing=null; draftBeforeEdit=null;}
  else if (editing !== null && editing > index) editing--;
  attempts.splice(index,1); recompute(); renderAll(previous); save();
}
function renderHistory(addedIndex) {
  $("history").replaceChildren();
  attempts.forEach((a,index) => {
    const row=document.createElement("div"); row.className="history-entry";
    const edit=document.createElement("button"); edit.className="history-edit";
    edit.setAttribute("aria-label", `Изменить попытку ${index+1}: ${a.word}`); edit.setAttribute("aria-current", String(editing===index));
    const num=document.createElement("span"); num.className="history-number"; num.textContent=index+1; edit.append(num);
    a.word.split("").forEach((letter,i) => {const t=document.createElement("span"); t.className=`mini ${CLASS[a.colors[i]]}`; t.textContent=letter.toUpperCase(); edit.append(t);});
    edit.addEventListener("click",()=>editAttempt(index));
    const del=document.createElement("button"); del.className="btn btn-ghost small hdel"; del.textContent="×"; del.setAttribute("aria-label", `Удалить попытку ${index+1}`);
    del.addEventListener("click",()=> {
      if (reduced.matches) {deleteAttempt(index); return;}
      const target=a; row.classList.add("leaving");
      setTimeout(()=> {const current=attempts.indexOf(target); if(current>=0) deleteAttempt(current);},180);
    });
    row.append(edit,del); $("history").append(row); if(index===addedIndex) animate(row,"enter");
  });
}

// Combined position/count constraints also power the explanations panel.
function constraints(list) {
  const fixed=Array(length).fill(null), forbidden=Array.from({length},()=>new Map()), letters=new Map();
  const issues=[];
  for (let row=0;row<list.length;row++) {
    const a=list[row];
    for(let i=0;i<length;i++) {
      const ch=a.word[i], color=a.colors[i];
      if(color==="з") {
        if(fixed[i] && fixed[i].letter!==ch) issues.push(`В попытках ${fixed[i].row+1} и ${row+1} на позиции ${i+1} зелёными отмечены разные буквы.`);
        if(forbidden[i].has(ch)) issues.push(`В попытке ${forbidden[i].get(ch)+1} буква «${ch.toUpperCase()}» исключена на позиции ${i+1}, а в попытке ${row+1} отмечена там зелёной.`);
        fixed[i]={letter:ch,row};
      } else {
        if(fixed[i]?.letter===ch) issues.push(`В попытке ${fixed[i].row+1} буква «${ch.toUpperCase()}» зелёная на позиции ${i+1}, а в попытке ${row+1} — ${color==="ж" ? "жёлтая" : "серая"} на той же позиции.`);
        forbidden[i].set(ch,row);
      }
    }
    for(const ch of new Set(a.word)) {
      let positive=0, gray=0;
      for(let i=0;i<length;i++) if(a.word[i]===ch) {if(a.colors[i]==="с") gray++; else positive++;}
      const value=letters.get(ch)||{min:0,max:length,minRow:row,maxRow:row};
      if(positive>value.min) {value.min=positive;value.minRow=row;}
      if(gray && positive<value.max) {value.max=positive;value.maxRow=row;}
      letters.set(ch,value);
      if(value.min>value.max) issues.push(`Для буквы «${ch.toUpperCase()}» попытка ${value.minRow+1} требует не менее ${value.min}, а попытка ${value.maxRow+1} допускает не более ${value.max}.`);
      const occurrences=[...a.word].map((c,i)=>c===ch && a.colors[i]!=="з" ? i : -1).filter(i=>i>=0);
      let sawGray=false;
      for(const i of occurrences) {if(a.colors[i]==="с") sawGray=true; else if(sawGray) issues.push(`В попытке ${row+1} для повторяющейся буквы «${ch.toUpperCase()}» серая клетка стоит перед жёлтой. По правилам Wordle жёлтые назначаются слева направо после зелёных.`);}
    }
  }
  for(const [ch,v] of letters) {
    const greens=fixed.filter(x=>x?.letter===ch).length;
    if(greens>v.max) issues.push(`Буква «${ch.toUpperCase()}» закреплена на ${greens} позициях, но попытка ${v.maxRow+1} допускает не более ${v.max}.`);
    const available=fixed.filter((x,i)=>x ? x.letter===ch : !forbidden[i].has(ch)).length;
    if(available<v.min) issues.push(`Для буквы «${ch.toUpperCase()}» нужно ${v.min} мест, но с учётом цветов доступно только ${available}.`);
  }
  if([...letters.values()].reduce((sum,v)=>sum+v.min,0)>length) issues.push("Все отмеченные буквы с учётом повторений не помещаются в слово выбранной длины.");
  return {fixed,letters,issues};
}
function renderKnowledge() {
  const {fixed,letters,issues}=constraints(attempts), box=$("knowledge"); box.replaceChildren();
  const title=document.createElement("h3"); title.textContent="Что уже известно"; box.append(title);
  if(!attempts.length) {const p=document.createElement("p"); p.textContent="Здесь появятся позиции, известные и исключённые буквы."; box.append(p);}
  else {
    const rows=[
      ["На своих местах",fixed.map(x=>x ? x.letter.toUpperCase() : "●").join(" ")],
      ["Есть в слове",[...letters].filter(([ch,v])=>v.min>fixed.filter(x=>x?.letter===ch).length).map(([ch])=>ch.toUpperCase()).join(", ")||"—"],
      ["Исключены",[...letters].filter(([,v])=>v.max===0).map(([ch])=>ch.toUpperCase()).join(", ")||"—"]
    ];
    for(const [label,text] of rows) {const p=document.createElement("p"), span=document.createElement("span"); span.textContent=label+": "; p.append(span,document.createTextNode(text)); box.append(p);}
    const counts=document.createElement("div"); counts.className="letter-counts";
    counts.textContent=[...letters].filter(([,v])=>v.min>0).map(([ch,v])=>`${ch.toUpperCase()} — ${v.min===v.max ? "ровно " : "не менее "}${v.min}`).join("; "); box.append(counts);
    if(issues.length) {const warning=document.createElement("p"); warning.textContent="Есть противоречия — проверьте подсказку справа."; box.append(warning);}
  }
  $("problem").hidden=filtered.length>0;
  $("problem-text").textContent=issues[0] || "Слов из встроенного словаря не осталось. Явного противоречия не найдено: проверьте цвета и повторяющиеся буквы. Возможно, ответа нет в словаре.";
  $("fix-last").hidden=!attempts.length;
}
function renderCandidates(previous) {
  const count=$("cand-count"), start=Number(count.textContent)||0, end=filtered.length;
  cancelAnimationFrame(countFrame);
  if(reduced.matches || previous===undefined) count.textContent=end;
  else {const time=performance.now(); const tick=now=>{const p=Math.min(1,(now-time)/350);count.textContent=Math.round(start+(end-start)*p);if(p<1)countFrame=requestAnimationFrame(tick);};countFrame=requestAnimationFrame(tick);}
  const total=pool().length;
  let note=`Осталось ${end} из ${total} · исключено ${total-end}`;
  if(previous!==undefined && previous!==end) note+=end<previous ? ` · −${previous-end} за этот шаг` : ` · возвращено ${end-previous}`;
  $("progress-note").textContent=note; $("progress-bar").style.width=`${total ? end/total*100 : 0}%`;
  const chips=$("chips"), wanted=filtered.length===1 ? [] : filtered.slice(0,showAll?filtered.length:30);
  const existing=new Map([...chips.children].map(el=>[el.dataset.word,el]));
  const keep=new Set(wanted.map(([w])=>w));
  for(const [w,el] of existing) if(!keep.has(w)) el.remove();
  for(const [w,freq] of wanted) {
    let button=existing.get(w);
    if(!button) {button=document.createElement("button"); button.className="chip";button.dataset.word=w;const b=document.createElement("b");b.textContent=w;button.append(b);button.title=`Частотность в исходном списке: ${freq.toLocaleString("ru-RU")}. Вставить слово`;button.addEventListener("click",()=>insertWord(w));if(previous!==undefined)animate(button,"new");}
    chips.append(button);
  }
  chips.classList.toggle("scroll",showAll); $("toggle-all").hidden=filtered.length<=30;
  $("toggle-all").textContent=showAll?"Свернуть":`Все ${filtered.length}`;
}

// Runs outside the UI thread. Exact on smaller sets, bounded sampling for large dictionaries.
function rankWords(payload) {
  const {answers,pool,used}=payload;
  const sampleSize=Math.min(answers.length,400);
  const sample=Array.from({length:sampleSize},(_,i)=>answers[Math.floor(i*answers.length/sampleSize)][0]);
  const letterFrequency={};
  for(const w of sample) for(const ch of new Set(w)) letterFrequency[ch]=(letterFrequency[ch]||0)+1;
  const sorted=pool.filter(([w])=>!used.includes(w)).map(pair=>({pair,score:[...new Set(pair[0])].reduce((n,ch)=>n+(letterFrequency[ch]||0)*(sampleSize-(letterFrequency[ch]||0)+1),0)})).sort((a,b)=>b.score-a.score||b.pair[1]-a.pair[1]);
  const chosen=new Map(sorted.slice(0,220).map(x=>[x.pair[0],x.pair]));
  answers.slice(0,80).forEach(pair=>chosen.set(pair[0],pair));
  let best=null;
  const answerSet=new Set(answers.map(x=>x[0]));
  for(const [guess,freq] of chosen.values()) {
    const buckets=new Map();
    for(const answer of sample) {
      const counts={}, codes=Array(guess.length).fill(0);
      for(let i=0;i<guess.length;i++) {if(guess[i]===answer[i]) codes[i]=2; else counts[answer[i]]=(counts[answer[i]]||0)+1;}
      for(let i=0;i<guess.length;i++) if(codes[i]!==2 && counts[guess[i]]>0) {codes[i]=1;counts[guess[i]]--;}
      let code=0; for(const c of codes) code=code*3+c;
      buckets.set(code,(buckets.get(code)||0)+1);
    }
    let entropy=0, expected=0;
    for(const size of buckets.values()) {const p=size/sampleSize;entropy-=p*Math.log2(p);expected+=size*size/sampleSize;}
    const candidate=answerSet.has(guess);
    if(!best || entropy>best.entropy+1e-9 || (Math.abs(entropy-best.entropy)<1e-9 && (Number(candidate)>Number(best.candidate) || (candidate===best.candidate && freq>best.freq)))) best={word:guess,freq,entropy,expected,candidate,groups:buckets.size};
  }
  if(best) {best.approximate=sampleSize<answers.length || chosen.size<pool.filter(([w])=>!used.includes(w)).length; best.sampleSize=sampleSize;best.tested=chosen.size;}
  return best;
}
function showRecommendation(result, loading=false, celebrate=false) {
  const box=$("recommendation"); box.replaceChildren(); recommendation=result;
  box.className="recommendation"; box.hidden=!filtered.length;
  if(!filtered.length) return;
  const solved=attempts.some(a=>a.colors==="з".repeat(length)) && filtered.length===1;
  const unique=filtered.length===1;
  if(unique) box.classList.add(solved?"solved":"unique");
  // Only animate feedback states in response to a submitted/edited attempt.
  if(!celebrate) box.style.animation="none"; else box.style.animation="";
  const heading=document.createElement("h3");heading.textContent=solved?"Слово подтверждено — отлично!":unique?"Остался один кандидат":loading?"Сравниваем возможные ходы…":"Рекомендуемая попытка";
  const answer=document.createElement("div");answer.className="answer";answer.textContent=result ? result.word.toUpperCase() : "…";
  const text=document.createElement("p");
  if(unique) text.textContent="Подходит под все введённые подсказки.";
  else if(loading) text.textContent="Оцениваем, как цвета разделят оставшиеся варианты.";
  else if(strategy==="answer") text.textContent="Самый частотный из подходящих кандидатов. Частотность не гарантирует, что именно он загадан.";
  else if(result) {
    const seen=new Set(attempts.map(a=>a.word).join(""));const fresh=[...new Set(result.word)].filter(ch=>!seen.has(ch)).length;
    text.textContent=`Новых букв: ${fresh}. Разделяет ${result.sampleSize} ${result.approximate?"выбранных":"оставшихся"} ответов на ${result.groups} групп по цветам. ${result.candidate?"Это также возможный ответ.":"Проверочное слово, не возможный ответ."}${result.approximate?" Приблизительная оценка.":""}`;
  }
  box.append(heading,answer,text);
  if(result && !loading && !solved) {const button=document.createElement("button");button.className="btn btn-primary";button.textContent="Вставить слово";button.addEventListener("click",()=>insertWord(result.word));box.append(button);}
}
function updateRecommendation(celebrate=false) {
  generation++; const token=generation;
  if(worker) {worker.terminate();worker=null;}
  if(!filtered.length) {showRecommendation(null);return;}
  if(strategy==="answer" || filtered.length===1) {showRecommendation({word:filtered[0][0]},false,celebrate);return;}
  showRecommendation(null,true);
  const payload={answers:filtered,pool:pool(),used:attempts.map(a=>a.word)};
  const finish=result=>{if(token===generation) showRecommendation(result||{word:filtered[0][0],sampleSize:filtered.length,groups:1,candidate:true,approximate:true});};
  try {
    const blob=new Blob([`const rankWords=${rankWords.toString()};onmessage=e=>postMessage(rankWords(e.data));`],{type:"text/javascript"});
    const url=URL.createObjectURL(blob);try {worker=new Worker(url);} finally {URL.revokeObjectURL(url);}
    worker.onmessage=e=>{finish(e.data);worker.terminate();worker=null;};
    worker.onerror=()=>{if(token!==generation)return;worker.terminate();worker=null;setTimeout(()=>{if(token===generation)finish(rankWords(payload));},0);};
    worker.postMessage(payload);
  } catch (_) {setTimeout(()=>{if(token===generation)finish(rankWords(payload));},0);}
}
function renderAll(previous, addedIndex) {
  for(const button of $("pills").children) {button.classList.toggle("active",Number(button.textContent)===length);button.setAttribute("aria-pressed",String(Number(button.textContent)===length));}
  $("strategy-answer").setAttribute("aria-pressed",String(strategy==="answer"));$("strategy-explore").setAttribute("aria-pressed",String(strategy==="explore"));
  renderInput();renderHistory(addedIndex);renderKnowledge();renderCandidates(previous);updateRecommendation(addedIndex!==undefined);
}
for(let n=4;n<=11;n++) {const button=document.createElement("button");button.className="pill";button.textContent=n;button.setAttribute("aria-label",`${n} букв`);button.addEventListener("click",()=>{if(n!==length)setLength(n);});$("pills").append(button);}
for(const button of document.querySelectorAll("[data-color]")) button.addEventListener("click",()=>assignColor(button.dataset.color));
$("submit").addEventListener("click",submit);$("cancel-edit").addEventListener("click",cancelEdit);
$("undo").addEventListener("click",()=>{if(attempts.length && editing===null)deleteAttempt(attempts.length-1);});
$("reset").addEventListener("click",()=>{attempts=[];word=blank();colors=blank();mode="word";cursor=0;editing=null;draftBeforeEdit=null;recompute();renderAll();save();toast("Начата новая партия для этой длины слова");});
$("fix-last").addEventListener("click",()=>{if(attempts.length)editAttempt(attempts.length-1);});
$("toggle-all").addEventListener("click",()=>{showAll=!showAll;renderCandidates();});
for(const value of ["answer","explore"]) $("strategy-"+value).addEventListener("click",()=>{strategy=value;$("strategy-answer").setAttribute("aria-pressed",String(value==="answer"));$("strategy-explore").setAttribute("aria-pressed",String(value==="explore"));updateRecommendation();save();});
document.addEventListener("keydown",e=>{
  if(e.ctrlKey||e.metaKey||e.altKey||e.isComposing)return;
  // Native button Enter/Space and Tab remain available to keyboard users.
  if((e.key==="Enter"||e.key===" ") && e.target.closest("button,summary") && !e.target.closest("#word-row,#color-row"))return;
  if(e.key==="Enter"){e.preventDefault();submit();return;}
  if(e.key==="Backspace"){e.preventDefault();backspace();return;}
  if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();cursor=(cursor+(e.key==="ArrowRight"?1:length-1))%length;renderInput();save();return;}
  if(e.key.length===1 && (/^[а-яё]$/i.test(e.key)||KEYS[e.key.toLowerCase()])){e.preventDefault();inputChar(e.key);}
});
$("hidden-input").addEventListener("input",e=>{if(e.isComposing)return;const input=e.currentTarget;if(e.inputType==="deleteContentBackward")backspace();else for(const c of input.value || e.data || "")inputChar(c);input.value="";});
$("hidden-input").addEventListener("compositionend",e=>{for(const c of e.data||"")inputChar(c);e.currentTarget.value="";});
document.addEventListener("paste",e=>{if(mode!=="word")return;const text=norm(e.clipboardData.getData("text")).trim();if(!/^[а-я]+$/.test(text))return;e.preventDefault();for(const c of text){if(mode!=="word")break;inputChar(c);}});
function applyTheme(theme) {document.documentElement.dataset.theme=theme;document.querySelector('meta[name="color-scheme"]').content=theme;$("theme-toggle").textContent=theme==="dark"?"☀":"☾";try{localStorage.setItem("wordle-theme",theme);}catch(_){}}
let theme=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";try{const saved=localStorage.getItem("wordle-theme");if(["light","dark"].includes(saved))theme=saved;}catch(_){}
applyTheme(theme);$("theme-toggle").addEventListener("click",()=>applyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark"));
load();setLength(length,true);
})();
