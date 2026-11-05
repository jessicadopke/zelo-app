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
    return { categoria: l.categoria || "", pessoa: l.pessoa || "", forma: l.forma || "", cartao: l.cartao || "", caixinha: l.caixinha || "" };
  }

  // Guardar, tirar e saldo conferido não têm editor no P4 (são do P5): para o Editar é como se não existissem.
  var SEM_EDITOR = ["guardou", "tirou", "saldo"];

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
    // pedido.fatura = nome do cartão (botão "Paguei a fatura" do Início): abre o pagamento com cartão e valor em aberto.
    function abrirNovo(hoje, pedido) {
      return Promise.all([Opc.ler(db), Lan.todosVisiveis(db)]).then(function (v) {
        var opcoesDaPlanilha = v[0], lancamentos = v[1];
        var ctx = { opcoes: opcoesDaPlanilha, hoje: hoje };
        var campos = For.vazio(ctx);
        var pad = For.padroes(lancamentos, ctx);
        campos.pessoa = pad.pessoa;
        campos.forma = pad.forma;
        var temCartao = !!(opcoesDaPlanilha && Array.isArray(opcoesDaPlanilha.cartoes) && opcoesDaPlanilha.cartoes.length);
        var cartaoPedido = pedido && typeof pedido.fatura === "string" ? pedido.fatura : "";
        if (temCartao && cartaoPedido && opcoesDaPlanilha.cartoes.indexOf(cartaoPedido) >= 0) {
          campos.tipo = "fatura";
          campos.cartao = cartaoPedido;
          campos.valor = For.valorSugerido(For.emAberto(lancamentos, cartaoPedido, hoje));
        } else if (temCartao) {
          var ultimo = For.ultimoCartao(lancamentos, opcoesDaPlanilha);
          if (ultimo) campos.cartao = ultimo;
        }
        return { opcoes: opcoesDaPlanilha, lancamentos: lancamentos, campos: campos };
      });
    }

    // Abre o Editar. Id que não existe ou já apagado: { achou: false }.
    function abrirEdicao(id, hoje) {
      return Promise.all([db.lancamentos.obter(id), Opc.ler(db), Lan.todosVisiveis(db)]).then(function (v) {
        var l = v[0];
        if (!l || l.apagado === "sim" || SEM_EDITOR.indexOf(l.tipo) >= 0) return { achou: false };
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

    // origem: { id, origem } (opcional): a leitura de comprovante (#73) cria com o id gerado quando a proposta chegou e origem "foto".
    function salvarNovo(campos, ctx, origem) {
      var p = For.preparar(campos, ctx);
      var r = For.validar(p.campos, p.ctx);
      if (!r.ok) return Promise.resolve({ ok: false, erros: r.erros, avisos: r.avisos });
      var registro = origem ? Object.assign({}, r.registro, { id: origem.id, origem: origem.origem }) : r.registro;
      return umPorVez(function () {
        return Lan.criar(db, registro, relogio).then(function (l) { return { ok: true, lancamento: l, avisos: r.avisos }; });
      });
    }

    // original: o lançamento como estava ao abrir. Sem mudança: não toca no banco (exceto se foi recusado).
    // Se o outro celular apagou este lançamento enquanto o Editar estava aberto, Salvar traz ele de volta
    // (apagado: ""): a edição mais nova vale (#16, parte F, decisão 3).
    function salvarEdicao(original, campos, ctx) {
      var p = For.preparar(campos, { opcoes: ctx.opcoes, hoje: ctx.hoje, manter: manterDe(original) });
      var r = For.validar(p.campos, p.ctx);
      if (!r.ok) return Promise.resolve({ ok: false, erros: r.erros, avisos: r.avisos });
      var mudancas = For.diferenca(original, r.registro);
      var recusado = original.situacao === "nao_enviado"; // a ponte recusou: Salvar manda de novo
      return umPorVez(function () {
        return db.lancamentos.obter(original.id).then(function (noBanco) {
          if (noBanco && noBanco.apagado === "sim") mudancas.apagado = "";
          if (Object.keys(mudancas).length === 0 && !recusado) return { ok: true, nada: true };
          return Lan.editar(db, original.id, mudancas, relogio).then(function (l) { return { ok: true, lancamento: l, avisos: r.avisos }; });
        });
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

    // O que está no banco agora (para a nota "alterado no outro celular" do Editar). Id que não existe: null.
    function lerAtual(id) { return db.lancamentos.obter(id).then(function (l) { return l || null; }); }

    return {
      lerAtual: lerAtual, abrirNovo: abrirNovo, abrirEdicao: abrirEdicao, salvarNovo: salvarNovo, salvarEdicao: salvarEdicao,
      apagar: apagar, desfazerApagar: desfazerApagar, versaoMaisNova: versaoMaisNova
    };
  }

  return { criar: criar };
})();
if (typeof module !== "undefined") module.exports = Lancar;
