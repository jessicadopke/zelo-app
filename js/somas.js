// Zelo: somas do mês (lógica pura, sem tela, rede nem banco). No navegador vira o objeto global Somas.
// Dinheiro em centavos inteiros; "saldo" é o único valor com sinal. Os mesmos exemplos (tests/exemplos/somas.json) valem para o script da Etapa 4.
var Somas = (function () {
  var Din = typeof Dinheiro !== "undefined" ? Dinheiro : require("./dinheiro.js");
  var Dat = typeof Datas !== "undefined" ? Datas : require("./datas.js");

  function mesValido(mes) {
    return typeof mes === "string" && /^\d{4}-\d{2}$/.test(mes) && Dat.valida(mes + "-01");
  }

  function texto(v) {
    return typeof v === "string" ? v.replace(/^\s+|\s+$/g, "") : "";
  }

  function somarNa(grupos, nome, tipo, valor) {
    var g = grupos[nome];
    if (!g) g = grupos[nome] = { nome: nome, entrou: 0, saiu: 0 };
    g[tipo] += valor;
  }

  // Maior "saiu" primeiro; empate, maior "entrou"; empate, nome pt-BR; nome vazio sempre por último.
  function comparar(a, b) {
    if (a.nome === "" && b.nome !== "") return 1;
    if (b.nome === "" && a.nome !== "") return -1;
    if (a.saiu !== b.saiu) return b.saiu - a.saiu;
    if (a.entrou !== b.entrou) return b.entrou - a.entrou;
    return a.nome.localeCompare(b.nome, "pt-BR");
  }

  function lista(grupos, chave) {
    return Object.keys(grupos).map(function (k) { return grupos[k]; }).sort(comparar).map(function (g) {
      var o = {};
      o[chave] = g.nome;
      o.entrou = g.entrou;
      o.saiu = g.saiu;
      return o;
    });
  }

  var MOVIMENTOS = ["fatura", "guardou", "tirou", "saldo"];

  // "saldo" conferido aceita 0 (cartão zerado); os demais valores seguem de 1 a 10^9.
  function valorDoMovimento(l) {
    return Din.valido(l.valor_centavos) || (l.tipo === "saldo" && l.valor_centavos === 0);
  }

  function resumoDoMes(lancamentos, mes) {
    if (!mesValido(mes)) throw new TypeError("Mês inválido: use AAAA-MM.");
    if (!Array.isArray(lancamentos)) throw new TypeError("Os lançamentos devem vir em uma lista.");
    var entrou = 0, saiu = 0, quantidade = 0, ignorados = 0, movimentos = 0;
    var cats = Object.create(null), pessoas = Object.create(null);

    lancamentos.forEach(function (l) {
      if (l === null || typeof l !== "object") { ignorados++; return; }
      if (l.apagado === "sim") return;
      if (!Dat.valida(l.data)) { ignorados++; return; }
      if (Dat.mes(l.data) !== mes) return;
      if (MOVIMENTOS.indexOf(l.tipo) >= 0) {
        // fatura, guardou, tirou e saldo conferido: não são gasto nem renda; só contam em "movimentos".
        if (valorDoMovimento(l)) movimentos++; else ignorados++;
        return;
      }
      if ((l.tipo !== "entrou" && l.tipo !== "saiu") || !Din.valido(l.valor_centavos)) { ignorados++; return; }
      if (l.tipo === "entrou") entrou += l.valor_centavos; else saiu += l.valor_centavos;
      quantidade++;
      somarNa(cats, texto(l.categoria), l.tipo, l.valor_centavos);
      somarNa(pessoas, texto(l.pessoa), l.tipo, l.valor_centavos);
    });

    return {
      mes: mes,
      entrou: entrou,
      saiu: saiu,
      saldo: entrou - saiu,
      quantidade: quantidade,
      ignorados: ignorados,
      movimentos: movimentos,
      porCategoria: lista(cats, "categoria"),
      porPessoa: lista(pessoas, "pessoa")
    };
  }

  // ---- saldos: onde está o dinheiro até uma data (regra 4.3 da nota do arquiteto, issues #37 e #39) ----
  // O "saldo" conferido vale até o FIM do dia informado (como num extrato): só somam os lançamentos com data DEPOIS dela (decisão 26, issue #39).
  // Lugares: a conta, cada cartão (em aberto) e cada caixinha. Efeito de cada tipo em [conta, cartão, caixinha].
  // Lançamento que não fecha a conta (sem o nome exigido, nome nos dois lugares, valor ruim) não conta em nada.
  function efeito(l) {
    var cartao = texto(l.cartao), caixinha = texto(l.caixinha), v = l.valor_centavos;
    switch (l.tipo) {
      case "entrou": return cartao ? { cartao: cartao, em_aberto: -v } : { conta: v };
      case "saiu": return cartao ? { cartao: cartao, em_aberto: v } : { conta: -v };
      case "fatura": return cartao && !caixinha ? { conta: -v, cartao: cartao, em_aberto: -v } : null;
      case "guardou": return caixinha && !cartao ? { conta: -v, caixinha: caixinha, saldo: v } : null;
      case "tirou": return caixinha && !cartao ? { conta: v, caixinha: caixinha, saldo: -v } : null;
      default: return null;
    }
  }

  // Dono do "saldo" conferido: { lugar: "conta" | "cartao" | "caixinha", nome }; null se os dois nomes vieram preenchidos.
  function lugarDoSaldo(l) {
    var cartao = texto(l.cartao), caixinha = texto(l.caixinha);
    if (cartao && caixinha) return null;
    if (cartao) return { lugar: "cartao", nome: cartao };
    if (caixinha) return { lugar: "caixinha", nome: caixinha };
    return { lugar: "conta", nome: "" };
  }

  // Mais recente primeiro: maior data, depois maior editado_em, depois maior id.
  function saldoMaisNovo(a, b) {
    if (a.data !== b.data) return a.data > b.data;
    var ea = typeof a.editado_em === "string" ? a.editado_em : "", eb = typeof b.editado_em === "string" ? b.editado_em : "";
    if (ea !== eb) return ea > eb;
    return String(a.id) > String(b.id);
  }

  function porNome(chave) {
    return function (a, b) {
      if (a[chave] === "" && b[chave] !== "") return 1;
      if (b[chave] === "" && a[chave] !== "") return -1;
      return a[chave].localeCompare(b[chave], "pt-BR");
    };
  }

  function saldos(lancamentos, ate) {
    if (!Dat.valida(ate)) throw new TypeError("Data inválida: use AAAA-MM-DD.");
    if (!Array.isArray(lancamentos)) throw new TypeError("Os lançamentos devem vir em uma lista.");
    // chave "c:", "k:nome", "x:nome" separa conta, cartão e caixinha (um nome nunca se mistura com outro lugar).
    var lugares = Object.create(null);
    function lugar(tipo, nome) {
      var k = tipo + ":" + nome;
      if (!lugares[k]) lugares[k] = { tipo: tipo, nome: nome, ancora: null, total: 0, itens: [] };
      return lugares[k];
    }

    lancamentos.forEach(function (l) {
      if (l === null || typeof l !== "object") return;
      if (l.apagado === "sim") return;
      if (!Dat.valida(l.data) || l.data > ate) return;
      if (!valorDoMovimento(l)) return;
      if (l.tipo === "saldo") {
        var dono = lugarDoSaldo(l);
        if (!dono) return;
        var g = lugar(dono.lugar === "conta" ? "c" : dono.lugar === "cartao" ? "k" : "x", dono.nome);
        if (!g.ancora || saldoMaisNovo(l, g.ancora)) g.ancora = l;
        return;
      }
      if (!Din.valido(l.valor_centavos)) return;
      var e = efeito(l);
      if (!e) return;
      if ("conta" in e) lugar("c", "").itens.push({ data: l.data, valor: e.conta });
      if (e.cartao) lugar("k", e.cartao).itens.push({ data: l.data, valor: e.em_aberto });
      if (e.caixinha) lugar("x", e.caixinha).itens.push({ data: l.data, valor: e.saldo });
    });

    function valorDe(g) {
      var base = g.ancora ? g.ancora.valor_centavos : 0;
      var desde = g.ancora ? g.ancora.data : "";
      return g.itens.reduce(function (s, i) { return i.data > desde ? s + i.valor : s; }, base);
    }

    // Data do saldo conferido vigente do lugar (AAAA-MM-DD) ou null se nunca foi conferido (até a data pedida).
    function dataDe(g) { return g.ancora ? g.ancora.data : null; }

    var conta = lugares["c:"] ? valorDe(lugares["c:"]) : 0;
    var cartoes = [], caixinhas = [];
    Object.keys(lugares).forEach(function (k) {
      var g = lugares[k];
      if (g.tipo === "k") cartoes.push({ cartao: g.nome, em_aberto: valorDe(g), conferido: dataDe(g) });
      else if (g.tipo === "x") caixinhas.push({ caixinha: g.nome, saldo: valorDe(g), conferido: dataDe(g) });
    });
    cartoes.sort(porNome("cartao"));
    caixinhas.sort(porNome("caixinha"));
    var guardado = caixinhas.reduce(function (s, c) { return s + c.saldo; }, 0);
    var emAberto = cartoes.reduce(function (s, c) { return s + c.em_aberto; }, 0);

    return {
      ate: ate,
      conta: conta,
      conta_conferida: lugares["c:"] ? dataDe(lugares["c:"]) : null,
      cartoes: cartoes,
      caixinhas: caixinhas,
      guardado: guardado,
      em_aberto: emAberto,
      patrimonio: conta + guardado - emAberto
    };
  }

  // Conferência de saldo (formulário "Conferir saldo" e linha "O app mostrava…"): compara o que o banco mostra com o que o app calcula.
  // lugar: "conta" | "cartao" | "caixinha"; nome é ignorado na conta. excetoId = o saldo que está sendo editado (fica de fora).
  // app = valor do lugar no FIM de "data" (o saldo conferido vale até o fim do dia); diferenca = banco - app;
  // primeira = o lugar nunca teve saldo conferido; maisNovo = data do saldo conferido mais novo que "data" (ou null).
  function conferencia(lancamentos, lugarTipo, nome, data, valorBanco, excetoId) {
    if (!Dat.valida(data)) throw new TypeError("Data inválida: use AAAA-MM-DD.");
    if (!Array.isArray(lancamentos)) throw new TypeError("Os lançamentos devem vir em uma lista.");
    if (lugarTipo !== "conta" && lugarTipo !== "cartao" && lugarTipo !== "caixinha") throw new TypeError("Lugar inválido.");
    if (!Number.isInteger(valorBanco) || valorBanco < 0) throw new TypeError("Valor inválido.");
    var alvo = lugarTipo === "conta" ? "" : texto(nome);
    var lista = lancamentos.filter(function (l) { return l && typeof l === "object" && (excetoId === undefined || excetoId === null || l.id !== excetoId); });
    var r = saldos(lista, data), app = 0;
    if (lugarTipo === "conta") app = r.conta;
    else if (lugarTipo === "cartao") r.cartoes.forEach(function (c) { if (c.cartao === alvo) app = c.em_aberto; });
    else r.caixinhas.forEach(function (c) { if (c.caixinha === alvo) app = c.saldo; });
    var primeira = true, maisNovo = null;
    lista.forEach(function (l) {
      if (l.tipo !== "saldo" || l.apagado === "sim" || !Dat.valida(l.data) || !valorDoMovimento(l)) return;
      var d = lugarDoSaldo(l);
      if (!d || d.lugar !== lugarTipo || d.nome !== alvo) return;
      primeira = false;
      if (l.data > data && (maisNovo === null || l.data > maisNovo)) maisNovo = l.data;
    });
    return { app: app, banco: valorBanco, diferenca: valorBanco - app, primeira: primeira, maisNovo: maisNovo };
  }

  // Quanto foi pago de fatura no mês (soma dos "fatura" não apagados com data no mês). Só para a nota do Resumo (#37, P4).
  function faturasDoMes(lancamentos, mes) {
    if (!mesValido(mes)) throw new TypeError("Mês inválido: use AAAA-MM.");
    if (!Array.isArray(lancamentos)) throw new TypeError("Os lançamentos devem vir em uma lista.");
    return lancamentos.reduce(function (s, l) {
      if (l === null || typeof l !== "object" || l.tipo !== "fatura" || l.apagado === "sim") return s;
      if (!Dat.valida(l.data) || Dat.mes(l.data) !== mes || !Din.valido(l.valor_centavos)) return s;
      return s + l.valor_centavos;
    }, 0);
  }

  return { resumoDoMes: resumoDoMes, saldos: saldos, conferencia: conferencia, faturasDoMes: faturasDoMes };
})();
if (typeof module !== "undefined") module.exports = Somas;
