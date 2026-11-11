// Zelo: botão "+" que muda por tela e a folha "O que você quer fazer?" (#159). Lógica pura (opcoes, rotulo, visivel, tecladoAberto)
// separada do desenho. A folha empilha uma entrada no histórico (como a gaveta): quem usa passa `historico.empurrar()` e `historico.voltar()`;
// quando o histórico volta, o app chama `aoVoltar()`. Texto sempre como textContent. No navegador vira o objeto global Mais.
var Mais = (function () {
  var SVG_NS = "http://www.w3.org/2000/svg";
  // Ordem fixa das ações possíveis. O app só entrega as que existem; uma ausente some.
  var TODAS = [
    { id: "novo", texto: "Novo lançamento", icone: "i-mais" },
    { id: "ler", texto: "Ler comprovante", icone: "i-arquivo" },
    { id: "conta", texto: "Nova conta a pagar", icone: "i-contas" },
    { id: "fixa", texto: "Nova conta fixa", icone: "i-contas" },
    { id: "nota", texto: "Nova nota", icone: "i-arquivo" },
    { id: "compromisso", texto: "Novo compromisso", icone: "i-comp" },
  ];
  // O que cada tela oferece (antes de tirar as ações que não existem). Telas fora da tabela (Reserva, Conversa, Notas, Agenda, Ajustes): nada.
  var POR_TELA = {
    inicio: ["novo", "ler", "conta", "nota"],
    lancamentos: ["novo", "ler"],
    resumo: ["novo", "ler"],
    contas: ["conta", "fixa"],
    fixas: ["conta", "fixa"],
  };

  // opcoes("inicio", { novo: fn, ler: fn }) -> [{ id, texto, icone }] na ordem fixa. `acoes` é o que o app consegue fazer (função presente = existe).
  function opcoes(tela, acoes) {
    var quer = POR_TELA[tela] || [];
    var tem = acoes || {};
    return TODAS.filter(function (o) { return quer.indexOf(o.id) >= 0 && !!tem[o.id]; });
  }
  // Texto do aria-label: "Criar: Novo lançamento, Ler comprovante" ou, com uma só opção, o nome dela.
  function rotulo(lista) {
    if (!lista.length) return "";
    if (lista.length === 1) return lista[0].texto;
    return "Criar: " + lista.map(function (o) { return o.texto; }).join(", ");
  }
  // Teclado aberto: campo de texto com foco, ou a altura visível bem menor que a da tela (menos de 75 %).
  function tecladoAberto(i) {
    if (i.campoDeTexto) return true;
    return !!(i.alturaTela > 0 && i.alturaVisivel > 0 && i.alturaVisivel < i.alturaTela * 0.75);
  }
  // O botão aparece só com ao menos uma opção e nada por cima (formulário, tela cheia, teclado, gaveta, folha).
  function visivel(i) {
    if (i.formAberto || i.tecladoAberto || i.gavetaAberta || i.folhaAberta) return false;
    return opcoes(i.tela, i.acoes).length > 0;
  }

  // env: { doc, atual() -> id da tela à vista, acoes: { novo(), ler(), conta(), fixa(), nota(), compromisso() } (só as que existem),
  //        resto (elemento que fica inerte), historico: { empurrar, voltar }, estado() -> { formAberto, tecladoAberto, gavetaAberta } (opcional) }
  // Elementos no HTML: #mais (botão), #mais-folha (fundo), #mais-veu, #mais-titulo, #mais-lista.
  function criar(env) {
    var doc = env.doc;
    var botao = doc.getElementById("mais");
    var fundo = doc.getElementById("mais-folha");
    var veu = doc.getElementById("mais-veu");
    var titulo = doc.getElementById("mais-titulo");
    var lista = doc.getElementById("mais-lista");
    var aberta = false;
    var escolha = null;
    var atuais = [];

    function icone(id) {
      var svg = doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "ic");
      svg.setAttribute("aria-hidden", "true");
      var uso = doc.createElementNS(SVG_NS, "use");
      uso.setAttribute("href", "#" + id);
      svg.appendChild(uso);
      return svg;
    }
    function desenhar() {
      lista.textContent = "";
      atuais.forEach(function (o) {
        var li = doc.createElement("li");
        var b = doc.createElement("button");
        b.className = "folha-mais-item";
        b.setAttribute("type", "button");
        b.setAttribute("data-id", o.id);
        b.appendChild(icone(o.icone));
        var t = doc.createElement("span");
        t.textContent = o.texto;
        b.appendChild(t);
        b.addEventListener("click", function () { escolher(o.id); });
        li.appendChild(b);
        lista.appendChild(li);
      });
    }
    // Recalcula as opções da tela à vista, o rótulo e se o botão aparece. O app chama a cada mudança (tela, formulário, teclado, gaveta).
    function atualizar() {
      var tela = env.atual();
      atuais = opcoes(tela, env.acoes);
      var s = env.estado ? env.estado() : {};
      var mostra = visivel({ tela: tela, acoes: env.acoes, formAberto: !!s.formAberto, tecladoAberto: !!s.tecladoAberto, gavetaAberta: !!s.gavetaAberta, folhaAberta: aberta });
      botao.hidden = !mostra;
      if (atuais.length) botao.setAttribute("aria-label", rotulo(atuais));
      else botao.removeAttribute("aria-label");
      botao.setAttribute("aria-haspopup", atuais.length > 1 ? "dialog" : "false");
    }

    function clicar() {
      if (aberta || !atuais.length) return;
      if (atuais.length === 1) { executar(atuais[0].id); return; }
      abrir();
    }
    function abrir() {
      if (aberta) return;
      desenhar();
      aberta = true;
      fundo.hidden = false;
      env.resto.inert = true;
      botao.hidden = true;
      titulo.focus();
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
    function executar(id) {
      var f = env.acoes && env.acoes[id];
      if (f) f();
    }
    // O histórico voltou (Voltar do Android, ou o `voltar()` que a própria folha pediu): fecha e, se havia opção escolhida, abre o destino
    // (já sem a entrada extra). Devolve true se tinha folha aberta (o app não faz mais nada com esse Voltar).
    function aoVoltar() {
      if (!aberta) return false;
      var id = escolha;
      escolha = null;
      aberta = false;
      fundo.hidden = true;
      env.resto.inert = false;
      atualizar();
      if (id) executar(id);
      else if (!botao.hidden) botao.focus();
      return true;
    }

    botao.addEventListener("click", clicar);
    veu.addEventListener("click", pedirFechar);
    fundo.addEventListener("keydown", function (e) {
      if (e && e.key === "Escape") pedirFechar();
    });
    atualizar();

    return { atualizar: atualizar, aoVoltar: aoVoltar, abrir: abrir, pedirFechar: pedirFechar, escolher: escolher, aberta: function () { return aberta; } };
  }

  return { opcoes: opcoes, rotulo: rotulo, visivel: visivel, tecladoAberto: tecladoAberto, criar: criar, TODAS: TODAS };
})();
if (typeof module !== "undefined") module.exports = Mais;
