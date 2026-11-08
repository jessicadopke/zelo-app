// Zelo: contas a pagar no app (#120). Cópia local da aba "Contas a pagar" da planilha e as regras da lista
// (lógica testada com node --test). No navegador vira o objeto global Contas.
// O app só LÊ a aba: nada aqui grava na planilha. O banco (Db, js/db.js) e a ponte entram por parâmetro; sem DOM, sem rede própria.
// A cópia guarda só os 10 campos da seção 4A do contrato. Dinheiro em centavos; datas AAAA-MM-DD.
var Contas = (function () {
  var Din = typeof Dinheiro !== "undefined" ? Dinheiro : require("./dinheiro.js");
  var Dat = typeof Datas !== "undefined" ? Datas : require("./datas.js");

  var CAMPOS = ["id", "vencimento", "valor_centavos", "favorecido", "categoria", "pessoa", "situacao", "lancamento_id", "recebido_em", "atualizado_em"];
  var OPCIONAIS = ["categoria", "pessoa", "lancamento_id", "recebido_em"];
  var SITUACOES = ["a_pagar", "paga"];
  var LIMITE_PAGAS = 20;
  var MAX_PAGINAS = 100;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var ISO24 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  // ---- avisos de mudança na cópia (a tela e o Início redesenham) ----
  var ouvintes = [];
  function aoMudar(ouvinte) {
    ouvintes.push(ouvinte);
    return function () { ouvintes = ouvintes.filter(function (o) { return o !== ouvinte; }); };
  }
  function avisar() {
    ouvintes.slice().forEach(function (o) { try { o(); } catch (_) { /* um ouvinte com defeito não derruba a leitura */ } });
  }

  var internos = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  function interno(db) {
    var s = internos.get(db);
    if (!s) { s = { recebendo: false }; internos.set(db, s); }
    return s;
  }

  // ---- conferência do item que vem da ponte ----
  // Item da ponte -> conta com os 10 campos (opcionais vazios viram ""), ou null se vier malformado.
  function itemRecebido(it) {
    if (!it || typeof it !== "object" || Array.isArray(it)) return null;
    if (typeof it.id !== "string" || !UUID.test(it.id)) return null;
    if (!Dat.valida(it.vencimento)) return null;
    if (!Din.valido(it.valor_centavos)) return null;
    if (typeof it.favorecido !== "string" || it.favorecido.trim() === "") return null;
    if (SITUACOES.indexOf(it.situacao) < 0) return null;
    if (typeof it.atualizado_em !== "string" || !ISO24.test(it.atualizado_em)) return null;
    var c = {};
    for (var i = 0; i < OPCIONAIS.length; i++) {
      var v = it[OPCIONAIS[i]];
      if (v === undefined || v === null) v = "";
      if (typeof v !== "string") return null;
      c[OPCIONAIS[i]] = v;
    }
    CAMPOS.forEach(function (k) { if (OPCIONAIS.indexOf(k) < 0) c[k] = it[k]; });
    return c;
  }

  function iguais(a, b) {
    return CAMPOS.every(function (k) { return a[k] === b[k]; });
  }

  // Guarda uma página inteira (contas + marcador) numa transação só: tudo ou nada.
  // A planilha manda: conta nova entra; conta existente é trocada se QUALQUER campo mudou; tudo igual, ignora.
  function guardarPagina(db, itens, proximo) {
    return db.transacao(["contas", "config"], function (o) {
      var c = { novas: 0, trocadas: 0, iguais: 0, ignoradas: 0 };
      var p = Promise.resolve();
      itens.forEach(function (bruto) {
        p = p.then(function () {
          var item = itemRecebido(bruto);
          if (!item) { c.ignoradas++; return null; }
          return o.contas.obter(item.id).then(function (local) {
            if (!local) { c.novas++; return o.contas.gravar(item); }
            if (iguais(local, item)) { c.iguais++; return null; }
            c.trocadas++;
            return o.contas.gravar(item);
          });
        });
      });
      return p.then(function () { return o.config.definir("proximo_desde_contas", proximo); }).then(function () { return c; });
    });
  }

  function parar(motivo, res, mensagem) {
    res.parou = true;
    res.motivo = motivo;
    if (typeof mensagem === "string") res.mensagem = mensagem;
    return res;
  }

  // Lê da planilha e guarda no celular. ponte.chamar("ler_contas", { desde, limite? }) devolve o envelope. Nunca lança.
  // opcoes: { completo (começa com desde: null, mesmo com marcador guardado), limite, maxPaginas, relogio }
  // Devolve { novas, trocadas, iguais, ignoradas, ignoradas_script, paginas, parou, motivo?, mensagem? } ou { jaRecebendo: true }.
  async function receber(db, ponte, opcoes) {
    var res = { novas: 0, trocadas: 0, iguais: 0, ignoradas: 0, ignoradas_script: 0, paginas: 0, parou: false };
    // Arquivos de versões diferentes (rede falhando no meio do carregamento): sem a loja, para sem lançar.
    if (!db || !db.contas || !db.config || typeof db.transacao !== "function") return parar("indisponivel", res);
    var st = interno(db);
    if (st.recebendo) return { jaRecebendo: true };
    st.recebendo = true;
    var op = opcoes || {};
    var maxPaginas = op.maxPaginas || MAX_PAGINAS;
    var limite = op.limite;
    var mudou = false;
    try {
      var desde = null;
      if (!op.completo) {
        try { desde = await db.config.obter("proximo_desde_contas"); } catch (e) { return parar((e && e.codigo) || "outro", res); }
        if (typeof desde !== "string") desde = null;
      }
      var chamadas = 0;
      while (res.paginas < maxPaginas && chamadas < maxPaginas + 20) {
        chamadas++;
        var dados = { desde: desde };
        if (limite !== undefined) dados.limite = limite;
        var resp;
        try { resp = await ponte.chamar("ler_contas", dados); } catch (e) {
          return parar((e && typeof e.codigo === "string") ? e.codigo : "sem_internet", res);
        }
        if (!resp || typeof resp !== "object") return parar("resposta_estranha", res);
        if (resp.ok !== true) {
          var er = resp.erro && typeof resp.erro === "object" ? resp.erro : {};
          return parar(typeof er.codigo === "string" ? er.codigo : "resposta_estranha", res, er.mensagem);
        }
        var d = resp.dados;
        if (!d || !Array.isArray(d.itens) || typeof d.mais !== "boolean" || typeof d.proximo_desde !== "string" || !ISO24.test(d.proximo_desde)) {
          return parar("resposta_estranha", res);
        }
        if (d.mais && desde !== null && d.proximo_desde <= desde) {
          // Muitas contas com a mesma hora (o desde usa >=): pede uma página maior antes de desistir.
          if (limite !== undefined && limite < 500) { limite = Math.min(500, limite * 2); continue; }
          return parar("resposta_estranha", res);
        }
        var c;
        try { c = await guardarPagina(db, d.itens, d.proximo_desde); } catch (e) {
          return parar((e && typeof e.codigo === "string") ? e.codigo : "outro", res);
        }
        res.paginas++;
        ["novas", "trocadas", "iguais", "ignoradas"].forEach(function (k) { res[k] += c[k]; });
        if (typeof d.ignoradas === "number") res.ignoradas_script = d.ignoradas;
        if (c.novas || c.trocadas) mudou = true;
        desde = d.proximo_desde;
        if (!d.mais) {
          // Leitura inteira: guarda a hora, para a tela dizer "Atualizado há…". Falhar aqui não desfaz a leitura.
          try {
            await db.config.definir("ultima_leitura_contas", ((op.relogio || function () { return new Date(); })()).toISOString());
            mudou = true;
          } catch (_) { /* a lista já está guardada */ }
          return res;
        }
      }
      return res; // sobra para a próxima rodada
    } finally {
      st.recebendo = false;
      if (mudou) avisar();
    }
  }

  // ---- regras da lista (funções puras) ----
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function porUrgencia(a, b) {
    return cmp(a.vencimento, b.vencimento) || cmp(a.favorecido.toLowerCase(), b.favorecido.toLowerCase()) || cmp(a.id, b.id);
  }
  function porRecente(a, b) {
    return cmp(b.atualizado_em, a.atualizado_em) || cmp(a.id, b.id);
  }

  // hoje: AAAA-MM-DD (de Datas.hoje(), no fuso do aparelho). Vencida = a_pagar com vencimento antes de hoje.
  function agrupar(lista, hoje) {
    var g = { vencidas: [], aPagar: [], pagas: [] };
    (lista || []).forEach(function (c) {
      if (c.situacao === "paga") g.pagas.push(c);
      else if (c.situacao === "a_pagar") (c.vencimento < hoje ? g.vencidas : g.aPagar).push(c);
    });
    g.vencidas.sort(porUrgencia);
    g.aPagar.sort(porUrgencia);
    g.pagas.sort(porRecente);
    return g;
  }

  // As pagas que a tela mostra: as 20 mais recentes, ou todas.
  function pagasVisiveis(pagas, todas) {
    return todas ? pagas.slice() : pagas.slice(0, LIMITE_PAGAS);
  }

  function plural(n, um, varios) { return n + " " + (n === 1 ? um : varios); }

  // Uma conta pronta para desenhar. Os textos da planilha seguem como vieram (a tela os põe só como texto).
  function formatarLinha(c, hoje) {
    var vencida = c.situacao === "a_pagar" && c.vencimento < hoje;
    var paga = c.situacao === "paga";
    var dias = Dat.diasEntre(c.vencimento, hoje);
    var prazo = null;
    if (vencida) prazo = { tom: "vencida", texto: dias === 1 ? "Venceu ontem" : "Venceu há " + dias + " dias" };
    else if (!paga && c.vencimento === hoje) prazo = { tom: "hoje", texto: "Vence hoje" };
    return {
      id: c.id,
      favorecido: c.favorecido,
      vencimento: "Vencimento: " + Dat.porExtenso(c.vencimento),
      valor: Din.formatar(c.valor_centavos),
      categoria: c.categoria || "",
      estado: vencida ? "vencida" : paga ? "paga" : "a_pagar",
      palavra: vencida ? "Vencida" : paga ? "Paga" : "A pagar",
      prazo: prazo,
    };
  }

  // Contagens para o cartão do Início. lida: já leu a planilha alguma vez (ou há cópia).
  function resumo(lista, hoje, ultimaLeitura) {
    var g = agrupar(lista, hoje);
    return { vencidas: g.vencidas.length, aPagar: g.aPagar.length, pagas: g.pagas.length, lida: (lista || []).length > 0 || typeof ultimaLeitura === "string" };
  }

  // Texto do cartão do Início: { marca, sub } (marca = alerta de vencidas; sub = linha pequena).
  function textoEntrada(r) {
    if (r.vencidas) return { marca: plural(r.vencidas, "vencida", "vencidas"), sub: r.aPagar ? r.aPagar + " a pagar" : "" };
    if (r.aPagar) return { marca: "", sub: r.aPagar + " a pagar" };
    if (r.pagas) return { marca: "", sub: "Tudo em dia." };
    if (r.lida) return { marca: "", sub: "Nenhuma conta ainda." };
    return { marca: "", sub: "Toque para buscar as contas." };
  }

  // ---- "Atualizado …" ----
  function doisDig(n) { return (n < 10 ? "0" : "") + n; }
  // iso: ultima_leitura_contas; agora: Date. Devolve { texto, velho } ou null se nunca leu.
  // Mesmo dia: "agora há pouco", "há N min", "há N h". Ontem e antes já contam como desatualizado.
  function textoAtualizado(iso, agora) {
    if (typeof iso !== "string") return null;
    var t = new Date(iso);
    if (isNaN(t.getTime())) return null;
    var min = Math.floor((agora.getTime() - t.getTime()) / 60000);
    var hojeLocal = Dat.hoje(agora), dia = Dat.hoje(t);
    var hhmm = doisDig(t.getHours()) + ":" + doisDig(t.getMinutes());
    if (dia === hojeLocal) {
      if (min < 1) return { texto: "Atualizado agora há pouco", velho: false };
      if (min < 60) return { texto: "Atualizado há " + min + " min", velho: false };
      return { texto: "Atualizado há " + Math.floor(min / 60) + " h", velho: false };
    }
    if (Dat.diasEntre(dia, hojeLocal) === 1) return { texto: "Atualizado ontem às " + hhmm, velho: true };
    return { texto: "Atualizado em " + Dat.paraTela(dia), velho: true };
  }

  // ---- erros ----
  // erro: código (texto) ou { codigo, mensagem } (o que receber() devolve em motivo/mensagem).
  function tipoDeErro(erro) {
    var codigo = erro && typeof erro === "object" ? erro.codigo : erro;
    var mensagem = erro && typeof erro === "object" && typeof erro.mensagem === "string" ? erro.mensagem : "";
    if (codigo === "sem_internet" || codigo === "tempo_esgotado") return "offline";
    if (codigo === "sem_configuracao" || codigo === "endereco_invalido") return "ponte";
    if (codigo === "interno" && /aba Contas a pagar/.test(mensagem)) return "aba";
    return "outro";
  }

  var AVISOS = {
    offline: "Sem internet. Mostrando as contas guardadas no celular.",
    ponte: "Falta configurar a ponte em Ajustes.",
    aba: "A planilha ainda não tem a aba Contas a pagar.",
    outro: "Não consegui atualizar as contas agora. Tente de novo.",
  };

  // Texto da faixa de aviso (quando há cópia local e a lista continua).
  function mensagemDeErro(erro) {
    return AVISOS[tipoDeErro(erro)];
  }

  // Cartão no lugar da lista (sem cópia local): { titulo, apoio, tentar } (tentar = mostra "Tentar de novo").
  function erroSemCopia(erro) {
    var tipo = tipoDeErro(erro);
    if (tipo === "offline") return { tipo: tipo, titulo: "Ainda não consegui buscar as contas.", apoio: "Conecte-se à internet e tente de novo.", tentar: true };
    if (tipo === "ponte") return { tipo: tipo, titulo: AVISOS.ponte, apoio: "", tentar: false };
    if (tipo === "aba") return { tipo: tipo, titulo: AVISOS.aba, apoio: "", tentar: true };
    return { tipo: tipo, titulo: "Não consegui atualizar as contas agora.", apoio: "Tente de novo.", tentar: true };
  }

  return {
    CAMPOS: CAMPOS, LIMITE_PAGAS: LIMITE_PAGAS, receber: receber, itemRecebido: itemRecebido, aoMudar: aoMudar,
    agrupar: agrupar, pagasVisiveis: pagasVisiveis, formatarLinha: formatarLinha, resumo: resumo, textoEntrada: textoEntrada,
    textoAtualizado: textoAtualizado, mensagemDeErro: mensagemDeErro, erroSemCopia: erroSemCopia, plural: plural,
  };
})();
if (typeof module !== "undefined") module.exports = Contas;
