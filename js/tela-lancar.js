// Zelo: a tela de lançar (Novo e Editar), #18 partes C, D e E. Só desenho e ligação: as regras estão em Formulario,
// o que grava está em Lancar. Todo texto que vem da planilha ou da pessoa entra com textContent, nunca como HTML.
// Nada digitado vai para console, localStorage, URL, título ou aria-label. No navegador vira o objeto global TelaLancar.
var TelaLancar = (function () {
  var SVG_NS = "http://www.w3.org/2000/svg";
  var VAZIO = { categoria: "Sem categoria", pessoa: "Ninguém em especial", forma: "Não informar" };
  var MAX_BOTOES_CATEGORIA = 12;
  // campo da regra -> prefixo dos ids no index.html
  var ID = { valor: "valor", data: "data", favorecido: "fav", categoria: "cat", pessoa: "pes", forma: "forma", cartao: "lugar" };
  // Acima disto a lista de cartões vira <select> (como a categoria).
  var MAX_BOTOES_CARTAO = 12;
  // Ordem em que o foco procura o primeiro erro, como a tela está desenhada (o Pagar fatura só tem estes campos).
  var ORDEM = ["tipo", "valor", "data", "favorecido", "categoria", "cartao", "pessoa", "forma"];
  var ORDEM_FATURA = ["cartao", "valor", "data"];

  // env: { pronto: Promise<{ db, ponte } | null>, hoje(), online(), sair(), avisar({ texto, icone, acao, duracao, aoAcao }),
  //        marcas (opcional: Alterado.criarMarcas(); abrir um lançamento tira a marca dele) }
  function criar(env) {
    var doc = document;
    var $ = function (id) { return doc.getElementById(id); };
    var form = $("form"), corpo = $("form-corpo"), titulo = $("form-t");
    var salvarBtn = $("lf-salvar"), descartarBtn = $("lf-descartar"), erroBanco = $("lf-erro-banco");
    var campoValor = $("lf-valor"), campoData = $("lf-data"), campoFav = $("lf-fav");
    var gCat = $("lf-cat"), selCat = $("lf-cat-lista"), selPes = $("lf-pes"), selForma = $("lf-forma");
    var notaCat = $("lf-cat-nota"), notaForm = $("lf-nota");
    var folhaFundo = $("lf-folha-fundo");
    var app = doc.querySelector(".app");

    var aberto = false, modo = "novo", geracao = 0;
    var sessao = null, ctxDb = null;
    var original = null, inicial = null, opcoes = null, lancamentos = [];
    var lugar = null, qual = null, lugarPadrao = "", abriuPorFatura = false, listasVazias = false, ultimoAviso = "", ultimoAberto = "";
    var voltarFocoDaFolha = null, salvando = false, ultimaSugestao = "", tocou = {}, desligarFila = null, voltarFoco = null;
    var outro = null; // nota "trocada por outro celular": { id, passo: "troca" | "visto" | "apagado" | "mantido", atual }

    function el(tag, classe, texto) {
      var e = doc.createElement(tag);
      if (classe) e.className = classe;
      if (texto !== undefined) e.textContent = texto;
      return e;
    }
    function icone(id, classe) {
      var svg = doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "ic" + (classe ? " " + classe : ""));
      svg.setAttribute("aria-hidden", "true");
      var uso = doc.createElementNS(SVG_NS, "use");
      uso.setAttribute("href", "#" + id);
      svg.appendChild(uso);
      return svg;
    }
    function movimentoReduzido() {
      return doc.documentElement.dataset.movimento === "reduzido"
        || !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }

    // ---- campos: ler e escrever ----
    function tipoAtual() {
      var r = form.querySelector('input[name="lf-tipo"]:checked');
      return r ? r.value : "saiu";
    }
    function categoriaAtual() {
      if (!$("lf-cat-lista-linha").hidden) return selCat.value;
      var r = gCat.querySelector("input:checked");
      return r ? r.value : "";
    }
    function lerCampos() {
      var t = tipoAtual();
      var c = {
        tipo: t, valor: campoValor.value, data: campoData.value, favorecido: campoFav.value,
        categoria: categoriaAtual(), pessoa: selPes.value, forma: selForma.value
      };
      // Fatura usa "Qual cartão?"; saiu e entrou usam "Como pagou" / "Onde entrou". Sem cartão na tela, o campo nem existe.
      var nome = t === "fatura" ? qual.valor() : lugar.valor();
      if (nome) c.cartao = nome;
      return c;
    }
    function contexto() { return { opcoes: opcoes, hoje: env.hoje() }; }

    function preencherSelect(sel, vazio, lista, atual) {
      sel.textContent = "";
      var o0 = el("option", "", vazio);
      o0.value = "";
      sel.appendChild(o0);
      var itens = Array.isArray(lista) ? lista.slice() : [];
      if (atual && itens.indexOf(atual) < 0) itens.push(atual); // valor que a planilha tirou, mas o lançamento ainda tem
      itens.forEach(function (t) { var o = el("option", "", t); o.value = t; sel.appendChild(o); });
      sel.value = atual || "";
    }
    function preencherCategoria(atual) {
      var lista = opcoes && Array.isArray(opcoes.categorias) ? opcoes.categorias.slice() : [];
      if (atual && lista.indexOf(atual) < 0) lista.push(atual);
      var usarLista = lista.length > MAX_BOTOES_CATEGORIA;
      $("lf-cat-lista-linha").hidden = !usarLista;
      gCat.hidden = usarLista;
      if (usarLista) {
        preencherSelect(selCat, VAZIO.categoria, lista, atual);
        return;
      }
      gCat.textContent = "";
      [""].concat(lista).forEach(function (t) {
        var rotulo = el("label", "escolha");
        var radio = doc.createElement("input");
        radio.type = "radio";
        radio.name = "lf-categoria";
        radio.value = t;
        radio.checked = t === (atual || "");
        rotulo.append(radio, el("span", "", t === "" ? VAZIO.categoria : t), icone("i-ok", "ic-ok"));
        gCat.appendChild(rotulo);
      });
    }
    function definirCategoria(valor) {
      if (!$("lf-cat-lista-linha").hidden) { selCat.value = valor; return; }
      var alvo = Array.prototype.filter.call(gCat.querySelectorAll("input"), function (i) { return i.value === valor; })[0];
      if (alvo) alvo.checked = true;
    }
    // Grupo de escolha de cartão: botões à vista (ou lista acima de 12). itens: [{ valor, rotulo, cartao, extra }].
    function criarGrupoCartao(nome, idGrupo, idLinha, idSelect, vazioRotulo) {
      var g = $(idGrupo), linha = $(idLinha), sel = $(idSelect);
      var atual = ""; // o escolhido fica em memória: a tela não precisa ler os botões de volta
      return {
        preencher: function (itens, marcado) {
          atual = marcado || "";
          var usarLista = itens.filter(function (i) { return i.cartao; }).length > MAX_BOTOES_CARTAO;
          linha.hidden = !usarLista;
          g.hidden = usarLista;
          g.textContent = "";
          sel.textContent = "";
          if (usarLista) {
            var o0 = el("option", "", vazioRotulo);
            o0.value = "";
            sel.appendChild(o0);
            itens.forEach(function (i) { if (i.valor === "") return; var o = el("option", "", i.rotulo); o.value = i.valor; sel.appendChild(o); });
            sel.value = marcado || "";
            return;
          }
          itens.forEach(function (i) {
            var rotulo = el("label", "escolha");
            if (i.extra) rotulo.setAttribute("data-extra", "sim");
            var radio = doc.createElement("input");
            radio.type = "radio";
            radio.name = nome;
            radio.value = i.valor;
            radio.checked = i.valor === (marcado || "");
            if (i.cartao) rotulo.appendChild(icone("i-cartao", "ic-cartao"));
            rotulo.append(radio, el("span", "", i.rotulo), icone("i-ok", "ic-ok"));
            g.appendChild(rotulo);
          });
        },
        valor: function () { return atual; },
        // chamado quando a pessoa toca num botão (ou troca a lista)
        escolheu: function (alvo) { atual = alvo && typeof alvo.value === "string" ? alvo.value : ""; },
        definir: function (v) {
          atual = v || "";
          if (!linha.hidden) { sel.value = v; return; }
          Array.prototype.forEach.call(g.querySelectorAll("input"), function (i) { i.checked = i.value === v; });
        },
        // Trocar de botão tira o botão extra (cartão que a planilha não tem mais), a não ser que ele seja o marcado. Devolve se ainda há extra.
        tirarExtra: function () {
          var resta = false;
          Array.prototype.forEach.call(g.querySelectorAll("[data-extra]"), function (e) {
            var radio = e.querySelector("input");
            if (radio && radio.checked) resta = true; else e.remove();
          });
          return resta;
        },
        elemento: function () { return linha.hidden ? g : sel; },
        primeiroFocavel: function () { return linha.hidden ? (g.querySelector("input:checked") || g.querySelector("input")) : sel; },
        eh: function (alvo) { return alvo === sel || !!(alvo && alvo.name === nome); },
        marcarInvalido: function (sim) {
          [g, sel].forEach(function (e) { if (sim) e.setAttribute("aria-invalid", "true"); else e.removeAttribute("aria-invalid"); });
        }
      };
    }
    lugar = criarGrupoCartao("lf-lugar-op", "lf-lugar", "lf-lugar-lista-linha", "lf-lugar-lista", "Conta");
    qual = criarGrupoCartao("lf-qual-op", "lf-qual", "lf-qual-lista-linha", "lf-qual-lista", "Escolha o cartão");
    function cartoesDaConfig() { return opcoes && Array.isArray(opcoes.cartoes) ? opcoes.cartoes : []; }
    function temCartao() { return cartoesDaConfig().length > 0; }
    // marcados: { lugar, qual } (nome do cartão ou ""). Cartão que a planilha tirou mas o lançamento ainda tem: botão extra.
    function preencherCartoes(marcados) {
      var lista = cartoesDaConfig();
      var itens = lista.map(function (n) { return { valor: n, rotulo: n, cartao: true }; });
      function extra(nome) { return nome && lista.indexOf(nome) < 0 ? [{ valor: nome, rotulo: nome, cartao: true, extra: true }] : []; }
      var xl = extra(marcados.lugar), xq = extra(marcados.qual);
      lugar.preencher([{ valor: "", rotulo: "Conta", cartao: false }].concat(xl, itens), marcados.lugar);
      qual.preencher(xq.concat(itens), marcados.qual);
      $("lf-lugar-fora").hidden = xl.length === 0;
      $("lf-qual-fora").hidden = xq.length === 0;
    }
    function preencherListas(c, marcados) {
      preencherCategoria(c.categoria);
      preencherSelect(selPes, VAZIO.pessoa, opcoes && opcoes.pessoas, c.pessoa);
      preencherSelect(selForma, VAZIO.forma, opcoes && opcoes.formas, c.forma);
      listasVazias = !opcoes || (!opcoes.categorias.length && !opcoes.pessoas.length && !opcoes.formas.length);
      preencherCartoes(marcados);
    }
    function marcadosDe(c) {
      var nome = c.cartao || "";
      return c.tipo === "fatura" ? { lugar: "", qual: nome } : { lugar: nome, qual: "" };
    }
    function preencher(c) {
      form.querySelectorAll('input[name="lf-tipo"]').forEach(function (r) { r.checked = r.value === c.tipo; });
      campoValor.value = c.valor;
      campoData.value = c.data;
      campoFav.value = c.favorecido;
      preencherListas(c, marcadosDe(c));
      aplicarTipo();
    }

    // ---- o que muda com o Tipo e com o cartão escolhido (troca instantânea, sem animação) ----
    function aplicarTipo() {
      var t = tipoAtual(), fatura = t === "fatura", entrou = t === "entrou";
      var editar = modo === "editar";
      var daFatura = editar && !!original && original.tipo === "fatura";
      var mostraFatura = temCartao() || daFatura || fatura;
      $("lf-tipo-fatura").hidden = !mostraFatura;
      $("lf-tipos").className = "escolhas " + (mostraFatura ? "tres" : "dois");
      $("lf-tipo-apoio").hidden = !fatura;
      $("lf-qual-grupo").hidden = !fatura;
      ["lf-fav-campo", "lf-cat-grupo", "lf-pes-campo"].forEach(function (id) { $(id).hidden = fatura; });
      var mostraLugar = !fatura && (temCartao() || !!(original && original.cartao));
      $("lf-lugar-grupo").hidden = !mostraLugar;
      var noCartao = t === "saiu" && mostraLugar && lugar.valor() !== "";
      $("lf-forma-campo").hidden = fatura || noCartao;
      $("lf-forma-auto").hidden = !noCartao;
      $("lf-lugar-legenda").textContent = entrou ? "Onde entrou" : "Como pagou";
      $("lf-lugar-apoio").textContent = entrou ? "Escolha um cartão só se foi estorno ou crédito na fatura." : "Escolha um cartão se foi compra no crédito.";
      $("lf-listas-nota").hidden = fatura || !listasVazias;
      var tx = Formulario.textosDoTipo(t, editar);
      titulo.textContent = tx.titulo;
      $("lf-valor-rotulo").textContent = tx.valor;
      $("lf-data-rotulo").textContent = tx.data;
      var rotuloApagar = $("lf-apagar").querySelector("span");
      if (rotuloApagar) rotuloApagar.textContent = Formulario.textosDoTipo(editar && original ? original.tipo : t, true).apagar;
      pintarRotulos();
      atualizarFatura();
    }

    // ---- pagar fatura: linha "Em aberto no…" e aviso do valor (nunca bloqueiam o Salvar) ----
    function dataParaConta() { return Datas.valida(campoData.value) ? campoData.value : env.hoje(); }
    function emAbertoDe(cartao) {
      return Formulario.emAberto(lancamentos, cartao, dataParaConta(), modo === "editar" && original ? original.id : null);
    }
    function pintarAviso(texto) {
      if (texto === ultimoAviso) return; // texto igual não é anunciado de novo a cada tecla
      ultimoAviso = texto;
      var p = $("lf-valor-aviso");
      p.textContent = "";
      if (texto) p.append(icone("i-atencao"), el("span", "", texto));
    }
    function pintarAberto(cartao, aberto) {
      var p = $("lf-aberto");
      var chave = cartao ? cartao + "|" + aberto : "";
      if (chave === ultimoAberto) return;
      ultimoAberto = chave;
      p.textContent = "";
      p.hidden = !cartao;
      if (!cartao) return;
      var sp = el("span", "", "Em aberto no " + cartao + ": ");
      sp.appendChild(el("b", "", Dinheiro.formatar(Math.max(aberto, 0))));
      p.append(icone("i-info"), sp);
    }
    function atualizarFatura() {
      var cartao = tipoAtual() === "fatura" ? qual.valor() : "";
      if (!cartao) { pintarAberto("", 0); pintarAviso(""); return; }
      var aberto = emAbertoDe(cartao);
      pintarAberto(cartao, aberto);
      pintarAviso(Formulario.avisoFatura(Dinheiro.paraCentavos(campoValor.value), aberto));
    }
    // Enquanto a pessoa não mexeu no valor, ele acompanha o cartão escolhido (o em aberto, se maior que zero).
    function sugerirValor() {
      if (tocou.valor || modo !== "novo" || tipoAtual() !== "fatura") return;
      var cartao = qual.valor();
      campoValor.value = cartao ? Formulario.valorSugerido(emAbertoDe(cartao)) : "";
    }
    function pintarRotulos() {
      var r = Formulario.rotulos(tipoAtual());
      $("lf-fav-rotulo").textContent = r.favorecido;
      var p = $("lf-pes-rotulo");
      p.textContent = r.pessoa + " ";
      p.appendChild(el("span", "opc", "opcional"));
    }

    // ---- erros por campo ----
    function elementoDe(campo) {
      if (campo === "categoria") return $("lf-cat-lista-linha").hidden ? gCat : selCat;
      if (campo === "cartao") return (tipoAtual() === "fatura" ? qual : lugar).elemento();
      return $("lf-" + ID[campo]);
    }
    // O erro do cartão aparece no grupo que está à vista (Qual cartão? na fatura; Como pagou nos outros).
    function mostrarErroCartao(msg) {
      var fatura = tipoAtual() === "fatura";
      [["qual", qual], ["lugar", lugar]].forEach(function (par) {
        var ativo = (par[0] === "qual") === fatura;
        var p = $("lf-" + par[0] + "-erro");
        var m = ativo ? msg : "";
        p.querySelector("span").textContent = m || "";
        p.hidden = !m;
        par[1].marcarInvalido(!!m);
      });
    }
    function mostrarErro(campo, msg) {
      if (campo === "cartao") { mostrarErroCartao(msg); return; }
      var p = $("lf-" + ID[campo] + "-erro");
      var alvo = elementoDe(campo);
      if (!p || !alvo) return;
      p.querySelector("span").textContent = msg || "";
      p.hidden = !msg;
      if (campo === "categoria") { gCat.removeAttribute("aria-invalid"); selCat.removeAttribute("aria-invalid"); }
      if (msg) alvo.setAttribute("aria-invalid", "true"); else alvo.removeAttribute("aria-invalid");
    }
    function limparErros() { Object.keys(ID).forEach(function (c) { mostrarErro(c, ""); }); mostrarAvisoData(""); }
    function mostrarAvisoData(msg) {
      var p = $("lf-data-aviso");
      p.querySelector("span").textContent = msg || "";
      p.hidden = !msg;
    }
    function focarCampo(campo) {
      var alvo = elementoDe(campo);
      if (campo === "categoria" && alvo === gCat) alvo = gCat.querySelector("input:checked") || gCat.querySelector("input");
      if (campo === "cartao") alvo = (tipoAtual() === "fatura" ? qual : lugar).primeiroFocavel();
      if (!alvo) return;
      alvo.focus({ preventScroll: true });
      if (alvo.scrollIntoView) alvo.scrollIntoView({ block: "center", behavior: movimentoReduzido() ? "auto" : "smooth" });
    }

    // ---- estado do botão Salvar / aviso do banco ----
    function pintarSalvando(sim) {
      salvando = sim;
      salvarBtn.disabled = sim;
      descartarBtn.disabled = sim;
      if (sim) salvarBtn.setAttribute("aria-busy", "true"); else salvarBtn.removeAttribute("aria-busy");
      salvarBtn.textContent = "";
      if (sim) { salvarBtn.appendChild(icone("i-enviando")); salvarBtn.appendChild(doc.createTextNode("Guardando…")); }
      else salvarBtn.textContent = "Salvar";
    }
    function mostrarErroBanco(mensagem) {
      erroBanco.textContent = "";
      if (!mensagem) return;
      var caixa = el("div", "res");
      caixa.dataset.tom = "erro";
      var c = el("div");
      c.append(el("b", "", mensagem), el("span", "", "O que você digitou continua aqui. Nada foi guardado."));
      caixa.append(icone("i-atencao"), c);
      erroBanco.appendChild(caixa);
    }

    // ---- notas do Editar ----
    function pintarNota(tom, iconeId, tituloNota, linhas, acao) {
      notaForm.textContent = "";
      if (!tituloNota) return;
      var caixa = el("div", "res");
      caixa.dataset.tom = tom;
      var c = el("div");
      c.appendChild(el("b", "", tituloNota));
      linhas.forEach(function (l) { if (l) c.appendChild(el("span", "", l)); });
      if (acao) {
        var b = el("button", "res-acao", acao.texto);
        b.type = "button";
        b.addEventListener("click", acao.aoTocar);
        c.appendChild(b);
      }
      caixa.append(icone(iconeId), c);
      notaForm.appendChild(caixa);
    }
    function notaRecusado() {
      if (original && original.situacao === "nao_enviado") {
        pintarNota("atencao", "i-atencao", "A planilha não aceitou este lançamento.", [original.motivo_recusa || "", "Toque em Salvar para tentar de novo."]);
      } else pintarNota("", "", "", []);
    }

    // ---- nota "esta edição foi trocada por uma mais nova de outro celular" (#16, parte F) ----
    // Os campos nunca mudam sozinhos: só quando a pessoa toca "Ver o do outro celular". Só em memória.
    function pintarNotaOutro() {
      notaForm.textContent = "";
      if (!outro || outro.passo === "mantido") return null;
      var tituloN, apoio, botoes = [];
      if (outro.passo === "apagado") {
        tituloN = "Este lançamento foi apagado no outro celular";
        apoio = "Ele não aparece mais na lista. Se você salvar, ele volta.";
      } else if (outro.passo === "visto") {
        tituloN = "Agora você vê o que veio do outro celular";
        apoio = "Pode fechar sem salvar ou mudar o que quiser.";
      } else {
        tituloN = "Esta edição foi trocada por uma mais nova de outro celular";
        apoio = "O que está nos campos é o que você digitou e ainda não foi salvo. Se você salvar, o que digitou passa a valer.";
        botoes = [{ texto: "Ver o do outro celular", aoTocar: verDoOutro }, { texto: "Manter o que digitei", aoTocar: manterDigitado }];
      }
      var caixa = el("div", "res nota-outro");
      if (outro.passo === "visto") caixa.setAttribute("tabindex", "-1");
      var c = el("div");
      c.append(el("b", "", tituloN), el("span", "", apoio));
      if (botoes.length) {
        var acoes = el("div", "res-acoes");
        botoes.forEach(function (b) {
          var x = el("button", "res-acao", b.texto);
          x.type = "button";
          x.addEventListener("click", b.aoTocar);
          acoes.appendChild(x);
        });
        c.appendChild(acoes);
      }
      caixa.append(icone("i-trocar"), c);
      notaForm.appendChild(caixa);
      return caixa;
    }
    function verDoOutro() {
      if (!outro || !sessao || !aberto) return;
      var minha = geracao, id = outro.id;
      sessao.lerAtual(id).then(function (atual) {
        if (!atual || minha !== geracao || !aberto || !outro) return;
        if (atual.apagado === "sim") { outro.passo = "apagado"; pintarNotaOutro(); return; }
        original = atual;
        preencher(Formulario.deLancamento(atual));
        inicial = lerCampos();
        limparErros();
        outro.passo = "visto";
        var nota = pintarNotaOutro();
        if (nota && nota.focus) nota.focus({ preventScroll: true });
      }).catch(function () {});
    }
    function manterDigitado() {
      if (!outro) return;
      outro.passo = "mantido";
      pintarNotaOutro();
      titulo.focus({ preventScroll: true });
    }
    function aoAlterado(ids) {
      if (!aberto || modo !== "editar" || !original || !sessao || !Array.isArray(ids) || ids.indexOf(original.id) < 0) return;
      var minha = geracao, id = original.id;
      outro = { id: id, passo: "troca", atual: null };
      sessao.lerAtual(id).then(function (atual) {
        if (!atual || minha !== geracao || !aberto || !outro) { outro = null; return; }
        outro.atual = atual;
        outro.passo = atual.apagado === "sim" ? "apagado" : "troca";
        pintarNotaOutro();
      }).catch(function () { outro = null; }); // se a leitura falhar, não mostra nada: o aviso é só cortesia
    }

    // ---- sugestões (parte E) ----
    function pintarSugestoes() {
      var nomes = Formulario.favorecidosRecentes(lancamentos, campoFav.value, 4);
      var lista = $("lf-sug-lista");
      lista.textContent = "";
      nomes.forEach(function (nome) {
        var li = el("li");
        var b = el("button", "sugestao", nome);
        b.type = "button";
        b.addEventListener("click", function () {
          campoFav.value = nome;
          pintarSugestoes();
          aplicarSugestao();
          campoFav.blur();
        });
        li.appendChild(b);
        lista.appendChild(li);
      });
      $("lf-sug").hidden = nomes.length === 0;
    }
    // Ao sair do Favorecido: preenche categoria (e pessoa/forma) pelo último gasto com o mesmo nome, sem sobrescrever escolha da pessoa.
    function aplicarSugestao() {
      if (modo !== "novo") return;
      var nome = campoFav.value;
      if (nome === ultimaSugestao) return;
      var s = Formulario.sugerir(lancamentos, nome, opcoes);
      if (!s) return;
      ultimaSugestao = nome;
      if (s.categoria && categoriaAtual() === "" && !tocou.categoria) {
        definirCategoria(s.categoria);
        notaCat.textContent = "";
        notaCat.append(icone("i-info"), el("span", "", "Preenchi a categoria pelo último gasto em " + s.favorecido + ". Para mudar, toque em outra."));
      }
      if (s.pessoa && !tocou.pessoa && Array.prototype.some.call(selPes.options, function (o) { return o.value === s.pessoa; })) selPes.value = s.pessoa;
      if (s.forma && !tocou.forma && Array.prototype.some.call(selForma.options, function (o) { return o.value === s.forma; })) selForma.value = s.forma;
    }

    // ---- abrir ----
    function mostrarCarregando(sim) {
      $("lf-carregando").hidden = !sim;
      $("lf-campos").hidden = sim;
      $("lf-naoachei").hidden = true;
    }
    function reiniciarEstado() {
      limparErros();
      mostrarErroBanco("");
      pintarSalvando(false);
      notaForm.textContent = "";
      outro = null;
      notaCat.textContent = "";
      $("lf-sug").hidden = true;
      $("lf-sug-lista").textContent = "";
      $("lf-apagar-bloco").hidden = true;
      folhaFundo.hidden = true;
      form.inert = false;
      tocou = {};
      ultimaSugestao = "";
      ultimoAviso = "";
      ultimoAberto = "";
      lugarPadrao = "";
      $("lf-valor-aviso").textContent = "";
      $("lf-aberto").textContent = "";
      $("lf-aberto").hidden = true;
    }
    function pintarRede() { $("lf-semnet").hidden = env.online() !== false; }

    function obterSessao() {
      if (sessao) return Promise.resolve(sessao);
      return env.pronto.then(function (c) {
        if (!c) return null;
        ctxDb = c;
        sessao = Lancar.criar(c.db);
        return sessao;
      });
    }

    function concluirAbertura(dados, naoAchou) {
      mostrarCarregando(false);
      if (naoAchou) {
        $("lf-campos").hidden = true;
        $("lf-naoachei").hidden = false;
        salvarBtn.hidden = true;
        descartarBtn.hidden = true;
        titulo.focus({ preventScroll: true });
        return;
      }
      salvarBtn.hidden = false;
      descartarBtn.hidden = false;
      opcoes = dados.opcoes;
      lancamentos = dados.lancamentos;
      original = modo === "editar" ? dados.lancamento : null;
      lugarPadrao = modo === "novo" && dados.campos.tipo !== "fatura" && dados.campos.cartao ? dados.campos.cartao : "";
      preencher(dados.campos);
      if (modo === "editar") tocou.valor = true; // o valor guardado nunca é trocado sozinho
      inicial = lerCampos();
      if (modo === "editar") {
        $("lf-apagar-bloco").hidden = false;
        notaRecusado();
        Object.keys(dados.erros || {}).forEach(function (c) { mostrarErro(c, dados.erros[c]); });
        titulo.focus({ preventScroll: true });
      } else if (abriuPorFatura && dados.campos.tipo === "fatura") {
        // Aberto pelo "Paguei a fatura" do Início: cartão e valor já vêm certos, então o foco fica no título (teclado fechado).
        titulo.focus({ preventScroll: true });
      } else {
        campoValor.focus({ preventScroll: true });
      }
      pintarRede();
      atualizarOpcoes();
    }

    function abrirTela(tela) {
      var minha = ++geracao;
      aberto = true;
      modo = tela.tipo === "editar" ? "editar" : "novo";
      abriuPorFatura = modo === "novo" && typeof tela.fatura === "string" && tela.fatura !== "";
      if (!voltarFoco) voltarFoco = doc.activeElement;
      titulo.textContent = modo === "editar" ? "Editar lançamento" : "Novo lançamento";
      $("lf-folha-t").textContent = modo === "editar" ? "Descartar o que você mudou?" : "Descartar o que você digitou?";
      reiniciarEstado();
      original = null;
      if (modo === "editar" && env.marcas && tela.id) env.marcas.tirar(tela.id); // quem abriu a linha já viu a marca
      form.hidden = false;
      if (app) app.inert = true;
      mostrarCarregando(true);
      $("lf-carregando").setAttribute("aria-busy", "true");
      salvarBtn.hidden = false;
      descartarBtn.hidden = false;
      if (desligarFila) desligarFila();
      desligarFila = typeof Fila !== "undefined" && Fila.aoMudar ? Fila.aoMudar(aoMudarFila) : null;
      obterSessao().then(function (s) {
        if (!s) throw new Error("sem banco");
        return modo === "editar" ? s.abrirEdicao(tela.id, env.hoje()) : s.abrirNovo(env.hoje(), abriuPorFatura ? { fatura: tela.fatura } : null);
      }).then(function (dados) {
        if (minha !== geracao || !aberto) return;
        concluirAbertura(dados, modo === "editar" && !dados.achou);
      }).catch(function () {
        if (minha !== geracao || !aberto) return;
        mostrarCarregando(false);
        $("lf-campos").hidden = false;
        opcoes = null;
        lancamentos = [];
        preencher(Formulario.vazio({ hoje: env.hoje() }));
        inicial = lerCampos();
        mostrarErroBanco("O armazenamento do celular não está disponível agora.");
        campoValor.focus({ preventScroll: true });
      });
    }

    // Baixa as opções da planilha se já passou 1 hora; se mudou, refaz as listas sem perder o que já foi escolhido.
    function atualizarOpcoes() {
      if (!ctxDb || !ctxDb.ponte || typeof Opcoes === "undefined") return;
      var minha = geracao;
      Opcoes.atualizarSeVelho(ctxDb.db, ctxDb.ponte).then(function (res) {
        if (!res || !res.mudou) return null;
        return Opcoes.ler(ctxDb.db);
      }).then(function (novas) {
        if (!novas || minha !== geracao || !aberto) return;
        opcoes = novas;
        var atual = lerCampos();
        preencherListas(atual, { lugar: lugar.valor(), qual: qual.valor() });
        aplicarTipo();
      }).catch(function () {});
    }

    // ---- fechar ----
    function fechar() {
      if (!aberto) return;
      aberto = false;
      geracao++;
      if (desligarFila) { desligarFila(); desligarFila = null; }
      form.hidden = true;
      folhaFundo.hidden = true;
      if (app) app.inert = false;
      var destino = voltarFoco && doc.contains(voltarFoco) ? voltarFoco : $("conteudo");
      voltarFoco = null;
      if (destino && destino.focus) destino.focus({ preventScroll: true });
    }
    function mexeu() { return inicial ? Formulario.mudou(inicial, lerCampos()) : false; }
    function pedirSaida() {
      if (!aberto || salvando) return;
      if (!$("lf-naoachei").hidden || !mexeu()) { env.sair(); return; }
      folhaFundo.hidden = false;
      form.inert = true;
      voltarFocoDaFolha = doc.activeElement;
      $("lf-continuar").focus();
    }
    function continuarEditando() {
      folhaFundo.hidden = true;
      form.inert = false;
      var alvo = voltarFocoDaFolha && doc.contains(voltarFocoDaFolha) ? voltarFocoDaFolha : campoValor;
      alvo.focus({ preventScroll: true });
    }

    // ---- salvar e apagar ----
    function aposSalvar(r) {
      if (r.ignorado) return;
      if (r.ok) {
        if (r.nada) { pintarSalvando(false); env.sair(); return; }
        var online = env.online() !== false;
        env.sair();
        env.avisar({ texto: online ? "Guardado e enviando…" : "Guardado. Vai para a planilha quando houver internet.", icone: "i-ok", duracao: 6000 });
        return;
      }
      pintarSalvando(false);
      if (r.erros) {
        var fatura = tipoAtual() === "fatura";
        // Na fatura só há Cartão, Valor e Data à vista: erro de campo escondido não aparece nem leva o foco.
        Object.keys(ID).forEach(function (c) { mostrarErro(c, (!fatura || ORDEM_FATURA.indexOf(c) >= 0) && r.erros[c] || ""); });
        mostrarAvisoData((r.avisos && r.avisos.data) || "");
        var primeiro = (fatura ? ORDEM_FATURA : ORDEM).filter(function (c) { return r.erros[c]; })[0];
        if (primeiro && primeiro !== "tipo") focarCampo(primeiro);
        return;
      }
      if (r.banco) mostrarErroBanco(r.mensagem);
    }

    function salvar() {
      if (salvando || !sessao || !inicial) return;
      pintarSalvando(true);
      mostrarErroBanco("");
      if (tipoAtual() !== "fatura") aplicarSugestao();
      var campos = lerCampos();
      var p = modo === "editar" && original
        ? sessao.salvarEdicao(original, campos, contexto())
        : sessao.salvarNovo(campos, contexto());
      p.then(aposSalvar).catch(function () { pintarSalvando(false); mostrarErroBanco("Não consegui guardar no celular."); });
    }

    function apagar() {
      if (salvando || !sessao || !original) return;
      var id = original.id;
      pintarSalvando(true);
      mostrarErroBanco("");
      sessao.apagar(id).then(function (r) {
        if (r.ignorado) return;
        if (!r.ok) { pintarSalvando(false); mostrarErroBanco(r.mensagem); return; }
        env.sair();
        env.avisar({
          texto: "Lançamento apagado.", icone: "i-ok", duracao: 8000, acao: "Desfazer",
          aoAcao: function () {
            sessao.desfazerApagar(id).then(function (d) {
              env.avisar(d.ok ? { texto: "Lançamento de volta.", icone: "i-ok", duracao: 4000 } : { texto: d.mensagem || "Não consegui desfazer.", icone: "i-atencao", duracao: 6000 });
            });
          }
        });
      }).catch(function () { pintarSalvando(false); mostrarErroBanco("Não consegui apagar agora."); });
    }

    // ---- outro celular mudou o mesmo lançamento enquanto o Editar está aberto ----
    function aoMudarFila(evento, extra) {
      if (evento === "alterado_no_outro") { aoAlterado(extra); return; }
      if (evento !== "recebeu" || !aberto || modo !== "editar" || !original || !sessao || outro) return;
      var minha = geracao;
      sessao.versaoMaisNova(original).then(function (atual) {
        if (!atual || minha !== geracao || !aberto || outro) return;
        pintarNota("info", "i-enviando", "Este lançamento foi alterado no outro celular.", ["O que está na tela não mudou."], {
          texto: "Ver o novo",
          aoTocar: function () { abrirTela({ tipo: "editar", id: original.id }); }
        });
      }).catch(function () {});
    }

    // ---- ligações dos controles ----
    $("lf-x").addEventListener("click", pedirSaida);
    descartarBtn.addEventListener("click", pedirSaida);
    $("lf-voltar").addEventListener("click", function () { env.sair(); });
    salvarBtn.addEventListener("click", salvar);
    $("lf-apagar").addEventListener("click", apagar);
    $("lf-continuar").addEventListener("click", continuarEditando);
    $("lf-descartar-sim").addEventListener("click", function () { folhaFundo.hidden = true; form.inert = false; env.sair(); });
    folhaFundo.addEventListener("click", function (e) { if (e.target === folhaFundo) continuarEditando(); });
    doc.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !aberto) return;
      if (!folhaFundo.hidden) continuarEditando(); else pedirSaida();
    });
    $("lf-campos").addEventListener("submit", function (e) { e.preventDefault(); });

    form.addEventListener("change", function (e) {
      var t = e.target;
      if (t.name === "lf-tipo") { aoTrocarTipo(); return; }
      if (qual.eh(t)) { qual.escolheu(t); $("lf-qual-fora").hidden = !qual.tirarExtra(); mostrarErro("cartao", ""); sugerirValor(); atualizarFatura(); return; }
      if (lugar.eh(t)) { lugar.escolheu(t); tocou.lugar = true; $("lf-lugar-fora").hidden = !lugar.tirarExtra(); mostrarErro("cartao", ""); aplicarTipo(); return; }
      if (t.name === "lf-categoria" || t === selCat) { tocou.categoria = true; notaCat.textContent = ""; mostrarErro("categoria", ""); }
      if (t === selPes) { tocou.pessoa = true; mostrarErro("pessoa", ""); }
      if (t === selForma) { tocou.forma = true; mostrarErro("forma", ""); }
      if (t === campoData) {
        mostrarErro("data", "");
        var v = Formulario.validar(lerCampos(), contexto());
        mostrarAvisoData((v.avisos && v.avisos.data) || "");
        atualizarFatura();
      }
    });
    // Trocar o Tipo não apaga nada do que foi digitado: só muda o que está à vista.
    function aoTrocarTipo() {
      var t = tipoAtual();
      mostrarErro("cartao", "");
      // Padrão do "Como pagou": o último cartão usado no Saiu; no Entrou, sempre Conta (enquanto a pessoa não escolheu).
      if (!tocou.lugar && modo === "novo") lugar.definir(t === "saiu" ? lugarPadrao : "");
      if (t === "fatura") {
        var unico = cartoesDaConfig();
        if (!qual.valor() && unico.length === 1) qual.definir(unico[0]);
        sugerirValor();
      }
      aplicarTipo();
      if (t === "fatura") {
        // Pelo Tipo, o foco vai ao primeiro campo vazio: o cartão, se ainda não marcado; senão o valor.
        if (!qual.valor()) { var f = qual.primeiroFocavel(); if (f) f.focus({ preventScroll: true }); }
        else campoValor.focus({ preventScroll: true });
      }
    }
    campoValor.addEventListener("input", function () { tocou.valor = true; mostrarErro("valor", ""); atualizarFatura(); });
    campoValor.addEventListener("blur", function () {
      var c = typeof Dinheiro !== "undefined" ? Dinheiro.paraCentavos(campoValor.value) : null;
      if (c !== null) campoValor.value = Dinheiro.formatarCampo(c);
    });
    campoValor.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); if (tipoAtual() === "fatura") campoValor.blur(); else campoFav.focus(); }
    });
    campoFav.addEventListener("input", function () { mostrarErro("favorecido", ""); pintarSugestoes(); });
    campoFav.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); campoFav.blur(); }
    });
    campoFav.addEventListener("blur", function () {
      // Só quando sai do campo (nunca a cada tecla): avisa dado proibido e aplica a sugestão do nome.
      if (Formulario.pareceDadoProibido(campoFav.value)) mostrarErro("favorecido", Formulario.TEXTOS.proibido);
      aplicarSugestao();
    });
    window.addEventListener("online", function () { if (aberto) pintarRede(); });
    window.addEventListener("offline", function () { if (aberto) pintarRede(); });

    return {
      abrir: abrirTela,
      fechar: fechar,
      pedirSaida: pedirSaida,
      aberto: function () { return aberto; },
      mexeu: mexeu
    };
  }

  return { criar: criar };
})();
if (typeof module !== "undefined") module.exports = TelaLancar;
