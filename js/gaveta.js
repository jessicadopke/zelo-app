// Zelo: gaveta de navegação (menu ☰). Só abre por toque no botão; nada de gesto de borda (a borda é do "voltar" do Android).
// Lógica separada do histórico: quem usa passa `historico.empurrar()` (ao abrir) e `historico.voltar()` (para fechar).
// Fechar por ×, véu, Escape ou item chama `voltar()`; quando o histórico volta, o app chama `aoVoltar()` e a gaveta fecha.
// Texto sempre como textContent. No navegador vira o objeto global Gaveta.
var Gaveta = (function () {
  // env: { doc, grupos, rotulo(id), itens(grupoId, rotaAtual) -> [{ id, texto, atual }] (opcional; sem ele, as telas do grupo), atual() -> id da tela à vista, ir(id), historico: { empurrar, voltar }, resto (elemento que fica inerte) }
  // Elementos esperados no HTML: #gaveta (fundo), #gaveta-veu, #gaveta-fechar, #gaveta-lista e o botão #menu-btn (☰).
  function criar(env) {
    var doc = env.doc;
    var fundo = doc.getElementById("gaveta");
    var veu = doc.getElementById("gaveta-veu");
    var botaoFechar = doc.getElementById("gaveta-fechar");
    var lista = doc.getElementById("gaveta-lista");
    var menu = doc.getElementById("menu-btn");
    var aberta = false;
    var escolha = null;

    function item(id, texto, marcado) {
      var li = doc.createElement("li");
      var a = doc.createElement("a");
      a.className = "gaveta-item";
      a.setAttribute("href", "#" + id);
      a.setAttribute("data-id", id);
      if (marcado) a.setAttribute("aria-current", "page");
      a.textContent = texto;
      a.addEventListener("click", function (e) {
        if (e && e.preventDefault) e.preventDefault();
        escolher(id);
      });
      li.appendChild(a);
      return li;
    }

    // Desenha a lista a partir dos grupos; o item da tela atual leva aria-current.
    function desenhar() {
      var atual = env.atual();
      lista.textContent = "";
      env.grupos.forEach(function (g) {
        var bloco = doc.createElement("li");
        bloco.className = "gaveta-grupo";
        var ul = doc.createElement("ul");
        ul.className = "gaveta-itens";
        if (g.id !== "inicio") { // o Início é só uma linha, sem título
          var h = doc.createElement("h2");
          h.className = "gaveta-titulo";
          h.setAttribute("id", "gaveta-g-" + g.id);
          h.textContent = g.rotulo;
          bloco.appendChild(h);
          ul.setAttribute("aria-labelledby", "gaveta-g-" + g.id);
        }
        var itens = env.itens
          ? env.itens(g.id, atual)
          : g.telas.map(function (t) { return { id: t, texto: env.rotulo(t), atual: t === atual }; });
        itens.forEach(function (it) { ul.appendChild(item(it.id, it.texto, it.atual)); });
        bloco.appendChild(ul);
        lista.appendChild(bloco);
      });
    }

    function abrir() {
      if (aberta) return;
      desenhar();
      aberta = true;
      fundo.hidden = false;
      env.resto.inert = true;
      menu.setAttribute("aria-expanded", "true");
      botaoFechar.focus();
      env.historico.empurrar();
    }
    function pedirFechar() {
      if (aberta) env.historico.voltar();
    }
    function escolher(id) {
      if (!aberta) return;
      escolha = id;
      env.historico.voltar();
    }
    // O histórico voltou (Voltar do Android, ou o `voltar()` que a própria gaveta pediu): fecha e, se havia item escolhido, vai a ele.
    // Devolve true se tinha gaveta aberta (o app não faz mais nada com esse Voltar).
    function aoVoltar() {
      if (!aberta) return false;
      var id = escolha;
      escolha = null;
      aberta = false;
      fundo.hidden = true;
      env.resto.inert = false;
      menu.setAttribute("aria-expanded", "false");
      if (id) env.ir(id);
      else menu.focus();
      return true;
    }

    menu.addEventListener("click", abrir);
    botaoFechar.addEventListener("click", pedirFechar);
    veu.addEventListener("click", pedirFechar);
    fundo.addEventListener("keydown", function (e) {
      if (e && e.key === "Escape") pedirFechar();
    });

    return { abrir: abrir, pedirFechar: pedirFechar, escolher: escolher, aoVoltar: aoVoltar, aberta: function () { return aberta; } };
  }

  return { criar: criar };
})();
if (typeof module !== "undefined") module.exports = Gaveta;
