// Zelo: lógica da Reserva, do "Conferir saldo" e do painel "Onde está o dinheiro" (#39, P5). Sem DOM: decide o que mostrar
// e valida o que gravar; quem desenha é js/tela-reserva.js, js/tela-movimento.js e js/tela-ver.js. Só Somas soma.
// Dinheiro em centavos; datas AAAA-MM-DD. Nomes de caixinha e de cartão vêm da planilha: aqui são só dados (a tela usa textContent).
// No navegador vira o objeto global Reserva.
var Reserva = (function () {
  var Din = typeof Dinheiro !== "undefined" ? Dinheiro : require("./dinheiro.js");
  var Dat = typeof Datas !== "undefined" ? Datas : require("./datas.js");
  var Som = typeof Somas !== "undefined" ? Somas : require("./somas.js");
  var For = typeof Formulario !== "undefined" ? Formulario : require("./formulario.js");
  var Ver_ = typeof Ver !== "undefined" ? Ver : require("./ver.js");
  var Lan = typeof Lancamentos !== "undefined" ? Lancamentos : require("./lancamentos.js");
  var Opc = typeof Opcoes !== "undefined" ? Opcoes : require("./opcoes.js");

  var MENOS = "−";
  var TIPOS_RESERVA = ["guardou", "tirou", "saldo"];
  var MAX_BOTOES = 12;

  var TEXTOS = {
    apoio_reserva: "O dinheiro guardado, separado da conta. Guardar e tirar não contam como gasto nem como renda.",
    sem_internet: "Sem internet. Os valores são da última atualização e do que você anotou aqui.",
    ate_hoje: "Até hoje, com o que está lançado.",
    esperando: "Já conta o que está esperando envio.",
    guardar_apoio: "O dinheiro sai da conta e vai para a caixinha. Não conta como gasto.",
    tirar_apoio: "O dinheiro sai da caixinha e volta para a conta. Não conta como renda.",
    passar_apoio: "O dinheiro muda de caixinha. A conta não muda e não conta como gasto nem como renda.",
    conferir_apoio: "Digite o saldo que o banco mostra. O Zelo passa a contar a partir dele, sem apagar nada do que já está lançado.",
    escolha_caixinha: "Escolha a caixinha.",
    escolha_origem: "Escolha de qual caixinha sai.",
    escolha_destino: "Escolha para qual caixinha vai.",
    escolha_lugar: "Escolha o que você quer conferir.",
    fora_da_lista: "Esta caixinha não está mais na lista.",
    passagem: "Este movimento faz parte de uma passagem entre caixinhas. Se mudar o valor ou a data aqui, mude também o outro lado.",
    partida: "Este será o ponto de partida. A partir daqui o Zelo soma os lançamentos a este saldo.",
    bateu: "O app e o banco mostram o mesmo valor.",
    passo_banco: "Ao salvar, o Zelo passa a usar o valor do banco. Os lançamentos antigos não mudam.",
    futura: "Esta data ainda não chegou. O saldo só vai valer a partir dela.",
    caixinha_sem_conferir: "Há caixinha sem saldo conferido. O patrimônio pode estar diferente do banco.",
    total_sem_conferir: "Inclui caixinha ainda não conferida com o banco.",
    conta_negativa: "A conta ficou negativa pelos lançamentos. Confira o saldo no banco.",
    caixinha_negativa: "Esta caixinha ficou negativa pelos lançamentos. Confira o saldo no banco.",
    caixinha_fora: "Esta caixinha não está mais na lista da planilha. Dá para tirar o dinheiro, mas não guardar mais."
  };

  function aparar(v) { return typeof v === "string" ? v.replace(/^\s+|\s+$/g, "") : ""; }
  function plural(n, um, varios) { return n === 1 ? um : varios; }
  function ordem(a, b) { return a.localeCompare(b, "pt-BR") || (a < b ? -1 : a > b ? 1 : 0); }

  // "R$ 10,00" ou "−R$ 10,00" (sinal de menos de verdade, U+2212). Zero nunca leva sinal.
  function reais(c) { return (c < 0 ? MENOS : "") + Din.formatar(Math.abs(c)); }

  function listaConfig(opcoes, chave) { return opcoes && Array.isArray(opcoes[chave]) ? opcoes[chave] : []; }

  // Nomes de caixinha/cartão que existem só nos lançamentos (não apagados).
  function nomesNosDados(todos, campo) {
    var vistos = Object.create(null), nomes = [];
    (todos || []).forEach(function (l) {
      if (!l || typeof l !== "object" || l.apagado === "sim") return;
      var n = aparar(l[campo]);
      if (n && !vistos[n]) { vistos[n] = true; nomes.push(n); }
    });
    return nomes;
  }
  function temCaixinha(todos, opcoes) {
    return listaConfig(opcoes, "caixinhas").length > 0 || nomesNosDados(todos, "caixinha").length > 0;
  }
  function temCartao(todos, opcoes) {
    return listaConfig(opcoes, "cartoes").length > 0 || nomesNosDados(todos, "cartao").length > 0;
  }

  // ---- as caixinhas (Reserva e formulários) ----
  // Config primeiro (nome pt-BR), depois as que só existem nos dados. estado: "guardado" | "vazia" | "negativa".
  function caixinhas(todos, opcoes, ate) {
    var s = Som.saldos(todos || [], ate);
    var porNome = Object.create(null);
    s.caixinhas.forEach(function (c) { porNome[c.caixinha] = c; });
    var config = listaConfig(opcoes, "caixinhas").slice().sort(ordem);
    var nomes = config.slice();
    s.caixinhas.map(function (c) { return c.caixinha; }).sort(ordem).forEach(function (n) { if (config.indexOf(n) < 0 && n !== "") nomes.push(n); });
    return nomes.map(function (n) {
      var c = porNome[n];
      var saldo = c ? c.saldo : 0;
      return {
        nome: n, saldo: saldo, conferido: c ? c.conferido : null, daConfig: config.indexOf(n) >= 0,
        estado: saldo < 0 ? "negativa" : saldo === 0 ? "vazia" : "guardado", valor: reais(saldo)
      };
    });
  }

  // Total guardado: { valor, estado: "guardado" | "negativo", inclui_nao_conferida }
  function total(lista) {
    var t = lista.reduce(function (s, c) { return s + c.saldo; }, 0);
    return { centavos: t, valor: reais(t), estado: t < 0 ? "negativo" : "guardado", inclui_nao_conferida: lista.some(function (c) { return c.conferido === null; }) };
  }

  // Quais botões e quais caixinhas cada formulário oferece (decisão 11: caixinha só nos dados dá para tirar, não guardar).
  function opcoesDe(lista) {
    var config = lista.filter(function (c) { return c.daConfig; }).map(function (c) { return c.nome; });
    var origens = lista.filter(function (c) { return c.daConfig || c.saldo > 0; }).map(function (c) { return c.nome; });
    var pode = false;
    origens.forEach(function (o) { config.forEach(function (d) { if (o !== d) pode = true; }); });
    return { guardar: config, tirar: origens, de: origens, para: config, podeGuardar: config.length > 0, podeTirar: origens.length > 0, podePassar: pode };
  }

  // ---- linhas do histórico ----
  function metadeDePassagem(l) {
    var f = aparar(l && l.favorecido);
    return f.indexOf("Passou para ") === 0 || f.indexOf("Veio de ") === 0;
  }
  // Movimentos de caixinha (guardou, tirou, saldo), na ordem recebida; filtro: nome da caixinha ou undefined.
  function movimentos(todos, filtro) {
    return (todos || []).filter(function (l) {
      return l && l.apagado !== "sim" && TIPOS_RESERVA.indexOf(l.tipo) >= 0 && aparar(l.caixinha) !== "" && (filtro === undefined || filtro === null || aparar(l.caixinha) === filtro);
    });
  }
  // Ver.linha + o que só a Reserva mostra: ajuste (2ª linha do saldo) e dentro (linha de antes do saldo conferido da caixinha).
  function linha(l, todos) {
    var v = Ver_.linha(l);
    var nome = aparar(l.caixinha);
    var ancora = null;
    (todos || []).forEach(function (x) {
      if (x && x.tipo === "saldo" && x.apagado !== "sim" && aparar(x.caixinha) === nome && !aparar(x.cartao) && Dat.valida(x.data)) {
        if (!ancora || x.data > ancora.data || (x.data === ancora.data && (String(x.editado_em) > String(ancora.editado_em) || (x.editado_em === ancora.editado_em && String(x.id) > String(ancora.id))))) ancora = x;
      }
    });
    v.caixinha = nome;
    v.passagem = metadeDePassagem(l);
    v.dentro = !!ancora && ancora.id !== l.id && Dat.valida(l.data) && l.data <= ancora.data;
    if (l.tipo === "saldo") {
      var valor = Din.valido(l.valor_centavos) || l.valor_centavos === 0 ? l.valor_centavos : 0;
      var c = Som.conferencia(todos || [], "caixinha", nome, l.data, valor, l.id);
      // "Primeira conferência": nenhum outro saldo da caixinha veio antes deste (o que vem depois não conta).
      var antes = (todos || []).some(function (x) {
        return x && x.id !== l.id && x.tipo === "saldo" && x.apagado !== "sim" && aparar(x.caixinha) === nome && !aparar(x.cartao) && Dat.valida(x.data) &&
          (x.data < l.data || (x.data === l.data && String(x.editado_em) < String(l.editado_em)));
      });
      v.ajuste = !antes ? "Primeira conferência" : c.diferenca === 0 ? "Bateu com o app" : "O app mostrava " + reais(c.app);
    }
    return v;
  }

  // ---- painel "Onde está o dinheiro" (Início) ----
  // ctx: { sincronizou, online, esperando } . Devolve null quando o painel não existe (sem cartão e sem caixinha, ou nada sincronizado).
  function painel(todos, opcoes, hoje, ctx) {
    var c = ctx || {};
    var comCaixinha = temCaixinha(todos, opcoes), comCartao = temCartao(todos, opcoes);
    if (!comCaixinha && !comCartao) return null;
    if (!c.sincronizou && (todos || []).length === 0) return null;
    var s = Som.saldos(todos || [], hoje);
    var cx = caixinhas(todos, opcoes, hoje);
    var nomesCartao = listaConfig(opcoes, "cartoes").slice();
    s.cartoes.forEach(function (k) { if (k.cartao !== "" && nomesCartao.indexOf(k.cartao) < 0) nomesCartao.push(k.cartao); });
    var apoio = c.online === false ? TEXTOS.sem_internet : c.esperando ? TEXTOS.esperando : TEXTOS.ate_hoje;
    var contaOk = s.conta_conferida !== null;
    var conta = {
      conferida: contaOk, data: s.conta_conferida, centavos: s.conta, valor: reais(s.conta),
      estado: !contaOk ? "sem_conferir" : s.conta < 0 ? "negativa" : s.conta === 0 ? "zerada" : "na_conta",
      palavra: !contaOk ? "" : s.conta < 0 ? "Negativa" : s.conta === 0 ? "Zerada" : "Na conta",
      sub: contaOk ? "Conferida em " + Dat.paraTela(s.conta_conferida) : "Ainda sem saldo conferido.",
      frase: !contaOk ? "Digite o saldo que o banco mostra, uma vez. Depois o Zelo soma os lançamentos a ele." : s.conta < 0 ? TEXTOS.conta_negativa : "",
      botaoCheio: !contaOk || s.conta < 0
    };
    var guardado = comCaixinha ? {
      centavos: s.guardado, valor: reais(s.guardado), n: cx.length, sub: cx.length + " " + plural(cx.length, "caixinha", "caixinhas"),
      estado: s.guardado < 0 ? "negativo" : "guardado", palavra: s.guardado < 0 ? "Negativo" : "Guardado"
    } : null;
    var aberto = comCartao ? {
      centavos: s.em_aberto, n: nomesCartao.length, sub: nomesCartao.length + " " + plural(nomesCartao.length, "cartão", "cartões"),
      estado: s.em_aberto < 0 ? "pago_a_mais" : s.em_aberto === 0 ? "zerado" : "aberto",
      valor: Din.formatar(Math.abs(s.em_aberto)), palavra: s.em_aberto < 0 ? "Pago a mais" : s.em_aberto === 0 ? "Nada em aberto" : "Em aberto"
    } : null;
    var pat = s.patrimonio;
    var patrimonio = {
      mostrar: contaOk, centavos: pat, valor: reais(pat), estado: pat < 0 ? "negativo" : "liquido", palavra: pat < 0 ? "Negativo" : "Líquido",
      sub: contaOk ? "Conta + caixinhas − cartões" : "Aparece depois de conferir o saldo da conta."
    };
    var semConferir = contaOk && comCaixinha && cx.some(function (x) { return x.conferido === null; });
    return { apoio: apoio, conta: conta, guardado: guardado, aberto: aberto, patrimonio: patrimonio, notaCaixinha: semConferir ? TEXTOS.caixinha_sem_conferir : "" };
  }

  // ---- formulários: validação (sempre antes de gravar) ----
  function nomeOk(nome, lista, manter) {
    return nome !== "" && (lista.indexOf(nome) >= 0 || nome === manter);
  }
  function ctxDe(opcoes, hoje, manter) { return { opcoes: opcoes, hoje: hoje, manter: manter || {} }; }

  // campos: { caixinha, valor, data }. tipo: "guardou" | "tirou". original (Editar): mantém a caixinha mesmo se saiu da lista.
  function validarGuardarTirar(tipo, campos, opcoes, hoje, original) {
    var c = campos || {};
    var nome = aparar(c.caixinha);
    var erros = {};
    if (nome === "") erros.caixinha = TEXTOS.escolha_caixinha;
    var manter = original && aparar(original.caixinha) ? { caixinha: aparar(original.caixinha) } : {};
    var r = For.validar({ tipo: tipo, valor: c.valor, data: c.data, favorecido: nome ? "Caixinha " + nome : "Caixinha", caixinha: nome }, ctxDe(opcoes, hoje, manter));
    Object.keys(r.erros).forEach(function (k) {
      if (k === "favorecido") return;
      if (k === "caixinha") { if (!erros.caixinha) erros.caixinha = r.erros[k]; return; }
      erros[k] = r.erros[k];
    });
    if (Object.keys(erros).length) return { ok: false, erros: erros, avisos: r.avisos };
    return { ok: true, erros: {}, avisos: r.avisos, registro: r.registro };
  }

  // campos: { de, para, valor, data }. Devolve os dois registros (tirou da origem, guardou no destino), mesma data e valor.
  function validarPassagem(campos, opcoes, hoje) {
    var c = campos || {};
    var de = aparar(c.de), para = aparar(c.para);
    var erros = {};
    if (de === "") erros.de = TEXTOS.escolha_origem;
    if (para === "") erros.para = TEXTOS.escolha_destino;
    else if (para === de) erros.para = TEXTOS.escolha_destino;
    var ctx = ctxDe(opcoes, hoje, de ? { caixinha: de } : {});
    var a = For.validar({ tipo: "tirou", valor: c.valor, data: c.data, favorecido: "Passou para " + (para || "outra caixinha"), caixinha: de }, ctx);
    ["valor", "data"].forEach(function (k) { if (a.erros[k]) erros[k] = a.erros[k]; });
    if (de && a.erros.caixinha && !erros.de) erros.de = a.erros.caixinha;
    var b = For.validar({ tipo: "guardou", valor: c.valor, data: c.data, favorecido: "Veio de " + (de || "outra caixinha"), caixinha: para }, ctxDe(opcoes, hoje));
    if (para && b.erros.caixinha && !erros.para) erros.para = b.erros.caixinha;
    if (Object.keys(erros).length) return { ok: false, erros: erros, avisos: a.avisos };
    return { ok: true, erros: {}, avisos: a.avisos, registros: [a.registro, b.registro] };
  }

  // lugar: { tipo: "conta" | "caixinha" | "cartao", nome }. Aceita zero. original (Editar): mantém o nome mesmo se saiu da lista.
  function validarConferencia(campos, opcoes, hoje, original) {
    var c = campos || {};
    var lugar = c.lugar && typeof c.lugar === "object" ? c.lugar : null;
    var erros = {};
    if (!lugar || (lugar.tipo !== "conta" && aparar(lugar.nome) === "")) erros.lugar = TEXTOS.escolha_lugar;
    var nome = lugar ? aparar(lugar.nome) : "";
    var f = { tipo: "saldo", valor: c.valor, data: c.data, favorecido: "Saldo conferido" };
    if (lugar && lugar.tipo === "caixinha") f.caixinha = nome;
    if (lugar && lugar.tipo === "cartao") f.cartao = nome;
    var manter = original ? { cartao: aparar(original.cartao), caixinha: aparar(original.caixinha) } : {};
    var r = For.validar(f, ctxDe(opcoes, hoje, manter));
    ["valor", "data"].forEach(function (k) { if (r.erros[k]) erros[k] = r.erros[k]; });
    if (!erros.lugar) ["cartao", "caixinha"].forEach(function (k) { if (r.erros[k]) erros.lugar = r.erros[k]; });
    if (Object.keys(erros).length) return { ok: false, erros: erros, avisos: r.avisos };
    return { ok: true, erros: {}, avisos: r.avisos, registro: r.registro };
  }

  // Valor digitado -> centavos, ou null se vazio/inválido. aceitaZero: só o saldo conferido aceita R$ 0,00.
  function valorDoCampo(texto, aceitaZero) {
    var t = aparar(texto);
    var c = Din.paraCentavos(t);
    if (c !== null) return c;
    if (aceitaZero && (/^(R\$\s*)?0+(,0{1,2})?$/.test(t) || /^0+\.0{1,2}$/.test(t))) return 0;
    return null;
  }

  // ---- textos que o formulário mostra enquanto a pessoa digita ----
  function notaDoSaldo(caixinha) {
    if (!caixinha) return null;
    return { antes: "Na caixinha " + caixinha.nome + ": ", valor: reais(caixinha.saldo), depois: caixinha.conferido === null ? " (ainda não conferida)" : "" };
  }
  function avisoDoValor(valorCentavos, saldo) {
    if (!Number.isInteger(valorCentavos) || valorCentavos <= 0 || typeof saldo !== "number") return "";
    return valorCentavos > saldo ? "Este valor é maior que o que está na caixinha (" + reais(saldo) + "). Pode salvar se for isso mesmo." : "";
  }
  function resumoDaPassagem(de, para, valorCentavos) {
    if (!de || !para || de === para || !Number.isInteger(valorCentavos) || valorCentavos <= 0) return null;
    return { antes: "Vai gravar dois lançamentos: tirou ", v1: Din.formatar(valorCentavos), meio: " de " + de + " e guardou ", v2: Din.formatar(valorCentavos), depois: " em " + para + ". A conta não muda." };
  }

  // Rótulos do "Conferir saldo" conforme o lugar marcado.
  function rotulosDoLugar(tipo) {
    if (tipo === "caixinha") return { valor: "Saldo da caixinha", apoio: "Quanto o banco mostra para esta caixinha." };
    if (tipo === "cartao") return { valor: "Total em aberto no cartão", apoio: "Quanto ainda falta pagar, somando tudo o que foi comprado e não foi pago." };
    return { valor: "Saldo no banco", apoio: "Como está no extrato ou no app do banco." };
  }

  // Resultado antes de salvar (seção 7.2). conf = Somas.conferencia(...). Devolve { tipo, linhas: [texto], maisNovo }.
  function resultadoDaConferencia(lugarTipo, conf) {
    if (!conf) return null;
    var quem = lugarTipo === "cartao" ? "o cartão" : "o banco";
    if (conf.primeira) return { tipo: "partida", linhas: [TEXTOS.partida] };
    if (conf.diferenca === 0) return { tipo: "bateu", linhas: [TEXTOS.bateu] };
    var base = "O app mostra " + reais(conf.app) + " e " + quem + " " + reais(conf.banco) + ". ";
    if (conf.diferenca > 0) return { tipo: "falta", linhas: [base + "Falta " + reais(conf.diferenca) + " em algum lugar.", TEXTOS.passo_banco] };
    var dica = lugarTipo === "cartao" ? "Algum pagamento pode estar sem lançar." : lugarTipo === "caixinha" ? "Alguma retirada pode estar sem lançar." : "Algum gasto pode estar sem lançar.";
    return { tipo: "sobra", linhas: [base + "Sobra " + reais(-conf.diferenca) + " no app. " + dica, TEXTOS.passo_banco] };
  }
  function avisoDaDataConferencia(data, hoje, conf) {
    if (!Dat.valida(data)) return "";
    if (conf && conf.maisNovo) return "Já existe um saldo conferido em " + Dat.paraTela(conf.maisNovo) + ", mais novo que esta data. Este não vai mudar os números.";
    if (Dat.valida(hoje) && data > hoje) return TEXTOS.futura;
    return "";
  }

  // ---- sessão com o banco (grava sempre pelo mesmo caminho dos lançamentos: fila e id do aparelho) ----
  var MENSAGEM_PADRAO = "Não consegui guardar no celular. O que você digitou continua aqui.";
  function criarSessao(db, opcoes) {
    var relogio = opcoes && opcoes.relogio;
    var ocupado = false;
    function umPorVez(fn) {
      if (ocupado) return Promise.resolve({ ignorado: true });
      ocupado = true;
      return Promise.resolve().then(fn).then(
        function (r) { ocupado = false; return r; },
        function (e) { ocupado = false; return { ok: false, banco: true, mensagem: e && typeof e.message === "string" && e.message ? e.message : MENSAGEM_PADRAO }; }
      );
    }
    function ler() { return Promise.all([Opc.ler(db), Lan.todosVisiveis(db)]).then(function (v) { return { opcoes: v[0], lancamentos: v[1] }; }); }
    // Abre o Editar de um movimento: { achou, lancamento, opcoes, lancamentos }. Tipo que o editor não conhece: achou false.
    function abrirEdicao(id, tiposAceitos) {
      return Promise.all([db.lancamentos.obter(id), ler()]).then(function (v) {
        var l = v[0];
        if (!l || l.apagado === "sim" || tiposAceitos.indexOf(l.tipo) < 0) return { achou: false };
        return { achou: true, lancamento: l, opcoes: v[1].opcoes, lancamentos: v[1].lancamentos };
      });
    }
    function gravar(r, original) {
      if (!original) return Lan.criar(db, r.registro, relogio).then(function (l) { return { ok: true, lancamento: l, avisos: r.avisos }; });
      var mudancas = For.diferenca(original, r.registro);
      var recusado = original.situacao === "nao_enviado";
      return db.lancamentos.obter(original.id).then(function (noBanco) {
        if (noBanco && noBanco.apagado === "sim") mudancas.apagado = "";
        if (Object.keys(mudancas).length === 0 && !recusado) return { ok: true, nada: true };
        return Lan.editar(db, original.id, mudancas, relogio).then(function (l) { return { ok: true, lancamento: l, avisos: r.avisos }; });
      });
    }
    return {
      ler: ler, abrirEdicao: abrirEdicao,
      lerAtual: function (id) { return db.lancamentos.obter(id).then(function (l) { return l || null; }); },
      salvarMovimento: function (tipo, campos, ctx, original) {
        var r = validarGuardarTirar(tipo, campos, ctx.opcoes, ctx.hoje, original);
        if (!r.ok) return Promise.resolve({ ok: false, erros: r.erros, avisos: r.avisos });
        return umPorVez(function () { return gravar(r, original); });
      },
      salvarConferencia: function (campos, ctx, original) {
        var r = validarConferencia(campos, ctx.opcoes, ctx.hoje, original);
        if (!r.ok) return Promise.resolve({ ok: false, erros: r.erros, avisos: r.avisos });
        return umPorVez(function () { return gravar(r, original); });
      },
      // Os dois lançamentos entram juntos numa transação só: ou os dois ou nenhum.
      salvarPassagem: function (campos, ctx) {
        var r = validarPassagem(campos, ctx.opcoes, ctx.hoje);
        if (!r.ok) return Promise.resolve({ ok: false, erros: r.erros, avisos: r.avisos });
        return umPorVez(function () {
          return Lan.criarVarios(db, r.registros, relogio).then(function (ls) { return { ok: true, lancamentos: ls, avisos: r.avisos }; });
        });
      },
      apagar: function (ids) { return umPorVez(function () { return Lan.apagarVarios(db, ids).then(function () { return { ok: true }; }); }); },
      desfazerApagar: function (ids) { return umPorVez(function () { return Lan.desfazerApagarVarios(db, ids).then(function () { return { ok: true }; }); }); }
    };
  }

  return {
    TEXTOS: TEXTOS, MAX_BOTOES: MAX_BOTOES, reais: reais, temCaixinha: temCaixinha, temCartao: temCartao, nomesNosDados: nomesNosDados,
    caixinhas: caixinhas, total: total, opcoesDe: opcoesDe, movimentos: movimentos, linha: linha, metadeDePassagem: metadeDePassagem,
    painel: painel, validarGuardarTirar: validarGuardarTirar, validarPassagem: validarPassagem, validarConferencia: validarConferencia,
    valorDoCampo: valorDoCampo, notaDoSaldo: notaDoSaldo, avisoDoValor: avisoDoValor, resumoDaPassagem: resumoDaPassagem, rotulosDoLugar: rotulosDoLugar,
    resultadoDaConferencia: resultadoDaConferencia, avisoDaDataConferencia: avisoDaDataConferencia, criarSessao: criarSessao
  };
})();
if (typeof module !== "undefined") module.exports = Reserva;
