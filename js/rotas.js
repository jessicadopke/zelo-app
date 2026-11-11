// Zelo: rotas das telas e dos grupos da barra (lógica pura, testada com node --test). No navegador vira o objeto global Rotas.
var Rotas = (function () {
  // Telas com <section data-tela> (a ordem é a da direção da animação). Contas e Reserva são abas do grupo Dinheiro.
  var TELAS = [
    { id: "inicio", rotulo: "Início" },
    { id: "lancamentos", rotulo: "Lançamentos" },
    { id: "resumo", rotulo: "Resumo" },
    { id: "contas", rotulo: "Contas a pagar" },
    { id: "reserva", rotulo: "Reserva" },
    { id: "ajustes", rotulo: "Ajustes" },
    { id: "conversa", rotulo: "Conversa" },
    { id: "notas", rotulo: "Notas" },
    { id: "compromissos", rotulo: "Compromissos" },
  ];
  // Grupos da barra de baixo e da gaveta, na ordem em que aparecem.
  var GRUPOS = [
    { id: "inicio", rotulo: "Início", icone: "i-casa", telas: ["inicio"] },
    {
      id: "dinheiro", rotulo: "Dinheiro", icone: "i-dinheiro", telas: ["lancamentos", "resumo", "contas", "reserva"],
      // Fila de abas do grupo. "rotas": telas que a aba acende (Mês junta Lançamentos e Resumo). "disponivel:false": ainda não existe
      // (Fixas, até a #154 ligar), então não aparece.
      abas: [
        { id: "lancamentos", rotulo: "Mês", rotas: ["lancamentos", "resumo"] },
        { id: "contas", rotulo: "Contas" },
        { id: "fixas", rotulo: "Fixas", disponivel: false },
        { id: "reserva", rotulo: "Reserva" },
      ],
    },
    { id: "zelo", rotulo: "Zelo", icone: "i-zelo", telas: ["conversa", "notas"] },
    { id: "agenda", rotulo: "Agenda", icone: "i-agenda", telas: ["compromissos"] },
    { id: "sistema", rotulo: "Sistema", icone: "i-ajustes", telas: ["ajustes"] },
  ];
  var PADRAO = "inicio";

  // "#resumo" -> "resumo". Hash vazio ou inválido cai no Início.
  function abaDoHash(hash) {
    var id = String(hash || "").replace(/^#/, "");
    return TELAS.some(function (a) { return a.id === id; }) ? id : PADRAO;
  }
  function rotulo(id) {
    var a = TELAS.filter(function (x) { return x.id === id; })[0];
    return a ? a.rotulo : "";
  }
  function titulo(id) {
    return id === PADRAO ? "Zelo" : rotulo(id) + " · Zelo";
  }
  // Grupo da barra a que a rota pertence (inclusive Contas e Reserva). Desconhecida cai no Início.
  function grupoDaBarra(id) {
    var g = GRUPOS.filter(function (x) { return x.telas.indexOf(id) >= 0; })[0];
    return g ? g.id : PADRAO;
  }
  // Primeira tela de cada grupo: a que a barra abre.
  function primeiraTela(grupo) {
    var g = GRUPOS.filter(function (x) { return x.id === grupo; })[0];
    return g ? g.telas[0] : PADRAO;
  }
  // Direção da animação: "dir" se a nova tela está à direita da atual, "esq" se à esquerda, null se igual.
  function direcao(de, para) {
    var i = TELAS.findIndex(function (a) { return a.id === de; });
    var j = TELAS.findIndex(function (a) { return a.id === para; });
    if (i === j) return null;
    return j > i ? "dir" : "esq";
  }
  // O que fazer com o histórico ao ir de uma tela para outra. A pilha é sempre Início -> tela atual:
  // "empurrar" (do Início para outra), "trocar" (de uma tela de grupo para outra), "voltar" (de uma tela de grupo para o Início), null (mesma).
  function comoNavegar(de, para) {
    if (de === para) return null;
    if (de === PADRAO) return "empurrar";
    return para === PADRAO ? "voltar" : "trocar";
  }
  function grupoPorId(id) {
    return GRUPOS.filter(function (x) { return x.id === id; })[0] || null;
  }
  // Abas do grupo que existem hoje (as com disponivel:false ficam de fora). Grupo sem abas -> [].
  function abasVisiveis(grupo) {
    var g = grupoPorId(grupo);
    return ((g && g.abas) || []).filter(function (a) { return a.disponivel !== false; });
  }
  // Id da aba que uma rota acende (resumo -> lancamentos). Rota sem aba -> null.
  function abaDoGrupo(rota) {
    var g = grupoPorId(grupoDaBarra(rota));
    var abas = (g && g.abas) || [];
    for (var i = 0; i < abas.length; i++) {
      if (abas[i].id === rota || (abas[i].rotas && abas[i].rotas.indexOf(rota) >= 0)) return abas[i].id;
    }
    return null;
  }
  // Qual tela do Mês abrir: a última chave usada (só em memória); valor desconhecido ou vazio -> Lançamentos.
  function rotaDoMes(ultima) {
    return ultima === "resumo" ? "resumo" : "lancamentos";
  }
  // Nome das telas que não estão em TELAS ainda (a gaveta mostra "Contas fixas" quando a aba existir).
  var ROTULO_ITEM = { fixas: "Contas fixas" };
  // Itens da gaveta de um grupo: [{ id, texto, atual }]. Dinheiro usa as abas visíveis (Mês no lugar de Lançamentos e Resumo);
  // os outros grupos listam suas telas. `rota` é a tela à vista.
  function itensDaGaveta(grupo, rota) {
    var g = grupoPorId(grupo);
    if (!g) return [];
    if (g.abas) {
      var ativa = abaDoGrupo(rota);
      return abasVisiveis(grupo).map(function (a) {
        return { id: a.id, texto: a.rotas ? a.rotulo : (ROTULO_ITEM[a.id] || rotulo(a.id)), atual: a.id === ativa };
      });
    }
    return g.telas.map(function (t) { return { id: t, texto: rotulo(t), atual: t === rota }; });
  }
  // Telas que ainda são "Em breve". Quem entregar a tela tira o id desta lista (os cartões do Início e o "+" acompanham sozinhos).
  var EM_BREVE = ["conversa", "notas", "compromissos"];
  function emBreve(rota) {
    return EM_BREVE.indexOf(rota) >= 0;
  }
  // Telas de tela cheia, fora das abas: "#novo" -> { tipo: "novo" }; "#editar/<id>" -> { tipo: "editar", id };
  // "#reserva/guardar|tirar|passar" e "#conferir" -> { tipo: "guardar" | "tirar" | "passar" | "conferir" }; "#ler" -> { tipo: "ler" }
  // (Ler comprovante, #73). O resto -> null.
  // O nome de caixinha ou de cartão nunca vai no endereço: quem abre pelo botão leva isso em memória.
  // O id só pode ter letras, números e traço (o que o app gera); qualquer outra coisa não abre nada.
  function telaDoHash(hash) {
    var h = String(hash || "").replace(/^#/, "");
    if (h === "novo") return { tipo: "novo" };
    if (h === "conferir") return { tipo: "conferir" };
    if (h === "ler") return { tipo: "ler" };
    var r = /^reserva\/(guardar|tirar|passar)$/.exec(h);
    if (r) return { tipo: r[1] };
    var m = /^editar\/([0-9A-Za-z-]{1,64})$/.exec(h);
    return m ? { tipo: "editar", id: m[1] } : null;
  }
  return {
    abasVisiveis: abasVisiveis, abaDoGrupo: abaDoGrupo, rotaDoMes: rotaDoMes, itensDaGaveta: itensDaGaveta,
    emBreve: emBreve, EM_BREVE: EM_BREVE, TELAS: TELAS, GRUPOS: GRUPOS, PADRAO: PADRAO, abaDoHash: abaDoHash, telaDoHash: telaDoHash,
    rotulo: rotulo, titulo: titulo, direcao: direcao, grupoDaBarra: grupoDaBarra, primeiraTela: primeiraTela, comoNavegar: comoNavegar,
  };
})();
if (typeof module !== "undefined") module.exports = Rotas;
