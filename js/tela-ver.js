// Zelo: as telas de ver (#19, partes B, C e D): Lançamentos, Resumo e Início. Só desenho e ligação:
// o que mostrar vem de Ver, as somas são de Somas, a leitura é de Lancamentos. Todo texto da planilha ou da pessoa
// entra com textContent, nunca como HTML. Nada vai para console, localStorage nem URL. No navegador vira o objeto global TelaVer.
var TelaVer = (function () {
  var Ver_ = typeof Ver !== "undefined" ? Ver : require("./ver.js");
  var Lan = typeof Lancamentos !== "undefined" ? Lancamentos : require("./lancamentos.js");
  var Som = typeof Somas !== "undefined" ? Somas : require("./somas.js");
  var Dat = typeof Datas !== "undefined" ? Datas : require("./datas.js");
  var Fil = typeof Fila !== "undefined" ? Fila : require("./fila.js");

  var SVG_NS = "http://www.w3.org/2000/svg";
  var CINCO_MIN = 5 * 60 * 1000;
  var ATRASO = 150; // ms: vários avisos seguidos viram um redesenho só
  var AVISOS = ["criou", "editou", "recebeu", "terminou", "falhou", "alterado_no_outro"];
  var ABAS = ["inicio", "lancamentos", "resumo"];
  var SEM_VALOR = "__sem__";

  // env: { pronto: Promise<{ db, controle } | null>, hoje(), online(), agora(), agendar(fn, ms), cancelar(t), doc,
  //        ir(aba), novo(), editar(id) }
  function criar(env) {
    var doc = env.doc || document;
    var agora = env.agora || function () { return new Date().getTime(); };
    var agendar = env.agendar || function (fn, ms) { return setTimeout(fn, ms); };
    var cancelar = env.cancelar || function (t) { clearTimeout(t); };
    var $ = function (id) { return doc.getElementById(id); };

    var ctx = null;                 // { db, controle } quando o banco abriu
    var atual = null;               // aba à vista
    var mes = null;                 // mês escolhido (Lançamentos e Resumo); só em memória
    var filtro = { categoria: undefined, pessoa: undefined };
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
    function dinSaldo(centavos, comIcone) {
      var s = Ver_.saldo(centavos);
      var d = el("div", "din--linha din--saldo");
      d.setAttribute("data-sinal", s.sinal);
      var p = el("dd", "din-p");
      if (comIcone) p.appendChild(ic(s.sinal === "neg" ? "i-atencao" : "i-ok"));
      p.append(s.palavra);
      d.append(el("dt", "din-rot", "Saldo"), el("dd", "din-v", s.valor), p);
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
      return Promise.all([Lan.listar(ctx.db, m), Lan.todosVisiveis(ctx.db), lerLigacao()]).then(function (v) {
        if (minha !== geracao) return dadosMes; // chegou atrasada: vale a leitura mais nova
        dadosMes = { id: ++contador, mes: m, versao: v0, lista: v[0], todos: v[1], lig: v[2] };
        return dadosMes;
      });
    }
    function lerInicio() {
      var m = Dat.mes(env.hoje());
      var v0 = versao;
      return Promise.all([Lan.listar(ctx.db, m), lerLigacao()]).then(function (v) {
        dadosIni = { id: ++contador, mes: m, versao: v0, lista: v[0], lig: v[1] };
        return dadosIni;
      });
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
      filtro = { categoria: undefined, pessoa: undefined };
      ate = Ver_.TAMANHO;
      painel = false;
      focoPedido = passo < 0 ? "mes-ant" : "mes-seg";
      anunciar[atual] = true;
      ultimaVoz[atual] = "";
      ensure(atual, passo < 0 ? "esq" : "dir", true);
    }

    // ---- Lançamentos ----
    function linhaDom(l) {
      var v = Ver_.linha(l);
      var li = el("li");
      var a = el("a", "lan");
      a.setAttribute("href", "#editar/" + encodeURIComponent(v.id));
      a.setAttribute("data-tipo", v.tipo);
      a.setAttribute("data-foco", "lan:" + v.id);
      a.addEventListener("click", function (e) { if (e && e.preventDefault) e.preventDefault(); env.editar(v.id); });
      var circulo = el("span", "lan-ic");
      circulo.setAttribute("aria-hidden", "true");
      circulo.appendChild(ic(v.tipo === "entrou" ? "i-entrou" : "i-saiu"));
      var txt = el("div", "lan-txt");
      txt.append(el("p", "lan-titulo", v.titulo), el("p", "lan-sub lan-cat", v.categoria), el("p", "lan-sub lan-pes", v.pessoa));
      var d = el("span", "din");
      d.setAttribute("data-tipo", v.tipo);
      d.append(el("span", "din-p", ROTULO[v.tipo]), el("b", "din-v", v.valor === "—" ? "—" : v.sinal + v.valor));
      a.append(circulo, txt, d);
      if (v.estado !== "enviado") {
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
      filtro = { categoria: undefined, pessoa: undefined };
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
        op.value = o.valor === Ver_.SEM ? SEM_VALOR : "n:" + o.valor;
        s.appendChild(op);
      });
      s.value = atualValor === undefined ? "" : atualValor === Ver_.SEM ? SEM_VALOR : "n:" + atualValor;
      s.addEventListener("change", function () {
        var v = s.value;
        definir(v === "" ? undefined : v === SEM_VALOR ? Ver_.SEM : v.slice(2));
        ate = Ver_.TAMANHO;
        anunciar.lancamentos = true;
        focoPedido = id;
        desenharLan(null);
      });
      campo.append(lb, s);
      return campo;
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
        var nAtivos = (filtro.categoria !== undefined ? 1 : 0) + (filtro.pessoa !== undefined ? 1 : 0);
        var barra = el("div", "filtros-barra");
        var tog = botao("filtros-toggle", "Filtros", function () { painel = !painel; focoPedido = "filtros"; desenharLan(null); });
        tog.setAttribute("aria-expanded", String(painel));
        tog.setAttribute("aria-controls", "filtros-painel");
        tog.setAttribute("data-ativo", nAtivos ? "sim" : "nao");
        tog.setAttribute("data-foco", "filtros");
        if (nAtivos) tog.appendChild(el("span", "filtros-n", nAtivos === 1 ? "1 ativo" : "2 ativos"));
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
        raiz.appendChild(pn);
        if (nAtivos && !painel) {
          var ativos = el("p", "filtros-ativos", "Mostrando só: ");
          var nomeDe = function (valor, sem) { return valor === Ver_.SEM ? sem : valor; };
          if (filtro.categoria !== undefined) ativos.appendChild(el("b", "", "categoria " + nomeDe(filtro.categoria, "Sem categoria")));
          if (filtro.categoria !== undefined && filtro.pessoa !== undefined) ativos.append(" e ");
          if (filtro.pessoa !== undefined) ativos.appendChild(el("b", "", "pessoa " + nomeDe(filtro.pessoa, "Sem pessoa")));
          raiz.appendChild(ativos);
        }
        raiz.appendChild(blocoTotais(t));
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
      desenhado.lancamentos = d.id + ":" + versao;
      voz("lancamentos", Ver_.nomeDoMes(d.mes) + ", " + contagem);
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
        raiz.appendChild(cartao(Ver_.vazio(contextoVazio(d, false)), limparFiltros));
        texto = Ver_.nomeDoMes(d.mes) + ": nenhum lançamento";
      } else {
        var r = Som.resumoDoMes(d.lista, d.mes);
        raiz.appendChild(blocoTotais(r));
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
      raiz.appendChild(el("h2", "inicio-mes", Ver_.nomeDoMes(d.mes)));
      if (d.lista.length === 0) {
        var v = Ver_.vazio(contextoVazio(d, false));
        if (v.tipo === "mes") v = { tipo: "mes", titulo: "Ainda não há lançamentos em " + Ver_.nomeDoMes(d.mes), apoio: "Use o botão acima para anotar o primeiro gasto ou a primeira entrada.", icone: "i-vazio", status: true, acao: null };
        raiz.appendChild(cartao(v));
      } else {
        var t = Ver_.totais(d.lista, d.mes);
        var dl = el("dl", "painel");
        dl.append(dinLinha("entrou", t.entrou), dinLinha("saiu", t.saiu), dinSaldo(t.saldo, true));
        raiz.appendChild(dl);
        var p = Ver_.pendentes(d.lista);
        if (p.texto) {
          var a = link("pend", "#lancamentos", "", function () { env.ir("lancamentos"); });
          var sp = el("span", "", p.texto);
          a.append(ic("i-espera"), sp, ic("i-seta-dir"));
          raiz.appendChild(a);
        }
      }
      colocar($("ini-conteudo"), raiz);
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

    env.pronto.then(function (c) {
      if (!c) return;
      ctx = c;
      desligar.push(Fil.aoMudar(aoAviso));
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
