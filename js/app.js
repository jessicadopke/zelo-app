// Zelo: núcleo do app. Navegação por abas, tema e cópia offline. O conteúdo das telas vem nas próximas partes.
// Depende de js/rotas.js (Rotas) e js/tema.js (Tema), carregados antes no index.html.
const APP_VERSION = "0.5.0";

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
  const aoMostrar = []; // funções chamadas com o id da aba que acabou de aparecer

  function mostrar(id) {
    const antes = atual;
    atual = id;
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
    if (id === atual) return;
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

  // ---- avisos de baixo ("Guardado…", "Lançamento apagado. Desfazer"): um por vez, por cima da área, sem empurrar nada ----
  const avisoEl = $("#aviso");
  let avisoTimer = null, avisoSaida = null;
  function esconderAviso() {
    clearTimeout(avisoTimer);
    clearTimeout(avisoSaida);
    avisoEl.classList.remove("saindo");
    avisoEl.textContent = "";
  }
  function mostrarAviso(o) {
    esconderAviso();
    const texto = el("span", "", o.texto);
    avisoEl.append(icone(o.icone || "i-ok"), texto);
    let botao = null;
    if (o.acao) {
      botao = el("button", "aviso-acao", o.acao);
      botao.type = "button";
      botao.addEventListener("click", () => { esconderAviso(); if (o.aoAcao) o.aoAcao(); });
      avisoEl.appendChild(botao);
    }
    const sumir = () => {
      // Não some enquanto o botão de desfazer estiver com o foco.
      if (botao && document.activeElement === botao) { avisoTimer = setTimeout(sumir, 1000); return; }
      avisoEl.classList.add("saindo");
      avisoSaida = setTimeout(esconderAviso, movimentoReduzido() ? 0 : 200);
    };
    avisoTimer = setTimeout(sumir, o.duracao || 6000);
  }

  // ---- tela de lançar (Novo e Editar): tela cheia por cima das abas, aberta por #novo e #editar/<id> ----
  // Cada abertura empilha uma entrada no histórico; o voltar do Android (ou o X) volta à aba de antes sem empilhar de novo.
  let hashDaTela = "", saindoDeVez = false;
  const telaLancar = typeof TelaLancar !== "undefined" && typeof Lancar !== "undefined"
    ? TelaLancar.criar({
      pronto: pronto,
      hoje: () => Datas.hoje(),
      online: () => navigator.onLine !== false,
      sair: () => { saindoDeVez = true; history.back(); },
      avisar: mostrarAviso,
    })
    : null;
  function abrirTelaLancar(t, hash) {
    if (!telaLancar) return;
    hashDaTela = hash;
    history.pushState({ aba: atual, tela: true }, "", hash);
    telaLancar.abrir(t);
  }
  $$("[data-novo]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    abrirTelaLancar({ tipo: "novo" }, "#novo");
  }));
  // ---- telas de ver: Início, Lançamentos e Resumo (js/tela-ver.js) ----
  if (typeof TelaVer !== "undefined") {
    telaVer = TelaVer.criar({
      pronto: pronto,
      hoje: () => Datas.hoje(),
      online: () => navigator.onLine !== false,
      agora: () => Date.now(),
      ir: (id) => ir(id),
      novo: () => abrirTelaLancar({ tipo: "novo" }, "#novo"),
      editar: (id) => abrirTelaLancar({ tipo: "editar", id: id }, "#editar/" + encodeURIComponent(id)),
    });
    aoMostrar.push((id) => telaVer.mostrar(id));
    telaVer.mostrar(atual);
    // Voltou ao app depois de um tempo: confere se tem lançamento novo (no máximo a cada 5 minutos).
    document.addEventListener("visibilitychange", () => { if (!document.hidden) telaVer.voltou(); });
  }

  // Botão voltar do Android: fecha o formulário (perguntando se a pessoa mexeu) ou mostra a aba anterior, sem empilhar de novo.
  window.addEventListener("popstate", () => {
    const t = Rotas.telaDoHash(location.hash);
    if (t) {
      if (telaLancar && !telaLancar.aberto()) { hashDaTela = location.hash; telaLancar.abrir(t); }
      return;
    }
    if (telaLancar && telaLancar.aberto()) {
      if (!saindoDeVez && telaLancar.mexeu()) {
        history.pushState({ aba: atual, tela: true }, "", hashDaTela);
        telaLancar.pedirSaida();
        return;
      }
      telaLancar.fechar();
    }
    saindoDeVez = false;
    const aba = Rotas.abaDoHash(location.hash);
    if (aba !== atual) mostrar(aba);
  });
  // Aberto direto por #novo ou #editar/<id> (por exemplo, ao recarregar): a aba fica por baixo.
  const telaInicial = Rotas.telaDoHash(hashInicial);
  if (telaInicial) abrirTelaLancar(telaInicial, hashInicial);

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
