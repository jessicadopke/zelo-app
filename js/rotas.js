// Zelo: rotas das abas (lógica pura, testada com node --test). No navegador vira o objeto global Rotas.
var Rotas = (function () {
  var ABAS = [
    { id: "inicio", rotulo: "Início" },
    { id: "lancamentos", rotulo: "Lançamentos" },
    { id: "resumo", rotulo: "Resumo" },
    { id: "ajustes", rotulo: "Ajustes" },
  ];
  var PADRAO = "inicio";

  // "#resumo" -> "resumo". Hash vazio ou inválido cai no Início.
  function abaDoHash(hash) {
    var id = String(hash || "").replace(/^#/, "");
    return ABAS.some(function (a) { return a.id === id; }) ? id : PADRAO;
  }
  function rotulo(id) {
    var a = ABAS.filter(function (x) { return x.id === id; })[0];
    return a ? a.rotulo : "";
  }
  function titulo(id) {
    return id === PADRAO ? "Zelo" : rotulo(id) + " · Zelo";
  }
  // Direção da animação: "dir" se a nova aba está à direita da atual, "esq" se à esquerda, null se igual.
  function direcao(de, para) {
    var i = ABAS.findIndex(function (a) { return a.id === de; });
    var j = ABAS.findIndex(function (a) { return a.id === para; });
    if (i === j) return null;
    return j > i ? "dir" : "esq";
  }
  return { ABAS: ABAS, PADRAO: PADRAO, abaDoHash: abaDoHash, rotulo: rotulo, titulo: titulo, direcao: direcao };
})();
if (typeof module !== "undefined") module.exports = Rotas;
