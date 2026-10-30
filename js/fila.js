// Zelo: fila de envio dos lançamentos (lógica testada com node --test). No navegador vira o objeto global Fila.
// Cria o lançamento no aparelho (com id gerado aqui), guarda na fila e envia em lotes para a ponte, que entra por parâmetro.
// Usa Dinheiro e Datas; o banco (Db, js/db.js) entra por parâmetro. Nada de rede nem de DOM aqui.
var Fila = (function () {
  var Din = typeof Dinheiro !== "undefined" ? Dinheiro : require("./dinheiro.js");
  var Dat = typeof Datas !== "undefined" ? Datas : require("./datas.js");

  var TAMANHO_LOTE = 50;
  // Contrato seção 4: só estes campos vão para a ponte.
  var CAMPOS = ["id", "data", "tipo", "valor_centavos", "favorecido", "categoria", "pessoa", "forma", "origem", "apagado", "editado_em"];
  // Como o lançamento nasceu (contrato, seção 4). Ao editar a origem é mantida; origem que o app não conhece vira manual.
  var ORIGENS = ["manual", "importacao"];
  var EDITAVEIS = ["data", "tipo", "valor_centavos", "favorecido", "categoria", "pessoa", "forma", "apagado"];

  // Códigos em que vale tentar de novo mais tarde, sem a Jéssica fazer nada.
  var TENTAR_DEPOIS = ["sem_internet", "tempo_esgotado", "ocupado", "interno"];

  var MENSAGENS = {
    sem_internet: "Sem internet. O app envia quando a conexão voltar.",
    tempo_esgotado: "A ponte demorou para responder. O app tenta de novo.",
    ocupado: "A planilha está ocupada agora. O app tenta de novo sozinho.",
    interno: "Algo deu errado na ponte. O app tenta de novo mais tarde.",
    codigo_invalido: "Este celular não foi reconhecido. Confira o código do aparelho em Ajustes.",
    contrato_incompativel: "O app e a ponte estão em versões diferentes. Atualize o app ou publique a ponte de novo.",
    versao_incompativel: "O app e a ponte estão em versões diferentes. Atualize o app ou publique a ponte de novo.",
    acao_desconhecida: "A ponte não conhece este pedido. Atualize o app.",
    dado_invalido: "Algum dado veio em formato errado.",
    dado_proibido: "Este dado não pode ser guardado: parece número de documento, cartão, telefone ou boleto.",
    resposta_estranha: "A ponte respondeu algo inesperado. Confira o endereço em Ajustes.",
    sem_configuracao: "Falta configurar a ponte em Ajustes.",
    endereco_invalido: "O endereço da ponte precisa começar com https://. Confira em Ajustes.",
  };

  function mensagem(codigo) {
    return MENSAGENS[codigo] || MENSAGENS.interno;
  }
  // true = tentar de novo mais tarde; false = a pessoa precisa ajustar algo.
  function tentarDeNovo(codigo) {
    return TENTAR_DEPOIS.indexOf(codigo) >= 0 || !MENSAGENS[codigo];
  }

  function erro(codigo, texto, campo) {
    var e = new Error(texto);
    e.codigo = codigo;
    if (campo) e.campo = campo;
    return e;
  }
  function invalido(campo, texto) {
    return erro("dado_invalido", texto, campo);
  }

  // UUID v4 em minúsculas. "cripto" só existe para o teste forçar os dois caminhos.
  function novoId(cripto) {
    var c = cripto !== undefined ? cripto : (typeof crypto !== "undefined" ? crypto : null);
    if (c && typeof c.randomUUID === "function") return String(c.randomUUID()).toLowerCase();
    if (!c || typeof c.getRandomValues !== "function") throw erro("indisponivel", "Não consegui gerar um código para o gasto neste celular.");
    var b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = "";
    for (var i = 0; i < 16; i++) h += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  function relogioPadrao() { return new Date(); }

  function textoOpcional(v, max, campo) {
    if (v === undefined || v === null) return "";
    if (typeof v !== "string" || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) throw invalido(campo, "Confira o campo " + campo + ".");
    return v.trim();
  }

  // Confere um registro completo contra o contrato (seção 4) e devolve a cópia limpa com os 11 campos.
  function conferir(r) {
    if (!Dat.valida(r.data)) throw invalido("data", "A data não é válida.");
    if (r.tipo !== "entrou" && r.tipo !== "saiu") throw invalido("tipo", "O tipo precisa ser entrou ou saiu.");
    if (!Din.valido(r.valor_centavos)) throw invalido("valor_centavos", "O valor precisa ser maior que zero.");
    if (typeof r.favorecido !== "string") throw invalido("favorecido", "Falta dizer quem recebeu ou pagou.");
    var fav = r.favorecido.trim();
    if (fav.length < 1 || fav.length > 80 || /[\u0000-\u001f\u007f]/.test(fav)) throw invalido("favorecido", "O nome precisa ter de 1 a 80 letras.");
    if (r.apagado !== "" && r.apagado !== "sim") throw invalido("apagado", "Confira o campo apagado.");
    return {
      id: r.id, data: r.data, tipo: r.tipo, valor_centavos: r.valor_centavos, favorecido: fav,
      categoria: textoOpcional(r.categoria, 40, "categoria"), pessoa: textoOpcional(r.pessoa, 40, "pessoa"),
      forma: textoOpcional(r.forma, 30, "forma"), origem: ORIGENS.indexOf(r.origem) >= 0 ? r.origem : "manual", apagado: r.apagado, editado_em: r.editado_em,
    };
  }

  function soRegistro(l) {
    var r = {};
    CAMPOS.forEach(function (c) { r[c] = l[c] === undefined ? "" : l[c]; });
    return r;
  }

  // --- avisos e estado interno de cada banco aberto ---
  var ouvintes = [];
  var internos = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  function interno(db) {
    var s = internos.get(db);
    if (!s) { s = { enviando: false, ultimaFalha: null }; internos.set(db, s); }
    return s;
  }
  function aoMudar(ouvinte) {
    ouvintes.push(ouvinte);
    return function () { ouvintes = ouvintes.filter(function (o) { return o !== ouvinte; }); };
  }
  // extra: dado opcional do evento (ex.: a lista de ids de "alterado_no_outro").
  function avisar(evento, extra) {
    ouvintes.slice().forEach(function (o) { try { o(evento, extra); } catch (_) { /* um ouvinte com defeito não derruba a fila */ } });
  }

  // --- criar e editar ---
  function criar(db, dados, relogio) {
    var agora = (relogio || relogioPadrao)();
    var d = dados || {};
    var id = novoId();
    var registro;
    try {
      registro = conferir({
        id: id, data: d.data, tipo: d.tipo, valor_centavos: d.valor_centavos, favorecido: d.favorecido,
        categoria: d.categoria, pessoa: d.pessoa, forma: d.forma, apagado: "", editado_em: Dat.agoraIso(agora),
      });
    } catch (e) { return Promise.reject(e); }
    var local = Object.assign({}, registro, { situacao: "esperando" });
    return db.transacao(["lancamentos", "fila"], function (o) {
      return o.lancamentos.gravar(local).then(function () {
        return o.fila.acrescentar({ id: id, registro: registro, entrou_em: registro.editado_em });
      });
    }).then(function () { avisar("criou"); return local; });
  }

  function editar(db, id, mudancas, relogio) {
    var agora = (relogio || relogioPadrao)();
    var m = mudancas || {};
    return db.transacao(["lancamentos", "fila"], function (o) {
      return o.lancamentos.obter(id).then(function (atual) {
        if (!atual) throw erro("nao_encontrado", "Não achei este lançamento.");
        Object.keys(m).forEach(function (k) {
          if (k !== "id" && EDITAVEIS.indexOf(k) < 0) throw invalido(k, "Este campo não pode ser mudado.");
        });
        var novo = soRegistro(atual);
        EDITAVEIS.forEach(function (k) { if (m[k] !== undefined) novo[k] = m[k]; });
        // editado_em sempre mais novo que o anterior, mesmo com o relógio igual ou atrasado.
        var ms = Math.max(agora.getTime(), new Date(atual.editado_em).getTime() + 1);
        novo.editado_em = Dat.agoraIso(new Date(ms));
        var registro = conferir(novo);
        registro.id = id;
        var local = Object.assign({}, atual, registro, { situacao: "esperando" });
        delete local.motivo_recusa;
        return o.lancamentos.gravar(local).then(function () {
          return o.fila.todas();
        }).then(function (todas) {
          var existente = todas.filter(function (e) { return e.id === id; })[0];
          if (existente) return o.fila.substituir(existente.seq, { id: id, registro: registro, entrou_em: existente.entrou_em });
          return o.fila.acrescentar({ id: id, registro: registro, entrou_em: registro.editado_em });
        }).then(function () { return local; });
      });
    }).then(function (local) { avisar("editou"); return local; });
  }

  // --- envio ---
  function parar(codigo, resumo) {
    resumo.parou = true;
    resumo.motivo = codigo;
    return resumo;
  }

  // Aplica na transação os resultados de um lote (mesma ordem do pedido).
  function aplicar(o, lote, resultados, resumo) {
    var chain = o.fila.todas().then(function (naFila) {
      var porSeq = {};
      naFila.forEach(function (e) { porSeq[e.seq] = e; });
      var p = Promise.resolve();
      lote.forEach(function (entrada, i) {
        var res = resultados[i];
        p = p.then(function () {
          var atual = porSeq[entrada.seq];
          // Se a pessoa editou de novo enquanto enviava, a entrada nova continua na fila.
          var maisNova = !!atual && atual.registro.editado_em !== entrada.registro.editado_em;
          return o.lancamentos.obter(entrada.id).then(function (local) {
            var passos = [];
            if (!maisNova && atual) passos.push(o.fila.remover(entrada.seq));
            if (res.resultado === "gravado" || res.resultado === "atualizado") {
              if (local) {
                var l = Object.assign({}, local, { atualizado_em: res.atualizado_em });
                if (!maisNova) { l.situacao = ""; delete l.motivo_recusa; }
                passos.push(o.lancamentos.gravar(l));
              }
              resumo.enviados++;
            } else if (res.resultado === "repetido") {
              resumo.repetidos.push(entrada.id);
              var r = res.registro && typeof res.registro === "object" ? res.registro : null;
              if (r && !maisNova) {
                var novo = soRegistro(r);
                novo.id = entrada.id;
                var diferente = CAMPOS.some(function (c) { return novo[c] !== entrada.registro[c]; });
                if (diferente) resumo.alterados_no_outro.push(entrada.id);
                var trocado = Object.assign({}, novo, { situacao: "" });
                if (typeof r.atualizado_em === "string") trocado.atualizado_em = r.atualizado_em;
                passos.push(o.lancamentos.gravar(trocado));
              } else if (local && !maisNova) {
                passos.push(o.lancamentos.gravar(Object.assign({}, local, { situacao: "" })));
              }
            } else { // recusado
              var mot = res.motivo || {};
              var texto = typeof mot.mensagem === "string" ? mot.mensagem : mensagem(mot.codigo);
              resumo.recusados.push({ id: entrada.id, codigo: mot.codigo || "dado_invalido", campo: mot.campo || "", mensagem: texto });
              if (local && !maisNova) passos.push(o.lancamentos.gravar(Object.assign({}, local, { situacao: "nao_enviado", motivo_recusa: texto })));
            }
            return Promise.all(passos);
          });
        });
      });
      return p;
    });
    return chain;
  }

  function resultadoValido(r, entrada) {
    return r && typeof r === "object" && r.id === entrada.id &&
      ["gravado", "atualizado", "repetido", "recusado"].indexOf(r.resultado) >= 0;
  }

  // ponte(lote) recebe { itens: [...] } e devolve o envelope do contrato (ok/dados/erro) ou lança erro de rede.
  async function enviar(db, ponte, opcoes) {
    var st = interno(db);
    if (st.enviando) return { jaEnviando: true };
    st.enviando = true;
    avisar("enviando");
    var op = opcoes || {};
    var tam = Math.min(op.tamanhoLote || TAMANHO_LOTE, TAMANHO_LOTE);
    var resumo = { enviados: 0, repetidos: [], alterados_no_outro: [], recusados: [], parou: false };
    var tentados = {};
    try {
      for (;;) {
        var todas = await db.fila.todas();
        var lote = todas.filter(function (e) { return !tentados[e.seq + "|" + e.registro.editado_em]; }).slice(0, tam);
        if (!lote.length) break;
        var vistos = {};
        lote.forEach(function (e) {
          if (vistos[e.id]) throw new Error("Fila: dois itens com o mesmo id no mesmo lote.");
          vistos[e.id] = true;
          tentados[e.seq + "|" + e.registro.editado_em] = true;
        });
        var resp;
        try {
          resp = await ponte({ itens: lote.map(function (e) { return soRegistro(e.registro); }) });
        } catch (e) {
          st.ultimaFalha = (e && typeof e.codigo === "string") ? e.codigo : "sem_internet";
          avisar("falhou");
          return parar(st.ultimaFalha, resumo);
        }
        if (!resp || typeof resp !== "object") resp = { ok: false, erro: { codigo: "resposta_estranha" } };
        if (resp.ok !== true) {
          st.ultimaFalha = (resp.erro && typeof resp.erro.codigo === "string") ? resp.erro.codigo : "resposta_estranha";
          avisar("falhou");
          return parar(st.ultimaFalha, resumo);
        }
        var resultados = resp.dados && resp.dados.resultados;
        var bom = Array.isArray(resultados) && resultados.length === lote.length &&
          lote.every(function (e, i) { return resultadoValido(resultados[i], e); });
        if (!bom) {
          st.ultimaFalha = "resposta_estranha";
          avisar("falhou");
          return parar("resposta_estranha", resumo);
        }
        await db.transacao(["lancamentos", "fila"], function (o) { return aplicar(o, lote, resultados, resumo); });
        st.ultimaFalha = null;
        await db.config.definir("ultimo_envio_em", Dat.agoraIso((op.relogio || relogioPadrao)()));
      }
      st.ultimaFalha = null;
      return resumo;
    } finally {
      st.enviando = false;
      // Mesmo aviso do receber(): a tela ouve um só evento, sem saber de onde veio.
      if (resumo.alterados_no_outro.length) avisar("alterado_no_outro", resumo.alterados_no_outro.slice());
      avisar("terminou");
    }
  }

  // --- recebimento (contrato seção 6) ---
  var MAX_PAGINAS = 100;
  var UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var ISO24 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  // Item da ponte -> lançamento local (só os campos do banco) ou null se vier malformado.
  function itemRecebido(it) {
    if (!it || typeof it !== "object" || Array.isArray(it)) return null;
    if (typeof it.id !== "string" || !UUID4.test(it.id)) return null;
    if (!Dat.valida(it.data) || (it.tipo !== "entrou" && it.tipo !== "saiu") || !Din.valido(it.valor_centavos)) return null;
    if (typeof it.favorecido !== "string" || typeof it.editado_em !== "string" || !ISO24.test(it.editado_em)) return null;
    if (typeof it.atualizado_em !== "string" || !ISO24.test(it.atualizado_em)) return null;
    var apagado = it.apagado === undefined || it.apagado === null ? "" : it.apagado;
    if (apagado !== "" && apagado !== "sim") return null;
    var r = soRegistro(it);
    r.apagado = apagado;
    r.atualizado_em = it.atualizado_em;
    r.situacao = "";
    return r;
  }

  // Guarda uma página inteira (itens + proximo_desde) numa transação só. Devolve as contas da página.
  function guardarPagina(db, itens, proximo, conta) {
    return db.transacao(["lancamentos", "fila", "config"], function (o) {
      var c = { recebidos: 0, descartados: 0, mantidos: 0, trocados_local: 0, ignorados: 0, alterados: [], removidos: 0 };
      return o.fila.todas().then(function (naFila) {
        var porId = {};
        naFila.forEach(function (e) { porId[e.id] = e; });
        var p = Promise.resolve();
        itens.forEach(function (bruto) {
          p = p.then(function () {
            var item = itemRecebido(bruto);
            if (!item) { c.ignorados++; return null; }
            return o.lancamentos.obter(item.id).then(function (local) {
              var pend = porId[item.id];
              if (!local) { c.recebidos++; return o.lancamentos.gravar(item); }
              if (local.atualizado_em === item.atualizado_em) { c.descartados++; return null; }
              // Regra 3: a edição que está na fila (ou recusada) é mais nova: a cópia local fica.
              if (pend && pend.registro.editado_em > item.editado_em) { c.mantidos++; return null; }
              if (!pend && local.situacao === "nao_enviado" && local.editado_em > item.editado_em) { c.mantidos++; return null; }
              // Regra 4: troca a cópia local. Edição local mais velha na fila perdeu: sai da fila e vira aviso.
              var passos = [o.lancamentos.gravar(item)];
              if (pend) {
                passos.push(o.fila.remover(pend.seq));
                c.removidos++;
                if (pend.registro.editado_em < item.editado_em) c.alterados.push(item.id);
              }
              c.recebidos++;
              c.trocados_local++;
              return Promise.all(passos);
            });
          });
        });
        return p;
      }).then(function () {
        return o.config.definir("proximo_desde", proximo);
      }).then(function () { return c; });
    });
  }

  // Baixa só o que mudou desde o último recebimento e guarda no celular.
  // ponte.chamar("ler_lancamentos", { desde, limite? }) devolve o envelope. Nunca lança.
  // opcoes: { limite (padrão: o da ponte, 500), maxPaginas }
  async function receber(db, ponte, opcoes) {
    var st = interno(db);
    var res = { recebidos: 0, descartados: 0, mantidos: 0, trocados_local: 0, ignorados: 0, paginas: 0, alterados_no_outro: [], parou: false };
    if (st.recebendo) return { jaRecebendo: true };
    st.recebendo = true;
    var op = opcoes || {};
    var maxPaginas = op.maxPaginas || MAX_PAGINAS;
    var limite = op.limite;
    var mudou = false;
    try {
      var desde = await db.config.obter("proximo_desde");
      if (typeof desde !== "string") desde = null;
      var chamadas = 0;
      while (res.paginas < maxPaginas && chamadas < maxPaginas + 20) {
        chamadas++;
        var dados = { desde: desde };
        if (limite !== undefined) dados.limite = limite;
        var resp;
        try { resp = await ponte.chamar("ler_lancamentos", dados); } catch (e) {
          return parar((e && typeof e.codigo === "string") ? e.codigo : "sem_internet", res);
        }
        if (!resp || typeof resp !== "object") return parar("resposta_estranha", res);
        if (resp.ok !== true) return parar((resp.erro && typeof resp.erro.codigo === "string") ? resp.erro.codigo : "resposta_estranha", res);
        var d = resp.dados;
        if (!d || !Array.isArray(d.itens) || typeof d.mais !== "boolean" || typeof d.proximo_desde !== "string" || !ISO24.test(d.proximo_desde)) {
          return parar("resposta_estranha", res);
        }
        if (d.mais && desde !== null && d.proximo_desde <= desde) {
          // Muitos itens com a mesma hora (o desde usa >=): pede uma página maior antes de desistir.
          if (limite !== undefined && limite < 500) { limite = Math.min(500, limite * 2); continue; }
          return parar("resposta_estranha", res);
        }
        var c;
        try { c = await guardarPagina(db, d.itens, d.proximo_desde); } catch (e) {
          return parar((e && typeof e.codigo === "string") ? e.codigo : "outro", res);
        }
        res.paginas++;
        ["recebidos", "descartados", "mantidos", "trocados_local", "ignorados"].forEach(function (k) { res[k] += c[k]; });
        c.alterados.forEach(function (id) { if (res.alterados_no_outro.indexOf(id) < 0) res.alterados_no_outro.push(id); });
        if (c.recebidos || c.removidos) mudou = true;
        desde = d.proximo_desde;
        if (!d.mais) return res;
      }
      return res; // sobra para a próxima rodada
    } finally {
      st.recebendo = false;
      if (mudou) avisar("recebeu");
      if (res.alterados_no_outro.length) avisar("alterado_no_outro", res.alterados_no_outro.slice());
    }
  }

  // --- estado para o indicador (função pura) ---
  // contexto: { pendentes, nao_enviados, enviando, online, ultimaFalha, configurado }
  // "precisa-de-atencao" vale mesmo durante um envio ou sem internet: é o que a Jéssica precisa resolver.
  // Aceita estado(contexto) ou estado(db, contexto); o banco não é lido aqui (ver lerEstado).
  function estado(a, b) {
    var c = (b !== undefined ? b : a) || {};
    var pendentes = c.pendentes || 0;
    var naoEnviados = c.nao_enviados || 0;
    var falha = c.ultimaFalha || null;
    var base = { pendentes: pendentes, nao_enviados: naoEnviados };
    var atencao = naoEnviados > 0 || c.configurado === false || (falha && !tentarDeNovo(falha));
    var nome;
    if (atencao) nome = "precisa-de-atencao";
    else if (c.enviando) nome = "enviando";
    else if (pendentes > 0 && (c.online === false || falha)) nome = "esperando-internet";
    else if (pendentes > 0) nome = "esperando";
    else nome = "em-dia";
    base.estado = nome;
    base.online = c.online !== false;
    // Por que precisa de atenção: "recusado", "semconfig" ou "codigo" (o indicador escolhe o texto).
    if (atencao) base.causa = naoEnviados > 0 ? "recusado" : c.configurado === false ? "semconfig" : "codigo";
    return base;
  }

  // Lê o banco e o estado interno e devolve o mesmo que estado().
  async function lerEstado(db, online, configurado) {
    var todos = await db.lancamentos.todos();
    var s = interno(db);
    return estado({
      pendentes: await db.fila.contar(),
      nao_enviados: todos.filter(function (l) { return l.situacao === "nao_enviado"; }).length,
      enviando: s.enviando, online: online, ultimaFalha: s.ultimaFalha, configurado: configurado,
    });
  }

  return {
    TAMANHO_LOTE: TAMANHO_LOTE, ORIGENS: ORIGENS, novoId: novoId, criar: criar, editar: editar, enviar: enviar, receber: receber,
    estado: estado, lerEstado: lerEstado, aoMudar: aoMudar, mensagem: mensagem, tentarDeNovo: tentarDeNovo,
  };
})();
if (typeof module !== "undefined") module.exports = Fila;
