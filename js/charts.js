// @ts-check
/* ==========================================================================
   PZ.charts — gráficos livianos en HTML/CSS (sin librerías)
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  PZ.charts = {
    /** Barras verticales. data = [{label, value}] */
    bars(data, { money = true } = {}) {
      const max = Math.max(1, ...data.map((d) => d.value));
      return `<div class="bars">${data.map((d, i) => `
        <div class="bar"><i style="height:${(d.value / max) * 100}%;animation-delay:${i * 0.03}s" data-v="${money ? U.money(d.value) : d.value}"></i><span>${i % Math.ceil(data.length / 16) ? '' : U.esc(d.label)}</span></div>`).join('')}</div>`;
    },

    /** Barras horizontales (ranking). */
    hbars(data, { money = false, suffix = '' } = {}) {
      if (!data.length) return '<div class="empty small">Sin datos todavía</div>';
      const max = Math.max(1, ...data.map((d) => d.value));
      return `<div class="hbars">${data.map((d, i) => `
        <div class="hb"><span class="hb-name" title="${U.esc(d.label)}">${U.esc(d.label)}</span>
          <div class="hb-track"><div class="hb-fill" style="width:${(d.value / max) * 100}%;animation-delay:${i * 0.05}s"></div></div>
          <span class="hb-val">${money ? U.money(d.value) : U.num(d.value) + suffix}</span></div>`).join('')}</div>`;
    },

    /** Torta tipo dona. data = [{label, value, color}] */
    donut(data, { money = true } = {}) {
      const total = data.reduce((a, d) => a + d.value, 0);
      if (!total) return '<div class="empty small">Sin datos todavía</div>';
      let acc = 0;
      const stops = data.map((d) => {
        const from = (acc / total) * 360;
        acc += d.value;
        return `${d.color} ${from}deg ${(acc / total) * 360}deg`;
      }).join(',');
      return `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${stops})"></div>
        <div class="legend-list">${data.map((d) => `<div><i style="background:${d.color}"></i>${U.esc(d.label)} · ${money ? U.money(d.value) : d.value} <span class="muted">(${Math.round((d.value / total) * 100)}%)</span></div>`).join('')}</div></div>`;
    },

    /** Barras apiladas. rows = [{label, values:[...]}], series = [{label, color}] */
    stacked(rows, series) {
      const max = Math.max(1, ...rows.map((r) => r.values.reduce((a, b) => a + b, 0)));
      if (!rows.some((r) => r.values.some((v) => v))) return '<div class="empty small">Sin ventas en el período</div>';
      return `<div class="bars stacked">${rows.map((r, i) => {
        const tot = r.values.reduce((a, b) => a + b, 0);
        return `<div class="bar" title="${U.esc(r.label)}: ${U.money(tot)}"><div class="stack" style="height:${(tot / max) * 100}%;animation-delay:${i * 0.03}s">${r.values.map((v, j) => (v ? `<i style="flex:${v};background:${series[j].color}" title="${U.esc(series[j].label)}: ${U.money(v)}"></i>` : '')).join('')}</div><span>${i % Math.ceil(rows.length / 14) ? '' : U.esc(r.label)}</span></div>`;
      }).join('')}</div>
      <div class="legend-list row-flex" style="gap:14px">${series.map((s) => `<div><i style="background:${s.color}"></i>${U.esc(s.label)}</div>`).join('')}</div>`;
    },

    /** Barras agrupadas (ej. ventas vs. gastos). rows = [{label, values:[a,b]}] */
    grouped(rows, series) {
      const max = Math.max(1, ...rows.flatMap((r) => r.values));
      if (!rows.some((r) => r.values.some((v) => v))) return '<div class="empty small">Sin movimientos en el período</div>';
      return `<div class="bars grouped">${rows.map((r, i) => `
        <div class="bar"><div class="grp">${r.values.map((v, j) => `<i style="height:${(v / max) * 100}%;background:${series[j].color};animation-delay:${i * 0.03}s" data-v="${U.esc(series[j].label)}: ${U.money(v)}"></i>`).join('')}</div><span>${i % Math.ceil(rows.length / 14) ? '' : U.esc(r.label)}</span></div>`).join('')}</div>
        <div class="legend-list row-flex" style="gap:14px">${series.map((s) => `<div><i style="background:${s.color}"></i>${U.esc(s.label)}</div>`).join('')}</div>`;
    },

    methodColors: { efectivo: '#2d6a4f', transferencia: '#1d7bd7', qr: '#00a3e0', tarjeta: '#8e44ad' },
  };
})(window.PZ);
