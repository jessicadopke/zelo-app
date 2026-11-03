// Zelo: aviso "alterado no outro celular" (#16, parte F). Tudo em memória: nada vai para o banco nem para a planilha.
// Três peças sem DOM: resumir (lê o banco e monta nome/valor), criarMarcas (quais lançamentos mostram a marca) e
// criarAvisos (o espaço de aviso de baixo: um por vez, junta os alterados, nunca corta o "Desfazer").
// Quem desenha é js/app.js (aviso), js/tela-ver.js (marca e nota) e js/tela-lancar.js (nota do Editar). No navegador vira o objeto global Alterado.
var Alterado = (function () {
  var Ind = typeof Indicador !== "undefined" ? Indicador : require("./indicador.js");
  var Din = typeof Dinheiro !== "undefined" ? Dinheiro : require("./dinheiro.js");

  var DURACAO = 8000;     // ms que o aviso de alterado fica na tela
  var ESPERA_FOCO = 1000; // ms: se o foco está no botão quando acaba, espera mais um pouco
  var SAIDA = 200;        // ms da animação de saída (0 com movimento reduzido)

  // ids -> [{ id, nome, valor, apagado }] lidos do banco do celular (já na versão que valeu). Id que não se acha é ignorado.
  // Se a leitura falhar devolve [] (o aviso é só cortesia: o dado está certo).
  function resumir(db, ids) {
    var vistos = {}, unicos = [];
    (Array.isArray(ids) ? ids : []).forEach(function (id) { if (typeof id === "string" && !vistos[id]) { vistos[id] = true; unicos.push(id); } });
    return Promise.all(unicos.map(function (id) { return db.lancamentos.obter(id); })).then(function (ls) {
      var saida = [];
      ls.forEach(function (l) {
        if (!l) return;
        var fav = typeof l.favorecido === "string" ? l.favorecido.trim() : "";
        var temValor = Din.valido(l.valor_centavos) || (l.tipo === "saldo" && l.valor_centavos === 0);
        saida.push({ id: l.id, nome: fav || "Sem nome", valor: temValor ? Din.formatar(l.valor_centavos) : "", apagado: l.apagado === "sim" });
      });
      return saida;
    }).catch(function () { return []; });
  }

  // Quais lançamentos estão marcados "Alterado no outro celular". Só ids alterados (apagado não entra).
  function criarMarcas() {
    var set = {}, ouvintes = [];
    function avisar() { ouvintes.slice().forEach(function (f) { try { f(); } catch (_) { /* uma tela com defeito não atrapalha as outras */ } }); }
    return {
      marcar: function (ids) {
        var mudou = false;
        (ids || []).forEach(function (id) { if (!set[id]) { set[id] = true; mudou = true; } });
        if (mudou) avisar();
      },
      tirar: function (id) { if (set[id]) { delete set[id]; avisar(); } },
      limpar: function () { if (Object.keys(set).length) { set = {}; avisar(); } },
      tem: function (id) { return !!set[id]; },
      quantidade: function () { return Object.keys(set).length; },
      ids: function () { return Object.keys(set); },
      aoMudar: function (f) { ouvintes.push(f); return function () { ouvintes = ouvintes.filter(function (o) { return o !== f; }); }; },
    };
  }

  // O espaço do aviso de baixo. env:
  //   agendar(fn, ms), cancelar(t)        relógio (padrão: setTimeout)
  //   formularioAberto()                  com Novo/Editar aberto o aviso de alterado espera
  //   pintar(visao)                       { tipo: "comum", o, clicou } | { tipo: "alterado", texto, noLugar, ver }
  //   saindo(), limpar()                  começa a animação de saída / esvazia o aviso
  //   focoNoBotao(), reduzido()           opcionais
  //   aoVer({ editados, apagados })       o que fazer quando a pessoa toca "Ver"
  function criarAvisos(env) {
    var agendar = env.agendar || function (fn, ms) { return setTimeout(fn, ms); };
    var cancelar = env.cancelar || function (t) { clearTimeout(t); };
    var pend = {};      // chegou e está esperando (id -> item)
    var visivel = {};   // o que o aviso de alterado na tela está dizendo
    var atual = null;   // null | "comum" | "alterado"
    var tAviso = null, tFim = null;

    function tamanho(m) { return Object.keys(m).length; }
    function juntar(para, de) { Object.keys(de).forEach(function (k) { para[k] = de[k]; }); }
    function parar() { if (tAviso !== null) cancelar(tAviso); if (tFim !== null) cancelar(tFim); tAviso = null; tFim = null; }
    function armar(ms) { if (tAviso !== null) cancelar(tAviso); tAviso = agendar(sumir, ms); }
    function sumir() {
      tAviso = null;
      if (env.focoNoBotao && env.focoNoBotao()) { armar(ESPERA_FOCO); return; }
      env.saindo();
      tFim = agendar(fim, env.reduzido && env.reduzido() ? 0 : SAIDA);
    }
    function fim() { tFim = null; env.limpar(); atual = null; visivel = {}; tentar(); }

    function resumo() {
      var itens = Object.keys(visivel).map(function (k) { return visivel[k]; });
      return { itens: itens, editados: itens.filter(function (i) { return !i.apagado; }), apagados: itens.filter(function (i) { return i.apagado; }) };
    }
    function pintarAlterado(noLugar) {
      var r = resumo();
      var um = r.itens[0] || {};
      var texto = Ind.textoAlterado({ editados: r.editados.length, apagados: r.apagados.length, nome: um.nome, valor: um.valor });
      if (texto) env.pintar({ tipo: "alterado", texto: texto, noLugar: !!noLugar, ver: ver });
    }

    // Tenta mostrar o que está esperando. Nunca corta outro aviso e espera o formulário fechar.
    function tentar() {
      if (!tamanho(pend)) return;
      if (atual === "alterado") { // já tem um na tela: junta no lugar e os 8 s recomeçam
        juntar(visivel, pend);
        pend = {};
        pintarAlterado(true);
        armar(DURACAO);
        return;
      }
      if (atual === "comum" || env.formularioAberto()) return;
      visivel = pend;
      pend = {};
      atual = "alterado";
      pintarAlterado(false);
      armar(DURACAO);
    }

    // itens: [{ id, nome, valor, apagado }]. Id repetido conta uma vez (vale o mais recente).
    function chegou(itens) {
      (itens || []).forEach(function (i) { if (i && typeof i.id === "string") pend[i.id] = i; });
      tentar();
    }

    // Aviso comum ("Guardado…", "Lançamento apagado. Desfazer"): entra na hora, como sempre.
    // Se um de alterado estava na tela, ele volta a esperar e entra depois.
    function comum(o) {
      if (atual === "alterado") { var m = {}; juntar(m, visivel); juntar(m, pend); pend = m; visivel = {}; }
      parar();
      env.limpar();
      atual = "comum";
      env.pintar({ tipo: "comum", o: o, clicou: function () {
        parar(); env.limpar(); atual = null;
        if (o.aoAcao) o.aoAcao();
        agendar(tentar, 300); // dá tempo de o aviso seguinte ("de volta") entrar antes
      } });
      armar(o.duracao || 6000);
    }

    function ver() {
      if (atual !== "alterado") return;
      var r = resumo();
      parar(); env.limpar(); atual = null; visivel = {};
      if (env.aoVer) env.aoVer({ editados: r.editados, apagados: r.apagados });
      tentar();
    }

    return {
      chegou: chegou, comum: comum, tentar: tentar, ver: ver,
      estado: function () { return { atual: atual, esperando: tamanho(pend), naTela: tamanho(visivel) }; },
    };
  }

  return { DURACAO: DURACAO, resumir: resumir, criarMarcas: criarMarcas, criarAvisos: criarAvisos };
})();
if (typeof module !== "undefined") module.exports = Alterado;
