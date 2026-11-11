// Zelo: as telas de ver (#19, partes B, C e D): Lançamentos, Resumo e Início. Só desenho e ligação:
// o que mostrar vem de Ver, as somas são de Somas, a leitura é de Lancamentos. Todo texto da planilha ou da pessoa
// entra com textContent, nunca como HTML. Nada vai para console, localStorage nem URL. No navegador vira o objeto global TelaVer.
var TelaVer = (function () {
  var Ver_ = typeof Ver !== "undefined" ? Ver : require("./ver.js");
  var Lan = typeof Lancamentos !== "undefined" ? Lancamentos : require("./lancamentos.js");
  var Som = typeof Somas !== "undefined" ? Somas : require("./somas.js");
  var Dat = typeof Datas !== "undefined" ? Datas : require("./datas.js");
  var Fil = typeof Fila !== "undefined" ? Fila : require("./fila.js");
  var Opc = typeof Opcoes !== "undefined" ? Opcoes : require("./opcoes.js");
  var Res = typeof Reserva !== "undefined" ? Reserva : require("./reserva.js");
  var Con = typeof Contas !== "undefined" ? Contas : require("./contas.js");
  var Rot = typeof Rotas !== "undefined" ? Rotas : require("./rotas.js");

  var SVG_NS = "http://www.w3.org/2000/svg";
  var CINCO_MIN = 5 * 60 * 1000;
  var ATRASO = 150; // ms: vários avisos seguidos viram um redesenho só
  var AVISOS = ["criou", "editou", "recebeu", "terminou", "falhou", "alterado_no_outro"];
  var ABAS = ["inicio", "lancamentos", "resumo"];
  var SEM_VALOR = "__sem__";
  var FATURAS_VALOR = "__fatura__";
  var SEM_FILTRO = { categoria: undefined, pessoa: undefined, cartao: undefined };

  // env: { pronto: Promise<{ db, controle } | null>, hoje(), online(), agora(), agendar(fn, ms), cancelar(t), doc,
  //        ir(aba), ultimaChave() (última visão do Mês usada), novo(), editar(id), pagarFatura(cartao), reserva(), contas(), conferir(lugar), marcas (opcional: Alterado.criarMarcas(), a marca "alterado no outro celular") }
  function criar(env) {
    var doc = env.doc || document;
    var agora = env.agora || function () { return new Date().getTime(); };
    var agendar = env.agendar || function (fn, ms) { return setTimeout(fn, ms); };
    var cancelar = env.cancelar || function (t) { clearTimeout(t); };
    var $ = function (id) { return doc.getElementById(id); };

    var ctx = null;                 // { db, controle } quando o banco abriu
    var atual = null;               // aba à vista
    var mes = null;                 // mês escolhido (Lançamentos e Resumo); só em memória
    var filtro = { categoria: undefined, pessoa: undefined, cartao: undefined };
    var ate = Ver_.TAMANHO, painel = false;
    var versao = 0;                 // sobe a cada aviso da fila: dado mais velho que isto está velho
    var dadosMes = null, dadosIni = null, contador = 0, geracao = 0;
    var desenhado = { lancamentos: null, resumo: null, inicio: null };
    var timer = null;
    var releitura = false;
    var focoPedido = null, anunciar = { lancamentos: null, resumo: null };
    var ultimaVoz = { lancamentos: "", resumo: "" };
    var sync = { sincronizando: false, tentou: false, tentativaEm: null, sincronizadoEm: null };
    var abertoEm = agora();         // o app acabou de abrir: a sincronização de abertura conta como tentativa
    var lanRef = null;              // o que "Mostrar mais" acrescenta sem redesenhar
    var desligar = [];
    var marcas = env.marcas || null; // só em memória (#16, parte F)

    // ---- ajudas de desenho ----
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
    function botao(classe, texto, aoClicar) {
      var b = el("button", classe, texto);
      b.setAttribute("type", "button");
      if (aoClicar) b.addEventListener("click", aoClicar);
      return b;
    }
    function link(classe, href, texto, aoClicar) {
      var a = el("a", classe, texto);
      a.setAttribute("href", href);
      a.addEventListener("click", function (e) { if (e && e.preventDefault) e.preventDefault(); aoClicar(); });
      return a;
    }
    function achar(raiz, chave) {
      if (!raiz) return null;
      if (raiz.getAttribute && raiz.getAttribute("data-foco") === chave) return raiz;
      var fs = raiz.children || [];
      for (var i = 0; i < fs.length; i++) { var r = achar(fs[i], chave); if (r) return r; }
      return null;
    }

    // ---- dinheiro: uma só forma (valor com sinal em cima, palavra embaixo; no HTML a palavra vem antes) ----
    var ROTULO = { entrou: "Entrou", saiu: "Saiu" };
    function din(tipo, centavos) {
      var s = el("span", "din");
      s.setAttribute("data-tipo", tipo);
      s.append(el("span", "din-p", ROTULO[tipo]), el("b", "din-v", Ver_.dinheiro(tipo, centavos)));
      return s;
    }
    function dinLinha(tipo, centavos) {
      var d = el("div", "din--linha");
      d.setAttribute("data-tipo", tipo);
      var i = el("span", "din-ic");
      i.setAttribute("aria-hidden", "true");
      i.appendChild(ic(tipo === "entrou" ? "i-entrou" : "i-saiu"));
      d.append(i, el("dt", "din-p", ROTULO[tipo]), el("dd", "din-v", Ver_.dinheiro(tipo, centavos)));
      return d;
    }
    // Em aberto de um cartão: palavra antes do valor no HTML (o CSS põe o valor em cima). Sem sinal e sem vermelho.
    function dinAberto(e) {
      var s = el("span", "din");
      s.setAttribute("data-tipo", "aberto");
      var p = el("span", "din-p");
      if (e.tipo === "zerado") p.appendChild(ic("i-ok", "ic-ok"));
      if (e.tipo === "pago_a_mais") p.appendChild(ic("i-info", "ic-info"));
      p.append(e.palavra);
      s.append(p, el("b", "din-v", e.valor));
      return s;
    }
    function dinSaldo(centavos, comIcone, rotulo) {
      var s = Ver_.saldo(centavos);
      var d = el("div", "din--linha din--saldo");
      d.setAttribute("data-sinal", s.sinal);
      var p = el("dd", "din-p");
      if (comIcone) p.appendChild(ic(s.sinal === "neg" ? "i-atencao" : "i-ok"));
      p.append(s.palavra);
      d.append(el("dt", "din-rot", rotulo || "Saldo do mês"), el("dd", "din-v", s.valor), p);
      return d;
    }
    function blocoTotais(t) {
      var dl = el("dl", "totais");
      dl.append(dinLinha("entrou", t.entrou), dinLinha("saiu", t.saiu), dinSaldo(t.saldo, false));
      return dl;
    }

    // ---- sincronização (lida do Indicador; guardada em memória) ----
    function aplicarSync(s) {
      if (!s) return;
      sync = { sincronizando: !!s.sincronizando, tentou: !!s.tentou, tentativaEm: s.tentativaEm, sincronizadoEm: s.sincronizadoEm };
      if (ABAS.indexOf(atual) >= 0 && desenhado[atual] !== null) agendarRedesenho(false);
    }
    function lerLigacao() {
      return Promise.all([ctx.db.config.obter("proximo_desde"), ctx.db.config.obter("url_ponte"), ctx.db.config.obter("codigo_aparelho")]).then(function (v) {
        return { sincronizou: typeof v[0] === "string", configurado: !!(v[1] && v[2]) };
      });
    }
    // Tenta sincronizar. Sem forçar, só se já passou mais de 5 minutos da última tentativa. Nunca mostra erro.
    function sincronizar(forcar) {
      if (!ctx || !ctx.controle || sync.sincronizando || !env.online()) return Promise.resolve(false);
      if (!forcar && agora() - Math.max(sync.tentativaEm || 0, abertoEm) <= CINCO_MIN) return Promise.resolve(false);
      return lerLigacao().then(function (l) {
        if (!l.configurado || sync.sincronizando) return false;
        var propria = typeof ctx.controle.aoSincronia !== "function";
        if (propria) { sync.sincronizando = true; sync.tentativaEm = agora(); redesenharSemLer(); }
        return Promise.resolve(ctx.controle.tentarEnviar()).then(function () {
          if (propria) { sync.sincronizando = false; sync.tentou = true; sync.sincronizadoEm = agora(); redesenharSemLer(); }
          return true;
        });
      }).catch(function () { return false; });
    }

    // ---- leitura do banco: uma vez por abertura de tela ou mês; filtrar e paginar trabalham em memória ----
    function lerMes(m) {
      var minha = ++geracao, v0 = versao;
      return Promise.all([Lan.listar(ctx.db, m), Lan.todosVisiveis(ctx.db), lerLigacao(), lerOpcoes()]).then(function (v) {
        if (minha !== geracao) return dadosMes; // chegou atrasada: vale a leitura mais nova
        dadosMes = { id: ++contador, mes: m, versao: v0, lista: v[0], todos: v[1], lig: v[2], cartoesConfig: cartoesDe(v[3]) };
        return dadosMes;
      });
    }
    // Opções da Config (aba de opções, copiada no celular). Sem cópia ou script antigo: null (cartões e caixinhas = listas vazias).
    function lerOpcoes() {
      return Opc.ler(ctx.db).catch(function () { return null; });
    }
    function cartoesDe(o) { return o && Array.isArray(o.cartoes) ? o.cartoes : []; }
    function lerInicio() {
      var m = Dat.mes(env.hoje());
      var v0 = versao;
      return Promise.all([Lan.listar(ctx.db, m), lerLigacao(), Lan.todosVisiveis(ctx.db), lerOpcoes(), lerContas()]).then(function (v) {
        dadosIni = { id: ++contador, mes: m, versao: v0, lista: v[0], lig: v[1], todos: v[2], cartoesConfig: cartoesDe(v[3]), opcoes: v[3], contas: v[4] };
        return dadosIni;
      });
    }
    // Contas a pagar (#120): só a cópia local, para o cartão do Início. Sem a loja (arquivos de versões misturadas) ou com erro: sem cartão de números.
    function lerContas() {
      if (!ctx.db.contas) return Promise.resolve(null);
      var lancs = ctx.db.lancamentos ? ctx.db.lancamentos.todos() : Promise.resolve([]);
      return Promise.all([ctx.db.contas.todas(), ctx.db.config.obter("ultima_leitura_contas"), lancs, ctx.db.config.obter("dias_aviso").catch(function () { return null; })]).then(function (v) {
        // Conta paga no app e ainda não confirmada pela planilha já conta como paga (#121).
        var lista = Con.comPagamentosLocais(v[0] || [], v[2] || []);
        var r = Con.resumo(lista, env.hoje(), v[1]);
        // A faixa de vencimento (#122) usa esta mesma lista e os dias guardados; "hoje" é lido na hora de desenhar.
        r.lista = lista;
        r.diasAviso = Con.diasDeAviso(v[3]);
        return r;
      }, function () { return null; });
    }
    function mesAtual() { if (mes === null) mes = Dat.mes(env.hoje()); return mes; }
    function limites() { return Ver_.mesesDisponiveis(dadosMes ? dadosMes.todos : [], env.hoje()); }

    // ---- colocar na tela, guardando rolagem e foco ----
    function colocar(alvo, no) {
      var area = $("conteudo");
      var rolagem = area ? area.scrollTop : 0;
      var chave = focoPedido;
      focoPedido = null;
      if (!chave && doc.activeElement && doc.activeElement.getAttribute) {
        var k = doc.activeElement.getAttribute("data-foco");
        if (k && achar(alvo, k)) chave = k;
      }
      alvo.replaceChildren(no);
      if (area) area.scrollTop = rolagem;
      if (chave) {
        var f = achar(no, chave);
        if (f && f.disabled && chave.indexOf("mes-") === 0) f = achar(no, "mes-nome");
        if (f && f.focus) f.focus({ preventScroll: true });
      }
    }
    function voz(aba, texto) {
      var e = $(aba === "lancamentos" ? "lan-voz" : "res-voz");
      if (!e) return;
      if (anunciar[aba] && texto !== ultimaVoz[aba]) { e.textContent = texto; ultimaVoz[aba] = texto; }
      anunciar[aba] = null;
    }

    // ---- cartão de estado (vazio, buscando, nunca sincronizou) ----
    function cartao(v, aoLimpar) {
      var c = el("div", "cartao");
      if (v.status) c.setAttribute("role", "status");
      c.append(ic(v.icone, "ic-grande" + (v.tipo === "buscando" ? " ic-gira" : "")));
      var p = el("p"); p.appendChild(el("strong", "", v.titulo));
      c.appendChild(p);
      if (v.apoio) c.appendChild(el("p", "", v.apoio));
      if (v.acao === "limpar") c.appendChild(botao("btn-sec", "Limpar filtros", aoLimpar));
      else if (v.acao === "novo") c.appendChild(link("btn-sec", "#novo", "Novo lançamento", function () { env.novo(); }));
      else if (v.acao === "ajustes") c.appendChild(link("btn-sec", "#ajustes", "Ir para Ajustes", function () { env.ir("ajustes"); }));
      return c;
    }
    function contextoVazio(d, filtrado) {
      return { mes: d.mes, total: d.lista.length, filtrado: filtrado, sincronizou: d.lig.sincronizou, configurado: d.lig.configurado,
        online: env.online(), tentou: sync.tentou && !sync.sincronizadoEm };
    }

    // ---- seletor de mês (Lançamentos e Resumo) ----
    function seletorMes() {
      var lim = limites();
      var ant = Ver_.vizinho(mes, -1, lim), seg = Ver_.vizinho(mes, 1, lim);
      var w = el("div", "mes");
      function seta(passo, alvo, icone, rotulo) {
        var b = botao("mes-seta", "", function () { irMes(passo); });
        b.setAttribute("aria-label", alvo ? rotulo + ": " + Ver_.nomeDoMes(alvo) : rotulo);
        b.setAttribute("data-foco", passo < 0 ? "mes-ant" : "mes-seg");
        if (!alvo) b.disabled = true;
        b.appendChild(ic(icone));
        return b;
      }
      var nome = el("p", "mes-nome", Ver_.nomeDoMes(mes));
      nome.setAttribute("tabindex", "-1");
      nome.setAttribute("data-foco", "mes-nome");
      w.append(seta(-1, ant, "i-seta-esq", "Mês anterior"), nome, seta(1, seg, "i-seta-dir", "Mês seguinte"));
      return w;
    }
    function irMes(passo) {
      if (!ctx) return;
      var alvo = Ver_.vizinho(mes, passo, limites());
      if (!alvo) return;
      mes = alvo;
      filtro = { categoria: undefined, pessoa: undefined, cartao: undefined };
      ate = Ver_.TAMANHO;
      painel = false;
      focoPedido = passo < 0 ? "mes-ant" : "mes-seg";
      anunciar[atual] = true;
      ultimaVoz[atual] = "";
      ensure(atual, passo < 0 ? "esq" : "dir", true);
    }

    // ---- Lançamentos ----
    // Linha do cartão (ícone + nome), depois de categoria e pessoa.
    function linhaCartao(nome) {
      var p = el("p", "lan-sub lan-cartao");
      p.append(ic("i-cartao"), el("span", "", nome));
      return p;
    }
    // Linha do lugar de um movimento: caixinha (com o ícone dela), cartão ou "Conta".
    function linhaLugar(v) {
      if (v.cartao) return linhaCartao(v.cartao);
      if (v.lugar) {
        var p = el("p", "lan-sub lan-cartao");
        p.append(ic("i-caixinha"), el("span", "", v.lugar));
        return p;
      }
      return el("p", "lan-sub", "Conta");
    }
    function linhaDom(l) {
      var v = Ver_.linha(l);
      var fatura = v.tipo === "fatura";
      var movimento = v.tipo === "guardou" || v.tipo === "tirou" || v.tipo === "saldo";
      var li = el("li");
      // Toda linha abre o editor do tipo dela (guardou, tirou e saldo conferido incluídos).
      var a = el("a", "lan");
      a.setAttribute("href", "#editar/" + encodeURIComponent(v.id));
      a.setAttribute("data-tipo", v.tipo);
      a.setAttribute("data-foco", "lan:" + v.id);
      a.addEventListener("click", function (e) { if (e && e.preventDefault) e.preventDefault(); env.editar(v.id); });
      var circulo = el("span", "lan-ic");
      circulo.setAttribute("aria-hidden", "true");
      circulo.appendChild(ic(fatura ? "i-cartao" : v.tipo === "guardou" ? "i-guardar" : v.tipo === "tirou" ? "i-tirar" : v.tipo === "saldo" ? "i-ok" : v.tipo === "entrou" ? "i-entrou" : "i-saiu"));
      var txt = el("div", "lan-txt");
      txt.appendChild(el("p", "lan-titulo", v.titulo));
      if (movimento) {
        txt.appendChild(linhaLugar(v));
      } else if (fatura) {
        if (v.cartao) txt.appendChild(linhaCartao(v.cartao));
      } else {
        txt.append(el("p", "lan-sub lan-cat", v.categoria), el("p", "lan-sub lan-pes", v.pessoa));
        if (v.cartao) txt.appendChild(linhaCartao(v.cartao));
      }
      var d = el("span", "din");
      d.setAttribute("data-tipo", v.tipo);
      d.append(el("span", "din-p", v.palavra), el("b", "din-v", v.valor === "—" ? "—" : v.sinal + v.valor));
      a.append(circulo, txt, d);
      var alterado = v.estado === "enviado" && marcas && marcas.tem(v.id);
      if (alterado) {
        // Esperando envio e Não enviado são a verdade mais urgente: só quando já está enviado a marca de alterado aparece.
        var mo = el("div", "lan-marca");
        var po = el("span", "marca");
        po.setAttribute("data-tom", "outro");
        po.append(ic("i-trocar"), "Alterado no outro celular");
        mo.appendChild(po);
        a.appendChild(mo);
      } else if (v.estado !== "enviado") {
        var m = el("div", "lan-marca");
        var pil = el("span", "marca");
        pil.setAttribute("data-tom", v.estado === "esperando" ? "esperando" : "nao-enviado");
        pil.append(ic(v.estado === "esperando" ? "i-espera" : "i-atencao"), v.estado === "esperando" ? "Esperando envio" : "Não enviado");
        m.appendChild(pil);
        if (v.estado === "nao_enviado" && v.motivo) m.appendChild(el("p", "lan-motivo", v.motivo));
        a.appendChild(m);
      }
      li.appendChild(a);
      return li;
    }
    // Acrescenta linhas à lista sem mexer nas que já estão; a mesma data continua no mesmo cartão.
    function anexar(ref, itens) {
      var primeira = null;
      itens.forEach(function (l) {
        if (!ref.ul || ref.data !== l.data) {
          var ul = el("ul");
          var sec = el("section", "dia");
          var h = el("h3", "", Dat.paraTela(l.data) || "Sem data");
          h.setAttribute("id", "dia-" + ref.n++);
          sec.setAttribute("aria-labelledby", h.getAttribute("id"));
          sec.append(h, ul);
          ref.wrap.appendChild(sec);
          ref.ul = ul;
          ref.data = l.data;
        }
        var li = linhaDom(l);
        ref.ul.appendChild(li);
        if (!primeira) primeira = li.children[0];
      });
      return primeira;
    }
    function atualizarMais(ref) {
      var falta = ref.lista.length - ref.ate;
      ref.mais.textContent = "";
      if (falta <= 0) return;
      ref.mais.append(el("p", "apoio", Ver_.mostrando(ref.ate, ref.lista.length)));
      var b = botao("btn-sec", Ver_.maisRotulo(falta, Ver_.TAMANHO), function () { mostrarMais(); });
      b.setAttribute("data-foco", "mais");
      ref.mais.appendChild(b);
    }
    function mostrarMais() {
      var ref = lanRef;
      if (!ref) return;
      var antes = ref.ate;
      ate = Ver_.maisUm(antes, Ver_.TAMANHO);
      var pag = Ver_.paginar(ref.lista, ate, Ver_.TAMANHO);
      ref.ate = pag.itens.length;
      var primeira = anexar(ref, pag.itens.slice(antes));
      atualizarMais(ref);
      if (primeira && primeira.focus) primeira.focus({ preventScroll: true });
    }
    function limparFiltros() {
      filtro = { categoria: undefined, pessoa: undefined, cartao: undefined };
      ate = Ver_.TAMANHO;
      anunciar.lancamentos = true;
      focoPedido = "filtros";
      desenharLan(null);
    }
    function meta(contagem) {
      var m = el("div", "meta");
      var t = el("div", "meta-txt");
      if (contagem !== null) t.appendChild(el("p", "conta", contagem));
      t.appendChild(el("p", "apoio", Ver_.atualizadoEm(sync.sincronizadoEm)));
      var ocupado = sync.sincronizando;
      var b = botao("btn-atualizar", "", function () { sincronizar(true); });
      b.setAttribute("data-foco", "atualizar");
      if (ocupado) b.setAttribute("aria-busy", "true");
      b.disabled = ocupado || !env.online();
      b.append(ic("i-enviando"), ocupado ? "Atualizando…" : "Atualizar");
      m.append(t, b);
      return m;
    }
    function codigo(valor) { return valor === Ver_.SEM ? SEM_VALOR : valor === Ver_.FATURAS ? FATURAS_VALOR : "n:" + valor; }
    function seletorFiltro(id, rotulo, todas, ops, atualValor, definir) {
      var campo = el("div", "campo");
      var lb = el("label", "", rotulo);
      lb.setAttribute("for", id);
      var s = el("select");
      s.setAttribute("id", id);
      s.setAttribute("data-foco", id);
      s.setAttribute("data-ativo", atualValor !== undefined ? "sim" : "nao");
      var o0 = el("option", "", todas); o0.value = "";
      s.appendChild(o0);
      ops.forEach(function (o) {
        var op = el("option", "", o.rotulo + " (" + o.quantidade + ")");
        op.value = codigo(o.valor);
        s.appendChild(op);
      });
      s.value = atualValor === undefined ? "" : codigo(atualValor);
      s.addEventListener("change", function () {
        var v = s.value;
        definir(v === "" ? undefined : v === SEM_VALOR ? Ver_.SEM : v === FATURAS_VALOR ? Ver_.FATURAS : v.slice(2));
        ate = Ver_.TAMANHO;
        anunciar.lancamentos = true;
        focoPedido = id;
        desenharLan(null);
      });
      campo.append(lb, s);
      return campo;
    }

    // Nota no alto: fica enquanto houver lançamentos marcados (só em memória). Entendi limpa todos.
    function pintarNotaLan() {
      var alvo = $("lan-nota");
      if (!alvo) return;
      var tinhaFoco = !!doc.activeElement && !!doc.activeElement.getAttribute && doc.activeElement.getAttribute("data-foco") === "entendi";
      alvo.textContent = "";
      var n = marcas ? marcas.quantidade() : 0;
      if (!n) return;
      var noMes = !!dadosMes && dadosMes.lista.some(function (l) { return marcas.tem(l.id); });
      var caixa = el("div", "res nota-outro");
      var c = el("div");
      c.appendChild(el("b", "", n === 1 ? "1 lançamento foi alterado no outro celular" : n + " lançamentos foram alterados no outro celular"));
      c.appendChild(el("span", "", noMes ? "Os que estão marcados abaixo já mostram o valor mais novo." : "Abra o mês deles para ver o valor mais novo."));
      var acoes = el("div", "res-acoes");
      var b = botao("res-acao", "Entendi", function () {
        marcas.limpar();
        pintarNotaLan();
        var h = $("t-lan");
        if (h && h.focus) h.focus({ preventScroll: true });
      });
      b.setAttribute("data-foco", "entendi");
      acoes.appendChild(b);
      c.appendChild(acoes);
      caixa.append(ic("i-trocar"), c);
      alvo.appendChild(caixa);
      if (tinhaFoco && b.focus) b.focus({ preventScroll: true }); // um redesenho não tira o foco de quem está no botão
    }

    function desenharLan(dir) {
      var d = dadosMes;
      if (!d) return;
      var f = Ver_.filtrar(d.lista, filtro);
      var t = Ver_.totais(f, d.mes);
      var raiz = el("div", dir ? "troca-" + dir : "");
      raiz.appendChild(seletorMes());
      lanRef = null;
      var contagem = Ver_.contagem(f.length);
      if (d.lista.length === 0) {
        var v = Ver_.vazio(contextoVazio(d, false));
        if (v.tipo === "mes") raiz.appendChild(meta(null));
        raiz.appendChild(cartao(v, limparFiltros));
      } else {
        var ops = Ver_.opcoesDeFiltro(d.lista);
        var cart = Ver_.opcoesDeCartao(d.lista, d.cartoesConfig);
        var nAtivos = (filtro.categoria !== undefined ? 1 : 0) + (filtro.pessoa !== undefined ? 1 : 0) + (filtro.cartao !== undefined ? 1 : 0);
        var barra = el("div", "filtros-barra");
        var tog = botao("filtros-toggle", "Filtros", function () { painel = !painel; focoPedido = "filtros"; desenharLan(null); });
        tog.setAttribute("aria-expanded", String(painel));
        tog.setAttribute("aria-controls", "filtros-painel");
        tog.setAttribute("data-ativo", nAtivos ? "sim" : "nao");
        tog.setAttribute("data-foco", "filtros");
        if (nAtivos) tog.appendChild(el("span", "filtros-n", nAtivos === 1 ? "1 ativo" : nAtivos + " ativos"));
        tog.appendChild(ic("i-seta-baixo"));
        barra.appendChild(tog);
        if (nAtivos) barra.appendChild(botao("btn-limpar", "Limpar filtros", limparFiltros));
        raiz.appendChild(barra);
        var pn = el("div", "filtros-painel");
        pn.setAttribute("id", "filtros-painel");
        pn.hidden = !painel;
        pn.append(
          seletorFiltro("f-cat", "Categoria", "Todas as categorias", ops.categorias, filtro.categoria, function (v) { filtro.categoria = v; }),
          seletorFiltro("f-pes", "Pessoa", "Todas as pessoas", ops.pessoas, filtro.pessoa, function (v) { filtro.pessoa = v; }));
        if (cart.mostrar) pn.appendChild(seletorFiltro("f-car", "Cartão", "Todos", cart.opcoes, filtro.cartao, function (v) { filtro.cartao = v; }));
        raiz.appendChild(pn);
        if (nAtivos && !painel) {
          var ativos = el("p", "filtros-ativos", "Mostrando só: ");
          var nomeDe = function (valor, sem) { return valor === Ver_.SEM ? sem : valor; };
          var partes = [];
          if (filtro.categoria !== undefined) partes.push("categoria " + nomeDe(filtro.categoria, "Sem categoria"));
          if (filtro.pessoa !== undefined) partes.push("pessoa " + nomeDe(filtro.pessoa, "Sem pessoa"));
          if (filtro.cartao !== undefined) partes.push(filtro.cartao === Ver_.FATURAS ? "pagamentos de fatura" : filtro.cartao === Ver_.SEM ? "fora do cartão" : "cartão " + filtro.cartao);
          partes.forEach(function (txt, k) {
            if (k > 0) ativos.append(" e ");
            ativos.appendChild(el("b", "", txt));
          });
          raiz.appendChild(ativos);
        }
        raiz.appendChild(blocoTotais(t));
        var textoNota = Ver_.notaDeMovimentos(f);
        if (textoNota) {
          var nf = el("p", "res-nota");
          nf.append(ic("i-info"), textoNota);
          raiz.appendChild(nf);
        }
        raiz.appendChild(meta(contagem));
        if (f.length === 0) {
          raiz.appendChild(cartao(Ver_.vazio(contextoVazio(d, true)), limparFiltros));
        } else {
          var pag = Ver_.paginar(f, ate, Ver_.TAMANHO);
          var ref = { lista: f, ate: pag.itens.length, wrap: el("div"), mais: el("div", "mais"), ul: null, data: null, n: 0 };
          ref.wrap.setAttribute("id", "lista");
          anexar(ref, pag.itens);
          raiz.append(ref.wrap, ref.mais);
          atualizarMais(ref);
          lanRef = ref;
        }
      }
      colocar($("lan-conteudo"), raiz);
      pintarNotaLan();
      desenhado.lancamentos = d.id + ":" + versao;
      voz("lancamentos", Ver_.nomeDoMes(d.mes) + ", " + contagem);
    }

    // ---- cartões: em aberto de cada um (Início e Resumo) ----
    // Nunca desenha "R$ 0,00" falso: sem nada sincronizado e sem lançamentos, o bloco não existe.
    function dadosDeCartoes(d, ate) {
      if (!d.lig.sincronizou && d.todos.length === 0) return null;
      var c = Ver_.cartoes(d.todos, ate, d.cartoesConfig);
      return c.linhas.length ? c : null;
    }
    function nomeDoCartao(nome) {
      var p = el("p", "cart-nome");
      p.append(ic("i-cartao"), el("span", "", nome));
      return p;
    }
    function blocoCartoesIni(d) {
      var c = dadosDeCartoes(d, env.hoje());
      if (!c) return null;
      var sec = el("section", "painel cart");
      var h = el("h2", "", "Cartões"); h.setAttribute("id", "h-cart");
      sec.setAttribute("aria-labelledby", "h-cart");
      var apoio = !env.online() ? "Sem internet. Os valores são da última atualização e do que você anotou aqui."
        : Ver_.pendentes(d.todos).texto ? "Já conta o que está esperando envio."
          : "O que ainda falta pagar em cada cartão.";
      sec.append(h, el("p", "apoio", apoio));
      var ul = el("ul");
      c.linhas.forEach(function (e, i) {
        var li = el("li");
        var linha = el("div", "cart-linha");
        linha.append(nomeDoCartao(e.cartao), dinAberto(e));
        if (e.frase) linha.appendChild(el("p", "cart-frase", e.frase));
        var acoes = el("div", "cart-acoes");
        if (e.botao) {
          var b = botao("btn-sec", "Paguei a fatura", function () { if (env.pagarFatura) env.pagarFatura(e.cartao); });
          b.setAttribute("aria-label", "Paguei a fatura do " + e.cartao);
          b.setAttribute("data-foco", "pagar:" + i);
          acoes.appendChild(b);
        }
        // "Conferir saldo": só de cartão da Config (o formulário não consegue oferecer os outros). Pago a mais: convite cheio.
        if (env.conferir && d.cartoesConfig.indexOf(e.cartao) >= 0) {
          var cheio = e.tipo === "pago_a_mais";
          var cf = botao(cheio ? "btn-sec" : "btn-link", "", function () { env.conferir({ tipo: "cartao", nome: e.cartao }); });
          if (!cheio) cf.appendChild(ic("i-ok"));
          cf.append("Conferir saldo");
          cf.setAttribute("aria-label", "Conferir saldo do " + e.cartao);
          cf.setAttribute("data-foco", "conferir-cartao:" + i);
          acoes.appendChild(cf);
        }
        if (acoes.children.length) linha.appendChild(acoes);
        li.appendChild(linha);
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      if (c.total) {
        var tot = el("div", "cart-total");
        var nome = el("p", "cart-nome"); nome.appendChild(el("span", "", "Total em aberto"));
        tot.append(nome, dinAberto(c.total));
        sec.appendChild(tot);
      }
      return sec;
    }
    // ---- faixa de aviso de vencimento (Início, #122): acima do cartão "Contas a pagar"; sem conta para avisar, não existe ----
    function faixaVencimento(r) {
      if (!r || !Array.isArray(r.lista)) return null;
      var hoje = env.hoje();
      var tx = Con.textoDaFaixa(Con.paraAvisar(r.lista, hoje, r.diasAviso), hoje);
      if (!tx) return null;
      var a = link("faixa-venc", "#contas", "", function () { if (env.contas) env.contas(); });
      a.setAttribute("data-tom", tx.tom);
      a.setAttribute("data-foco", "faixa-venc");
      a.setAttribute("aria-label", tx.rotulo);
      var corpo = el("div", "faixa-venc-txt");
      if (tx.n === 1) {
        var tit = el("p", "faixa-venc-tit");
        tit.append(el("span", "faixa-venc-nome", tx.nome), el("span", "faixa-venc-prazo", ": " + tx.prazo));
        corpo.appendChild(tit);
      } else {
        corpo.appendChild(el("p", "faixa-venc-tit", tx.titulo));
      }
      corpo.appendChild(el("p", "faixa-venc-sub", tx.sub));
      a.append(ic(tx.tom === "alerta" ? "i-atencao" : "i-espera", "faixa-venc-ic"), corpo, ic("i-seta-dir", "faixa-venc-seta"));
      return a;
    }
    // ---- grade de cartões do Início (#159): cada um é um link inteiro tocável para uma tela; o apoio vem do que o Início já calcula ----
    function cartaoIn(href, classe, rotulo, apoio, icone, aoClicar, foco) {
      var a = link("cartao-in" + (classe ? " " + classe : ""), href, "", aoClicar);
      if (foco) a.setAttribute("data-foco", foco);
      var txt = el("div", "cartao-in-txt");
      txt.appendChild(el("p", "cartao-in-tit", rotulo));
      if (apoio.marca) {
        var m = el("div");
        var pil = el("span", "contas-marca");
        pil.append(ic("i-atencao"), apoio.marca);
        m.appendChild(pil);
        txt.appendChild(m);
      }
      if (apoio.sub) txt.appendChild(el("p", "cartao-in-sub", apoio.sub));
      var circulo = el("span", "cartao-in-ic");
      circulo.appendChild(ic(icone));
      a.append(circulo, txt);
      return a;
    }
    function painelOnde(d) {
      return Res.painel(d.todos, d.opcoes, env.hoje(), { sincronizou: d.lig.sincronizou, online: env.online(), esperando: !!Ver_.pendentes(d.todos).texto });
    }
    function gradeDeCartoes(d) {
      var grade = el("div", "cartoes");
      // Contas a pagar: o texto de apoio é o de sempre (Con.textoEntrada)
      grade.appendChild(cartaoIn("#contas", "contas-entrada", "Contas a pagar", Con.textoEntrada(d.contas || { vencidas: 0, aPagar: 0, pagas: 0, lida: false }), "i-contas", function () { if (env.contas) env.contas(); }, "contas"));
      // Mês: abre a última visão usada (Lançamentos ou Resumo); o apoio é o gasto do mês atual
      var rotaMes = Rot.rotaDoMes(env.ultimaChave ? env.ultimaChave() : null);
      var apoioMes = d.lista.length === 0 ? "Nenhum lançamento" : "Gasto " + Ver_.reais(Ver_.totais(d.lista, d.mes).saiu);
      grade.appendChild(cartaoIn("#" + rotaMes, "", "Mês", { sub: apoioMes }, "i-resumo", function () { env.ir(rotaMes); }, "mes"));
      // Reserva: o total guardado que o painel já mostra; sem saldo conferido, um convite que continua tocável
      var p = painelOnde(d);
      var apoioRes = p && p.guardado && p.guardado.centavos !== 0 ? p.guardado.palavra + " " + p.guardado.valor : "Ver a reserva";
      grade.appendChild(cartaoIn("#reserva", "", "Reserva", { sub: apoioRes }, "i-caixinha", function () { if (env.reserva) env.reserva(); }, "reserva-cartao"));
      // Notas e Compromissos: só quando a tela deixar de ser "Em breve" (Rotas.emBreve)
      if (!Rot.emBreve("notas")) grade.appendChild(cartaoIn("#notas", "", "Notas", { sub: "Abrir as notas" }, "i-arquivo", function () { env.ir("notas"); }, "notas"));
      if (!Rot.emBreve("compromissos")) grade.appendChild(cartaoIn("#compromissos", "cartao-in--largo", "Compromissos", { sub: "Ver a agenda" }, "i-agenda", function () { env.ir("compromissos"); }, "compromissos"));
      return grade;
    }

    // ---- painel "Onde está o dinheiro" (Início, #39 P5): conta, guardado, cartões e patrimônio ----
    function dinOnde(estado, palavra, valor, comIcone) {
      var sp = el("span", "din");
      sp.setAttribute("data-tipo", estado === "negativa" || estado === "negativo" ? "alerta" : "neutro");
      var p = el("span", "din-p");
      if (comIcone) p.appendChild(ic("i-atencao", "ic-alerta"));
      p.append(palavra);
      sp.append(p, el("b", "din-v", valor));
      return sp;
    }
    function textoOnde(rotulo, sub) {
      var w = el("div");
      w.append(el("p", "onde-rot", rotulo), el("p", "onde-sub", sub));
      return w;
    }
    function botaoConferir(cheio, rotuloAria, lugar, chave) {
      var b = botao(cheio ? "btn-sec" : "btn-link", "", function () { if (env.conferir) env.conferir(lugar); });
      if (!cheio) b.appendChild(ic("i-ok"));
      b.append("Conferir saldo");
      b.setAttribute("aria-label", rotuloAria);
      b.setAttribute("data-foco", chave);
      return b;
    }
    function blocoOnde(d) {
      var p = painelOnde(d);
      if (!p) return null;
      var sec = el("section", "painel onde");
      var h = el("h2", "", "Onde está o dinheiro"); h.setAttribute("id", "h-onde");
      sec.setAttribute("aria-labelledby", "h-onde");
      sec.append(h, el("p", "apoio", p.apoio));
      var ul = el("ul");
      // Conta: sem número até o primeiro saldo conferido (sem ponto de partida a soma não é o saldo do banco).
      var c = p.conta, li = el("li"), linha = el("div", "onde-linha");
      linha.appendChild(textoOnde("Conta", c.sub));
      if (c.conferida) linha.appendChild(dinOnde(c.estado, c.palavra, c.valor, c.estado === "negativa"));
      if (c.frase) linha.appendChild(el("p", "onde-frase", c.frase));
      linha.appendChild(botaoConferir(c.botaoCheio, "Conferir saldo da conta", { tipo: "conta", nome: "" }, "conferir-conta"));
      li.appendChild(linha);
      ul.appendChild(li);
      if (p.guardado) {
        var g = p.guardado, lg = el("li"), a = el("a", "onde-linha");
        a.setAttribute("href", "#reserva");
        a.setAttribute("data-foco", "reserva");
        a.addEventListener("click", function (e) { if (e && e.preventDefault) e.preventDefault(); if (env.reserva) env.reserva(); });
        a.append(textoOnde("Guardado nas caixinhas", g.sub), dinOnde(g.estado, g.palavra, g.valor, g.estado === "negativo"));
        a.appendChild(ic("i-seta-dir", "onde-seta"));
        lg.appendChild(a);
        ul.appendChild(lg);
      }
      if (p.aberto) {
        var ab = p.aberto, la = el("li"), ca = el("div", "onde-linha");
        ca.append(textoOnde("Em aberto nos cartões", ab.sub), dinOnde("aberto", ab.palavra, ab.valor, false));
        la.appendChild(ca);
        ul.appendChild(la);
      }
      var pt = p.patrimonio, lp = el("li", "fim"), cp = el("div", "onde-linha onde-total");
      cp.appendChild(textoOnde("Patrimônio", pt.sub));
      if (pt.mostrar) cp.appendChild(dinOnde(pt.estado, pt.palavra, pt.valor, pt.estado === "negativo"));
      lp.appendChild(cp);
      ul.appendChild(lp);
      sec.appendChild(ul);
      if (p.notaCaixinha) {
        var n = el("p", "res-nota");
        n.append(ic("i-info"), p.notaCaixinha);
        sec.appendChild(n);
      }
      return sec;
    }

    // Bloco "Conta" do Resumo (#72): começou com / terminou com (ou hoje). Os números vêm de Somas.contaNoMes sobre todos os lançamentos.
    function blocoConta(d, comLancamentos) {
      var c = Ver_.conta(Som.contaNoMes(d.todos, d.mes, env.hoje()), comLancamentos, env.hoje());
      var sec = el("section", "painel onde");
      var h = el("h2", "", "Conta"); h.setAttribute("id", "h-conta");
      sec.setAttribute("aria-labelledby", "h-conta");
      sec.appendChild(h);
      if (!c.tem) { sec.appendChild(el("p", "onde-frase", c.frase)); return sec; }
      sec.appendChild(el("p", "apoio", c.apoio));
      var ul = el("ul");
      c.linhas.forEach(function (x, i) {
        var li = el("li", i === c.linhas.length - 1 ? "fim" : ""), linha = el("div", "onde-linha");
        linha.append(textoOnde(x.rotulo, x.sub), dinOnde(x.estado, x.palavra, x.valor, x.estado === "negativa"));
        li.appendChild(linha);
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      [c.aviso, c.soma].forEach(function (t) {
        if (!t) return;
        var n = el("p", "res-nota");
        n.append(ic("i-info"), t);
        sec.appendChild(n);
      });
      return sec;
    }

    function secaoCartoesRes(d) {
      var c = dadosDeCartoes(d, Dat.dosDoMes(d.mes).ate);
      if (!c) return null;
      var sec = el("section", "res-bloco");
      var h = el("h2", "", "Cartões"); h.setAttribute("id", "h-cart-res");
      sec.setAttribute("aria-labelledby", "h-cart-res");
      sec.append(h, el("p", "apoio", "O que ainda falta pagar em cada cartão no fim de " + Ver_.nomeDoMes(d.mes) + "."));
      var pago = Som.faturasDoMes(d.lista, d.mes);
      if (pago > 0) {
        var n = el("p", "res-nota");
        n.append(ic("i-info"), "Neste mês você pagou " + Ver_.reais(pago) + " de fatura. Isso não conta como gasto.");
        sec.appendChild(n);
      }
      var ul = el("ul");
      function linhaRes(nome, e, total) {
        var li = el("li");
        var topo = el("div", "rl-topo");
        var nm = total ? el("p", "rl-nome") : nomeDoCartao(e.cartao);
        if (total) nm.appendChild(el("strong", "", "Total em aberto")); else nm.className = "rl-nome cart-nome";
        var vals = el("div", "rl-valores");
        vals.appendChild(dinAberto(e));
        topo.append(nm, vals);
        li.appendChild(topo);
        ul.appendChild(li);
      }
      c.linhas.forEach(function (e) { linhaRes(e.cartao, e, false); });
      if (c.total) linhaRes("", c.total, true);
      sec.appendChild(ul);
      return sec;
    }

    // ---- Resumo ----
    function bloco(idH, titulo, apoio, linhas, chave, vazioRotulo) {
      var sec = el("section", "res-bloco");
      var h = el("h2", "", titulo); h.setAttribute("id", idH);
      sec.setAttribute("aria-labelledby", idH);
      sec.append(h, el("p", "apoio", apoio));
      var maior = 0;
      linhas.forEach(function (x) { if (x.saiu > maior) maior = x.saiu; });
      var ul = el("ul");
      linhas.forEach(function (x) {
        var li = el("li");
        var topo = el("div", "rl-topo");
        var vals = el("div", "rl-valores");
        if (x.saiu > 0) vals.appendChild(din("saiu", x.saiu));
        if (x.entrou > 0) vals.appendChild(din("entrou", x.entrou));
        if (x.saiu <= 0 && x.entrou <= 0) {
          var traco = el("span", "din-nada", "—"); traco.setAttribute("aria-hidden", "true");
          vals.append(traco, el("span", "so-leitor", "Sem entrada nem saída"));
        }
        topo.append(el("p", "rl-nome", x[chave] === "" ? vazioRotulo : x[chave]), vals);
        li.appendChild(topo);
        if (x.saiu > 0) {
          var barra = el("div", "rl-barra"); barra.setAttribute("aria-hidden", "true");
          var i = el("i"); i.style.width = Math.round(x.saiu / maior * 100) + "%";
          barra.appendChild(i); li.appendChild(barra);
        }
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      return sec;
    }
    function desenharRes(dir) {
      var d = dadosMes;
      if (!d) return;
      var raiz = el("div", dir ? "troca-" + dir : "");
      raiz.appendChild(seletorMes());
      var texto;
      if (d.lista.length === 0) {
        var vz = Ver_.vazio(contextoVazio(d, false));
        raiz.appendChild(cartao(vz, limparFiltros));
        if (vz.tipo === "mes") raiz.appendChild(blocoConta(d, false));
        var cv = secaoCartoesRes(d);
        if (cv) raiz.appendChild(cv);
        texto = Ver_.nomeDoMes(d.mes) + ": nenhum lançamento";
      } else {
        var r = Som.resumoDoMes(d.lista, d.mes);
        raiz.appendChild(blocoTotais(r));
        raiz.appendChild(blocoConta(d, true));
        var cr = secaoCartoesRes(d);
        if (cr) raiz.appendChild(cr);
        raiz.appendChild(bloco("h-cat", "Para onde foi", "O que entrou e saiu em cada categoria. A barra mostra o que saiu.", r.porCategoria, "categoria", "Sem categoria"));
        raiz.appendChild(bloco("h-pes", "Quem gastou", "O que entrou e saiu por pessoa. A barra mostra o que saiu.", r.porPessoa, "pessoa", "Sem pessoa"));
        if (r.ignorados > 0) {
          var n = el("p", "res-nota");
          n.append(ic("i-info"), r.ignorados === 1 ? "1 lançamento não entrou na conta porque está fora do formato." : r.ignorados + " lançamentos não entraram na conta porque estão fora do formato.");
          raiz.appendChild(n);
        }
        texto = Ver_.nomeDoMes(d.mes) + ": entrou " + Ver_.dinheiro("entrou", r.entrou) + ", saiu " + Ver_.dinheiro("saiu", r.saiu) + ", saldo " + Ver_.dinheiro("saldo", r.saldo);
      }
      colocar($("res-conteudo"), raiz);
      desenhado.resumo = d.id + ":" + versao;
      voz("resumo", texto);
    }

    // ---- Início ----
    function desenharIni() {
      var d = dadosIni;
      if (!d) return;
      var raiz = el("div");
      var faixaV = faixaVencimento(d.contas);
      if (faixaV) raiz.appendChild(faixaV);
      raiz.appendChild(gradeDeCartoes(d));
      raiz.appendChild(el("h2", "inicio-mes", Ver_.nomeDoMes(d.mes)));
      if (d.lista.length === 0) {
        var v = Ver_.vazio(contextoVazio(d, false));
        if (v.tipo === "mes") v = { tipo: "mes", titulo: "Ainda não há lançamentos em " + Ver_.nomeDoMes(d.mes), apoio: "Toque no + para anotar o primeiro gasto ou a primeira entrada.", icone: "i-vazio", status: true, acao: null };
        raiz.appendChild(cartao(v));
      } else {
        var t = Ver_.totais(d.lista, d.mes);
        var dl = el("dl", "painel");
        dl.append(dinLinha("entrou", t.entrou), dinLinha("saiu", t.saiu), dinSaldo(t.saldo, true, "Saldo do mês"));
        raiz.appendChild(dl);
        raiz.appendChild(el("p", "apoio", "Entrou menos saiu neste mês. Não conta fatura nem caixinhas."));
        var p = Ver_.pendentes(d.lista);
        if (p.texto) {
          var a = link("pend", "#lancamentos", "", function () { env.ir("lancamentos"); });
          var sp = el("span", "", p.texto);
          a.append(ic("i-espera"), sp, ic("i-seta-dir"));
          raiz.appendChild(a);
        }
      }
      var onde = blocoOnde(d);
      if (onde) raiz.appendChild(onde);
      var cini = blocoCartoesIni(d);
      if (cini) raiz.appendChild(cini);
      colocar($("ini-conteudo"), raiz);
      $("ini-conteudo").removeAttribute("aria-busy");
      desenhado.inicio = d.id + ":" + versao;
    }

    // ---- quando ler e quando desenhar ----
    function velho(d) { return !d || d.versao !== versao; }
    // Garante os dados da aba e a desenha. forcar: relê mesmo que o dado pareça novo.
    function ensure(aba, dir, forcar) {
      if (!ctx || ABAS.indexOf(aba) < 0) return Promise.resolve();
      if (aba === "inicio") {
        var velhoIni = forcar || velho(dadosIni) || dadosIni.mes !== Dat.mes(env.hoje());
        if (!velhoIni && desenhado.inicio === dadosIni.id + ":" + versao) return Promise.resolve();
        return (velhoIni ? lerInicio() : Promise.resolve(dadosIni)).then(function () { if (atual === "inicio") desenharIni(); });
      }
      var m = mesAtual();
      var desatualizado = forcar || velho(dadosMes) || dadosMes.mes !== m;
      var jaDesenhado = dadosMes && desenhado[aba] === dadosMes.id + ":" + versao;
      if (!desatualizado && jaDesenhado) return Promise.resolve();
      var leitura = desatualizado ? lerMes(m) : Promise.resolve(dadosMes);
      return leitura.then(function () {
        if (atual === aba) (aba === "lancamentos" ? desenharLan : desenharRes)(dir || null);
      });
    }
    function redesenharSemLer() {
      if (atual === "inicio") desenharIni();
      else if (atual === "lancamentos") desenharLan(null);
      else if (atual === "resumo") desenharRes(null);
    }
    // Um só temporizador para avisos e sincronia; se algum pedido precisa reler, relê.
    function agendarRedesenho(reler) {
      if (reler) releitura = true;
      if (timer !== null) return;
      timer = agendar(function () {
        var rel = releitura; timer = null; releitura = false;
        if (ABAS.indexOf(atual) < 0) return;
        if (rel) ensure(atual); else redesenharSemLer();
      }, ATRASO);
    }
    function aoAviso(evento) {
      if (AVISOS.indexOf(evento) < 0) return;
      versao++;
      if (ABAS.indexOf(atual) < 0 || !ctx) return; // fora das telas de ver: relê quando voltar
      agendarRedesenho(true);
    }

    // ---- o que o app chama ----
    function mostrar(id) {
      atual = id;
      if (ABAS.indexOf(id) < 0) {
        if (timer !== null) { cancelar(timer); timer = null; }
        return Promise.resolve();
      }
      sincronizar(false);
      return ensure(id);
    }
    function voltou() {
      if (ABAS.indexOf(atual) < 0) return Promise.resolve();
      sincronizar(false);
      return ensure(atual);
    }
    function rede() { if (ABAS.indexOf(atual) >= 0 && desenhado[atual] !== null) redesenharSemLer(); }
    function parar() {
      desligar.forEach(function (f) { f(); });
      desligar = [];
      if (timer !== null) { cancelar(timer); timer = null; }
    }

    if (marcas && marcas.aoMudar) {
      desligar.push(marcas.aoMudar(function () { if (atual === "lancamentos" && desenhado.lancamentos !== null) agendarRedesenho(false); }));
    }

    env.pronto.then(function (c) {
      if (!c) return;
      ctx = c;
      desligar.push(Fil.aoMudar(aoAviso));
      desligar.push(Con.aoMudar(function () { aoAviso("terminou"); })); // a cópia das contas mudou: o cartão do Início acompanha
      if (c.controle && typeof c.controle.aoSincronia === "function") {
        desligar.push(c.controle.aoSincronia(aplicarSync));
        if (typeof c.controle.sincronia === "function") aplicarSync(c.controle.sincronia());
      }
      ensure(atual);
    }).catch(function () {});

    return { mostrar: mostrar, voltou: voltou, rede: rede, sincronizar: sincronizar, parar: parar };
  }

  return { criar: criar };
})();
if (typeof module !== "undefined") module.exports = TelaVer;
