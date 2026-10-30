// Zelo: o que as telas Novo e Editar fazem com o banco (#18, partes C, D e E), sem DOM.
// Une Formulario (regras), Opcoes (listas da planilha) e Lancamentos (gravar). Quem desenha é js/tela-lancar.js.
// Valida SEMPRE antes de gravar: com erro, nada é chamado. Um segundo toque enquanto grava é ignorado.
// Nada digitado vai para console, localStorage ou URL. No navegador vira o objeto global Lancar.
var Lancar = (function () {
  var Lan = typeof Lancamentos !== "undefined" ? Lancamentos : require("./lancamentos.js");
  var For = typeof Formulario !== "undefined" ? Formulario : require("./formulario.js");
  var Opc = typeof Opcoes !== "undefined" ? Opcoes : require("./opcoes.js");

  var MENSAGEM_PADRAO = "Não consegui guardar no celular. O que você digitou continua aqui.";

  function mensagemDe(e) {
    return e && typeof e.message === "string" && e.message ? e.message : MENSAGEM_PADRAO;
  }

  // Valores que o lançamento já tinha: passam na lista mesmo que a planilha tenha tirado a opção.
  function manterDe(l) {
    return { categoria: l.categoria || "", pessoa: l.pessoa || "", forma: l.forma || "" };
  }

  // db: banco aberto. opcoes: { relogio } (só para testes).
  function criar(db, opcoes) {
    var relogio = opcoes && opcoes.relogio;
    var ocupado = false;

    // Roda fn uma vez de cada vez; um segundo pedido no mesmo instante volta { ignorado: true }.
    function umPorVez(fn) {
      if (ocupado) return Promise.resolve({ ignorado: true });
      ocupado = true;
      return Promise.resolve().then(fn).then(
        function (r) { ocupado = false; return r; },
        function (e) { ocupado = false; return { ok: false, banco: true, mensagem: mensagemDe(e), codigo: e && e.codigo }; }
      );
    }

    // Abre o Novo: opções do celular, lançamentos para os padrões e as sugestões, e os campos iniciais.
    function abrirNovo(hoje) {
      return Promise.all([Opc.ler(db), Lan.todosVisiveis(db)]).then(function (v) {
        var opcoesDaPlanilha = v[0], lancamentos = v[1];
        var ctx = { opcoes: opcoesDaPlanilha, hoje: hoje };
        var campos = For.vazio(ctx);
        var pad = For.padroes(lancamentos, ctx);
        campos.pessoa = pad.pessoa;
        campos.forma = pad.forma;
        return { opcoes: opcoesDaPlanilha, lancamentos: lancamentos, campos: campos };
      });
    }

    // Abre o Editar. Id que não existe ou já apagado: { achou: false }.
    function abrirEdicao(id, hoje) {
      return Promise.all([db.lancamentos.obter(id), Opc.ler(db), Lan.todosVisiveis(db)]).then(function (v) {
        var l = v[0];
        if (!l || l.apagado === "sim") return { achou: false };
        var campos = For.deLancamento(l);
        var ctx = { opcoes: v[1], hoje: hoje, manter: manterDe(l) };
        var conferido = For.validar(campos, ctx);
        // Dado proibido já guardado (importado): o aviso já vem na abertura.
        var inicial = {};
        ["favorecido", "categoria", "pessoa", "forma"].forEach(function (k) {
          if (conferido.erros[k] === For.TEXTOS.proibido) inicial[k] = conferido.erros[k];
        });
        return { achou: true, lancamento: l, campos: campos, opcoes: v[1], lancamentos: v[2], erros: inicial };
      });
    }

    function salvarNovo(campos, ctx) {
      var r = For.validar(campos, ctx);
      if (!r.ok) return Promise.resolve({ ok: false, erros: r.erros, avisos: r.avisos });
      return umPorVez(function () {
        return Lan.criar(db, r.registro, relogio).then(function (l) { return { ok: true, lancamento: l, avisos: r.avisos }; });
      });
    }

    // original: o lançamento como estava ao abrir. Sem mudança: não toca no banco (exceto se foi recusado).
    function salvarEdicao(original, campos, ctx) {
      var contexto = { opcoes: ctx.opcoes, hoje: ctx.hoje, manter: manterDe(original) };
      var r = For.validar(campos, contexto);
      if (!r.ok) return Promise.resolve({ ok: false, erros: r.erros, avisos: r.avisos });
      var mudancas = For.diferenca(original, r.registro);
      var recusado = original.situacao === "nao_enviado"; // a ponte recusou: Salvar manda de novo
      if (Object.keys(mudancas).length === 0 && !recusado) return Promise.resolve({ ok: true, nada: true });
      return umPorVez(function () {
        return Lan.editar(db, original.id, mudancas, relogio).then(function (l) { return { ok: true, lancamento: l, avisos: r.avisos }; });
      });
    }

    function apagar(id) {
      return umPorVez(function () { return Lan.apagar(db, id, relogio).then(function (l) { return { ok: true, lancamento: l }; }); });
    }
    function desfazerApagar(id) {
      return umPorVez(function () { return Lan.desfazerApagar(db, id, relogio).then(function (l) { return { ok: true, lancamento: l }; }); });
    }

    // Com o Editar aberto: o banco já tem uma versão mais nova do mesmo lançamento? Devolve o lançamento atual ou null.
    function versaoMaisNova(aberto) {
      return db.lancamentos.obter(aberto.id).then(function (atual) {
        return For.alteradoDepois(aberto, atual) ? atual : null;
      });
    }

    return {
      abrirNovo: abrirNovo, abrirEdicao: abrirEdicao, salvarNovo: salvarNovo, salvarEdicao: salvarEdicao,
      apagar: apagar, desfazerApagar: desfazerApagar, versaoMaisNova: versaoMaisNova
    };
  }

  return { criar: criar };
})();
if (typeof module !== "undefined") module.exports = Lancar;
