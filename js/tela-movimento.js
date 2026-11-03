// Zelo: formulários de tela cheia da Reserva (#39, P5): Guardar, Tirar, Passar entre caixinhas e Conferir saldo (também no Editar).
// Só desenho e ligação: as regras estão em Reserva (e em Formulario/Somas), o que grava está em Reserva.criarSessao.
// Todo nome de caixinha ou de cartão (vem da planilha) entra com textContent, nunca como HTML, e nunca vai para console, URL, título nem aria-label de fora do app.
// No navegador vira o objeto global TelaMovimento.
var TelaMovimento = (function () {
  var Res = typeof Reserva !== "undefined" ? Reserva : require("./reserva.js");
  var Som = typeof Somas !== "undefined" ? Somas : require("./somas.js");
  var Din = typeof Dinheiro !== "undefined" ? Dinheiro : require("./dinheiro.js");
  var Dat = typeof Datas !== "undefined" ? Datas : require("./datas.js");

  var SVG_NS = "http://www.w3.org/2000/svg";
  var TIPO_DO_LANCAMENTO = { guardou: "guardar", tirou: "tirar", saldo: "conferir" };
  var TIPOS_DO_EDITOR = { guardar: ["guardou"], tirar: ["tirou"], conferir: ["saldo"] };
  var TITULOS = {
    guardar: ["Guardar na caixinha", "Editar: guardar na caixinha"],
    tirar: ["Tirar da caixinha", "Editar: tirar da caixinha"],
    passar: ["Passar para outra caixinha", "Passar para outra caixinha"],
    conferir: ["Conferir saldo", "Editar saldo conferido"]
  };

  // env: { doc, pronto: Promise<{ db, ponte } | null>, hoje(), online(), sair(), avisar({ texto, icone, acao, duracao, aoAcao }), marcas }
  function criar(env) {
    var doc = env.doc || document;
    var $ = function (id) { return doc.getElementById(id); };
    var form = $("mv"), titulo = $("mv-t"), campos = $("mv-campos");
    var salvarBtn = $("mv-salvar"), descartarBtn = $("mv-descartar"), erroBanco = $("mv-erro-banco"), folhaFundo = $("mv-folha-fundo");
    var app = typeof document !== "undefined" && doc === document ? doc.querySelector(".app") : null;

    var aberto = false, geracao = 0, salvando = false, voltarFoco = null, voltarFocoDaFolha = null, sessao = null;
    var s = null;       // estado do formulário aberto
    var refs = null;    // peças desenhadas (campos, notas)

    function el(tag, classe, texto) {
      var e = doc.createElement(tag);
      if (classe) e.className = classe;
      if (texto !== undefined) e.textContent = texto;
      return e;
    }
    function ic(id, classe) {
      var svg = doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "ic" + (classe ? " " + classe : ""));
      svg.setAttribute("aria-hidden", "true");
      var uso = doc.createElementNS(SVG_NS, "use");
      uso.setAttribute("href", "#" + id);
      svg.appendChild(uso);
      return svg;
    }
    function movimentoReduzido() {
      return doc.documentElement.dataset && doc.documentElement.dataset.movimento === "reduzido";
    }
    function erroP() {
      var p = el("p", "campo-erro");
      p.hidden = true;
      p._texto = el("span", "");
      p.append(ic("i-atencao"), p._texto);
      return p;
    }
    function mostrarErro(p, alvos, msg) {
      p._texto.textContent = msg || "";
      p.hidden = !msg;
      (Array.isArray(alvos) ? alvos : [alvos]).forEach(function (a) {
        if (!a) return;
        if (msg) a.setAttribute("aria-invalid", "true"); else a.removeAttribute("aria-invalid");
      });
    }
    // Texto de status só é trocado quando muda (o leitor de tela não repete a cada tecla).
    function pintarStatus(p, chave, montar) {
      if (p._chave === chave) return;
      p._chave = chave;
      p.textContent = "";
      p.hidden = !chave;
      if (chave) montar(p);
    }
    function notaIc(icone, classe) {
      var p = el("p", "nota-ic" + (classe ? " " + classe : ""));
      p.setAttribute("role", "status");
      p.hidden = true;
      p._icone = icone;
      return p;
    }

    // ---- grupo de escolha (botões à vista; acima de 12, uma lista) ----
    // itens: [{ valor, rotulo, icone, extra }]. aoEscolher(valor). Tudo que a pessoa escolhe fica em memória em "atual".
    function grupo(legenda, nome, itens, marcado, aoEscolher) {
      var fs = el("fieldset", "campo-grupo");
      fs.appendChild(el("legend", "", legenda));
      var g = el("div", "escolhas");
      g.setAttribute("role", "radiogroup");
      var erro = erroP();
      var atual = marcado || "";
      var usarLista = itens.length > Res.MAX_BOTOES;
      var sel = null, radios = [];
      if (usarLista) {
        var linha = el("div", "campo-linha");
        sel = el("select");
        sel.setAttribute("aria-label", legenda);
        var o0 = el("option", "", "Escolha"); o0.value = ""; sel.appendChild(o0);
        itens.forEach(function (i) { var o = el("option", "", i.rotulo); o.value = i.valor; sel.appendChild(o); });
        sel.value = atual;
        sel.addEventListener("change", function () { atual = sel.value; aoEscolher(atual); });
        linha.appendChild(sel);
        fs.appendChild(linha);
      } else {
        itens.forEach(function (i) {
          var rot = el("label", "escolha");
          if (i.extra) rot.setAttribute("data-extra", "sim");
          var r = doc.createElement("input");
          r.type = "radio";
          r.setAttribute("name", nome);
          r.value = i.valor;
          r.checked = i.valor === atual;
          r.addEventListener("change", function () { if (!r.checked) return; atual = i.valor; aoEscolher(atual); });
          radios.push(r);
          if (i.icone) rot.appendChild(ic(i.icone, "ic-caixinha"));
          rot.append(r, el("span", "", i.rotulo), ic("i-ok", "ic-ok"));
          g.appendChild(rot);
        });
        fs.appendChild(g);
      }
      fs.appendChild(erro);
      return {
        no: fs, erro: erro,
        valor: function () { return atual; },
        definir: function (v) { atual = v || ""; if (sel) sel.value = atual; radios.forEach(function (r) { r.checked = r.value === atual; }); },
        mostrarErro: function (msg) { mostrarErro(erro, usarLista ? sel : g, msg); },
        focavel: function () { return sel || radios.filter(function (r) { return r.checked; })[0] || radios[0]; }
      };
    }
    function campoValor(rotulo, apoio) {
      var c = el("div", "campo");
      var lb = el("label", "", rotulo);
      lb.setAttribute("for", "mv-valor");
      c.appendChild(lb);
      var ap = apoio !== undefined ? el("p", "campo-apoio", apoio) : null;
      if (ap) c.appendChild(ap);
      var linha = el("div", "campo-linha entrada-prefixo");
      var pre = el("span", "prefixo", "R$"); pre.setAttribute("aria-hidden", "true");
      var inp = el("input");
      inp.setAttribute("id", "mv-valor"); inp.setAttribute("type", "text"); inp.setAttribute("inputmode", "decimal");
      inp.setAttribute("autocomplete", "off"); inp.setAttribute("placeholder", "0,00");
      linha.append(pre, inp);
      var erro = erroP();
      var aviso = notaIc("i-atencao", "nota-aviso");
      c.append(linha, erro, aviso);
      return { no: c, rotulo: lb, apoio: ap, input: inp, erro: erro, aviso: aviso };
    }
    function campoData(rotulo, apoio) {
      var c = el("div", "campo");
      var lb = el("label", "", rotulo);
      lb.setAttribute("for", "mv-data");
      c.appendChild(lb);
      if (apoio) c.appendChild(el("p", "campo-apoio", apoio));
      var linha = el("div", "campo-linha");
      var inp = el("input");
      inp.setAttribute("id", "mv-data"); inp.setAttribute("type", "date"); inp.setAttribute("min", "2000-01-01"); inp.setAttribute("max", "2099-12-31");
      linha.appendChild(inp);
      var erro = erroP();
      var aviso = notaIc("i-atencao", "nota-aviso");
      c.append(linha, erro, aviso);
      return { no: c, input: inp, erro: erro, aviso: aviso };
    }

    // ---- números que as notas usam ----
    function lancamentosSem(id) {
      return id ? s.lancamentos.filter(function (l) { return l.id !== id; }) : s.lancamentos;
    }
    function dataParaConta() { return Dat.valida(refs.data.input.value) ? refs.data.input.value : env.hoje(); }
    function caixinhaPorNome(nome) {
      var lista = Res.caixinhas(lancamentosSem(s.original ? s.original.id : null), s.opcoes, env.hoje());
      return lista.filter(function (c) { return c.nome === nome; })[0] || null;
    }
    function valorCentavos() { return Res.valorDoCampo(refs.valor.input.value, s.tipo === "conferir"); }

    // ---- as notas que mudam com o que a pessoa digita ----
    function pintarNotaSaldo() {
      var nome = refs.caixinha ? refs.caixinha.valor() : refs.de ? refs.de.valor() : "";
      var c = nome ? caixinhaPorNome(nome) : null;
      var n = Res.notaDoSaldo(c);
      pintarStatus(refs.notaSaldo, n ? n.antes + n.valor + n.depois : "", function (p) {
        var sp = el("span", "");
        sp.append(n.antes, el("b", "nota-valor", n.valor), n.depois);
        p.append(ic("i-info"), sp);
      });
    }
    function pintarAvisoValor() {
      if (!refs.valor.aviso) return;
      var nome = refs.caixinha ? refs.caixinha.valor() : refs.de ? refs.de.valor() : "";
      var c = nome ? caixinhaPorNome(nome) : null;
      var txt = s.tipo === "guardar" || !c ? "" : Res.avisoDoValor(valorCentavos(), c.saldo);
      pintarStatus(refs.valor.aviso, txt, function (p) { p.append(ic("i-atencao"), el("span", "", txt)); });
    }
    function pintarResumo() {
      var n = Res.resumoDaPassagem(refs.de.valor(), refs.para.valor(), valorCentavos());
      var chave = n ? n.antes + n.v1 + n.meio + n.v2 + n.depois : "";
      pintarStatus(refs.resumo, chave, function (p) {
        var sp = el("span", "");
        sp.append(n.antes, el("b", "nota-valor", n.v1), n.meio, el("b", "nota-valor", n.v2), n.depois);
        p.append(ic("i-info"), sp);
      });
    }
    function lugarAtual() {
      var v = refs.lugar.valor();
      if (v === "conta") return { tipo: "conta", nome: "" };
      if (v.indexOf("x:") === 0) return { tipo: "caixinha", nome: v.slice(2) };
      if (v.indexOf("k:") === 0) return { tipo: "cartao", nome: v.slice(2) };
      return null;
    }
    function pintarConferencia() {
      var lugar = lugarAtual();
      var rot = Res.rotulosDoLugar(lugar ? lugar.tipo : "conta");
      refs.valor.rotulo.textContent = rot.valor;
      refs.valor.apoio.textContent = rot.apoio;
      pintarStatus(refs.notaConta, lugar && lugar.tipo === "conta" ? "conta" : "", function (p) { p.append(ic("i-info"), Res.TEXTOS.conferir_conta_apoio); });
      var v = valorCentavos();
      var data = refs.data.input.value;
      var conf = null;
      if (lugar && v !== null && Dat.valida(data)) conf = Som.conferencia(s.lancamentos, lugar.tipo, lugar.nome, data, v, s.original ? s.original.id : null);
      var r = lugar && conf ? Res.resultadoDaConferencia(lugar.tipo, conf) : null;
      var chave = r ? r.tipo + "|" + r.linhas.join("|") : "";
      var caixa = refs.resultado;
      if (caixa._chave !== chave) {
        caixa._chave = chave;
        caixa.textContent = "";
        if (r) {
          r.linhas.forEach(function (txt, i) {
            var p = el("p", "nota-ic" + (r.tipo === "falta" || r.tipo === "sobra" ? (i === 0 ? " nota-aviso" : "") : r.tipo === "bateu" ? " nota-ok" : ""));
            var icone = r.tipo === "bateu" ? "i-ok" : r.tipo === "partida" || i === 1 ? "i-info" : "i-atencao";
            p.append(ic(icone), el("span", "", txt));
            caixa.appendChild(p);
          });
        }
      }
      var avisoData = Res.avisoDaDataConferencia(data, env.hoje(), conf);
      pintarStatus(refs.data.aviso, avisoData, function (p) { p.append(ic("i-atencao"), el("span", "", avisoData)); });
    }
    function atualizar() {
      if (!refs) return;
      if (s.tipo === "guardar" || s.tipo === "tirar") { pintarNotaSaldo(); pintarAvisoValor(); }
      else if (s.tipo === "passar") { pintarNotaSaldo(); pintarAvisoValor(); pintarResumo(); }
      else pintarConferencia();
    }

    // ---- desenho de cada formulário ----
    function itensDeCaixinha(nomes, extraNome) {
      var itens = nomes.map(function (n) { return { valor: n, rotulo: n, icone: "i-caixinha" }; });
      if (extraNome && nomes.indexOf(extraNome) < 0) itens.unshift({ valor: extraNome, rotulo: extraNome, icone: "i-caixinha", extra: true });
      return itens;
    }
    function desenhar() {
      var t = s.tipo, editar = !!s.original;
      campos.textContent = "";
      refs = {};
      var lista = Res.caixinhas(lancamentosSem(s.original ? s.original.id : null), s.opcoes, env.hoje());
      var o = Res.opcoesDe(lista);
      var semNet = el("div", "faixa faixa-info");
      semNet.setAttribute("role", "status");
      semNet.hidden = env.online() !== false;
      var corpoF = el("div"); corpoF.append(el("strong", "", "Sem internet por enquanto"), "Pode salvar. O Zelo envia quando a conexão voltar.");
      semNet.append(ic("i-semnet"), corpoF);
      refs.semNet = semNet;
      var nota = el("div", "form-nota");
      nota.setAttribute("role", "status");
      refs.nota = nota;
      campos.append(semNet, nota);

      if (t === "guardar" || t === "tirar") {
        campos.appendChild(el("p", "campo-apoio", t === "guardar" ? Res.TEXTOS.guardar_apoio : Res.TEXTOS.tirar_apoio));
        var daLista = t === "guardar" ? o.guardar : o.tirar;
        var extra = editar ? s.original.caixinha : "";
        var marcada = s.caixinha && (daLista.indexOf(s.caixinha) >= 0 || s.caixinha === extra) ? s.caixinha : (daLista.length === 1 && !editar ? daLista[0] : "");
        refs.caixinha = grupo("Qual caixinha?", "mv-caixinha", itensDeCaixinha(daLista, extra), marcada, function () { refs.caixinha.mostrarErro(""); if (refs.foraDaLista) refs.foraDaLista.hidden = true; atualizar(); });
        campos.appendChild(refs.caixinha.no);
        var fora = notaIc("i-atencao", "nota-aviso");
        fora.hidden = !(editar && daLista.indexOf(extra) < 0);
        if (!fora.hidden) { fora._chave = "fora"; fora.append(ic("i-atencao"), el("span", "", Res.TEXTOS.fora_da_lista)); }
        refs.foraDaLista = fora;
        campos.appendChild(fora);
        refs.notaSaldo = notaIc("i-info", "");
        campos.appendChild(refs.notaSaldo);
        refs.valor = campoValor(t === "guardar" ? "Valor a guardar" : "Valor a tirar");
        campos.appendChild(refs.valor.no);
      } else if (t === "passar") {
        campos.appendChild(el("p", "campo-apoio", Res.TEXTOS.passar_apoio));
        refs.de = grupo("De qual caixinha?", "mv-de", itensDeCaixinha(o.de), s.caixinha && o.de.indexOf(s.caixinha) >= 0 ? s.caixinha : "", function (v) {
          refs.de.mostrarErro("");
          if (refs.para.valor() === v) refs.para.definir("");
          montarDestinos(o);
          atualizar();
        });
        campos.appendChild(refs.de.no);
        refs.notaSaldo = notaIc("i-info", "");
        campos.appendChild(refs.notaSaldo);
        refs.paraLugar = el("div");
        campos.appendChild(refs.paraLugar);
        refs.para = null;
        montarDestinos(o);
        refs.valor = campoValor("Valor a passar");
        campos.appendChild(refs.valor.no);
      } else {
        campos.appendChild(el("p", "campo-apoio", Res.TEXTOS.conferir_apoio));
        var itens = [{ valor: "conta", rotulo: "Conta" }];
        var cx = Res.caixinhas(s.lancamentos, s.opcoes, env.hoje()).map(function (c) { return c.nome; });
        var cartoes = (s.opcoes && Array.isArray(s.opcoes.cartoes) ? s.opcoes.cartoes : []).slice();
        Res.nomesNosDados(s.lancamentos, "cartao").forEach(function (n) { if (cartoes.indexOf(n) < 0) cartoes.push(n); });
        cx.forEach(function (n) { itens.push({ valor: "x:" + n, rotulo: n, icone: "i-caixinha" }); });
        cartoes.forEach(function (n) { itens.push({ valor: "k:" + n, rotulo: n, icone: "i-cartao" }); });
        if (editar) {
          var orig = s.original;
          var dono = orig.cartao ? "k:" + orig.cartao : orig.caixinha ? "x:" + orig.caixinha : "conta";
          itens = itens.filter(function (i) { return i.valor === dono; });
          if (!itens.length) itens = [{ valor: dono, rotulo: dono === "conta" ? "Conta" : dono.slice(2), icone: dono.indexOf("x:") === 0 ? "i-caixinha" : dono.indexOf("k:") === 0 ? "i-cartao" : undefined }];
        }
        var inicialLugar = s.lugar ? (s.lugar.tipo === "conta" ? "conta" : (s.lugar.tipo === "caixinha" ? "x:" : "k:") + s.lugar.nome) : "";
        if (editar) inicialLugar = itens[0].valor;
        refs.lugar = grupo("O que você quer conferir?", "mv-lugar", itens, inicialLugar, function () { refs.lugar.mostrarErro(""); atualizar(); });
        campos.appendChild(refs.lugar.no);
        refs.notaConta = notaIc("i-info", "");
        campos.appendChild(refs.notaConta);
        refs.valor = campoValor("Saldo no banco", Res.rotulosDoLugar("conta").apoio);
        campos.appendChild(refs.valor.no);
      }
      refs.data = t === "conferir" ? campoData("Em que dia?", "O saldo vale para o fim deste dia.") : campoData("Data");
      campos.appendChild(refs.data.no);
      if (t === "passar") { refs.resumo = notaIc("i-info", ""); campos.appendChild(refs.resumo); }
      if (t === "conferir") { refs.resultado = el("div", "conf-resultado"); refs.resultado.setAttribute("role", "status"); campos.appendChild(refs.resultado); }

      refs.valor.input.addEventListener("input", function () { mostrarErro(refs.valor.erro, refs.valor.input, ""); atualizar(); });
      refs.valor.input.addEventListener("blur", function () {
        var c = Din.paraCentavos(refs.valor.input.value);
        if (c !== null) refs.valor.input.value = Din.formatarCampo(c);
      });
      refs.valor.input.addEventListener("keydown", function (e) { if (e && e.key === "Enter") { if (e.preventDefault) e.preventDefault(); if (refs.valor.input.blur) refs.valor.input.blur(); } });
      refs.data.input.addEventListener("change", function () { mostrarErro(refs.data.erro, refs.data.input, ""); atualizar(); });

      if (editar) {
        var bloco = el("div", "form-apagar");
        var ap = el("button", "btn-sec btn-atencao");
        ap.setAttribute("type", "button");
        ap.append(ic("i-lixeira"), el("span", "", t === "conferir" ? "Apagar saldo conferido" : "Apagar movimento"));
        ap.addEventListener("click", apagar);
        refs.apagar = ap;
        bloco.append(ap, el("p", "apoio", t === "conferir"
          ? "Ele some da lista e o Zelo volta a usar o saldo conferido anterior. Dá para desfazer logo depois."
          : "Ele some da lista, mas dá para desfazer logo depois."));
        campos.appendChild(bloco);
      }
    }
    // "Para qual caixinha?" sem a de origem; só as da Config.
    function montarDestinos(o) {
      var origem = refs.de.valor();
      var marcado = refs.para ? refs.para.valor() : "";
      var nomes = o.para.filter(function (n) { return n !== origem; });
      if (nomes.indexOf(marcado) < 0) marcado = "";
      refs.para = grupo("Para qual caixinha?", "mv-para", itensDeCaixinha(nomes), marcado, function () { refs.para.mostrarErro(""); atualizar(); });
      refs.paraLugar.replaceChildren(refs.para.no);
    }

    // ---- preencher e abrir ----
    function preencher() {
      var o = s.original;
      var hoje = env.hoje();
      if (o) {
        refs.valor.input.value = Din.formatarCampo(o.valor_centavos);
        refs.data.input.value = o.data;
      } else {
        refs.data.input.value = hoje;
      }
      s.inicial = lerCampos();
    }
    function lerCampos() {
      var c = { valor: refs.valor.input.value, data: refs.data.input.value };
      if (refs.caixinha) c.caixinha = refs.caixinha.valor();
      if (refs.de) { c.de = refs.de.valor(); c.para = refs.para.valor(); }
      if (refs.lugar) c.lugar = refs.lugar.valor();
      return c;
    }
    function mexeu() {
      if (!s || !s.inicial || !refs) return false;
      var a = s.inicial, b = lerCampos();
      return Object.keys(b).some(function (k) { return String(a[k] || "") !== String(b[k] || ""); });
    }

    function pintarSalvando(sim) {
      salvando = sim;
      salvarBtn.disabled = sim;
      descartarBtn.disabled = sim;
      if (sim) salvarBtn.setAttribute("aria-busy", "true"); else salvarBtn.removeAttribute("aria-busy");
      salvarBtn.textContent = "";
      if (sim) salvarBtn.append(ic("i-enviando"), "Guardando…");
      else salvarBtn.textContent = "Salvar";
    }
    function mostrarErroBanco(mensagem) {
      erroBanco.textContent = "";
      if (!mensagem) return;
      var caixa = el("div", "res");
      caixa.setAttribute("data-tom", "erro");
      var c = el("div");
      c.append(el("b", "", mensagem), el("span", "", "O que você digitou continua aqui. Nada foi guardado."));
      caixa.append(ic("i-atencao"), c);
      erroBanco.appendChild(caixa);
    }
    function pintarNotaForm() {
      refs.nota.textContent = "";
      var o = s.original;
      if (!o) return;
      if (o.situacao === "nao_enviado") {
        var caixa = el("div", "res");
        caixa.setAttribute("data-tom", "atencao");
        var c = el("div");
        c.append(el("b", "", "A planilha não aceitou este lançamento."));
        if (o.motivo_recusa) c.appendChild(el("span", "", o.motivo_recusa));
        c.appendChild(el("span", "", "Toque em Salvar para tentar de novo."));
        caixa.append(ic("i-atencao"), c);
        refs.nota.appendChild(caixa);
      }
      if ((s.tipo === "guardar" || s.tipo === "tirar") && Res.metadeDePassagem(o)) {
        var p = el("p", "nota-ic nota-aviso");
        p.append(ic("i-atencao"), el("span", "", Res.TEXTOS.passagem));
        refs.nota.appendChild(p);
      }
    }

    function reiniciar() {
      mostrarErroBanco("");
      pintarSalvando(false);
      folhaFundo.hidden = true;
      form.inert = false;
      $("mv-naoachei").hidden = true;
    }
    function concluirAbertura(dados) {
      $("mv-carregando").hidden = true;
      if (!dados.achou) {
        campos.hidden = true;
        $("mv-naoachei").hidden = false;
        salvarBtn.hidden = true;
        descartarBtn.hidden = true;
        titulo.focus({ preventScroll: true });
        return;
      }
      campos.hidden = false;
      salvarBtn.hidden = false;
      descartarBtn.hidden = false;
      s.opcoes = dados.opcoes;
      s.lancamentos = dados.lancamentos;
      s.original = dados.lancamento || null;
      if (s.original && (s.tipo === "guardar" || s.tipo === "tirar")) s.caixinha = s.original.caixinha;
      desenhar();
      preencher();
      pintarNotaForm();
      atualizar();
      s.inicial = lerCampos();
      var primeiro = s.tipo === "conferir" || s.tipo === "passar" ? (refs.lugar || refs.de) : refs.caixinha;
      var jaMarcado = primeiro && primeiro.valor() !== "";
      if (s.original) titulo.focus({ preventScroll: true });
      else if (jaMarcado) refs.valor.input.focus({ preventScroll: true });
      else if (primeiro && primeiro.focavel()) primeiro.focavel().focus({ preventScroll: true });
      else refs.valor.input.focus({ preventScroll: true });
      if (env.online() !== false) { /* sem aviso */ } else refs.semNet.hidden = false;
    }

    function abrir(tela) {
      var minha = ++geracao;
      aberto = true;
      s = { tipo: tela.tipo, id: tela.id || null, caixinha: tela.caixinha || "", lugar: tela.lugar || null, original: null, opcoes: null, lancamentos: [], inicial: null };
      refs = null;
      if (!voltarFoco) voltarFoco = doc.activeElement;
      titulo.textContent = TITULOS[s.tipo][s.id ? 1 : 0];
      $("mv-folha-t").textContent = s.id ? "Descartar o que você mudou?" : "Descartar o que você digitou?";
      reiniciar();
      campos.textContent = "";
      campos.hidden = true;
      if (s.id && env.marcas) env.marcas.tirar(s.id);
      form.hidden = false;
      if (app) app.inert = true;
      $("mv-carregando").hidden = false;
      salvarBtn.hidden = false;
      descartarBtn.hidden = false;
      return env.pronto.then(function (c) {
        if (!c) throw new Error("sem banco");
        if (!sessao) sessao = Res.criarSessao(c.db);
        return s.id ? sessao.abrirEdicao(s.id, TIPOS_DO_EDITOR[s.tipo]) : sessao.ler().then(function (d) { return { achou: true, opcoes: d.opcoes, lancamentos: d.lancamentos }; });
      }).then(function (dados) {
        if (minha !== geracao || !aberto) return;
        concluirAbertura(dados);
      }).catch(function () {
        if (minha !== geracao || !aberto) return;
        $("mv-carregando").hidden = true;
        campos.hidden = false;
        s.opcoes = null; s.lancamentos = [];
        desenhar();
        preencher();
        mostrarErroBanco("O armazenamento do celular não está disponível agora.");
      });
    }

    // ---- fechar ----
    function fechar() {
      if (!aberto) return;
      aberto = false;
      geracao++;
      form.hidden = true;
      folhaFundo.hidden = true;
      if (app) app.inert = false;
      var destino = voltarFoco && doc.contains && doc.contains(voltarFoco) ? voltarFoco : $("conteudo");
      voltarFoco = null;
      if (destino && destino.focus) destino.focus({ preventScroll: true });
    }
    function pedirSaida() {
      if (!aberto || salvando) return;
      if (!$("mv-naoachei").hidden || !mexeu()) { env.sair(); return; }
      folhaFundo.hidden = false;
      form.inert = true;
      voltarFocoDaFolha = doc.activeElement;
      $("mv-continuar").focus();
    }
    function continuarEditando() {
      folhaFundo.hidden = true;
      form.inert = false;
      var alvo = voltarFocoDaFolha && (!doc.contains || doc.contains(voltarFocoDaFolha)) ? voltarFocoDaFolha : refs && refs.valor.input;
      if (alvo) alvo.focus({ preventScroll: true });
    }

    // ---- salvar e apagar ----
    function mostrarErros(erros) {
      if (!refs) return;
      var ordem = [];
      var grupoDe = { caixinha: refs.caixinha, de: refs.de, para: refs.para, lugar: refs.lugar };
      ["caixinha", "de", "para", "lugar"].forEach(function (k) {
        var g = grupoDe[k];
        if (!g) return;
        g.mostrarErro(erros[k] || "");
        if (erros[k]) ordem.push(function () { var f = g.focavel(); if (f) f.focus({ preventScroll: true }); });
      });
      mostrarErro(refs.valor.erro, refs.valor.input, erros.valor || "");
      if (erros.valor) ordem.push(function () { refs.valor.input.focus({ preventScroll: true }); });
      mostrarErro(refs.data.erro, refs.data.input, erros.data || "");
      if (erros.data) ordem.push(function () { refs.data.input.focus({ preventScroll: true }); });
      if (ordem.length) ordem[0]();
    }
    function textoGuardado() {
      return env.online() !== false ? "Guardado e enviando…" : "Guardado. Vai para a planilha quando houver internet.";
    }
    function aposSalvar(r) {
      if (r.ignorado) return;
      if (r.ok) {
        if (r.nada) { pintarSalvando(false); env.sair(); return; }
        env.sair();
        if (s.tipo === "passar") {
          var ids = r.lancamentos.map(function (l) { return l.id; });
          var v = Din.formatar(r.lancamentos[0].valor_centavos);
          var de = r.lancamentos[0].caixinha, para = r.lancamentos[1].caixinha;
          env.avisar({
            texto: "Passou " + v + " de " + de + " para " + para + ".", icone: "i-ok", duracao: 8000, acao: "Desfazer",
            aoAcao: function () {
              sessao.apagar(ids).then(function (d) {
                env.avisar(d.ok ? { texto: "Passagem desfeita.", icone: "i-ok", duracao: 4000 } : { texto: d.mensagem || "Não consegui desfazer.", icone: "i-atencao", duracao: 6000 });
              });
            }
          });
          return;
        }
        env.avisar({ texto: textoGuardado(), icone: "i-ok", duracao: 6000 });
        return;
      }
      pintarSalvando(false);
      if (r.erros) { mostrarErros(r.erros); return; }
      if (r.banco) mostrarErroBanco(r.mensagem);
    }
    function salvar() {
      if (salvando || !sessao || !refs || !s.inicial) return;
      pintarSalvando(true);
      mostrarErroBanco("");
      var ctx = { opcoes: s.opcoes, hoje: env.hoje() };
      var c = lerCampos();
      var p;
      if (s.tipo === "guardar" || s.tipo === "tirar") p = sessao.salvarMovimento(s.tipo === "guardar" ? "guardou" : "tirou", { caixinha: c.caixinha, valor: c.valor, data: c.data }, ctx, s.original);
      else if (s.tipo === "passar") p = sessao.salvarPassagem({ de: c.de, para: c.para, valor: c.valor, data: c.data }, ctx);
      else p = sessao.salvarConferencia({ lugar: lugarAtual(), valor: c.valor, data: c.data }, ctx, s.original);
      p.then(aposSalvar).catch(function () { pintarSalvando(false); mostrarErroBanco("Não consegui guardar no celular."); });
    }
    function apagar() {
      if (salvando || !sessao || !s || !s.original) return;
      var id = s.original.id;
      pintarSalvando(true);
      mostrarErroBanco("");
      sessao.apagar([id]).then(function (r) {
        if (r.ignorado) return;
        if (!r.ok) { pintarSalvando(false); mostrarErroBanco(r.mensagem); return; }
        env.sair();
        env.avisar({
          texto: "Lançamento apagado.", icone: "i-ok", duracao: 8000, acao: "Desfazer",
          aoAcao: function () {
            sessao.desfazerApagar([id]).then(function (d) {
              env.avisar(d.ok ? { texto: "Lançamento de volta.", icone: "i-ok", duracao: 4000 } : { texto: d.mensagem || "Não consegui desfazer.", icone: "i-atencao", duracao: 6000 });
            });
          }
        });
      }).catch(function () { pintarSalvando(false); mostrarErroBanco("Não consegui apagar agora."); });
    }

    // ---- ligações dos controles ----
    $("mv-x").addEventListener("click", pedirSaida);
    descartarBtn.addEventListener("click", pedirSaida);
    $("mv-voltar").addEventListener("click", function () { env.sair(); });
    salvarBtn.addEventListener("click", salvar);
    $("mv-continuar").addEventListener("click", continuarEditando);
    $("mv-descartar-sim").addEventListener("click", function () { folhaFundo.hidden = true; form.inert = false; env.sair(); });
    folhaFundo.addEventListener("click", function (e) { if (e && e.target === folhaFundo) continuarEditando(); });
    if (typeof document !== "undefined" && doc === document) {
      doc.addEventListener("keydown", function (e) {
        if (e.key !== "Escape" || !aberto) return;
        if (!folhaFundo.hidden) continuarEditando(); else pedirSaida();
      });
      window.addEventListener("online", function () { if (aberto && refs) refs.semNet.hidden = true; });
      window.addEventListener("offline", function () { if (aberto && refs) refs.semNet.hidden = false; });
    }
    if (campos.addEventListener) campos.addEventListener("submit", function (e) { if (e && e.preventDefault) e.preventDefault(); });

    return {
      abrir: abrir, fechar: fechar, pedirSaida: pedirSaida, mexeu: mexeu,
      aberto: function () { return aberto; }
    };
  }

  return { criar: criar, tipoDoLancamento: function (tipo) { return TIPO_DO_LANCAMENTO[tipo] || null; } };
})();
if (typeof module !== "undefined") module.exports = TelaMovimento;
