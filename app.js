"use strict";
// 수치는 아래 순수 함수에서 계산하며, 화면 해석은 검토 가능한 규칙으로 생성합니다.
const Analysis = (() => {
  const MAX = 1e12;
  function validate(input) {
    if (!Array.isArray(input) || input.length < 1 || input.length > 120) throw Error("1~120개월의 데이터를 입력해 주세요.");
    const seen = new Set();
    const rows = input.map((row, i) => {
      const month = String(row.month || "").trim();
      if (!/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw Error(`${i + 1}행: 1900~2199년의 올바른 월을 입력해 주세요.`);
      if (seen.has(month)) throw Error(`${month}: 같은 월이 중복되었습니다. 합산 또는 수정해 주세요.`);
      seen.add(month);
      const item = { month };
      for (const [key, label] of [["revenue", "매출"], ["variableCost", "변동비"], ["fixedCost", "고정비"]]) {
        const raw = String(row[key] ?? "").trim();
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > MAX) throw Error(`${i + 1}행 ${label}: 0~1조 원의 정수를 입력해 주세요. 빈칸은 0으로 간주하지 않습니다.`);
        item[key] = Number(raw);
      }
      item.cost = item.variableCost + item.fixedCost;
      item.profit = item.revenue - item.cost;
      return item;
    }).sort((a, b) => a.month.localeCompare(b.month));
    for (let i = 1; i < rows.length; i++) {
      const serial = m => Number(m.slice(0, 4)) * 12 + Number(m.slice(5));
      if (serial(rows[i].month) - serial(rows[i - 1].month) !== 1) throw Error(`${rows[i - 1].month}와 ${rows[i].month} 사이에 누락된 월이 있습니다. 연속된 월로 보완해 주세요.`);
    }
    return rows;
  }
  function summarize(input) {
    const rows = validate(input);
    const totals = { revenue: 0, variableCost: 0, fixedCost: 0, cost: 0, profit: 0 };
    rows.forEach(row => Object.keys(totals).forEach(k => totals[k] += row[k]));
    const average = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v / rows.length]));
    return { rows, totals, average, margin: totals.revenue ? totals.profit / totals.revenue * 100 : null };
  }
  function simulate(summary, raw) {
    const c = {};
    for (const k of ["price", "volume", "variable", "fixed"]) {
      if (String(raw[k] ?? "").trim() === "" || !Number.isFinite(Number(raw[k]))) throw Error("모든 시뮬레이션 조건에 숫자를 입력해 주세요.");
      c[k] = Number(raw[k]);
      if (k !== "fixed" && (c[k] < -100 || c[k] > 200)) throw Error("변화율은 -100%~200% 범위로 입력해 주세요.");
    }
    if (!Number.isSafeInteger(c.fixed) || Math.abs(c.fixed) > MAX) throw Error("고정비 증감은 ±1조 원 이내 정수로 입력해 주세요.");
    const a = summary.average;
    const revenue = a.revenue * (1 + c.price / 100) * (1 + c.volume / 100);
    const variableCost = a.variableCost * (1 + c.variable / 100) * (1 + c.volume / 100);
    const fixedCost = a.fixedCost + c.fixed;
    if (fixedCost < 0) throw Error("변경 후 고정비가 음수입니다. 고정비 감소액을 줄여 주세요.");
    const cost = variableCost + fixedCost;
    return { revenue, variableCost, fixedCost, cost, profit: revenue - cost, delta: revenue - cost - a.profit, conditions: c };
  }
  function parseCSV(text) {
    const records = []; let row = [], value = "", quoted = false, closed = false;
    text = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { value += '"'; i++; }
        else if (ch === '"') { quoted = false; closed = true; }
        else value += ch;
      } else if (ch === '"') {
        if (value || closed) throw Error("CSV 따옴표 형식이 올바르지 않습니다.");
        quoted = true;
      } else if (ch === "," || ch === "\n" || ch === "\r") {
        row.push(value); value = ""; closed = false;
        if (ch !== ",") { if (row.some(v => v.trim())) records.push(row); row = []; if (ch === "\r" && text[i + 1] === "\n") i++; }
      } else { if (closed) throw Error("CSV 닫는 따옴표 뒤에 잘못된 문자가 있습니다."); value += ch; }
    }
    if (quoted) throw Error("CSV의 닫히지 않은 따옴표를 확인해 주세요.");
    row.push(value); if (row.some(v => v.trim())) records.push(row);
    const expected = ["month", "revenue", "variableCost", "fixedCost"];
    if (!records.length || records[0].map(v => v.trim()).join(",") !== expected.join(",")) throw Error("CSV 첫 줄은 month,revenue,variableCost,fixedCost여야 합니다. 양식 파일을 사용해 주세요.");
    return validate(records.slice(1).map((r, i) => {
      if (r.length !== 4) throw Error(`CSV ${i + 2}행: 4개 항목이 필요합니다.`);
      return Object.fromEntries(expected.map((key, j) => [key, r[j].trim()]));
    }));
  }
  return { validate, summarize, simulate, parseCSV };
})();
if (typeof module !== "undefined") module.exports = Analysis;
if (typeof document !== "undefined") initializeApp();

