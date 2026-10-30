// Zelo: a tela de lançar (Novo e Editar), #18 partes C, D e E. Só desenho e ligação: as regras estão em Formulario,
// o que grava está em Lancar. Todo texto que vem da planilha ou da pessoa entra com textContent, nunca como HTML.
// Nada digitado vai para console, localStorage, URL, título ou aria-label. No navegador vira o objeto global TelaLancar.
var TelaLancar = (function () {
  var SVG_NS = "http://www.w3.org/2000/svg";
  var VAZIO = { categoria: "Sem categoria", pessoa: "Ninguém em especial", forma: "Não informar" };
  var MAX_BOTOES_CATEGORIA = 12;
  // campo da regra -> prefixo dos ids no index.html
  var ID = { valor: "valor", data: "data", favorecido: "fav", categoria: "cat", pessoa: "pes", forma: "forma" };

  // env: { pronto: Promise<{ db, ponte } | null>, hoje(), online(), sair(), avisar({ texto, icone, acao, duracao, aoAcao }) }
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
    var voltarFocoDaFolha = null, salvando = false, ultimaSugestao = "", tocou = {}, desligarFila = null, voltarFoco = null;

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
      return {
        tipo: tipoAtual(), valor: campoValor.value, data: campoData.value, favorecido: campoFav.value,
        categoria: categoriaAtual(), pessoa: selPes.value, forma: selForma.value
      };
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
    function preencherListas(c) {
      preencherCategoria(c.categoria);
      preencherSelect(selPes, VAZIO.pessoa, opcoes && opcoes.pessoas, c.pessoa);
      preencherSelect(selForma, VAZIO.forma, opcoes && opcoes.formas, c.forma);
      var semListas = !opcoes || (!opcoes.categorias.length && !opcoes.pessoas.length && !opcoes.formas.length);
      $("lf-listas-nota").hidden = !semListas;
    }
    function preencher(c) {
      form.querySelectorAll('input[name="lf-tipo"]').forEach(function (r) { r.checked = r.value === c.tipo; });
      campoValor.value = c.valor;
      campoData.value = c.data;
      campoFav.value = c.favorecido;
      preencherListas(c);
      pintarRotulos();
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
      return $("lf-" + ID[campo]);
    }
    function mostrarErro(campo, msg) {
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
      notaCat.textContent = "";
      $("lf-sug").hidden = true;
      $("lf-sug-lista").textContent = "";
      $("lf-apagar-bloco").hidden = true;
      folhaFundo.hidden = true;
      form.inert = false;
      tocou = {};
      ultimaSugestao = "";
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
      preencher(dados.campos);
      inicial = lerCampos();
      if (modo === "editar") {
        $("lf-apagar-bloco").hidden = false;
        notaRecusado();
        Object.keys(dados.erros || {}).forEach(function (c) { mostrarErro(c, dados.erros[c]); });
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
      if (!voltarFoco) voltarFoco = doc.activeElement;
      titulo.textContent = modo === "editar" ? "Editar lançamento" : "Novo lançamento";
      $("lf-folha-t").textContent = modo === "editar" ? "Descartar o que você mudou?" : "Descartar o que você digitou?";
      reiniciarEstado();
      original = null;
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
        return modo === "editar" ? s.abrirEdicao(tela.id, env.hoje()) : s.abrirNovo(env.hoje());
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
        preencherListas(atual);
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
        Object.keys(ID).forEach(function (c) { mostrarErro(c, r.erros[c] || ""); });
        mostrarAvisoData((r.avisos && r.avisos.data) || "");
        var primeiro = Formulario.primeiroErro(r.erros);
        if (primeiro && primeiro !== "tipo") focarCampo(primeiro);
        return;
      }
      if (r.banco) mostrarErroBanco(r.mensagem);
    }

    function salvar() {
      if (salvando || !sessao || !inicial) return;
      pintarSalvando(true);
      mostrarErroBanco("");
      aplicarSugestao();
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
    function aoMudarFila(evento) {
      if (evento !== "recebeu" || !aberto || modo !== "editar" || !original || !sessao) return;
      var minha = geracao;
      sessao.versaoMaisNova(original).then(function (atual) {
        if (!atual || minha !== geracao || !aberto) return;
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
      if (t.name === "lf-tipo") { pintarRotulos(); return; }
      if (t.name === "lf-categoria" || t === selCat) { tocou.categoria = true; notaCat.textContent = ""; mostrarErro("categoria", ""); }
      if (t === selPes) { tocou.pessoa = true; mostrarErro("pessoa", ""); }
      if (t === selForma) { tocou.forma = true; mostrarErro("forma", ""); }
      if (t === campoData) {
        mostrarErro("data", "");
        var v = Formulario.validar(lerCampos(), contexto());
        mostrarAvisoData((v.avisos && v.avisos.data) || "");
      }
    });
    campoValor.addEventListener("input", function () { mostrarErro("valor", ""); });
    campoValor.addEventListener("blur", function () {
      var c = typeof Dinheiro !== "undefined" ? Dinheiro.paraCentavos(campoValor.value) : null;
      if (c !== null) campoValor.value = Dinheiro.formatarCampo(c);
    });
    campoValor.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); campoFav.focus(); }
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
