// Zelo: a tela "Contas a pagar" (#120). Mora dentro do Início (#contas). Só desenho e ligação: as regras (grupos, ordem,
// textos, erros) são de Contas; a cópia local vem do banco. Todo texto da planilha (favorecido, categoria) entra com
// textContent, nunca como HTML. Nada vai para console, localStorage nem URL. O app só lê: nenhum botão grava conta.
// No navegador vira o objeto global TelaContas.
var TelaContas = (function () {
  var Con = typeof Contas !== "undefined" ? Contas : require("./contas.js");
  var Fil = typeof Fila !== "undefined" ? Fila : require("./fila.js");

  // Leitura rápida ao tocar em "Pagar" (#121, D2-A): no máximo isto, depois abre o formulário do mesmo jeito.
  var ESPERA_CONFERIR_MS = 3000;

  var SVG_NS = "http://www.w3.org/2000/svg";

  // env: { doc, pronto: Promise<{ db, ponte } | null>, hoje(), online(), agora() (ms), sair(), pagar(conta) (abre o Novo já com a conta) }
  function criar(env) {
    var doc = env.doc || document;
    var $ = function (id) { return doc.getElementById(id); };
    var ctx = null, aberta = false, geracao = 0;
    var dados = null;            // { lista, ultima } lidos do banco
    var erro = null;             // { codigo, mensagem } da última leitura que não deu certo
    var atualizando = false, todasPagas = false;
    var contadorGrupos = 0;
    var desligar = null, desligarFila = null;
    var conferindo = "";         // id da conta que está sendo conferida antes de abrir o pagamento
    var aviso = "";              // "ja_paga" | "guardado" | "": faixa no alto da lista
    var pagando = false;         // abriu o pagamento daqui: o próximo "criou" da fila é este pagamento

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

    // ---- leitura da cópia local ----
    function ler() {
      var minha = ++geracao;
      if (!ctx || !ctx.db || !ctx.db.contas) return Promise.reject(new Error("sem banco"));
      var lancs = ctx.db.lancamentos ? ctx.db.lancamentos.todos() : Promise.resolve([]);
      return Promise.all([ctx.db.contas.todas(), ctx.db.config.obter("ultima_leitura_contas"), lancs]).then(function (v) {
        if (minha !== geracao) return dados;
        // A cópia local não muda: "paga, falta enviar" é derivado dos lançamentos com conta_id (D1-A).
        dados = { lista: Con.comPagamentosLocais(v[0] || [], v[2] || []), ultima: typeof v[1] === "string" ? v[1] : null };
        return dados;
      });
    }
    function temDados() { return !!dados && (dados.lista.length > 0 || dados.ultima !== null); }

    // ---- peças ----
    function cartao(icone, titulo, apoio, extra, gira) {
      var c = el("div", "cartao");
      c.setAttribute("role", "status");
      c.appendChild(ic(icone, "ic-grande" + (gira ? " ic-gira" : "")));
      var p = el("p");
      p.appendChild(el("strong", "", titulo));
      c.appendChild(p);
      if (apoio) c.appendChild(el("p", "", apoio));
      if (extra) c.appendChild(extra);
      return c;
    }
    function faixa(e) {
      var offline = Con.erroSemCopia(e).tipo === "offline";
      var f = el("div", "faixa contas-aviso " + (offline ? "faixa-info" : "faixa-erro"));
      f.setAttribute("role", "status");
      f.append(ic(offline ? "i-semnet" : "i-atencao"), el("div", "", Con.mensagemDeErro(e)));
      return f;
    }
    function metaDom() {
      var m = el("div", "meta");
      var t = el("div", "meta-txt");
      var at = dados ? Con.textoAtualizado(dados.ultima, new Date(env.agora())) : null;
      if (at) {
        var p = el("p", "apoio contas-atualizado");
        if (at.velho) { p.setAttribute("data-velho", "true"); p.appendChild(ic("i-atencao")); }
        p.append(at.texto);
        t.appendChild(p);
      }
      var b = botao("btn-atualizar", "", function () { atualizar(); });
      b.setAttribute("data-foco", "atualizar");
      if (atualizando) { b.setAttribute("aria-busy", "true"); b.disabled = true; }
      b.append(ic("i-enviando"), atualizando ? "Atualizando…" : "Atualizar");
      m.append(t, b);
      return m;
    }
    function dinDom(v) {
      var s = el("span", "din");
      s.setAttribute("data-tipo", v.estado === "a_pagar" ? "apagar" : v.estado);
      var p = el("span", "din-p");
      if (v.estado === "vencida") p.appendChild(ic("i-atencao"));
      else if (v.estado === "paga") p.appendChild(ic("i-ok"));
      p.append(v.palavra);
      s.append(p, el("b", "din-v", v.valor));
      return s;
    }
    function contaDom(c, hoje) {
      var v = Con.formatarLinha(c, hoje);
      var li = el("li");
      var linha = el("div", "conta");
      if (v.podePagar) linha.setAttribute("data-pagar", "");
      var txt = el("div", "conta-txt");
      txt.appendChild(el("p", "conta-fav", v.favorecido));
      txt.appendChild(el("p", "conta-sub", v.vencimento));
      if (v.categoria) txt.appendChild(el("p", "conta-sub", v.categoria));
      if (v.prazo) {
        var pz = el("p", "conta-prazo");
        if (v.prazo.tom === "vencida") { pz.setAttribute("data-tom", "vencida"); pz.appendChild(ic("i-atencao")); }
        pz.append(v.prazo.texto);
        txt.appendChild(pz);
      }
      if (v.selo) {
        var sl = el("p", "conta-selo");
        var marca = el("span", "marca");
        marca.setAttribute("data-tom", "esperando");
        marca.append(ic("i-espera"), v.selo);
        sl.appendChild(marca);
        txt.appendChild(sl);
      }
      linha.append(txt, dinDom(v));
      if (v.podePagar) {
        var bp = botao("conta-pagar", "", function () { pagar(c); });
        bp.setAttribute("aria-label", "Pagar a conta de " + c.favorecido);
        bp.setAttribute("data-foco", "pagar-" + c.id);
        if (conferindo) { bp.disabled = true; if (conferindo === c.id) { bp.setAttribute("aria-busy", "true"); bp.appendChild(ic("i-enviando")); } }
        bp.append("Pagar");
        linha.appendChild(bp);
      }
      li.appendChild(linha);
      return li;
    }
    function grupoDom(id, titulo, apoio, lista, hoje, itens, extra) {
      var sec = el("section", "contas-sec");
      sec.setAttribute("data-grupo", id);
      var hid = "ct-h-" + (++contadorGrupos);
      sec.setAttribute("aria-labelledby", hid);
      var h = el("h2");
      h.setAttribute("id", hid);
      if (id === "vencidas") h.appendChild(ic("i-atencao"));
      var n = lista.length;
      var cont = el("span", "contas-n", String(n));
      cont.setAttribute("aria-hidden", "true");
      h.append(titulo, cont, el("span", "so-leitor", Con.plural(n, "conta", "contas")));
      var ul = el("ul", "contas-lista");
      itens.forEach(function (c) { ul.appendChild(contaDom(c, hoje)); });
      sec.append(h, el("p", "apoio", apoio), ul);
      if (extra) sec.appendChild(extra);
      return sec;
    }

    function avisoDom() {
      var f = el("div", "faixa faixa-info contas-aviso");
      f.setAttribute("role", "status");
      f.append(ic("i-ok"), el("div", "", aviso === "ja_paga" ? "Esta conta já foi paga." : "Pagamento guardado. A conta foi para Pagas."));
      return f;
    }

    function listaDom() {
      var hoje = env.hoje();
      var g = Con.agrupar(dados.lista, hoje);
      var raiz = el("div");
      if (aviso) raiz.appendChild(avisoDom());
      if (g.vencidas.length) raiz.appendChild(grupoDom("vencidas", "Vencidas", "A mais antiga fica em cima.", g.vencidas, hoje, g.vencidas));
      if (g.aPagar.length) raiz.appendChild(grupoDom("pagar", "A pagar", "A que vence primeiro fica em cima.", g.aPagar, hoje, g.aPagar));
      if (!g.vencidas.length && !g.aPagar.length && g.pagas.length) {
        raiz.appendChild(cartao("i-ok", "Tudo em dia", "Nenhuma conta vencida ou a pagar."));
      }
      if (g.pagas.length) {
        var extra = null;
        if (!todasPagas && g.pagas.length > Con.LIMITE_PAGAS) {
          extra = botao("btn-sec contas-mais", "Ver todas as pagas", function () {
            todasPagas = true;
            desenhar();
          });
          extra.setAttribute("data-foco", "mais");
        }
        raiz.appendChild(grupoDom("pagas", "Pagas", "As mais recentes ficam em cima.", g.pagas, hoje, Con.pagasVisiveis(g.pagas, todasPagas), extra));
      }
      return raiz;
    }

    // ---- desenho ----
    function desenhar() {
      if (!aberta) return;
      var corpo = $("contas-conteudo");
      if (!corpo) return;
      var focoAntes = doc.activeElement && doc.activeElement.getAttribute ? doc.activeElement.getAttribute("data-foco") : null;
      var raiz = el("div");
      if (!temDados()) {
        if (!erro) {
          raiz.appendChild(cartao("i-enviando", "Buscando as contas…", "", null, true));
        } else {
          var e = Con.erroSemCopia(erro);
          var b = e.tentar ? botao("btn-sec", "Tentar de novo", function () { sincronizar(); }) : null;
          if (b) b.setAttribute("data-foco", "de-novo");
          raiz.appendChild(cartao(e.tipo === "offline" ? "i-semnet" : "i-atencao", e.titulo, e.apoio, b));
        }
      } else {
        if (erro) raiz.appendChild(faixa(erro));
        raiz.appendChild(metaDom());
        if (dados.lista.length === 0) raiz.appendChild(cartao("i-vazio", "Nenhuma conta por aqui ainda.", "As contas aparecem quando forem lançadas na planilha."));
        else raiz.appendChild(listaDom());
      }
      var area = $("conteudo");
      var rolagem = area ? area.scrollTop : 0;
      corpo.replaceChildren(raiz);
      if (area) area.scrollTop = rolagem;
      if (focoAntes) {
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

    // ---- pagar (#121): confere rápido se o outro celular já pagou (D2-A) e abre o Novo já preenchido ----
    function pagar(conta) {
      if (conferindo || !ctx || typeof env.pagar !== "function") return Promise.resolve();
      aviso = "";
      var abrirForm = function () { pagando = true; env.pagar(conta); };
      if (!ctx.ponte || typeof ctx.ponte.chamar !== "function" || env.online() === false) { abrirForm(); return Promise.resolve(); }
      conferindo = conta.id;
      desenhar();
      var fim;
      var espera = new Promise(function (ok) { fim = setTimeout(ok, ESPERA_CONFERIR_MS); });
      var leitura = Con.receber(ctx.db, ctx.ponte, { completo: true, relogio: function () { return new Date(env.agora()); } }).catch(function () { return null; });
      return Promise.race([leitura, espera]).then(function () {
        clearTimeout(fim);
        return ctx.db.contas.obter(conta.id).catch(function () { return null; });
      }).then(function (c) {
        conferindo = "";
        if (!aberta) return null;
        if (c && c.situacao === "paga") {
          aviso = "ja_paga";
          return ler().catch(function () { return null; }).then(function () { desenhar(); });
        }
        desenhar();
        abrirForm();
        return null;
      });
    }

    // ---- ler da planilha (leitura completa: abrir a tela e o botão Atualizar) ----
    function sincronizar() {
      if (!aberta || !ctx || atualizando) return Promise.resolve();
      if (!ctx.ponte || typeof ctx.ponte.chamar !== "function") {
        erro = { codigo: "sem_configuracao" };
        desenhar();
        return Promise.resolve();
      }
      if (env.online() === false) {
        erro = { codigo: "sem_internet" };
        desenhar();
        return Promise.resolve();
      }
      atualizando = true;
      desenhar();
      return Con.receber(ctx.db, ctx.ponte, { completo: true, relogio: function () { return new Date(env.agora()); } }).then(function (res) {
        if (res && res.parou) erro = { codigo: res.motivo, mensagem: res.mensagem };
        else if (res && !res.jaRecebendo) erro = null;
        return ler().catch(function () { return null; });
      }, function () {
        erro = { codigo: "outro" };
      }).then(function () {
        atualizando = false;
        desenhar();
      });
    }
    function atualizar() { return sincronizar(); }

    // ---- o que o app chama ----
    function abrir() {
      aberta = true;
      todasPagas = false;
      aviso = "";
      pagando = false;
      conferindo = "";
      erro = null;
      atualizando = false;
      var h1 = $("ct-titulo");
      if (h1 && h1.focus) h1.focus({ preventScroll: true });
      if (!ctx) { dados = null; desenhar(); }
      return env.pronto.then(function (c) {
        if (!c) throw new Error("sem banco");
        ctx = c;
        ligar();
        return ler();
      }).then(function () {
        if (!aberta) return false;
        desenhar();
        return sincronizar().then(function () { return true; });
      }).catch(function () {
        if (!aberta) return false;
        erro = { codigo: "outro" };
        desenhar();
        return false;
      });
    }
    // Quando a leitura em segundo plano muda a cópia, a lista aberta acompanha.
    function ligar() {
      if (desligar) return;
      desligar = Con.aoMudar(function () {
        if (!aberta || atualizando) return;
        ler().then(function () { desenhar(); }).catch(function () {});
      });
      // Lançamento criado, editado, apagado ou enviado: a derivação "paga, falta enviar" acompanha.
      if (Fil.aoMudar) desligarFila = Fil.aoMudar(function (evento) {
        if (!aberta || atualizando || ["criou", "editou", "terminou", "recebeu"].indexOf(evento) < 0) return;
        if (evento === "criou" && pagando) { pagando = false; aviso = "guardado"; }
        ler().then(function () {
          desenhar();
          if (aviso === "guardado") { var h1 = $("ct-titulo"); if (h1 && h1.focus) h1.focus({ preventScroll: true }); }
        }).catch(function () {});
      });
    }
    function fechar() { aberta = false; }
    function rede() {
      if (!aberta) return;
      if (env.online() === false) {
        if (!erro) { erro = { codigo: "sem_internet" }; desenhar(); }
      } else if (erro && Con.erroSemCopia(erro).tipo === "offline") {
        erro = null;
        desenhar();
        sincronizar();
      }
    }
    function parar() { if (desligar) desligar(); desligar = null; if (desligarFila) desligarFila(); desligarFila = null; aberta = false; }

    var voltar = $("ct-voltar");
    if (voltar) voltar.addEventListener("click", function () { env.sair(); });

    return { abrir: abrir, fechar: fechar, rede: rede, parar: parar, aberta: function () { return aberta; } };
  }

  return { criar: criar };
})();
if (typeof module !== "undefined") module.exports = TelaContas;