function initializeApp() {
  const $ = id => document.getElementById(id);
  const money = n => `${Math.round(n).toLocaleString("ko-KR")}원`;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let summary = null, scenario = null, selection = null, sampleMode = false, fileVersion = 0;
  const example = [
    { month: "2026-01", revenue: 12000000, variableCost: 4200000, fixedCost: 5000000 },
    { month: "2026-02", revenue: 12800000, variableCost: 4600000, fixedCost: 5000000 },
    { month: "2026-03", revenue: 11600000, variableCost: 4400000, fixedCost: 5100000 },
    { month: "2026-04", revenue: 13900000, variableCost: 5100000, fixedCost: 5100000 },
    { month: "2026-05", revenue: 14600000, variableCost: 5500000, fixedCost: 5300000 },
    { month: "2026-06", revenue: 14200000, variableCost: 5700000, fixedCost: 5300000 }
  ];
  function message(id, text, bad = false) { $(id).textContent = text; $(id).className = text ? (bad ? "error" : "success") : ""; }
  function invalidateScenario() {
    scenario = null; selection = null;
    $("sim-result").hidden = true; $("choice-content").hidden = true; $("choice-empty").hidden = false; $("report").disabled = true;
    message("sim-message", ""); message("decision-result", ""); $("reason").value = "";
    document.querySelectorAll("[data-choice]").forEach(b => { b.classList.remove("selected"); b.setAttribute("aria-pressed", "false"); });
  }
  function invalidate() {
    summary = null; invalidateScenario();
    $("overview-content").hidden = true; $("overview-empty").hidden = false; $("scenario-fields").disabled = true; $("status").textContent = "입력 확인 필요";
    message("message", "");
  }
  function addRow(data = {}) {
    if ($("rows").children.length >= 120) { message("message", "최대 120개월까지 입력할 수 있습니다.", true); return; }
    const tr = document.createElement("tr");
    for (const [key, label] of [["month", "월"], ["revenue", "매출"], ["variableCost", "변동비"], ["fixedCost", "고정비"]]) {
      const td = document.createElement("td"), input = document.createElement("input");
      input.type = key === "month" ? "month" : "number";
      input.dataset.key = key; input.setAttribute("aria-label", label); input.value = data[key] ?? "";
      if (key !== "month") { input.min = "0"; input.max = "1000000000000"; input.step = "1"; input.placeholder = "0"; }
      else { input.min = "1900-01"; input.max = "2199-12"; }
      input.addEventListener("input", invalidate); td.append(input); tr.append(td);
    }
    const td = document.createElement("td"), remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button"; remove.textContent = "삭제";
    remove.addEventListener("click", () => { tr.remove(); invalidate(); }); td.append(remove); tr.append(td); $("rows").append(tr);
  }
  function getRows() { return [...$("rows").children].map(tr => Object.fromEntries([...tr.querySelectorAll("input")].map(i => [i.dataset.key, i.value]))); }
  function setRows(rows) { $("rows").replaceChildren(); rows.forEach(addRow); invalidate(); }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type })); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("add-row").addEventListener("click", () => { addRow(); invalidate(); });
  $("reset").addEventListener("click", () => { fileVersion++; sampleMode = false; setRows([{}]); $("csv").value = ""; $("source-label").textContent = "직접 입력 · 데이터는 이 브라우저 메모리에서만 처리됩니다."; for (const id of ["price", "volume", "variable", "fixed"]) $(id).value = "0"; $("status").textContent = "데이터 입력 대기"; });
  $("sample").addEventListener("click", () => { fileVersion++; sampleMode = true; setRows(example); $("csv").value = ""; $("source-label").textContent = "시연용 가상 데이터 · 실제 사업 실적이 아닙니다."; analyze(); });
  $("template").addEventListener("click", () => download("aletheia-template.csv", "\uFEFFmonth,revenue,variableCost,fixedCost\n2026-01,12000000,4200000,5000000\n2026-02,12800000,4600000,5000000\n", "text/csv;charset=utf-8"));
  $("csv").addEventListener("change", async event => {
    const file = event.target.files[0]; if (!file) return; const version = ++fileVersion;
    invalidate();
    try {
      if (file.size > 1024 * 1024) throw Error("1MB 이하의 CSV 파일을 사용해 주세요.");
      const text = await file.text(); if (version !== fileVersion) return;
      const data = Analysis.parseCSV(text); sampleMode = false; setRows(data); $("source-label").textContent = `CSV: ${file.name} · 브라우저에서 처리됨`; message("message", "CSV를 불러왔습니다. 내용을 확인한 후 분석해 주세요.");
    } catch (error) { if (version === fileVersion) message("message", error.message, true); }
    finally { if (version === fileVersion) event.target.value = ""; }
  });
  function analyze() {
    invalidate();
    try {
      summary = Analysis.summarize(getRows());
      $("overview-content").hidden = false; $("overview-empty").hidden = true; $("scenario-fields").disabled = false;
      $("status").textContent = sampleMode ? "가상 데이터 분석 완료" : "현황 분석 완료";
      const { rows, totals, margin } = summary;
      $("period").textContent = `${rows[0].month} ~ ${rows.at(-1).month} · ${rows.length}개월 합계${sampleMode ? " · 시연용 가상 데이터" : ""}`;
      $("metrics").innerHTML = [["총매출", money(totals.revenue), "입력 기간 합계"], ["총비용", money(totals.cost), "변동비 + 고정비"], ["입력 비용 기준 이익", money(totals.profit), "미입력 비용은 제외"], ["이익률", margin === null ? "계산 불가" : `${margin.toFixed(1)}%`, margin === null ? "매출이 0원입니다" : "입력 비용 기준"]].map(([label, value, hint]) => `<article class="metric"><p>${label}</p><strong>${value}</strong><small>${hint}</small></article>`).join("");
      const notes = [];
      if (rows.length < 2) notes.push("1개월 데이터이므로 변화 추이는 분석하지 않습니다. 시뮬레이션은 해당 월만을 기준으로 계산합니다.");
      else {
        const last = rows.at(-1), previous = rows.at(-2);
        notes.push(previous.revenue === 0 ? "직전 월 매출이 0원이므로 매출 변화율은 계산할 수 없습니다." : `${last.month} 매출은 직전 월 대비 ${((last.revenue - previous.revenue) / previous.revenue * 100).toFixed(1)}% 변했습니다. 변화의 원인은 이 데이터만으로 확인할 수 없습니다.`);
        notes.push(`최근 월 총비용은 직전 월보다 ${money(Math.abs(last.cost - previous.cost))} ${last.cost > previous.cost ? "증가" : last.cost < previous.cost ? "감소" : "변동 없음"}${last.cost === previous.cost ? "입니다." : "했습니다."}`);
      }
      const losses = rows.filter(r => r.profit < 0).length;
      notes.push(losses ? `${rows.length}개월 중 ${losses}개월은 입력 비용이 매출보다 큽니다. 비용 구성과 누락된 항목을 점검해 보세요.` : "입력 기간에 비용이 매출을 초과한 월은 없습니다. 미입력 비용이 있는지 확인해 주세요.");
      notes.push("이 해석은 비교 규칙으로 작성됩니다. 사업 성공이나 특정 행동의 효과를 보장하지 않습니다.");
      $("insights").innerHTML = notes.map(t => `<li>${esc(t)}</li>`).join("");
      renderChart(rows); message("message", "분석이 완료되었습니다. 아래에서 조건을 바꾸어 비교할 수 있습니다.");
    } catch (error) { summary = null; message("message", error.message, true); }
  }
  function renderChart(rows) {
    const w = 680, h = 265, left = 72, right = 18, top = 20, bottom = 42;
    const max = Math.max(1, ...rows.flatMap(r => [r.revenue, r.cost]));
    const x = i => rows.length === 1 ? (w + left - right) / 2 : left + i * (w - left - right) / (rows.length - 1);
    const y = n => h - bottom - n / max * (h - top - bottom);
    let svg = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="입력 기간 월별 매출과 총비용 선 그래프"><title>월별 매출 및 비용, 원 단위</title>`;
    for (let i = 0; i <= 4; i++) { const n = max * i / 4; svg += `<line x1="${left}" y1="${y(n)}" x2="${w - right}" y2="${y(n)}" stroke="#e1e9eb"/><text x="${left - 8}" y="${y(n) + 4}" text-anchor="end" fill="#596d76" font-size="12">${n >= 1e8 ? (n / 1e8).toFixed(1) + "억" : n >= 1e4 ? (n / 1e4).toFixed(0) + "만" : n.toFixed(0)}</text>`; }
    for (const [key, color] of [["revenue", "#0f766e"], ["cost", "#64748b"]]) {
      svg += `<polyline fill="none" stroke="${color}" stroke-width="3" ${key === "cost" ? 'stroke-dasharray="6 4"' : ""} points="${rows.map((r, i) => `${x(i)},${y(r[key])}`).join(" ")}"/>`;
      rows.forEach((r, i) => { svg += `<circle cx="${x(i)}" cy="${y(r[key])}" r="3" fill="${color}"><title>${esc(r.month)} ${key === "revenue" ? "매출" : "총비용"}: ${money(r[key])}</title></circle>`; });
    }
    rows.forEach((r, i) => { if (i % Math.max(1, Math.ceil(rows.length / 5)) === 0 || i === rows.length - 1) svg += `<text x="${x(i)}" y="${h - 12}" text-anchor="middle" font-size="12" fill="#596d76">${esc(r.month)}</text>`; });
    $("chart").innerHTML = svg + "</svg>";
  }
  $("analyze").addEventListener("click", analyze);
  for (const id of ["price", "volume", "variable", "fixed"]) $(id).addEventListener("input", invalidateScenario);
  $("simulate").addEventListener("click", () => {
    invalidateScenario(); if (!summary) return;
    try {
      scenario = Analysis.simulate(summary, Object.fromEntries(["price", "volume", "variable", "fixed"].map(k => [k, $(k).value])));
      const c = scenario.conditions;
      const card = (name, data) => `<article><h3>${name}</h3><dl><dt>월매출</dt><dd>${money(data.revenue)}</dd><dt>월총비용</dt><dd>${money(data.cost)}</dd><dt>월이익</dt><dd><strong>${money(data.profit)}</strong></dd></dl></article>`;
      $("sim-result").innerHTML = `<div class="comparison">${card("기존 월평균", summary.average)}${card("변경 조건 적용", scenario)}</div><p><strong>입력 비용 기준 월이익 차이: ${scenario.delta > 0 ? "+" : ""}${money(scenario.delta)}</strong></p><p class="muted">가정: 판매가격 ${c.price}%, 판매량 ${c.volume}%, 단위당 변동비 ${c.variable}%, 고정비 증감 ${money(c.fixed)}. 실제 미래 결과가 아닌 조건부 계산이며, 표시 금액은 원 단위 반올림입니다.</p>`;
      $("sim-result").hidden = false; $("choice-content").hidden = false; $("choice-empty").hidden = true; $("report").disabled = false;
      $("choice-rows").innerHTML = `<tr><td><strong>기존 조건 유지</strong></td><td>비교 기준 월이익 ${money(summary.average.profit)}. 입력 기간의 평균 구조를 유지하는 방안입니다.</td><td>과거 평균이 지속된다는 보장은 없습니다. 기존 비용 구조의 문제도 남을 수 있습니다.</td></tr><tr><td><strong>변경 조건 적용</strong></td><td>조건부 월이익 ${money(scenario.profit)}, 기존 대비 ${money(scenario.delta)}. ${scenario.delta > 0 ? "설정한 가정에서는 이익이 증가합니다." : scenario.delta < 0 ? "설정한 가정에서는 이익이 감소합니다." : "설정한 가정에서는 이익 차이가 없습니다."}</td><td>설정한 판매량·비용 조건의 실현 가능성을 확인해야 합니다. 고객 반응, 실행 비용, 계절성은 반영되지 않습니다.</td></tr><tr><td><strong>추가 검토</strong></td><td>조건의 근거와 누락 비용을 확인한 뒤 다시 비교합니다. 불확실한 가정에 대한 점검 기회를 확보합니다.</td><td>자료를 확보하는 시간과 노력이 필요하고 결정이 늦어질 수 있습니다.</td></tr>`;
      message("sim-message", "조건별 비교가 완료되었습니다. 아래에서 방안을 검토해 주세요.");
    } catch (error) { scenario = null; message("sim-message", error.message, true); }
  });
  function showSelection() { if (selection) message("decision-result", `선택: ${selection}${$("reason").value.trim() ? " · 이유: " + $("reason").value.trim() : ""}. 화면에만 표시되며 실제 거래는 실행되지 않습니다.`); }
  $("reason").addEventListener("input", showSelection);
  $("choose-buttons").addEventListener("click", event => {
    const button = event.target.closest("[data-choice]"); if (!button || !scenario) return;
    selection = button.dataset.choice;
    document.querySelectorAll("[data-choice]").forEach(b => { b.classList.toggle("selected", b === button); b.setAttribute("aria-pressed", String(b === button)); }); showSelection();
  });
  $("report").addEventListener("click", () => {
    if (!summary || !scenario) return;
    const body = ["ALETHEIA 분석 보고서", sampleMode ? "시연용 가상 데이터" : "사용자 입력 데이터", $("period").textContent, "\n[핵심 지표]", $("metrics").innerText, "\n[규칙 기반 해석]", $("insights").innerText, "\n[조건부 시뮬레이션]", $("sim-result").innerText, "\n[선택지 비교]", $("choice-rows").innerText, "\n[사용자 선택]", selection || "선택 전", $("reason").value, "\n[원본 데이터와 계산값]", JSON.stringify(summary, null, 2), "\n[가정과 한계]", "매출 = 월평균 매출 × 가격 배율 × 판매량 배율. 변동비 = 월평균 변동비 × 단위당 비용 배율 × 판매량 배율. 고정비 = 월평균 고정비 + 증감액. 이익 = 매출 − 변동비 − 고정비. 상품 구성은 유지된다고 가정하며, 미입력 비용·세금·계절성·시장 변화·고객 반응은 반영하지 않습니다. 미래 성과를 보장하지 않습니다. 생성형 AI를 사용하지 않는 규칙 기반 분석입니다."].join("\n");
    download("ALETHEIA-report.txt", body, "text/plain;charset=utf-8");
  });
  addRow();
}
