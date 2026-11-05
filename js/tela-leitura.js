// Zelo: a tela "Ler comprovante" (#73, parte 1): escolher foto ou PDF, "Lendo…", erros e "O que entendi" (Salvar, Corrigir, Descartar).
// Só desenho e ligação: as regras estão em Leitura (arquivo e resposta) e em Lancar (gravar). Tudo que vem da leitura ou da
// planilha entra com textContent, nunca como HTML. DESENHO: specs/73-design.md.
// PRIVACIDADE: o arquivo só existe nas variáveis desta tela (memória) e é solto ao sair. Aqui não há IndexedDB, localStorage,
// sessionStorage, Cache, fila para o arquivo, histórico nem endereço. Nada vai para o console. No navegador vira o objeto global TelaLeitura.
var TelaLeitura = (function () {
  var SVG_NS = "http://www.w3.org/2000/svg";
  var Lei = typeof Leitura !== "undefined" ? Leitura : require("./leitura.js");
  var Din = typeof Dinheiro !== "undefined" ? Dinheiro : require("./dinheiro.js");
  var Dat = typeof Datas !== "undefined" ? Datas : require("./datas.js");
  var Ver_ = typeof Ver !== "undefined" ? Ver : require("./ver.js");
  var Lan = typeof Lancar !== "undefined" ? Lancar : require("./lancar.js");
  var Opc = typeof Opcoes !== "undefined" ? Opcoes : require("./opcoes.js");
  var Fil = typeof Fila !== "undefined" ? Fila : require("./fila.js");

  var PALAVRA = { saiu: "Saiu", entrou: "Entrou", fatura: "Fatura" };
  var ICONE_TIPO = { saiu: "i-saiu", entrou: "i-entrou", fatura: "i-cartao" };
  // Nome de cada campo na frase "Falta preencher: …", na ordem da tela.
  var FALTA = [["tipo", "o tipo"], ["valor_centavos", "o valor"], ["data", "a data"], ["favorecido", "quem recebeu"], ["categoria", "a categoria"], ["cartao", "o cartão"]];
  var SEM_CATEGORIA = "__sem__";

  // env: { raiz (a <section class="form" id="ler">), doc?, pronto: Promise<{ db, ponte } | null>, hoje(), online(),
  //        sair(), irLancamentos(), lancarAMao(), corrigir(previa), setTimeout?, clearTimeout?, novoId?, preparar?(file) }
  function criar(env) {
    var doc = env.doc || document;
    var raiz = env.raiz;
    var agendar = env.setTimeout || function (f, ms) { return setTimeout(f, ms); };
    var desagendar = env.clearTimeout || function (t) { clearTimeout(t); };
    var gerarId = env.novoId || function () { return Fil.novoId(); };
    var preparar = env.preparar || function (f) { return Lei.prepararArquivo(f); };

    var aberto = false, passo = "escolher", geracao = 0;
    var arquivos = [];            // { tipo_arquivo, base64, bytes, foto }: só em memória
    var aviso = "";               // aviso do arquivo (um por vez)
    var preparando = false, demora = false;
    var erro = null;              // { caso, mensagem }
    var cards = [], opcoes = null, sessao = null, documento = "comprovante";
    var folha = null;             // null | "sair"
    var avisoBaixo = "", timerAviso = null, timerDemora = null, timerLimite = null;
    var emFormulario = false;
    var entradas = null;          // os três <input type=file>

    // ---- ajudas de desenho ----
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
    function botao(texto, classe, aoTocar, id, iconeId) {
      var b = el("button", classe);
      b.type = "button";
      if (id) b.setAttribute("id", id);
      if (iconeId) b.appendChild(icone(iconeId));
      b.appendChild(el("span", "", texto));
      b.addEventListener("click", aoTocar);
      return b;
    }
    function nota(iconeId, texto, classe, papel) {
      var p = el("p", classe || "nota-ic");
      if (papel) p.setAttribute("role", papel);
      p.append(icone(iconeId), el("span", "", texto));
      return p;
    }

    // ---- limpar tudo que é do arquivo ----
    function soltar() {
      arquivos = [];
      aviso = "";
      erro = null;
      cards = [];
      sessao = null;
      opcoes = null;
      folha = null;
      avisoBaixo = "";
      preparando = false;
      demora = false;
      parar();
      if (timerAviso !== null) { desagendar(timerAviso); timerAviso = null; }
    }
    function parar() {
      if (timerDemora !== null) { desagendar(timerDemora); timerDemora = null; }
      if (timerLimite !== null) { desagendar(timerLimite); timerLimite = null; }
    }

    // ---- campos de arquivo (escondidos) ----
    function criarEntradas() {
      function entrada(id, accept, multiplo, camera) {
        var i = doc.createElement("input");
        i.type = "file";
        i.setAttribute("id", id);
        i.accept = accept;
        i.multiple = multiplo;
        i.hidden = true;
        if (camera) i.setAttribute("capture", "environment");
        i.setAttribute("tabindex", "-1");
        i.setAttribute("aria-hidden", "true");
        i.addEventListener("change", function () {
          var lista = i.files ? Array.prototype.slice.call(i.files) : [];
          try { i.value = ""; } catch (_) { /* campo de arquivo só aceita vazio */ }
          if (lista.length) adicionar(lista);
        });
        return i;
      }
      entradas = {
        camera: entrada("ler-in-camera", "image/*", false, true),
        galeria: entrada("ler-in-galeria", "image/jpeg,image/png", true, false),
        pdf: entrada("ler-in-pdf", "application/pdf", true, false)
      };
    }
    function abrirEntrada(qual) {
      var i = entradas && entradas[qual];
      if (i && typeof i.click === "function") i.click();
    }

    // ---- escolher páginas ----
    function adicionar(lista) {
      if (!aberto || passo !== "escolher" || preparando) return;
      var vaga = Lei.MAX_ARQUIVOS - arquivos.length;
      if (vaga <= 0) return;
      var minha = ++geracao;
      var fila = lista.slice(0, vaga);
      var cortou = lista.length > vaga;
      var novos = [], ultimoAviso = "";
      preparando = true;
      aviso = "";
      passo = "lendo";
      pintar();
      var p = Promise.resolve();
      fila.forEach(function (f) {
        p = p.then(function () {
          if (minha !== geracao) return null;
          return Promise.resolve(preparar(f)).catch(function () { return { ok: false, mensagem: Lei.MENSAGENS.preparo }; }).then(function (r) {
            if (minha !== geracao) return;
            if (r && r.ok) novos.push(r.arquivo); else ultimoAviso = (r && r.mensagem) || Lei.MENSAGENS.preparo;
          });
        });
      });
      p.then(function () {
        if (minha !== geracao || !aberto) return;
        var junto = arquivos.concat(novos);
        // Soma grande demais: as novas páginas não entram (a pessoa escolhe menos páginas).
        var conf = Lei.conferirLote(junto);
        if (novos.length && !conf.ok && conf.motivo !== "vazio") {
          ultimoAviso = conf.mensagem;
        } else {
          arquivos = junto;
        }
        if (cortou && !ultimoAviso) ultimoAviso = "Só cabem " + Lei.MAX_ARQUIVOS + " páginas. As outras ficaram de fora.";
        aviso = ultimoAviso;
        preparando = false;
        passo = "escolher";
        pintar();
      });
    }
    function tirar(i) {
      arquivos.splice(i, 1);
      aviso = "";
      pintar();
    }

    // ---- ler ----
    function lerAgora() {
      if (!aberto || !arquivos.length) return;
      var conf = Lei.conferirLote(arquivos);
      if (!conf.ok) { aviso = conf.mensagem; passo = "escolher"; pintar(); return; }
      var minha = ++geracao;
      passo = "lendo";
      preparando = false;
      demora = false;
      erro = null;
      parar();
      pintar(true);
      timerDemora = agendar(function () {
        timerDemora = null;
        if (minha !== geracao || passo !== "lendo") return;
        demora = true;
        pintar();
      }, Lei.AVISO_DEMORA);
      // Rede de segurança: a ponte já desiste em 60 s; isto cobre um navegador sem AbortController.
      timerLimite = agendar(function () {
        timerLimite = null;
        if (minha !== geracao || passo !== "lendo") return;
        geracao++;
        erro = { caso: "demora" };
        passo = "erro";
        pintar(true);
      }, Lei.TEMPO_LIMITE + 3000);
      var dados = Lei.montarDados(arquivos, env.hoje());
      env.pronto.then(function (c) {
        if (!c || !c.ponte || typeof c.ponte.chamar !== "function") return { ok: false, erro: { codigo: "sem_configuracao", mensagem: "Falta configurar a ponte em Ajustes." } };
        return c.ponte.chamar("ler_comprovante", dados, { tempoLimite: Lei.TEMPO_LIMITE });
      }).catch(function () {
        return { ok: false, erro: { codigo: "tempo_esgotado" } };
      }).then(function (resp) {
        if (minha !== geracao || !aberto) return null;
        parar();
        var r = Lei.entenderResposta(resp);
        if (!r.ok) {
          if (r.caso === "tamanho") { aviso = Lei.MENSAGENS.tamanho; passo = "escolher"; pintar(true); return null; }
          erro = r;
          passo = "erro";
          pintar(true);
          return null;
        }
        return prepararLinhas(r, minha);
      });
    }

    function prepararLinhas(r, minha) {
      return env.pronto.then(function (c) {
        if (!c) return null;
        sessao = Lan.criar(c.db);
        return Opc.ler(c.db).catch(function () { return null; });
      }).catch(function () { return null; }).then(function (op) {
        if (minha !== geracao || !aberto) return;
        opcoes = op;
        documento = r.documento;
        cards = r.linhas.map(function (l, n) { return novoCard(l, n); });
        arquivos = []; // o arquivo já cumpriu o papel: solta da memória
        passo = "entendi";
        pintar(true);
      });
    }

    function novoCard(l, n) {
      return {
        n: n, id: gerarId(), dados: l, estado: "aberta", salvando: false, erroSalvar: "", resumo: "",
        // o que a pessoa vê e preenche (texto)
        tipo: l.tipo, valor: l.valor_centavos === null ? "" : Din.formatarCampo(l.valor_centavos), data: l.data,
        favorecido: l.favorecido, categoria: l.categoria, cartao: "",
        ui: null
      };
    }

    // ---- regras de cada cartão ----
    function centavosDe(c) { return c.valor === "" ? null : Din.paraCentavos(c.valor); }
    function faltas(c) {
      var f = [];
      var d = c.dados.duvidas;
      FALTA.forEach(function (par) {
        var k = par[0];
        if (d.indexOf(k) < 0) return;
        var ok;
        if (k === "tipo") ok = c.tipo === "saiu" || c.tipo === "entrou" || c.tipo === "fatura";
        else if (k === "valor_centavos") ok = centavosDe(c) !== null;
        else if (k === "data") ok = Dat.valida(c.data);
        else if (k === "favorecido") ok = c.favorecido.trim() !== "";
        else if (k === "categoria") ok = c.categoria !== "";
        else ok = c.cartao !== "";
        if (!ok) f.push(par[1]);
      });
      // fatura sempre pede o cartão, mesmo que o script não tenha listado
      if (c.tipo === "fatura" && c.cartao === "" && d.indexOf("cartao") < 0) f.push("o cartão");
      return f;
    }
    function nomeDoCartao(c) {
      var cent = centavosDe(c);
      var fav = c.tipo === "fatura" ? (c.cartao ? "Fatura " + c.cartao : "Pagamento de fatura") : c.favorecido.trim();
      return (fav || "Sem nome") + (cent === null ? "" : ", " + Din.formatar(cent));
    }
    function camposDoFormulario(c) {
      var cent = centavosDe(c);
      return {
        tipo: c.tipo, valor: cent === null ? "" : Din.formatarCampo(cent), data: c.data, favorecido: c.favorecido.trim(),
        categoria: c.categoria === SEM_CATEGORIA ? "" : c.categoria, pessoa: "", forma: c.dados.forma, cartao: c.tipo === "fatura" ? c.cartao : ""
      };
    }
    function contexto(c) {
      return { opcoes: opcoes, hoje: env.hoje(), manter: { categoria: c.dados.categoria, forma: c.dados.forma } };
    }

    function salvar(c) {
      if (!aberto || c.estado !== "aberta" || c.salvando || faltas(c).length || !sessao) return;
      c.salvando = true;
      c.erroSalvar = "";
      sessao.salvarNovo(camposDoFormulario(c), contexto(c), { id: c.id, origem: "foto" }).then(function (r) {
        c.salvando = false;
        if (!aberto) return;
        if (r.ignorado) return;
        if (r.ok) { marcarSalva(c); return; }
        c.erroSalvar = r.banco ? (r.mensagem || "Não consegui guardar no celular.") : "Confira os dados. Toque em Corrigir para ver o que falta.";
        pintar();
      }).catch(function () {
        c.salvando = false;
        c.erroSalvar = "Não consegui guardar no celular.";
        if (aberto) pintar();
      });
    }
    // lanc: o que o formulário do Corrigir gravou (pode ter mudado valor e nome); sem ele vale o que o cartão mostra.
    function marcarSalva(c, lanc) {
      c.estado = "salva";
      var nome = lanc && typeof lanc.favorecido === "string" && Number.isInteger(lanc.valor_centavos) ? lanc.favorecido + ", " + Din.formatar(lanc.valor_centavos) : nomeDoCartao(c);
      c.resumo = "Salvo: " + nome;
      mostrarAvisoBaixo(env.online() !== false ? "Guardado e enviando…" : "Guardado. Vai para a planilha quando houver internet.");
      pintar();
    }
    function descartar(c) {
      if (c.estado !== "aberta") return;
      c.estado = "descartada";
      c.resumo = "Descartada: " + nomeDoCartao(c);
      pintar();
    }
    function desfazer(c) {
      if (c.estado !== "descartada") return;
      c.estado = "aberta";
      pintar();
    }
    function corrigir(c) {
      if (!aberto || c.estado !== "aberta" || !env.corrigir) return;
      emFormulario = true;
      env.corrigir({
        campos: camposDoFormulario(c), id: c.id, origem: "foto",
        aoSalvar: function (lanc) { marcarSalva(c, lanc); }
      });
    }
    function mostrarAvisoBaixo(texto) {
      avisoBaixo = texto;
      if (timerAviso !== null) desagendar(timerAviso);
      timerAviso = agendar(function () { timerAviso = null; avisoBaixo = ""; if (aberto && !emFormulario) pintar(); }, 5000);
    }

    // ---- desenho ----
    function pintar(focarTitulo) {
      if (!aberto) return;
      raiz.textContent = "";
      var titulo = passo === "entendi" ? "O que entendi" : "Ler comprovante";
      var topo = el("header", "form-topo");
      var x = el("button", "btn-icone");
      x.type = "button";
      x.setAttribute("id", "ler-x");
      x.setAttribute("aria-label", "Fechar");
      x.appendChild(icone("i-fechar"));
      x.addEventListener("click", pedirSaida);
      var h1 = el("h1", "", titulo);
      h1.setAttribute("id", "ler-titulo");
      h1.setAttribute("tabindex", "-1");
      topo.append(x, h1);
      var corpo = el("div", "form-corpo");
      var rodape = null;
      if (passo === "escolher") rodape = pintarEscolher(corpo);
      else if (passo === "lendo") pintarLendo(corpo);
      else if (passo === "erro") pintarErro(corpo);
      else rodape = pintarEntendi(corpo);
      raiz.append(topo, corpo);
      if (rodape) raiz.appendChild(rodape);
      if (avisoBaixo) {
        var av = el("div", "aviso-fixo", "");
        av.setAttribute("id", "ler-aviso");
        av.setAttribute("role", "status");
        av.append(icone("i-ok"), el("span", "", avisoBaixo));
        raiz.appendChild(av);
      }
      if (folha) raiz.appendChild(pintarFolha());
      raiz.appendChild(entradas.camera);
      raiz.appendChild(entradas.galeria);
      raiz.appendChild(entradas.pdf);
      if (folha) {
        var h2 = doc.getElementById("ler-folha-t");
        if (h2) h2.focus();
      } else if (focarTitulo) h1.focus();
    }

    function pintarEscolher(corpo) {
      var cheio = arquivos.length >= Lei.MAX_ARQUIVOS;
      if (env.online() === false) {
        var faixa = el("div", "faixa faixa-info");
        faixa.setAttribute("role", "status");
        var txt = el("div");
        txt.append(el("strong", "", "Sem internet por enquanto"), "Para ler preciso de internet. Lançar à mão continua funcionando.");
        faixa.append(icone("i-semnet"), txt);
        corpo.appendChild(faixa);
      }
      corpo.appendChild(el("p", "campo-apoio", arquivos.length
        ? "Pode mandar até " + Lei.MAX_ARQUIVOS + " páginas. Escolha na ordem das páginas."
        : "Tire uma foto ou escolha um arquivo do comprovante ou do extrato. Pode mandar até " + Lei.MAX_ARQUIVOS + " páginas, na ordem em que aparecem."));
      if (arquivos.length) {
        corpo.appendChild(el("p", "ler-cont", "Páginas escolhidas: " + arquivos.length + " de " + Lei.MAX_ARQUIVOS));
        var ul = el("ul", "ler-lista");
        arquivos.forEach(function (a, i) {
          var li = el("li");
          var ic = el("span", "lan-ic");
          ic.appendChild(icone(a.foto ? "i-imagem" : "i-arquivo"));
          var t = el("div");
          t.append(el("p", "ler-nome", "Página " + (i + 1)), el("p", "ler-sub", (a.foto ? "Foto" : "PDF") + " · " + Lei.rotuloTamanho(a.bytes)));
          var b = el("button", "btn-icone");
          b.type = "button";
          b.setAttribute("aria-label", "Tirar a página " + (i + 1));
          b.appendChild(icone("i-fechar"));
          b.addEventListener("click", function () { tirar(i); });
          li.append(ic, t, b);
          ul.appendChild(li);
        });
        corpo.appendChild(ul);
      }
      if (aviso) {
        var p = el("p", "campo-erro");
        p.setAttribute("role", "alert");
        p.append(icone("i-atencao"), el("span", "", aviso));
        corpo.appendChild(p);
      }
      if (cheio) corpo.appendChild(nota("i-info", "Você já escolheu " + Lei.MAX_ARQUIVOS + " páginas. Tire alguma para colocar outra."));
      var fontes = el("div", "ler-fontes");
      [["camera", "i-camera", "Tirar foto", "Abre a câmera"], ["galeria", "i-imagem", "Escolher da galeria", "Foto ou imagem do celular"], ["pdf", "i-arquivo", "Escolher um PDF", "Comprovante ou extrato do banco"]].forEach(function (f) {
        var b = el("button", "ler-fonte");
        b.type = "button";
        b.setAttribute("id", "ler-fonte-" + f[0]);
        b.disabled = cheio;
        var t = el("span");
        t.append(f[2], el("small", "", f[3]));
        b.append(icone(f[1]), t);
        b.addEventListener("click", function () { abrirEntrada(f[0]); });
        fontes.appendChild(b);
      });
      corpo.appendChild(fontes);
      corpo.appendChild(nota("i-info", "O arquivo é usado só para ler e depois é esquecido. Ele nunca fica guardado."));
      var rodape = el("footer", "form-rodape");
      if (!arquivos.length) rodape.appendChild(el("p", "campo-apoio rodape-aviso", "Escolha pelo menos uma foto ou um PDF."));
      var ler = botao("Ler agora", "btn-p", lerAgora, "ler-agora");
      ler.disabled = !arquivos.length;
      rodape.append(botao("Cancelar", "btn-sec", function () { env.sair(); }, "ler-cancelar"), ler);
      return rodape;
    }

    function pintarLendo(corpo) {
      var c = el("div", "cartao");
      c.setAttribute("role", "status");
      c.append(icone("i-enviando", "ic-grande ic-gira"), el("strong", "", "Lendo…"), el("p", "", preparando ? "Preparando as páginas." : "Isso leva alguns segundos."));
      if (demora && !preparando) {
        var extra = el("p", "cartao-extra", "Está demorando mais que o normal. Pode esperar ou cancelar.");
        c.appendChild(extra);
      }
      var bs = el("div", "botoes");
      bs.appendChild(botao("Cancelar", "btn-sec", cancelarLeitura, "ler-cancelar-leitura"));
      c.appendChild(bs);
      corpo.appendChild(c);
      if (!preparando) {
        var ap = el("p", "campo-apoio", "Se cancelar, esta leitura ainda entra na conta do limite do mês.");
        ap.setAttribute("style", "text-align:center");
        corpo.appendChild(ap);
      }
    }
    function cancelarLeitura() {
      geracao++; // a resposta que chegar depois é ignorada
      parar();
      preparando = false;
      demora = false;
      passo = "escolher";
      pintar(true);
    }

    function textoDoErro(e) {
      var voltar = function () { passo = "escolher"; erro = null; pintar(true); };
      var fechar = botao("Fechar", "btn-sec", function () { env.sair(); }, "ler-erro-fechar");
      switch (e.caso) {
        case "semnet":
          return { icone: "i-semnet", titulo: "Para ler preciso de internet.", apoio: ["Seu arquivo não foi guardado.", "Com a conexão de volta, toque em Tentar de novo. Se sair desta tela, o arquivo é esquecido e você escolhe de novo."],
            botoes: [botao("Tentar de novo", "btn-p", lerAgora, "ler-de-novo", "i-enviando"), fechar] };
        case "teto":
          return { tom: "atencao", icone: "i-atencao", titulo: "O limite do mês da leitura automática acabou.", apoio: ["Lance à mão ou espere o mês virar. O resto do Zelo continua funcionando normalmente."],
            botoes: [botao("Lançar à mão", "btn-p", function () { if (env.lancarAMao) env.lancarAMao(); }, "ler-a-mao", "i-mais"), fechar] };
        case "invalida":
          return { tom: "atencao", icone: "i-atencao", titulo: "Não consegui entender a leitura.", apoio: ["Mande de novo. Foto reta, com boa luz e sem cortar as bordas costuma ajudar."],
            botoes: [botao("Escolher de novo", "btn-p", voltar, "ler-escolher-de-novo"), fechar] };
        case "vazio":
          return { icone: "i-vazio", titulo: "Não achei lançamentos nesse arquivo.", apoio: ["Veja se é um comprovante ou um extrato e se a foto está nítida."],
            botoes: [botao("Escolher outro arquivo", "btn-p", function () { arquivos = []; voltar(); }, "ler-escolher-outro"),
              botao("Lançar à mão", "btn-sec", function () { if (env.lancarAMao) env.lancarAMao(); }, "ler-a-mao")] };
        case "config":
        case "codigo":
          return { tom: "atencao", icone: "i-atencao", titulo: "Não consegui falar com a planilha.", apoio: [e.mensagem || "Confira a ligação em Ajustes."], botoes: [fechar] };
        default:
          return { tom: "atencao", icone: "i-atencao", titulo: "Não consegui ler agora, tente de novo.", apoio: ["Nada foi guardado. Você pode tentar de novo agora, com os mesmos arquivos, enquanto esta tela estiver aberta."],
            botoes: [botao("Tentar de novo", "btn-p", lerAgora, "ler-de-novo", "i-enviando"), fechar] };
      }
    }
    function pintarErro(corpo) {
      var t = textoDoErro(erro || { caso: "demora" });
      var c = el("div", "cartao");
      c.setAttribute("role", "alert");
      if (t.tom) c.setAttribute("data-tom", t.tom);
      c.append(icone(t.icone, "ic-grande"), el("strong", "", t.titulo));
      t.apoio.forEach(function (a) { c.appendChild(el("p", "", a)); });
      var bs = el("div", "botoes");
      t.botoes.forEach(function (b) { bs.appendChild(b); });
      c.appendChild(bs);
      corpo.appendChild(c);
    }

    // ---- O que entendi ----
    function abertas() { return cards.filter(function (c) { return c.estado === "aberta"; }); }
    function pintarEntendi(corpo) {
      var meta = el("div", "meta");
      var mt = el("div", "meta-txt");
      if (documento === "extrato") {
        mt.append(el("p", "conta", "Li um extrato"), el("p", "apoio", cards.length + (cards.length === 1 ? " lançamento para conferir." : " lançamentos para conferir.")));
      } else {
        mt.append(el("p", "conta", "Li 1 comprovante"), el("p", "apoio", "Confira os dados e escolha o que fazer."));
      }
      meta.appendChild(mt);
      corpo.appendChild(meta);
      corpo.appendChild(nota("i-info", "Confira antes de salvar. O Zelo pode errar ao ler."));
      cards.forEach(function (c) {
        corpo.appendChild(c.estado === "aberta" ? pintarCard(c) : pintarFeita(c));
      });
      if (abertas().length === 0) corpo.appendChild(pintarPronto());
      return null;
    }

    function pintarFeita(c) {
      var d = el("div", "ll-feita");
      d.setAttribute("role", "status");
      if (c.estado === "descartada") d.setAttribute("data-tom", "descartada");
      d.append(icone(c.estado === "salva" ? "i-ok" : "i-lixeira"), el("span", "", c.resumo));
      if (c.estado === "descartada") d.appendChild(botao("Desfazer", "btn-link", function () { desfazer(c); }, "ler-desfazer-" + c.n));
      return d;
    }

    function pintarPronto() {
      var salvos = cards.filter(function (c) { return c.estado === "salva"; }).length;
      var desc = cards.filter(function (c) { return c.estado === "descartada"; }).length;
      var partes = [];
      if (salvos) partes.push(salvos + (salvos === 1 ? " lançamento salvo" : " lançamentos salvos"));
      if (desc) partes.push(desc + (desc === 1 ? " descartado" : " descartados"));
      var frase = partes.length ? partes.join(" e ") + "." : "";
      if (salvos) frase += " Os salvos seguem para a planilha assim que o Zelo conseguir enviar.";
      else frase += " Nada foi guardado.";
      var c = el("div", "cartao");
      c.setAttribute("role", "status");
      c.append(icone("i-ok", "ic-grande"), el("strong", "", "Pronto"), el("p", "", frase.trim()));
      var bs = el("div", "botoes");
      bs.append(
        botao("Ver lançamentos", "btn-p", function () { if (env.irLancamentos) env.irLancamentos(); }, "ler-ver-lancamentos"),
        botao("Ler outro arquivo", "btn-sec", function () { soltar(); passo = "escolher"; pintar(true); }, "ler-outro")
      );
      c.appendChild(bs);
      return c;
    }

    function textoValor(c) {
      var cent = centavosDe(c);
      if (cent === null) return "—";
      if (c.tipo === "saiu" || c.tipo === "entrou") return Ver_.dinheiro(c.tipo, cent);
      return Din.formatar(cent);
    }
    function textoCategoria(c) {
      if (c.categoria === SEM_CATEGORIA) return "Sem categoria";
      if (c.categoria !== "") return c.categoria;
      return c.dados.duvidas.indexOf("categoria") >= 0 ? null : "Sem categoria";
    }

    function pintarCard(c) {
      var art = el("article", "ll");
      art.setAttribute("id", "ler-card-" + c.n);
      var ui = { art: art };
      c.ui = ui;
      // topo: ícone, favorecido e valor
      var topo = el("div", "ll-topo");
      ui.ic = el("span", "lan-ic");
      var txt = el("div", "lan-txt");
      ui.titulo = el("p", "lan-titulo");
      txt.appendChild(ui.titulo);
      ui.din = el("span", "din");
      ui.palavra = el("span", "din-p");
      ui.valor = el("b", "din-v");
      ui.din.append(ui.palavra, ui.valor);
      topo.append(ui.ic, txt, ui.din);
      art.appendChild(topo);
      // detalhes
      var compacto = cards.length > 1;
      if (compacto) {
        ui.sub = el("p", "lan-sub");
        txt.appendChild(ui.sub);
      } else {
        ui.dl = el("dl", "envio-dados");
        ui.dd = {};
        [["data", "Data"], ["categoria", "Categoria"], ["forma", "Forma"], ["cartao", "Cartão"]].forEach(function (par) {
          var dt = el("dt", "", par[1]);
          var dd = el("dd");
          ui.dd[par[0]] = { dt: dt, dd: dd };
          ui.dl.append(dt, dd);
        });
        art.appendChild(ui.dl);
      }
      // quadro em dúvida
      ui.quadro = pintarQuadro(c);
      if (ui.quadro) art.appendChild(ui.quadro);
      // ações
      var acoes = el("div", "ll-acoes");
      ui.salvar = botao(c.salvando ? "Salvando…" : "Salvar", "btn-p", function () { salvar(c); }, "ler-salvar-" + c.n);
      acoes.append(ui.salvar,
        botao("Corrigir", "btn-sec", function () { corrigir(c); }, "ler-corrigir-" + c.n),
        botao("Descartar", "btn-sec", function () { descartar(c); }, "ler-descartar-" + c.n));
      art.appendChild(acoes);
      ui.falta = el("p", "nota-ic nota-aviso ll-falta");
      ui.falta.setAttribute("id", "ler-falta-" + c.n);
      ui.falta.setAttribute("role", "status");
      art.appendChild(ui.falta);
      sincronizar(c);
      return art;
    }

    // Atualiza só o que depende do que foi preenchido (sem refazer a tela, para o teclado não fechar).
    function sincronizar(c) {
      var ui = c.ui;
      if (!ui) return;
      var f = faltas(c);
      var tipo = c.tipo;
      art_tipo(ui.art, tipo);
      ui.ic.textContent = "";
      if (ICONE_TIPO[tipo]) ui.ic.appendChild(icone(ICONE_TIPO[tipo]));
      var fav = c.favorecido.trim();
      var nome = tipo === "fatura" ? (fav || "Pagamento de fatura") : fav;
      ui.titulo.textContent = "";
      if (nome) ui.titulo.textContent = nome;
      else ui.titulo.appendChild(el("span", "ll-vazio", "Sem nome"));
      ui.din.setAttribute("data-tipo", tipo || "");
      ui.palavra.textContent = PALAVRA[tipo] || "Sem tipo";
      ui.valor.textContent = textoValor(c);
      if (ui.sub) {
        var cat = textoCategoria(c);
        ui.sub.textContent = [c.data ? Dat.paraTela(c.data) : "sem data", cat === null ? "sem categoria" : cat, c.dados.forma].filter(function (x) { return x; }).join(" · ");
      } else {
        var cat2 = textoCategoria(c);
        var linhas = { data: c.data ? Dat.paraTela(c.data) : null, categoria: cat2, forma: c.dados.forma || "Não informada", cartao: c.cartao || null };
        ["data", "categoria", "forma", "cartao"].forEach(function (k) {
          var par = ui.dd[k];
          var visivel = k !== "cartao" || tipo === "fatura";
          par.dt.hidden = !visivel;
          par.dd.hidden = !visivel;
          par.dd.textContent = "";
          if (linhas[k] === null) par.dd.appendChild(el("span", "ll-vazio", "Falta preencher"));
          else par.dd.textContent = linhas[k];
        });
      }
      if (ui.quadro) {
        var pronto = f.length === 0;
        if (pronto) ui.quadro.setAttribute("data-pronto", ""); else ui.quadro.removeAttribute("data-pronto");
        ui.quadroTitulo.textContent = "";
        ui.quadroTitulo.append(icone(pronto ? "i-ok" : "i-atencao"), el("span", "", pronto ? "Tudo preenchido. Confira antes de salvar." : "Preencha o que não consegui ler"));
      }
      ui.salvar.disabled = f.length > 0 || c.salvando;
      var msg = c.erroSalvar || (f.length ? "Falta preencher: " + f.join(", ") + "." : "");
      ui.falta.textContent = "";
      ui.falta.hidden = msg === "";
      if (msg) ui.falta.append(icone("i-atencao"), el("span", "", msg));
    }
    function art_tipo(art, tipo) { art.setAttribute("data-tipo", tipo || ""); }

    function pintarQuadro(c) {
      var d = c.dados.duvidas.slice();
      if (c.dados.tipo === "fatura" && d.indexOf("cartao") < 0) d.push("cartao");
      if (!d.length) return null;
      var q = el("div", "ll-aviso");
      var t = el("p", "ll-aviso-t");
      c.ui.quadroTitulo = t;
      q.appendChild(t);
      var pre = "ler-" + c.n + "-";
      function mudou() { sincronizar(c); }
      function campoTexto(chave, rotulo, apoio, montar) {
        var box = el("div", "campo");
        var lab = el("label", "", rotulo);
        lab.setAttribute("for", pre + chave);
        box.appendChild(lab);
        if (apoio) {
          var ap = el("p", "campo-apoio", apoio);
          ap.setAttribute("id", pre + chave + "-apoio");
          box.appendChild(ap);
        }
        box.appendChild(montar());
        return box;
      }
      if (d.indexOf("tipo") >= 0) {
        var g = el("fieldset", "campo-grupo");
        g.appendChild(el("legend", "", "Tipo"));
        var es = el("div", "escolhas dois");
        [["saiu", "Saiu", "i-saiu"], ["entrou", "Entrou", "i-entrou"]].forEach(function (o) {
          var l = el("label", "escolha");
          var r = doc.createElement("input");
          r.type = "radio";
          r.name = pre + "tipo";
          r.value = o[0];
          r.checked = c.tipo === o[0];
          r.setAttribute("id", pre + "tipo-" + o[0]);
          r.addEventListener("change", function () { if (r.checked) { c.tipo = o[0]; mudou(); } });
          l.append(icone(o[2], "ic-tipo " + o[0]), r, o[1], icone("i-ok", "ic-ok"));
          es.appendChild(l);
        });
        g.appendChild(es);
        q.appendChild(g);
      }
      if (d.indexOf("valor_centavos") >= 0) {
        q.appendChild(campoTexto("valor", "Valor", "", function () {
          var linha = el("div", "campo-linha entrada-prefixo");
          var i = doc.createElement("input");
          i.type = "text";
          i.setAttribute("inputmode", "decimal");
          i.setAttribute("placeholder", "0,00");
          i.setAttribute("id", pre + "valor");
          i.value = c.valor;
          i.addEventListener("input", function () { c.valor = i.value; mudou(); });
          linha.append(el("span", "prefixo", "R$"), i);
          return linha;
        }));
      }
      if (d.indexOf("data") >= 0) {
        q.appendChild(campoTexto("data", "Data", "", function () {
          var linha = el("div", "campo-linha");
          var i = doc.createElement("input");
          i.type = "date";
          i.setAttribute("min", "2000-01-01");
          i.setAttribute("max", "2099-12-31");
          i.setAttribute("id", pre + "data");
          i.value = c.data;
          i.addEventListener("input", function () { c.data = i.value; mudou(); });
          i.addEventListener("change", function () { c.data = i.value; mudou(); });
          linha.appendChild(i);
          return linha;
        }));
      }
      if (d.indexOf("favorecido") >= 0) {
        q.appendChild(campoTexto("favorecido", "Quem recebeu", "Só o nome. Não escreva CPF, cartão nem telefone.", function () {
          var linha = el("div", "campo-linha");
          var i = doc.createElement("input");
          i.type = "text";
          i.setAttribute("maxlength", "80");
          i.setAttribute("autocomplete", "off");
          i.setAttribute("id", pre + "favorecido");
          i.setAttribute("aria-describedby", pre + "favorecido-apoio");
          i.value = c.favorecido;
          i.addEventListener("input", function () { c.favorecido = i.value; mudou(); });
          linha.appendChild(i);
          return linha;
        }));
      }
      if (d.indexOf("categoria") >= 0) {
        q.appendChild(campoTexto("categoria", "Categoria", "", function () {
          var linha = el("div", "campo-linha");
          var s = doc.createElement("select");
          s.setAttribute("id", pre + "categoria");
          [["", "Escolha…"], [SEM_CATEGORIA, "Sem categoria"]].concat(((opcoes && opcoes.categorias) || []).map(function (x) { return [x, x]; })).forEach(function (o) {
            var op = el("option", "", o[1]);
            op.value = o[0];
            s.appendChild(op);
          });
          s.value = c.categoria;
          s.addEventListener("change", function () { c.categoria = s.value; mudou(); });
          linha.appendChild(s);
          return linha;
        }));
      }
      if (d.indexOf("cartao") >= 0) {
        q.appendChild(campoTexto("cartao", "Qual cartão?", "", function () {
          var linha = el("div", "campo-linha");
          var s = doc.createElement("select");
          s.setAttribute("id", pre + "cartao");
          [["", "Escolha…"]].concat(((opcoes && opcoes.cartoes) || []).map(function (x) { return [x, x]; })).forEach(function (o) {
            var op = el("option", "", o[1]);
            op.value = o[0];
            s.appendChild(op);
          });
          s.value = c.cartao;
          s.addEventListener("change", function () { c.cartao = s.value; mudou(); });
          linha.appendChild(s);
          return linha;
        }));
      }
      return q;
    }

    // ---- folha de perguntar antes de descartar ----
    function pintarFolha() {
      var fundo = el("div", "folha-fundo");
      fundo.setAttribute("id", "ler-folha-fundo");
      var f = el("div", "folha");
      f.setAttribute("role", "alertdialog");
      f.setAttribute("aria-modal", "true");
      f.setAttribute("aria-labelledby", "ler-folha-t");
      var h2 = el("h2", "", "Descartar o que li?");
      h2.setAttribute("id", "ler-folha-t");
      h2.setAttribute("tabindex", "-1");
      var bs = el("div", "botoes");
      bs.append(
        botao("Continuar conferindo", "btn-p", function () { folha = null; pintar(); }, "ler-continuar"),
        botao("Descartar", "btn-sec btn-atencao", function () { folha = null; env.sair(); }, "ler-descartar-sim")
      );
      f.append(h2, el("p", "", "As linhas que você ainda não salvou serão esquecidas. O que já foi salvo continua guardado."), bs);
      fundo.appendChild(f);
      return fundo;
    }

    // ---- abrir, fechar e sair ----
    function abrir() {
      if (aberto) return;
      soltar();
      aberto = true;
      emFormulario = false;
      passo = "escolher";
      documento = "comprovante";
      geracao++;
      criarEntradas();
      raiz.hidden = false;
      pintar(true);
    }
    function fechar() {
      if (!aberto) return;
      aberto = false;
      emFormulario = false;
      geracao++;
      soltar();
      raiz.textContent = ""; // nada do que foi lido fica na tela
      raiz.hidden = true;
    }
    function mexeu() { return aberto && passo === "entendi" && abertas().length > 0; }
    function pedirSaida() {
      if (!aberto) return;
      if (folha) { folha = null; pintar(); return; }
      if (mexeu()) { folha = "sair"; pintar(); return; }
      env.sair();
    }
    // Voltou do formulário de Corrigir (salvando ou não).
    function voltou() {
      if (!aberto) return;
      emFormulario = false;
      pintar(false);
    }

    return {
      abrir: abrir, fechar: fechar, pedirSaida: pedirSaida, mexeu: mexeu, voltou: voltou,
      aberto: function () { return aberto; },
      noFormulario: function () { return emFormulario; },
      rede: function () { if (aberto && passo === "escolher" && !preparando) pintar(); }
    };
  }

  return { criar: criar };
})();
if (typeof module !== "undefined") module.exports = TelaLeitura;
