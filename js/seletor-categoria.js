// Zelo: seletor de categoria com busca (#106). Campo de texto + lista que se filtra a cada letra, com "Sem categoria" fixa no rodapé.
// Nasce reutilizável (hoje só a tela "O que entendi" o usa). Desenho: specs/106-design.md. Tudo que vem da planilha entra com
// textContent, nunca como HTML. Sem armazenamento, sem rede e sem registro no console do navegador. No navegador vira o objeto global SeletorCategoria.
var SeletorCategoria = (function () {
  var SVG_NS = "http://www.w3.org/2000/svg";
  var SEM_CATEGORIA = "__sem__";
  var MAX_USADAS = 6;
  var LINHAS_MAX = 6, LINHAS_MIN = 3, ALTURA_LINHA = 48;
  var TXT = {
    rotulo: "Categoria", placeholder: "Escolha ou digite", aguarde: "Aguarde…", sem: "Sem categoria",
    historico: "Você usou com este favorecido", modelo: "Sugerida pela leitura, confira", falta: "Falta escolher a categoria",
    sugerida: "Sugerida", usadas: "Mais usadas", todas: "Todas", limpar: "Limpar categoria", carregando: "Buscando as categorias…",
    erro: "Não deu para buscar as categorias. Tente de novo.", tentar: "Tentar de novo"
  };

  // Minúsculas, sem acento, espaços únicos (a mesma ideia do normalizarNome do script, sem os prefixos de Pix/TED).
  function normalizar(t) {
    var x = String(t === null || t === undefined ? "" : t).toLowerCase();
    x = x.normalize ? x.normalize("NFD").replace(/[̀-ͯ]/g, "") : x;
    return x.replace(/\s+/g, " ").trim();
  }

  // As categorias mais usadas pelos lançamentos guardados no aparelho. Conta só lançamentos não apagados e categorias que existem
  // na lista; empate: ordem da planilha. Sem lançamentos: lista vazia (a tela cai na ordem da planilha).
  function maisUsadas(lancamentos, categorias, max) {
    max = max || MAX_USADAS;
    if (!Array.isArray(lancamentos) || !Array.isArray(categorias)) return [];
    var ordem = {};
    categorias.forEach(function (c, i) { if (!Object.prototype.hasOwnProperty.call(ordem, c)) ordem[c] = i; });
    var n = {};
    lancamentos.forEach(function (l) {
      if (!l || l.apagado === "sim" || typeof l.categoria !== "string") return;
      if (!Object.prototype.hasOwnProperty.call(ordem, l.categoria)) return;
      n[l.categoria] = (n[l.categoria] || 0) + 1;
    });
    return Object.keys(n).sort(function (a, b) { return n[b] !== n[a] ? n[b] - n[a] : ordem[a] - ordem[b]; }).slice(0, max);
  }

  // Posição do trecho buscado dentro do nome original: { de, ate } ou null. Letra por letra, para o acento não deslocar o trecho.
  function acharTrecho(nome, busca) {
    var norm = "", mapa = [];
    for (var i = 0; i < nome.length; i++) {
      var ch = nome.charAt(i) === " " ? " " : normalizar(nome.charAt(i));
      for (var k = 0; k < ch.length; k++) { norm += ch.charAt(k); mapa.push(i); }
    }
    var pos = norm.indexOf(busca);
    if (pos < 0 || busca === "") return null;
    return { de: mapa[pos], ate: mapa[pos + busca.length - 1] + 1 };
  }

  // Categorias que têm o texto digitado em qualquer parte do nome, na ordem da planilha.
  function filtrar(categorias, texto) {
    var busca = normalizar(texto);
    if (busca === "") return categorias.slice();
    return categorias.filter(function (c) { return normalizar(c).indexOf(busca) >= 0; });
  }

  // cfg: { doc, id (prefixo dos ids), categorias (lista, ou null = não carregou), usadas?, valor ("" | SEM_CATEGORIA | nome),
  //        sugerida?, origem? ("historico" | "modelo" | ""), duvida? (veio vazia e é preciso escolher), carregando?,
  //        aoMudar(valor), aoTentarDeNovo?() }
  function criar(cfg) {
    var doc = cfg.doc || document;
    var categorias = Array.isArray(cfg.categorias) ? cfg.categorias : null;
    var usadas = (cfg.usadas || []).filter(function (c) { return categorias && categorias.indexOf(c) >= 0; });
    var sugerida = cfg.sugerida && categorias && categorias.indexOf(cfg.sugerida) >= 0 ? cfg.sugerida : "";
    var origem = sugerida && (cfg.origem === "historico" || cfg.origem === "modelo") ? cfg.origem : "";
    var valor = cfg.valor || "";
    var aberto = false, digitou = false, texto = "", ativo = -1, itens = [];
    var ouvindo = false;

    function el(tag, classe, txt) {
      var e = doc.createElement(tag);
      if (classe) e.className = classe;
      if (txt !== undefined) e.textContent = txt;
      return e;
    }
    function icone(id) {
      var svg = doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "ic");
      svg.setAttribute("aria-hidden", "true");
      var uso = doc.createElementNS(SVG_NS, "use");
      uso.setAttribute("href", "#" + id);
      svg.appendChild(uso);
      return svg;
    }

    var raiz = el("div", "campo cat");
    var rotulo = el("label", "", TXT.rotulo);
    rotulo.setAttribute("for", cfg.id + "categoria");
    var linha = el("div", "cat-campo");
    var entrada = doc.createElement("input");
    entrada.type = "text";
    entrada.setAttribute("id", cfg.id + "categoria");
    entrada.setAttribute("role", "combobox");
    entrada.setAttribute("aria-expanded", "false");
    entrada.setAttribute("aria-controls", cfg.id + "categoria-lista");
    entrada.setAttribute("aria-autocomplete", "list");
    entrada.setAttribute("autocomplete", "off");
    entrada.setAttribute("autocapitalize", "off");
    entrada.setAttribute("enterkeyhint", "done");
    entrada.setAttribute("placeholder", categorias ? TXT.placeholder : TXT.aguarde);
    var limpar = el("button", "cat-limpar");
    limpar.type = "button";
    limpar.setAttribute("aria-label", TXT.limpar);
    limpar.appendChild(icone("i-fechar"));
    linha.append(entrada, limpar);
    var apoio = el("p", "cat-origem");
    apoio.setAttribute("id", cfg.id + "categoria-apoio");
    var caixa = el("div", "cat-lista");
    caixa.hidden = true;
    var rolagem = el("ul", "cat-rolagem");
    rolagem.setAttribute("id", cfg.id + "categoria-lista");
    rolagem.setAttribute("role", "listbox");
    rolagem.setAttribute("aria-label", "Categorias");
    var vazio = el("div", "cat-vazio");
    vazio.setAttribute("role", "status");
    vazio.hidden = true;
    var rodape = el("div", "cat-rodape");
    var aviso = el("div", "so-leitor");
    aviso.setAttribute("aria-live", "polite");
    caixa.append(rolagem, vazio, rodape);
    raiz.append(rotulo, linha, apoio, caixa, aviso);

    // ---- estados sem lista: carregando e erro ----
    if (!categorias) {
      entrada.disabled = true;
      entrada.value = valor === SEM_CATEGORIA ? TXT.sem : valor; // o que já estava escolhido continua à vista
      if (entrada.value !== "") entrada.removeAttribute("placeholder");
      limpar.hidden = true;
      apoio.hidden = true;
      caixa.hidden = true;
      var st = el("div", "cat-carregando" + (cfg.carregando ? " gira" : ""));
      st.setAttribute("role", "status");
      st.append(icone(cfg.carregando ? "i-enviando" : "i-atencao"), el("span", "", cfg.carregando ? TXT.carregando : TXT.erro));
      raiz.appendChild(st);
      if (!cfg.carregando && typeof cfg.aoTentarDeNovo === "function") {
        var de_novo = el("button", "btn-sec", TXT.tentar);
        de_novo.type = "button";
        de_novo.setAttribute("id", cfg.id + "categoria-tentar");
        de_novo.addEventListener("click", cfg.aoTentarDeNovo);
        raiz.appendChild(de_novo);
      }
      return { raiz: raiz, entrada: entrada, valor: function () { return valor; }, aberto: function () { return false; }, fechar: function () {}, destruir: function () {} };
    }

    // ---- texto do campo e da frase de apoio ----
    function textoDoValor() { return valor === SEM_CATEGORIA ? TXT.sem : valor; }
    function pintarCampo() {
      entrada.value = textoDoValor();
      pintarApoio();
      limpar.hidden = entrada.value === "";
    }
    function pintarApoio() {
      apoio.textContent = "";
      var frase = "", tom = "";
      if (valor === "" && cfg.duvida) { frase = TXT.falta; tom = "atencao"; }
      else if (origem && valor === sugerida) frase = origem === "historico" ? TXT.historico : TXT.modelo;
      apoio.hidden = frase === "";
      if (tom) apoio.setAttribute("data-tom", tom); else apoio.removeAttribute("data-tom");
      if (frase) apoio.append(icone(tom ? "i-atencao" : "i-info"), el("span", "", frase));
      if (valor === "" && cfg.duvida) {
        entrada.setAttribute("aria-invalid", "true");
        entrada.setAttribute("aria-describedby", apoio.id);
      } else {
        entrada.removeAttribute("aria-invalid");
        if (frase) entrada.setAttribute("aria-describedby", apoio.id); else entrada.removeAttribute("aria-describedby");
      }
    }

    // ---- a lista ----
    function trechoMarcado(nome, busca) {
      var span = el("span", "cat-nome");
      var t = busca ? acharTrecho(nome, busca) : null;
      if (!t) { span.textContent = nome; return span; }
      span.append(nome.slice(0, t.de), el("mark", "", nome.slice(t.de, t.ate)), nome.slice(t.ate));
      return span;
    }
    function itemDe(rotuloItem, escolha, busca, extra) {
      var li = el("li", "cat-item");
      li.setAttribute("role", "option");
      li.setAttribute("id", cfg.id + "categoria-o-" + itens.length);
      li.setAttribute("aria-selected", escolha === valor ? "true" : "false");
      li.appendChild(trechoMarcado(rotuloItem, busca));
      if (extra) li.appendChild(el("span", "cat-selo", extra));
      if (escolha === valor) li.appendChild(icone("i-ok"));
      li.addEventListener("click", function () { escolher(escolha); });
      itens.push({ no: li, escolha: escolha });
      return li;
    }
    function grupo(nome) {
      var g = el("li", "cat-grupo", nome);
      g.setAttribute("role", "presentation");
      return g;
    }
    function pintarLista() {
      itens = [];
      rolagem.textContent = "";
      rodape.textContent = "";
      var busca = digitou ? normalizar(texto) : "";
      var achadas = filtrar(categorias, busca);
      if (busca === "") {
        var jaVistas = {};
        if (sugerida) {
          rolagem.appendChild(grupo(TXT.sugerida));
          rolagem.appendChild(itemDe(sugerida, sugerida, "", TXT.sugerida));
          jaVistas[sugerida] = true;
        }
        var u = usadas.filter(function (c) { return !jaVistas[c]; }).slice(0, MAX_USADAS);
        if (u.length) {
          rolagem.appendChild(grupo(TXT.usadas));
          u.forEach(function (c) { rolagem.appendChild(itemDe(c, c, "")); });
        }
        if (categorias.length) {
          rolagem.appendChild(grupo(TXT.todas));
          categorias.forEach(function (c) { rolagem.appendChild(itemDe(c, c, "")); });
        }
      } else {
        achadas.forEach(function (c) { rolagem.appendChild(itemDe(c, c, busca)); });
      }
      var nenhuma = busca !== "" && achadas.length === 0;
      vazio.hidden = !nenhuma;
      vazio.textContent = "";
      if (nenhuma) vazio.append("Nenhuma categoria com “", el("b", "", texto.trim()), "”. Confira as letras ou escolha “Sem categoria”.");
      rolagem.hidden = nenhuma;
      var fim = el("div", "cat-item");
      fim.setAttribute("role", "option");
      fim.setAttribute("id", cfg.id + "categoria-o-" + itens.length);
      fim.setAttribute("aria-selected", valor === SEM_CATEGORIA ? "true" : "false");
      fim.appendChild(el("span", "cat-nome", TXT.sem));
      if (valor === SEM_CATEGORIA) fim.appendChild(icone("i-ok"));
      fim.addEventListener("click", function () { escolher(SEM_CATEGORIA); });
      itens.push({ no: fim, escolha: SEM_CATEGORIA });
      rodape.appendChild(fim);
      ativo = -1;
      entrada.removeAttribute("aria-activedescendant");
      aviso.textContent = busca === "" ? "" : (achadas.length === 0 ? "Nenhuma categoria" : achadas.length + (achadas.length === 1 ? " categoria" : " categorias"));
      ajustarAltura();
    }
    // A caixa usa o menor entre 6 linhas e o espaço que sobra com o teclado aberto (no mínimo 3 linhas).
    function ajustarAltura() {
      var vv = doc.defaultView && doc.defaultView.visualViewport;
      var linhas = LINHAS_MAX;
      if (vv && typeof vv.height === "number" && vv.height > 0) {
        linhas = Math.max(LINHAS_MIN, Math.min(LINHAS_MAX, Math.floor((vv.height - 3 * ALTURA_LINHA - 24) / ALTURA_LINHA)));
      }
      rolagem.style.maxHeight = linhas * ALTURA_LINHA + "px";
    }
    function marcarAtivo(i) {
      if (ativo >= 0 && itens[ativo]) itens[ativo].no.removeAttribute("data-ativo");
      ativo = i;
      if (i >= 0 && itens[i]) {
        itens[i].no.setAttribute("data-ativo", "");
        entrada.setAttribute("aria-activedescendant", itens[i].no.id);
        if (typeof itens[i].no.scrollIntoView === "function") itens[i].no.scrollIntoView({ block: "nearest" });
      } else entrada.removeAttribute("aria-activedescendant");
    }

    // ---- abrir, fechar, escolher ----
    function fora(ev) {
      var alvo = ev && ev.target;
      if (alvo && typeof raiz.contains === "function" && raiz.contains(alvo)) return;
      fechar();
    }
    function abrir() {
      if (aberto) return;
      aberto = true;
      digitou = false;
      texto = "";
      entrada.setAttribute("aria-expanded", "true");
      caixa.hidden = false;
      pintarLista();
      if (typeof entrada.scrollIntoView === "function") entrada.scrollIntoView({ block: "start" });
      if (!ouvindo && typeof doc.addEventListener === "function") { doc.addEventListener("pointerdown", fora, true); ouvindo = true; }
    }
    function fechar() {
      if (ouvindo && typeof doc.removeEventListener === "function") { doc.removeEventListener("pointerdown", fora, true); ouvindo = false; }
      if (!aberto) return;
      aberto = false;
      digitou = false;
      entrada.setAttribute("aria-expanded", "false");
      entrada.removeAttribute("aria-activedescendant");
      caixa.hidden = true;
      pintarCampo(); // texto solto que não é categoria nunca fica: volta ao valor anterior
    }
    function escolher(nova) {
      valor = nova;
      aberto = true; // fechar() faz o resto
      fechar();
      entrada.focus();
      if (typeof cfg.aoMudar === "function") cfg.aoMudar(valor);
    }

    entrada.addEventListener("focus", abrir);
    entrada.addEventListener("click", abrir);
    entrada.addEventListener("input", function () {
      if (!aberto) abrir();
      digitou = true;
      texto = entrada.value;
      limpar.hidden = entrada.value === "";
      pintarLista();
    });
    entrada.addEventListener("keydown", function (ev) {
      var k = ev && ev.key;
      if (k === "ArrowDown" || k === "ArrowUp") {
        if (ev.preventDefault) ev.preventDefault();
        if (!aberto) { abrir(); return; }
        var n = itens.length;
        marcarAtivo(k === "ArrowDown" ? (ativo + 1) % n : (ativo <= 0 ? n - 1 : ativo - 1));
      } else if (k === "Enter") {
        if (aberto && ativo >= 0 && itens[ativo]) { if (ev.preventDefault) ev.preventDefault(); escolher(itens[ativo].escolha); }
        else if (aberto) { if (ev.preventDefault) ev.preventDefault(); fechar(); }
      } else if (k === "Escape" || k === "Tab") {
        fechar();
      }
    });
    limpar.addEventListener("click", function () {
      valor = "";
      entrada.value = "";
      texto = "";
      digitou = true;
      limpar.hidden = true;
      pintarApoio();
      if (!aberto) abrir();
      else pintarLista();
      entrada.focus();
      if (typeof cfg.aoMudar === "function") cfg.aoMudar(valor);
    });

    pintarCampo();
    return {
      raiz: raiz, entrada: entrada,
      valor: function () { return valor; },
      aberto: function () { return aberto; },
      fechar: fechar,
      destruir: function () { if (ouvindo && typeof doc.removeEventListener === "function") doc.removeEventListener("pointerdown", fora, true); ouvindo = false; }
    };
  }

  return { SEM_CATEGORIA: SEM_CATEGORIA, TXT: TXT, normalizar: normalizar, maisUsadas: maisUsadas, filtrar: filtrar, criar: criar };
})();
if (typeof module !== "undefined") module.exports = SeletorCategoria;
