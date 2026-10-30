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
  // Telas de tela cheia, fora das abas: "#novo" -> { tipo: "novo" }; "#editar/<id>" -> { tipo: "editar", id }. O resto -> null.
  // O id só pode ter letras, números e traço (o que o app gera); qualquer outra coisa não abre nada.
  function telaDoHash(hash) {
    var h = String(hash || "").replace(/^#/, "");
    if (h === "novo") return { tipo: "novo" };
    var m = /^editar\/([0-9A-Za-z-]{1,64})$/.exec(h);
    return m ? { tipo: "editar", id: m[1] } : null;
  }
  return { ABAS: ABAS, PADRAO: PADRAO, abaDoHash: abaDoHash, telaDoHash: telaDoHash, rotulo: rotulo, titulo: titulo, direcao: direcao };
})();
if (typeof module !== "undefined") module.exports = Rotas;
