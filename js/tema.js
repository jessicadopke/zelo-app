// Zelo: tema Automático / Claro / Escuro. Funções puras recebem o que precisam (testáveis sem navegador).
var Tema = (function () {
  var CHAVE = "zelo-tema";
  var COR_CLARO = "#F4F7F7";
  var COR_ESCURO = "#0C1A1D";

  // Valor guardado -> "auto" | "light" | "dark". Qualquer outra coisa vale como Automático.
  function normalizar(v) { return v === "light" || v === "dark" ? v : "auto"; }

  function ler(storage) {
    try { return normalizar(storage.getItem(CHAVE)); } catch (e) { return "auto"; }
  }
  // Automático apaga a chave. Devolve o valor normalizado.
  function salvar(storage, v) {
    v = normalizar(v);
    try {
      if (v === "auto") storage.removeItem(CHAVE); else storage.setItem(CHAVE, v);
    } catch (e) {}
    return v;
  }
  // Cor das metas theme-color: no manual as duas recebem a cor do tema; no automático voltam às originais.
  function coresDasMetas(v) {
    v = normalizar(v);
    if (v === "light") return { claro: COR_CLARO, escuro: COR_CLARO };
    if (v === "dark") return { claro: COR_ESCURO, escuro: COR_ESCURO };
    return { claro: COR_CLARO, escuro: COR_ESCURO };
  }
  // Aplica no documento: data-theme no <html> e as duas metas theme-color (claro primeiro, escuro depois).
  function aplicar(doc, v) {
    v = normalizar(v);
    var raiz = doc.documentElement;
    if (v === "auto") raiz.removeAttribute("data-theme"); else raiz.setAttribute("data-theme", v);
    var metas = doc.querySelectorAll('meta[name="theme-color"]');
    var c = coresDasMetas(v);
    if (metas[0]) metas[0].setAttribute("content", c.claro);
    if (metas[1]) metas[1].setAttribute("content", c.escuro);
    return v;
  }
  return { CHAVE: CHAVE, normalizar: normalizar, ler: ler, salvar: salvar, coresDasMetas: coresDasMetas, aplicar: aplicar };
})();
if (typeof module !== "undefined") module.exports = Tema;
