// Zelo: fila de abas de um grupo (Dinheiro hoje; a #160 reaproveita para Zelo e Sistema). Acessível: tablist/tab, aria-selected,
// setas, Home e End movem o foco (a aba só muda com toque, Enter ou Espaço). Texto sempre como textContent.
// No navegador vira o objeto global AbasGrupo.
var AbasGrupo = (function () {
  // env: { doc, raiz (o elemento tablist), rotas (Rotas: abasVisiveis, abaDoGrupo, grupoDaBarra), rotuloGrupo (aria-label da fila), aoEscolher(abaId) }
  function criar(env) {
    var doc = env.doc;
    var raiz = env.raiz;
    var ids = [];
    var botoes = [];

    function nomeDoGrupo(grupo) {
      var g = env.rotas.GRUPOS.filter(function (x) { return x.id === grupo; })[0];
      return g ? g.rotulo : "";
    }
    function mover(de, passo) {
      var n = botoes.length;
      if (!n) return;
      var para = passo === "inicio" ? 0 : passo === "fim" ? n - 1 : (de + passo + n) % n;
      botoes[para].focus();
    }
    function aoTeclar(e, i) {
      var k = e && e.key;
      var passo = k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : k === "Home" ? "inicio" : k === "End" ? "fim" : 0;
      if (!passo) return;
      if (e.preventDefault) e.preventDefault();
      mover(i, passo);
    }
    function desenhar(abas) {
      raiz.textContent = "";
      botoes = abas.map(function (a, i) {
        var b = doc.createElement("button");
        b.className = "aba";
        b.setAttribute("type", "button");
        b.setAttribute("role", "tab");
        b.setAttribute("data-aba", a.id);
        b.textContent = a.rotulo;
        b.addEventListener("click", function () { env.aoEscolher(a.id); });
        b.addEventListener("keydown", function (e) { aoTeclar(e, i); });
        raiz.appendChild(b);
        return b;
      });
    }

    // Mostra a fila do grupo da rota à vista, com a aba certa marcada. Grupo sem abas (ou tela cheia): a fila some.
    function mostrar(rota) {
      var grupo = env.rotas.grupoDaBarra(rota);
      var abas = env.rotas.abasVisiveis(grupo);
      if (!abas.length) {
        raiz.hidden = true;
        raiz.textContent = "";
        ids = [];
        botoes = [];
        return;
      }
      raiz.hidden = false;
      raiz.setAttribute("role", "tablist");
      raiz.setAttribute("aria-label", nomeDoGrupo(grupo));
      var novos = abas.map(function (a) { return a.id; });
      if (novos.join("|") !== ids.join("|")) { ids = novos; desenhar(abas); }
      var ativa = env.rotas.abaDoGrupo(rota);
      abas.forEach(function (a, i) {
        var b = botoes[i];
        var sel = a.id === ativa;
        b.setAttribute("aria-selected", sel ? "true" : "false");
        b.setAttribute("tabindex", sel ? "0" : "-1");
      });
    }

    return { mostrar: mostrar };
  }
  return { criar: criar };
})();
if (typeof module !== "undefined") module.exports = AbasGrupo;
