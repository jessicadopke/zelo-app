// Zelo: a tela da Reserva (#39, P5). Mora dentro do Início (#reserva): total guardado, caixinhas com saldo, filtro e histórico.
// Só desenho e ligação: o que mostrar vem de Reserva, as somas são de Somas. Todo nome de caixinha e todo texto da planilha
// entra com textContent, nunca como HTML. Nada vai para console, localStorage nem URL. No navegador vira o objeto global TelaReserva.
var TelaReserva = (function () {
  var Res = typeof Reserva !== "undefined" ? Reserva : require("./reserva.js");
  var Ver_ = typeof Ver !== "undefined" ? Ver : require("./ver.js");
  var Lan = typeof Lancamentos !== "undefined" ? Lancamentos : require("./lancamentos.js");
  var Dat = typeof Datas !== "undefined" ? Datas : require("./datas.js");
  var Opc = typeof Opcoes !== "undefined" ? Opcoes : require("./opcoes.js");
  var Fil = typeof Fila !== "undefined" ? Fila : require("./fila.js");

  var SVG_NS = "http://www.w3.org/2000/svg";
  var TODAS = "__todas__";
  var AVISOS = ["criou", "editou", "recebeu", "terminou", "falhou", "alterado_no_outro"];

  // env: { doc, pronto: Promise<{ db, controle } | null>, hoje(), online(), agora(), sair(), semReserva(),
  //        guardar(caixinha), tirar(caixinha), passar(caixinha), conferir(lugar), editar(id), marcas (opcional) }
  function criar(env) {
    var doc = env.doc || document;
    var $ = function (id) { return doc.getElementById(id); };
    var ctx = null, aberta = false, geracao = 0;
    var dados = null;                // { opcoes, todos, lig }
    var filtro = TODAS, ate = Ver_.TAMANHO;
    var sync = { sincronizando: false, sincronizadoEm: null };
    var desligar = [];
    var marcas = env.marcas || null;
    var ultimaVoz = "";

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
    function nota(icone, texto) {
      var p = el("p", "res-nota");
      p.append(ic(icone), texto);
      return p;
    }

    // ---- leitura ----
    function ler() {
      var minha = ++geracao;
      return Promise.all([Opc.ler(ctx.db), Lan.todosVisiveis(ctx.db), ctx.db.config.obter("proximo_desde"), ctx.db.config.obter("url_ponte"), ctx.db.config.obter("codigo_aparelho")]).then(function (v) {
        if (minha !== geracao) return dados;
        dados = { opcoes: v[0], todos: v[1], lig: { sincronizou: typeof v[2] === "string", configurado: !!(v[3] && v[4]) } };
        return dados;
      });
    }

    // ---- peças ----
    function dinCaixinha(c) {
      var s = el("span", "din");
      s.setAttribute("data-tipo", c.estado === "negativa" ? "alerta" : "guardado");
      var p = el("span", "din-p");
      if (c.estado === "negativa") p.appendChild(ic("i-atencao", "ic-alerta"));
      p.append(c.estado === "negativa" ? "Negativa" : c.estado === "vazia" ? "Vazia" : "Guardado");
      s.append(p, el("b", "din-v", c.valor));
      return s;
    }
    function totalDom(lista) {
      var t = Res.total(lista);
      var sec = el("div");
      var dl = el("dl", "painel reserva-total");
      var neg = t.estado === "negativo";
      var d = el("div", "din--linha din--saldo");
      d.setAttribute("data-sinal", neg ? "alerta" : "pos");
      var p = el("dd", "din-p");
      if (neg) p.appendChild(ic("i-atencao"));
      p.append(neg ? "Negativo" : "Guardado");
      d.append(el("dt", "din-rot", "Total guardado"), el("dd", "din-v", t.valor), p);
      dl.appendChild(d);
      sec.appendChild(dl);
      if (t.inclui_nao_conferida) sec.appendChild(nota("i-info", Res.TEXTOS.total_sem_conferir));
      return sec;
    }
    function acoesDom(lista) {
      var o = Res.opcoesDe(lista);
      // A caixinha do filtro é lida na hora do toque (o filtro muda sem redesenhar os botões).
      var marcada = function () { return filtro !== TODAS ? filtro : undefined; };
      var wrap = el("div", "reserva-acoes");
      if (o.podeGuardar) {
        var g = botao("btn-p", "", function () { env.guardar(marcada()); });
        g.append(ic("i-guardar"), "Guardar");
        g.setAttribute("data-foco", "guardar");
        wrap.appendChild(g);
      }
      if (o.podeTirar) {
        var t = botao("btn-sec", "", function () { env.tirar(marcada()); });
        t.append(ic("i-tirar"), "Tirar");
        t.setAttribute("data-foco", "tirar");
        wrap.appendChild(t);
      }
      if (o.podePassar) {
        var pa = botao("btn-sec passar", "", function () { env.passar(marcada()); });
        pa.append(ic("i-passar"), "Passar para outra caixinha");
        pa.setAttribute("data-foco", "passar");
        wrap.appendChild(pa);
      }
      return wrap;
    }
    function caixinhasDom(lista) {
      var sec = el("section", "painel cart cx");
      var h = el("h2", "", "Suas caixinhas");
      h.setAttribute("id", "rs-h-cx");
      sec.setAttribute("aria-labelledby", "rs-h-cx");
      sec.append(h, el("p", "apoio", "Cada caixinha tem o seu saldo."));
      var ul = el("ul");
      lista.forEach(function (c, i) {
        var li = el("li");
        var linha = el("div", "cart-linha");
        var nome = el("p", "cart-nome");
        nome.append(ic("i-caixinha"), el("span", "", c.nome));
        linha.append(nome, dinCaixinha(c));
        var frase = c.conferido ? "Conferida em " + Dat.paraTela(c.conferido) : "Ainda não conferida com o banco.";
        linha.appendChild(el("p", "cart-frase", frase));
        if (c.estado === "negativa") linha.appendChild(el("p", "cart-frase", Res.TEXTOS.caixinha_negativa));
        if (!c.daConfig) linha.appendChild(el("p", "cart-frase", Res.TEXTOS.caixinha_fora));
        var cheio = c.conferido === null || c.estado === "negativa";
        var b = botao(cheio ? "btn-sec" : "btn-link", "", function () { env.conferir({ tipo: "caixinha", nome: c.nome }); });
        if (!cheio) b.appendChild(ic("i-ok"));
        b.append("Conferir saldo");
        b.setAttribute("aria-label", "Conferir saldo da caixinha " + c.nome);
        b.setAttribute("data-foco", "conferir:" + i);
        linha.appendChild(b);
        li.appendChild(linha);
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      return sec;
    }

    // ---- uma linha de movimento (mesma forma da #19; o toque abre o editor do tipo) ----
    function linhaDom(l, todos) {
      var v = Res.linha(l, todos);
      var li = el("li");
      var a = el("a", "lan");
      a.setAttribute("href", "#editar/" + encodeURIComponent(v.id));
      a.setAttribute("data-tipo", v.tipo);
      a.setAttribute("data-foco", "lan:" + v.id);
      a.addEventListener("click", function (e) { if (e && e.preventDefault) e.preventDefault(); env.editar(v.id); });
      var circulo = el("span", "lan-ic");
      circulo.setAttribute("aria-hidden", "true");
      circulo.appendChild(ic(v.tipo === "guardou" ? "i-guardar" : v.tipo === "tirou" ? "i-tirar" : "i-ok"));
      var txt = el("div", "lan-txt");
      txt.appendChild(el("p", "lan-titulo", v.titulo));
      var sub = el("p", "lan-sub lan-cartao");
      sub.append(ic("i-caixinha"), el("span", "", v.caixinha));
      txt.appendChild(sub);
      if (v.ajuste) txt.appendChild(el("p", "lan-sub lan-ajuste", v.ajuste));
      if (v.dentro) txt.appendChild(el("p", "lan-sub lan-dentro", "Já está dentro do saldo conferido"));
      var d = el("span", "din");
      d.setAttribute("data-tipo", v.tipo);
      d.append(el("span", "din-p", v.palavra), el("b", "din-v", v.valor));
      a.append(circulo, txt, d);
      var alterado = v.estado === "enviado" && marcas && marcas.tem(v.id);
      if (alterado) {
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
    function anexar(ref, itens) {
      var primeira = null;
      itens.forEach(function (l) {
        if (!ref.ul || ref.data !== l.data) {
          var ul = el("ul");
          var sec = el("section", "dia");
          var h = el("h3", "", Dat.paraTela(l.data) || "Sem data");
          h.setAttribute("id", "rs-dia-" + ref.n++);
          sec.setAttribute("aria-labelledby", h.getAttribute("id"));
          sec.append(h, ul);
          ref.wrap.appendChild(sec);
          ref.ul = ul;
          ref.data = l.data;
        }
        var li = linhaDom(l, ref.todos);
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
      var b = botao("btn-sec reserva-mais", Ver_.maisRotulo(falta, Ver_.TAMANHO), function () {
        var antes = ref.ate;
        ate = Ver_.maisUm(antes, Ver_.TAMANHO);
        ref.ate = Ver_.paginar(ref.lista, ate, Ver_.TAMANHO).itens.length;
        var primeira = anexar(ref, ref.lista.slice(antes, ref.ate));
        atualizarMais(ref);
        if (primeira && primeira.focus) primeira.focus({ preventScroll: true });
      });
      b.setAttribute("data-foco", "mais");
      ref.mais.appendChild(b);
    }

    function listaDeMovimentos(d, lista) {
      var alvo = filtro === TODAS ? undefined : filtro;
      var movs = Res.movimentos(d.todos, alvo);
      var bloco = el("div");
      if (movs.length === 0) {
        var c = el("div", "cartao");
        c.setAttribute("role", "status");
        c.appendChild(ic("i-vazio", "ic-grande"));
        var p = el("p"); p.appendChild(el("strong", "", alvo === undefined ? "Nenhum movimento ainda" : "Nenhum movimento em " + alvo));
        c.appendChild(p);
        c.appendChild(el("p", "", alvo === undefined ? "Toque em Guardar para colocar o primeiro dinheiro na caixinha." : "Use Guardar para colocar dinheiro nela."));
        bloco.appendChild(c);
        return { no: bloco, quantidade: 0 };
      }
      var pag = Ver_.paginar(movs, ate, Ver_.TAMANHO);
      var ref = { lista: movs, todos: d.todos, ate: pag.itens.length, wrap: el("div"), mais: el("div", "mais"), ul: null, data: null, n: 0 };
      ref.wrap.setAttribute("id", "rs-lista");
      anexar(ref, pag.itens);
      bloco.append(ref.wrap, ref.mais);
      atualizarMais(ref);
      return { no: bloco, quantidade: movs.length };
    }
    function vozDoFiltro(n) {
      var txt = filtro === TODAS ? "Mostrando todos os movimentos: " : "Mostrando os movimentos de " + filtro + ": ";
      return txt + n + " " + (n === 1 ? "movimento" : "movimentos") + ".";
    }
    function falar(txt) {
      var e = $("rs-voz");
      if (!e || txt === ultimaVoz) return;
      ultimaVoz = txt;
      e.textContent = txt;
    }
    function metaDom() {
      var m = el("div", "meta");
      var t = el("div", "meta-txt");
      t.appendChild(el("p", "apoio", Ver_.atualizadoEm(sync.sincronizadoEm)));
      var ocupado = sync.sincronizando;
      var b = botao("btn-atualizar", "", function () { atualizar(); });
      b.setAttribute("data-foco", "atualizar");
      if (ocupado) b.setAttribute("aria-busy", "true");
      b.disabled = ocupado || !env.online();
      b.append(ic("i-enviando"), ocupado ? "Atualizando…" : "Atualizar");
      m.append(t, b);
      return m;
    }
    function atualizar() {
      if (!ctx || !ctx.controle || sync.sincronizando || !env.online()) return;
      sync.sincronizando = true;
      desenhar(false);
      Promise.resolve(ctx.controle.tentarEnviar()).then(function () {}, function () {}).then(function () {
        sync.sincronizando = false;
        sync.sincronizadoEm = env.agora ? env.agora() : Date.now();
        desenhar(false);
      });
    }
    function filtroDom(lista) {
      var fs = el("fieldset", "campo-grupo");
      fs.appendChild(el("legend", "", "Ver movimentos de"));
      var g = el("div", "escolhas");
      g.setAttribute("role", "radiogroup");
      [TODAS].concat(lista.map(function (c) { return c.nome; })).forEach(function (nome) {
        var rot = el("label", "escolha");
        var r = doc.createElement("input");
        r.type = "radio";
        r.setAttribute("name", "rs-filtro");
        r.value = nome;
        r.checked = nome === filtro;
        r.addEventListener("change", function () {
          if (!r.checked) return;
          filtro = nome;
          ate = Ver_.TAMANHO;
          desenharMovimentos();
        });
        rot.append(r, el("span", "", nome === TODAS ? "Todas" : nome), ic("i-ok", "ic-ok"));
        g.appendChild(rot);
      });
      fs.appendChild(g);
      return fs;
    }

    // ---- desenho ----
    var lugarMov = null, listaAtual = [];
    function desenharMovimentos() {
      if (!lugarMov || !dados) return;
      var r = listaDeMovimentos(dados, listaAtual);
      lugarMov.replaceChildren(r.no);
      falar(vozDoFiltro(r.quantidade));
    }
    function desenhar(refazFoco) {
      if (!aberta || !dados) return;
      var d = dados;
      var corpo = $("reserva-conteudo");
      if (!corpo) return;
      if (!Res.temCaixinha(d.todos, d.opcoes)) { aberta = false; env.semReserva(); return; }
      var lista = Res.caixinhas(d.todos, d.opcoes, env.hoje());
      listaAtual = lista;
      if (filtro !== TODAS && !lista.some(function (c) { return c.nome === filtro; })) filtro = TODAS;
      var focoAntes = doc.activeElement && doc.activeElement.getAttribute ? doc.activeElement.getAttribute("data-foco") : null;
      var raiz = el("div");
      raiz.appendChild(el("p", "apoio", env.online() === false ? Res.TEXTOS.sem_internet : Res.TEXTOS.apoio_reserva));
      raiz.appendChild(totalDom(lista));
      raiz.appendChild(acoesDom(lista));
      raiz.appendChild(caixinhasDom(lista));
      var sec = el("section", "reserva-sec");
      var h = el("h2", "", "Movimentos");
      h.setAttribute("id", "rs-h-mov");
      sec.setAttribute("aria-labelledby", "rs-h-mov");
      sec.appendChild(h);
      raiz.appendChild(metaDom());
      if (lista.length >= 2) sec.appendChild(filtroDom(lista));
      lugarMov = el("div");
      sec.appendChild(lugarMov);
      raiz.appendChild(sec);
      var area = $("conteudo");
      var rolagem = area ? area.scrollTop : 0;
      corpo.replaceChildren(raiz);
      if (area) area.scrollTop = rolagem;
      desenharMovimentos();
      if (focoAntes && !refazFoco) {
        var f = achar(raiz, focoAntes);
        if (f && f.focus) f.focus({ preventScroll: true });
      }
    }
    function achar(raiz, chave) {
      if (!raiz) return null;
      if (raiz.getAttribute && raiz.getAttribute("data-foco") === chave) return raiz;
      var fs = raiz.children || [];
      for (var i = 0; i < fs.length; i++) { var r = achar(fs[i], chave); if (r) return r; }
      return null;
    }
    function buscando() {
      var corpo = $("reserva-conteudo");
      if (!corpo) return;
      var c = el("div", "cartao");
      c.setAttribute("role", "status");
      c.appendChild(ic("i-enviando", "ic-grande ic-gira"));
      var p = el("p"); p.appendChild(el("strong", "", "Buscando seus lançamentos na planilha…"));
      c.appendChild(p);
      corpo.replaceChildren(c);
    }
    function erro() {
      var corpo = $("reserva-conteudo");
      if (!corpo) return;
      var c = el("div", "cartao");
      c.setAttribute("role", "status");
      c.appendChild(ic("i-atencao", "ic-grande"));
      var p = el("p"); p.appendChild(el("strong", "", "Não consegui abrir a Reserva"));
      c.append(p, el("p", "", "Seus lançamentos continuam guardados no celular. Tente de novo."), botao("btn-sec", "Tentar de novo", function () { abrir(); }));
      corpo.replaceChildren(c);
    }

    // ---- o que o app chama ----
    function abrir() {
      aberta = true;
      filtro = TODAS;
      ate = Ver_.TAMANHO;
      ultimaVoz = "";
      var h1 = $("rs-titulo");
      if (h1 && h1.focus) h1.focus({ preventScroll: true });
      if (!ctx) buscando();
      return env.pronto.then(function (c) {
        if (!c) throw new Error("sem banco");
        ctx = c;
        ligar();
        return ler();
      }).then(function () {
        if (!aberta) return false;
        desenhar(true);
        return true;
      }).catch(function () { if (aberta) erro(); return false; });
    }
    function ligar() {
      if (desligar.length) return;
      desligar.push(Fil.aoMudar(function (evento) {
        if (AVISOS.indexOf(evento) < 0 || !aberta) return;
        ler().then(function () { desenhar(false); }).catch(function () {});
      }));
      if (ctx.controle && typeof ctx.controle.aoSincronia === "function") {
        desligar.push(ctx.controle.aoSincronia(function (s) {
          if (!s) return;
          sync = { sincronizando: !!s.sincronizando, sincronizadoEm: s.sincronizadoEm };
          if (aberta && dados) desenhar(false);
        }));
        if (typeof ctx.controle.sincronia === "function") { var s0 = ctx.controle.sincronia(); if (s0) sync = { sincronizando: !!s0.sincronizando, sincronizadoEm: s0.sincronizadoEm }; }
      }
    }
    function fechar() { aberta = false; }
    function rede() { if (aberta && dados) desenhar(false); }
    function parar() { desligar.forEach(function (f) { f(); }); desligar = []; aberta = false; }
    // Depois de "Desfazer" ou de fechar um formulário: o foco volta ao título.
    function focarTitulo() { var h1 = $("rs-titulo"); if (h1 && h1.focus) h1.focus({ preventScroll: true }); }

    var voltar = $("rs-voltar");
    if (voltar) voltar.addEventListener("click", function () { env.sair(); });

    return { abrir: abrir, fechar: fechar, rede: rede, parar: parar, focarTitulo: focarTitulo, aberta: function () { return aberta; } };
  }

  return { criar: criar };
})();
if (typeof module !== "undefined") module.exports = TelaReserva;
