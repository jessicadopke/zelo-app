// Zelo: núcleo do app. Navegação por abas, tema e cópia offline. O conteúdo das telas vem nas próximas partes.
// Depende de js/rotas.js (Rotas) e js/tema.js (Tema), carregados antes no index.html.
const APP_VERSION = "0.6.0";

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

(function () {
  if (typeof Rotas === "undefined" || typeof Tema === "undefined") return;
  const $ = (sel, raiz) => (raiz || document).querySelector(sel);
  const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));

  // ---- ajudas de desenho (texto sempre como textContent, nunca HTML) ----
  const SVG_NS = $("svg.wordmark").namespaceURI;
  function el(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined) e.textContent = texto;
    return e;
  }
  function trocarSimbolo(svg, id) {
    svg.textContent = "";
    const uso = document.createElementNS(SVG_NS, "use");
    uso.setAttribute("href", "#" + id);
    svg.appendChild(uso);
  }
  function icone(id) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "ic");
    svg.setAttribute("aria-hidden", "true");
    trocarSimbolo(svg, id);
    return svg;
  }
  function movimentoReduzido() {
    return document.documentElement.dataset.movimento === "reduzido"
      || !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  // ---- navegação ----
  let atual = null;
  let reservaAberta = false; // tela da Reserva (#reserva), que mora dentro do Início
  let telaReserva = null, telaMov = null; // criadas mais abaixo
  const aoMostrar = []; // funções chamadas com o id da aba que acabou de aparecer

  function mostrar(id) {
    const antes = atual;
    atual = id;
    if (reservaAberta && id !== "inicio") fecharReservaTela();
    const dir = antes ? Rotas.direcao(antes, id) : null;
    $$(".tela").forEach((t) => {
      t.hidden = t.dataset.tela !== id;
      t.classList.remove("entra-dir", "entra-esq");
    });
    const tela = $('.tela[data-tela="' + id + '"]');
    if (dir) {
      // Reinicia a animação mesmo se o toque vier durante a anterior.
      void tela.offsetWidth;
      tela.classList.add("entra-" + dir);
    }
    $$(".nav a").forEach((a) => {
      if (a.dataset.id === id) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    document.title = Rotas.titulo(id);
    const area = $("#conteudo");
    area.scrollTop = 0;
    area.focus({ preventScroll: true });
    aoMostrar.forEach((f) => f(id));
  }

  function ir(id) {
    if (id === atual) {
      if (id === "inicio" && reservaAberta) history.back(); // "Início" tocado dentro da Reserva volta ao Início
      return;
    }
    history.pushState({ aba: id }, "", "#" + id);
    mostrar(id);
  }

  $$(".nav a").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    ir(a.dataset.id);
  }));
  // O botão voltar do Android (popstate) é tratado mais abaixo, junto com a tela de lançar.
  const hashInicial = location.hash;
  const inicial = Rotas.abaDoHash(location.hash);
  history.replaceState({ aba: inicial }, "", "#" + inicial);
  mostrar(inicial);
  // Na abertura o foco fica no começo da página, não na área da tela (evita contorno à toa).
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

  // ---- início: saudação (o mês e os números são desenhados por js/tela-ver.js) ----
  const agora = new Date();
  const h = agora.getHours();
  $("#saudacao").textContent = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";

  // ---- sem internet: faixa informativa, nunca erro ----
  function atualizarRede() {
    $("#faixa-semnet").hidden = navigator.onLine !== false;
    if (telaVer) telaVer.rede();
    if (telaReserva) telaReserva.rede();
  }
  window.addEventListener("online", atualizarRede);
  window.addEventListener("offline", atualizarRede);
  let telaVer = null; // criada mais abaixo (usa o banco e a ponte do indicador)
  atualizarRede();

  // ---- indicador da fila de envio (barra de cima e Ajustes > Envio dos gastos) ----
  // Tudo que vem de fora (motivo da recusa, nomes) entra como texto puro (textContent), nunca como HTML.
  // Devolve uma promessa com { db, ponte, controle } (ou null) para a seção de Ajustes usar o mesmo banco e a mesma ponte.
  function iniciarIndicador() {
    if (typeof Indicador === "undefined" || typeof Db === "undefined") return Promise.resolve(null);
    const pilula = $("#fila"), link = $("#fila-link"), esq = $("#fila-esq"), voz = $("#fila-voz");
    const cartao = $("#envio-cartao");
    let controle = null;

    function pintarCartao(v) {
      cartao.textContent = "";
      cartao.removeAttribute("aria-busy");
      if (v.erro) {
        cartao.removeAttribute("data-tom");
        cartao.appendChild(el("p", "envio-erro", "Não consegui ler o que está guardado neste celular."));
        return;
      }
      const t = v.texto;
      cartao.dataset.tom = t.tom === "atencao" ? "atencao" : t.tom === "enviando" ? "enviando" : "ok";
      const topo = el("div", "envio-topo");
      const ic = el("span", "envio-ic");
      ic.appendChild(icone(t.icone));
      const corpo = el("div");
      corpo.append(el("p", "envio-titulo", t.titulo), el("p", "envio-apoio", t.apoio));
      topo.append(ic, corpo);
      cartao.appendChild(topo);
      const causa = v.estado && v.estado.causa;
      if (v.estado && v.estado.estado === "precisa-de-atencao" && (causa === "semconfig" || causa === "codigo")) {
        const alvo = causa === "codigo" ? "f-cod" : "f-url";
        const a = el("a", "envio-atalho", "Ir para a ligação");
        a.href = "#" + alvo;
        a.addEventListener("click", (e) => {
          e.preventDefault();
          const campo = document.getElementById(alvo);
          if (!campo) return;
          campo.scrollIntoView({ block: "center", behavior: movimentoReduzido() ? "auto" : "smooth" });
          campo.focus({ preventScroll: true });
        });
        cartao.appendChild(a);
      }
      if (v.detalhe.recusados.length && v.estado.nao_enviados > 0) {
        const lista = el("ul", "envio-lista");
        v.detalhe.recusados.forEach((r) => {
          const li = el("li");
          li.append(el("b", "", r.titulo), el("span", "", r.motivo));
          lista.appendChild(li);
        });
        cartao.appendChild(lista);
      }
      const dl = el("dl", "envio-dados");
      [["Esperando para enviar", String(v.estado.pendentes)], ["Não enviados", String(v.estado.nao_enviados)], ["Último envio", v.detalhe.ultimoEnvio]]
        .forEach((par) => dl.append(el("dt", "", par[0]), el("dd", "", par[1])));
      cartao.appendChild(dl);
      if (v.podeEnviar) {
        const b = el("button", "btn-p", "Enviar agora");
        b.type = "button";
        b.addEventListener("click", () => { if (controle) controle.tentarEnviar(); });
        cartao.appendChild(b);
      }
    }

    function pintar(v) {
      if (v.carregando) return;
      esq.hidden = true;
      if (v.erro) {
        link.hidden = true;
        voz.textContent = "";
        pintarCartao(v);
        return;
      }
      link.hidden = false;
      const t = v.texto;
      pilula.dataset.tom = t.tom;
      pilula.textContent = "";
      pilula.appendChild(icone(t.icone));
      pilula.appendChild(el("span", "fila-txt", t.pilula));
      voz.textContent = v.voz;
      pintarCartao(v);
    }

    link.addEventListener("click", (e) => {
      e.preventDefault();
      ir("ajustes");
      const h = $("#envio-h");
      h.focus();
      h.scrollIntoView();
    });
    return Db.abrir().then((db) => {
      // A ponte lê o endereço e o código do banco a cada chamada (o que a pessoa digitou em Ajustes). Sem Ponte, a fila só espera.
      const ponte = typeof Ponte !== "undefined" && Ponte.criar
        ? Ponte.criar({
          lerConfig: () => Promise.all([db.config.obter("url_ponte"), db.config.obter("codigo_aparelho")])
            .then((v) => ({ url: v[0], codigo: v[1] })),
          versaoApp: APP_VERSION,
        })
        : null;
      // Depois de enviar e receber sem parar, baixa as opções da planilha (sem bloquear nada; se falhar, vale a cópia do celular).
      const aoSincronizar = ponte && typeof Opcoes !== "undefined" ? () => { Opcoes.atualizar(db, ponte); } : null;
      controle = Indicador.criar({ db: db, ponte: ponte, janela: window, pintar: pintar, aoSincronizar: aoSincronizar });
      controle.iniciar();
      return { db: db, ponte: ponte, controle: controle };
    }).catch(() => { pintar({ erro: true }); return null; });
  }
  const pronto = iniciarIndicador();

  // ---- avisos de baixo ("Guardado…", "Lançamento apagado. Desfazer", "alterado no outro celular"): um por vez, por cima da área, sem empurrar nada ----
  // A ordem e o tempo de cada aviso moram em js/alterado.js (criarAvisos); aqui só o desenho.
  const avisoEl = $("#aviso");
  const marcas = Alterado.criarMarcas();
  let telaLancar = null; // criada mais abaixo
  function esconderAviso() {
    avisoEl.classList.remove("saindo");
    avisoEl.textContent = "";
  }
  function pintarAviso(v) {
    if (v.tipo === "alterado") {
      // Texto da planilha (nome) entra como textContent, nunca como HTML.
      const t = v.texto;
      avisoEl.textContent = "";
      const txt = el("span", "aviso-txt");
      txt.appendChild(el("span", "aviso-tit", t.titulo));
      if (t.nome) {
        const det = el("span", "aviso-det");
        det.append(el("span", "av-nome", t.nome));
        if (t.valor) det.append(el("span", "so-leitor", ", "), el("span", "av-valor", t.valor));
        txt.appendChild(det);
      }
      avisoEl.append(icone("i-trocar"), txt);
      if (t.ver) {
        const b = el("button", "aviso-acao", "Ver");
        b.type = "button";
        b.setAttribute("aria-label", t.verAria);
        b.addEventListener("click", () => v.ver());
        avisoEl.appendChild(b);
      }
      return;
    }
    const o = v.o;
    avisoEl.append(icone(o.icone || "i-ok"), el("span", "", o.texto));
    if (o.acao) {
      const botao = el("button", "aviso-acao", o.acao);
      botao.type = "button";
      botao.addEventListener("click", () => v.clicou());
      avisoEl.appendChild(botao);
    }
  }
  const avisos = Alterado.criarAvisos({
    formularioAberto: () => algumFormAberto(),
    pintar: pintarAviso,
    limpar: esconderAviso,
    saindo: () => avisoEl.classList.add("saindo"),
    // Não some enquanto um botão do aviso estiver com o foco.
    focoNoBotao: () => !!document.activeElement && document.activeElement.tagName === "BUTTON" && avisoEl.contains(document.activeElement),
    reduzido: movimentoReduzido,
    // "Ver": com um só alterado abre o Editar dele; com vários, vai para Lançamentos (onde estão a nota e as marcas).
    aoVer: (r) => {
      if (r.editados.length === 1 && r.apagados.length === 0) abrirTelaLancar({ tipo: "editar", id: r.editados[0].id }, "#editar/" + encodeURIComponent(r.editados[0].id));
      else ir("lancamentos");
    },
  });
  const mostrarAviso = (o) => avisos.comum(o);
  // Uma edição daqui perdeu para a mais nova do outro celular (ou o outro celular apagou): marca na lista e aviso, só em memória.
  if (typeof Fila !== "undefined" && Fila.aoMudar) {
    Fila.aoMudar((evento, ids) => {
      if (evento !== "alterado_no_outro" || !Array.isArray(ids)) return;
      pronto.then((c) => (c ? Alterado.resumir(c.db, ids) : [])).then((itens) => {
        if (!itens.length) return;
        itens.forEach((i) => { if (i.apagado) marcas.tirar(i.id); });
        marcas.marcar(itens.filter((i) => !i.apagado).map((i) => i.id));
        avisos.chegou(itens);
      }).catch(() => {});
    });
  }

  // ---- telas de tela cheia: Novo/Editar (js/tela-lancar.js) e Guardar/Tirar/Passar/Conferir (js/tela-movimento.js) ----
  // Cada abertura empilha uma entrada no histórico; o voltar do Android (ou o X) volta à tela de antes sem empilhar de novo.
  // O nome de caixinha ou de cartão que pré-marca um formulário viaja só em memória (nunca no endereço nem no history.state).
  let hashDaTela = "", saindoDeVez = false;
  const envForm = {
    pronto: pronto,
    marcas: marcas,
    hoje: () => Datas.hoje(),
    online: () => navigator.onLine !== false,
    sair: () => { saindoDeVez = true; history.back(); },
    avisar: mostrarAviso,
  };
  telaLancar = typeof TelaLancar !== "undefined" && typeof Lancar !== "undefined" ? TelaLancar.criar(envForm) : null;
  telaMov = typeof TelaMovimento !== "undefined" && typeof Reserva !== "undefined" ? TelaMovimento.criar(envForm) : null;
  function algumFormAberto() { return (!!telaLancar && telaLancar.aberto()) || (!!telaMov && telaMov.aberto()); }
  function formAtivo() { return telaLancar && telaLancar.aberto() ? telaLancar : telaMov && telaMov.aberto() ? telaMov : null; }
  function empurrar(hash) {
    hashDaTela = hash;
    history.pushState({ aba: atual, tela: true, sub: reservaAberta ? "reserva" : null }, "", hash);
  }
  // Abre o formulário certo para a rota: Novo, Editar (o tipo do lançamento escolhe o editor) ou um dos da Reserva.
  function abrirPorRota(t, memoria) {
    if (t.tipo === "novo") { if (telaLancar) telaLancar.abrir(t); return; }
    if (t.tipo === "editar") {
      const ao = (l) => {
        const k = l && l.apagado !== "sim" && typeof TelaMovimento !== "undefined" ? TelaMovimento.tipoDoLancamento(l.tipo) : null;
        if (k && telaMov) telaMov.abrir({ tipo: k, id: t.id });
        else if (telaLancar) telaLancar.abrir(t);
      };
      pronto.then((c) => (c ? c.db.lancamentos.obter(t.id) : null)).then(ao, () => ao(null));
      return;
    }
    if (telaMov) telaMov.abrir(Object.assign({}, memoria || {}, { tipo: t.tipo }));
  }
  function abrirTelaLancar(t, hash, memoria) {
    if (!telaLancar && !telaMov) return;
    empurrar(hash);
    abrirPorRota(t, memoria);
  }
  function abrirMovimento(t, hash) { abrirTelaLancar(t, hash, t); }
  $$("[data-novo]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    abrirTelaLancar({ tipo: "novo" }, "#novo");
  }));

  // ---- Reserva: tela dentro do Início (#reserva); a barra de baixo continua com "Início" marcado ----
  const reservaEl = $("#reserva-tela"), principalEl = $("#ini-principal");
  function abrirReservaTela() {
    if (reservaAberta || !reservaEl || !telaReserva) return;
    reservaAberta = true;
    principalEl.hidden = true;
    reservaEl.hidden = false;
    document.title = "Reserva · Zelo";
    telaReserva.abrir();
  }
  function fecharReservaTela(foco) {
    if (!reservaAberta) return;
    reservaAberta = false;
    reservaEl.hidden = true;
    principalEl.hidden = false;
    document.title = Rotas.titulo(atual || "inicio");
    telaReserva.fechar();
    if (foco) {
      const alvo = $('[data-foco="reserva"]');
      if (alvo && alvo.focus) alvo.focus({ preventScroll: true });
    }
  }
  function abrirReserva() {
    if (reservaAberta || atual !== "inicio" || !telaReserva) return;
    history.pushState({ aba: "inicio", sub: "reserva" }, "", "#reserva");
    abrirReservaTela();
  }
  telaReserva = typeof TelaReserva !== "undefined" && typeof Reserva !== "undefined" && reservaEl
    ? TelaReserva.criar({
      pronto: pronto,
      marcas: marcas,
      hoje: () => Datas.hoje(),
      online: () => navigator.onLine !== false,
      agora: () => Date.now(),
      sair: () => history.back(),
      // Sem caixinha (ou script antigo): a Reserva não existe; volta ao Início sem deixar entrada no histórico.
      semReserva: () => { history.replaceState({ aba: "inicio" }, "", "#inicio"); fecharReservaTela(); },
      guardar: (cx) => abrirMovimento({ tipo: "guardar", caixinha: cx }, "#reserva/guardar"),
      tirar: (cx) => abrirMovimento({ tipo: "tirar", caixinha: cx }, "#reserva/tirar"),
      passar: (cx) => abrirMovimento({ tipo: "passar", caixinha: cx }, "#reserva/passar"),
      conferir: (lugar) => abrirMovimento({ tipo: "conferir", lugar: lugar }, "#conferir"),
      editar: (id) => abrirTelaLancar({ tipo: "editar", id: id }, "#editar/" + encodeURIComponent(id)),
    })
    : null;

  // ---- telas de ver: Início, Lançamentos e Resumo (js/tela-ver.js) ----
  if (typeof TelaVer !== "undefined") {
    telaVer = TelaVer.criar({
      pronto: pronto,
      marcas: marcas,
      hoje: () => Datas.hoje(),
      online: () => navigator.onLine !== false,
      agora: () => Date.now(),
      ir: (id) => ir(id),
      novo: () => abrirTelaLancar({ tipo: "novo" }, "#novo"),
      // O nome do cartão vai só em memória (nunca na URL): o endereço continua "#novo".
      pagarFatura: (cartao) => abrirTelaLancar({ tipo: "novo", fatura: cartao }, "#novo"),
      editar: (id) => abrirTelaLancar({ tipo: "editar", id: id }, "#editar/" + encodeURIComponent(id)),
      reserva: () => abrirReserva(),
      conferir: (lugar) => abrirMovimento({ tipo: "conferir", lugar: lugar }, "#conferir"),
    });
    aoMostrar.push((id) => telaVer.mostrar(id));
    telaVer.mostrar(atual);
    // Voltou ao app depois de um tempo: confere se tem lançamento novo (no máximo a cada 5 minutos).
    document.addEventListener("visibilitychange", () => { if (!document.hidden) telaVer.voltou(); });
  }

  // Botão voltar do Android: fecha o formulário (perguntando se a pessoa mexeu) ou mostra a tela anterior, sem empilhar de novo.
  window.addEventListener("popstate", () => {
    const t = Rotas.telaDoHash(location.hash);
    if (t) {
      if (!algumFormAberto()) { hashDaTela = location.hash; abrirPorRota(t); }
      return;
    }
    const ativo = formAtivo();
    if (ativo) {
      if (!saindoDeVez && ativo.mexeu()) {
        history.pushState({ aba: atual, tela: true, sub: reservaAberta ? "reserva" : null }, "", hashDaTela);
        ativo.pedirSaida();
        return;
      }
      ativo.fechar();
      avisos.tentar(); // o que chegou com o formulário aberto entra agora
    }
    saindoDeVez = false;
    const aba = Rotas.abaDoHash(location.hash);
    if (aba !== atual) mostrar(aba);
    const sub = history.state && history.state.sub === "reserva" ? "reserva" : null;
    if (sub === "reserva" && atual === "inicio") abrirReservaTela();
    else if (reservaAberta) fecharReservaTela(true);
  });
  // Aberto direto por #novo, #editar/<id>, #reserva/... ou #conferir (por exemplo, ao recarregar): a aba fica por baixo.
  const telaInicial = Rotas.telaDoHash(hashInicial);
  if (Rotas.subtelaDoHash(hashInicial)) abrirReserva();
  else if (telaInicial) abrirTelaLancar(telaInicial, hashInicial);

  // ---- Ajustes: ligação com a planilha e sobre o app ----
  // O endereço e o código só vão para o banco do aparelho (e para o corpo do POST, dentro de js/ponte.js).
  // Nunca em console, localStorage, URL nem texto de mensagem.
  function iniciarAjustes() {
    if (typeof Ajustes === "undefined") return;
    const fUrl = $("#f-url"), fCod = $("#f-cod");
    if (!fUrl || !fCod) return;
    const olho = $("#btn-olho"), salvar = $("#btn-salvar"), testar = $("#btn-testar");
    const salvo = $("#salvo"), resultado = $("#resultado");
    const campos = { url: { campo: fUrl, erro: $("#f-url-erro") }, codigo: { campo: fCod, erro: $("#f-cod-erro") } };
    let ctx = null, ocupado = false, sujo = false, versaoPonte = "";

    function pintarResultado(alvo, r) {
      alvo.textContent = "";
      const caixa = el("div", "res");
      caixa.dataset.tom = r.tom;
      const corpo = el("div");
      corpo.appendChild(el("b", "", r.titulo));
      if (r.apoio) corpo.appendChild(el("span", "", r.apoio));
      caixa.append(icone(r.icone), corpo);
      alvo.appendChild(caixa);
    }
    function limparErro(c) {
      c.campo.removeAttribute("aria-invalid");
      c.erro.hidden = true;
      c.erro.querySelector("span").textContent = "";
    }
    function mostrarErros(erros) {
      let primeiro = null;
      ["url", "codigo"].forEach((k) => {
        const c = campos[k];
        if (erros[k]) {
          c.campo.setAttribute("aria-invalid", "true");
          c.erro.querySelector("span").textContent = erros[k];
          c.erro.hidden = false;
          if (!primeiro) primeiro = c.campo;
        } else limparErro(c);
      });
      if (primeiro) primeiro.focus();
    }
    function zerarAvisos() { salvo.hidden = true; resultado.textContent = ""; }

    function pintarOlho(visivel) {
      const e = Ajustes.estadoOlho(visivel);
      fCod.type = e.tipo;
      olho.setAttribute("aria-pressed", String(e.pressionado));
      olho.setAttribute("aria-label", e.rotulo);
      olho.querySelector("span").textContent = e.texto;
      trocarSimbolo(olho.querySelector("svg"), e.icone);
    }
    olho.addEventListener("click", () => pintarOlho(fCod.type === "password"));
    function preencher() {
      return Ajustes.carregar(ctx.db).then((g) => { fUrl.value = g.url; fCod.value = g.codigo; }).catch(() => {});
    }
    aoMostrar.push((id) => {
      if (id !== "ajustes") { pintarOlho(false); return; }
      if (ctx && !sujo) preencher();
    });
    [fUrl, fCod].forEach((f) => f.addEventListener("input", () => {
      sujo = true;
      limparErro(f === fUrl ? campos.url : campos.codigo);
    }));

    // Grava o que está nos campos (se válido) e avisa o indicador. Devolve true se gravou.
    function gravar() {
      return Ajustes.salvar(ctx.db, { url: fUrl.value, codigo: fCod.value }).then((v) => {
        if (!v.ok) { mostrarErros(v.erros); return false; }
        mostrarErros({});
        fUrl.value = v.url;
        fCod.value = v.codigo;
        sujo = false;
        ctx.controle.atualizar();
        ctx.controle.tentarEnviar();
        return true;
      });
    }

    salvar.addEventListener("click", () => {
      if (!ctx || ocupado) return;
      zerarAvisos();
      gravar().then((ok) => { if (ok) salvo.hidden = false; }).catch(() => {});
    });

    testar.addEventListener("click", () => {
      if (!ctx || ocupado) return;
      ocupado = true;
      zerarAvisos();
      testar.disabled = true;
      testar.setAttribute("aria-busy", "true");
      resultado.setAttribute("aria-busy", "true");
      trocarSimbolo(testar.querySelector("svg"), "i-enviando");
      testar.querySelector("span").textContent = "Testando…";
      gravar().then((ok) => (ok ? Ajustes.testarLigacao({ ponte: ctx.ponte }) : null)).then((t) => {
        if (!t) return;
        if (t.conferido) { versaoPonte = t.resultado.versao; pintarSobre(); }
        pintarResultado(resultado, t.resultado);
      }).catch(() => {}).then(() => {
        ocupado = false;
        testar.disabled = false;
        testar.removeAttribute("aria-busy");
        resultado.removeAttribute("aria-busy");
        trocarSimbolo(testar.querySelector("svg"), "i-ok");
        testar.querySelector("span").textContent = "Testar ligação";
      });
    });

    // ---- Sobre o app (versão da ponte só em memória, depois de um teste que deu certo) ----
    const vApp = $("#v-app"), vPonte = $("#v-ponte"), aviso = $("#aviso-versao");
    vApp.textContent = APP_VERSION;
    function pintarSobre() {
      if (versaoPonte) { vPonte.textContent = versaoPonte; vPonte.removeAttribute("data-vazio"); }
      aviso.textContent = "";
      if (versaoPonte && Ajustes.compararVersoes(APP_VERSION, versaoPonte)) {
        pintarResultado(aviso, { tom: "atencao", icone: "i-atencao", titulo: "O app e a ponte estão em versões diferentes.", apoio: "Se algo não funcionar, toque em Buscar atualização." });
      }
    }
    const atualizar = $("#btn-atual"), atualRes = $("#atual-res");
    let procurando = false;
    atualizar.addEventListener("click", () => {
      if (procurando) return;
      procurando = true;
      atualRes.textContent = "";
      atualizar.disabled = true;
      atualizar.setAttribute("aria-busy", "true");
      atualizar.querySelector("span").textContent = "Procurando…";
      Ajustes.buscarAtualizacao("serviceWorker" in navigator ? navigator.serviceWorker : null).then((r) => {
        pintarResultado(atualRes, r === "nova"
          ? { tom: "info", icone: "i-enviando", titulo: "Tem versão nova.", apoio: "Feche e abra o Zelo de novo." }
          : r === "atualizado"
            ? { tom: "ok", icone: "i-ok", titulo: "Você já está na versão mais nova.", apoio: "" }
            : { tom: "info", icone: "i-semnet", titulo: "Não consegui procurar agora. Tente com internet.", apoio: "" });
        procurando = false;
        atualizar.disabled = false;
        atualizar.removeAttribute("aria-busy");
        atualizar.querySelector("span").textContent = "Buscar atualização";
      });
    });

    pronto.then((c) => { ctx = c; if (ctx) return preencher(); });
  }
  iniciarAjustes();

  // ---- tema (Ajustes > Aparência) ----
  const guardado = Tema.ler(localStorage);
  Tema.aplicar(document, guardado);
  $$('input[name="tema"]').forEach((r) => {
    r.checked = r.value === guardado;
    r.addEventListener("change", () => {
      if (!r.checked) return;
      Tema.aplicar(document, Tema.salvar(localStorage, r.value));
    });
  });
})();
