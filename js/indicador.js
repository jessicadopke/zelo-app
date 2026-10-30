// Zelo: indicador da fila de envio (#14, parte E). Textos, atraso do "Enviando…", ligação com a internet e envio automático.
// Sem DOM aqui: quem desenha é js/app.js, que recebe o que mostrar pela função "pintar". No navegador vira o objeto global Indicador.
var Indicador = (function () {
  var Fila_ = typeof Fila !== "undefined" ? Fila : require("./fila.js");
  var Din = typeof Dinheiro !== "undefined" ? Dinheiro : require("./dinheiro.js");
  var Dat = typeof Datas !== "undefined" ? Datas : require("./datas.js");

  var ATRASO_ENVIANDO = 300; // ms: um envio mais curto nem aparece
  var MINIMO_ENVIANDO = 800; // ms: depois de aparecer, fica pelo menos isto

  function plural(n, um, varios) { return n === 1 ? um : varios; }
  function num(n) { return n > 99 ? "99+" : String(n); }

  // e = resultado de Fila.estado: { estado, pendentes, nao_enviados, online, causa }.
  // Devolve { pilula, icone, tom, titulo, apoio, voz }. "voz" vazio = o leitor de tela não anuncia.
  function textos(e) {
    var pend = e.pendentes || 0;
    var nao = e.nao_enviados || 0;
    var lanc = pend + plural(pend, " lançamento", " lançamentos");
    switch (e.estado) {
      case "em-dia":
        return { pilula: "Tudo enviado", icone: "i-ok", tom: "ok", titulo: "Tudo enviado",
          apoio: "Seus lançamentos já estão guardados na planilha da família.", voz: "Tudo enviado." };
      case "enviando":
        return { pilula: "Enviando…", icone: "i-enviando", tom: "enviando", titulo: "Enviando…",
          apoio: "Estou mandando seus lançamentos. Pode continuar usando o app.", voz: "" };
      case "esperando-internet":
        if (e.online === false) {
          return { pilula: num(pend) + " por enviar", icone: "i-semnet", tom: "espera", titulo: "Esperando a internet",
            apoio: "Seus lançamentos estão guardados neste celular. O Zelo envia assim que a conexão voltar.",
            voz: "Sem internet. " + lanc + " por enviar." };
        }
        return { pilula: num(pend) + " por enviar", icone: "i-semnet", tom: "espera", titulo: "Não consegui enviar agora",
          apoio: "Seus lançamentos continuam guardados neste celular. O Zelo tenta de novo quando você abrir o app, salvar um gasto ou a internet voltar.",
          voz: lanc + " por enviar." };
      case "esperando":
        return { pilula: num(pend) + " por enviar", icone: "i-espera", tom: "espera", titulo: "Vai enviar em instantes",
          apoio: "Seus lançamentos estão guardados neste celular e seguem para a planilha logo.", voz: "" };
      case "precisa-de-atencao":
        if (e.causa === "semconfig") {
          return { pilula: "Falta configurar o envio", icone: "i-atencao", tom: "atencao", titulo: "Falta configurar o envio",
            apoio: "Informe o endereço e o código do aparelho em Ligação com a planilha, logo abaixo. Enquanto isso, os lançamentos ficam guardados neste celular.",
            voz: "Falta configurar o envio. Toque para ver." };
        }
        if (e.causa === "codigo") {
          return { pilula: "Celular não reconhecido", icone: "i-atencao", tom: "atencao", titulo: "Este celular não foi reconhecido",
            apoio: "Confira o código do aparelho em Ligação com a planilha, logo abaixo. Seus lançamentos continuam guardados aqui.",
            voz: "Celular não reconhecido. Toque para ver." };
        }
        return { pilula: nao + plural(nao, " não enviado", " não enviados"), icone: "i-atencao", tom: "atencao",
          titulo: nao + plural(nao, " lançamento não enviado", " lançamentos não enviados"),
          apoio: "A planilha não aceitou. Veja o motivo abaixo, corrija o lançamento e salve de novo.",
          voz: nao + plural(nao, " lançamento não enviado", " lançamentos não enviados") + ". Toque para ver." };
    }
    return textos({ estado: "em-dia" });
  }

  // "2030-01-15T12:30:00.000Z" -> "15/01/2030, 09:30" (hora local do celular); vazio -> "Ainda não enviou".
  function horaLocal(iso) {
    if (typeof iso !== "string" || !iso) return "Ainda não enviou";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "Ainda não enviou";
    var dois = function (n) { return (n < 10 ? "0" : "") + n; };
    var dia = d.getFullYear() + "-" + dois(d.getMonth() + 1) + "-" + dois(d.getDate());
    return Dat.paraTela(dia) + ", " + dois(d.getHours()) + ":" + dois(d.getMinutes());
  }

  // opcoes: { db, fila, ponte (função ou null), janela ({ addEventListener, navigator }), pintar(visao), agendar, cancelar, agora }
  // pintar recebe { carregando } | { erro } | { estado, texto, detalhe, voz, podeEnviar, online }.
  function criar(opcoes) {
    var db = opcoes.db;
    var fila = opcoes.fila || Fila_;
    var ponte = opcoes.ponte || null;
    var janela = opcoes.janela;
    var agendar = opcoes.agendar || function (fn, ms) { return setTimeout(fn, ms); };
    var cancelar = opcoes.cancelar || function (t) { clearTimeout(t); };
    var agora = opcoes.agora || function () { return Date.now(); };
    var pintar = opcoes.pintar;
    // Chamada depois de enviar e receber sem parar (ex.: baixar as opções da planilha). Opcional.
    var aoSincronizar = typeof opcoes.aoSincronizar === "function" ? opcoes.aoSincronizar : null;
    var online = !(janela && janela.navigator && janela.navigator.onLine === false);
    var ultimo = null;     // estado real mais recente
    var mostrado = null;   // estado que está na tela
    var mostradoEm = 0;
    var timer = null;
    var chaveVoz = null;   // o que foi anunciado por último
    var desligar = null;
    var geracao = 0;       // descarta leituras antigas que chegam atrasadas
    // Sincronização para as telas de ver (#19): só em memória. tentativaEm/sincronizadoEm em milissegundos.
    var sinc = { sincronizando: false, tentou: false, tentativaEm: null, sincronizadoEm: null };
    var ouvintesSinc = [];
    function avisarSinc() {
      var foto = { sincronizando: sinc.sincronizando, tentou: sinc.tentou, tentativaEm: sinc.tentativaEm, sincronizadoEm: sinc.sincronizadoEm };
      ouvintesSinc.slice().forEach(function (f) { try { f(foto); } catch (_) { /* uma tela com defeito não atrapalha o envio */ } });
    }

    function configurado() {
      if (!ponte) return Promise.resolve(false);
      return Promise.all([db.config.obter("url_ponte"), db.config.obter("codigo_aparelho")]).then(function (v) { return !!(v[0] && v[1]); });
    }

    // Lê o banco. Falta de configuração só conta quando há o que enviar (não assusta quem acabou de instalar).
    function ler() {
      return Promise.all([db.fila.contar(), configurado()]).then(function (v) {
        return fila.lerEstado(db, online, v[0] > 0 ? v[1] : true);
      });
    }

    function detalhe() {
      return Promise.all([db.config.obter("ultimo_envio_em"), db.lancamentos.todos()]).then(function (v) {
        var recusados = v[1].filter(function (l) { return l.situacao === "nao_enviado"; }).map(function (l) {
          return { titulo: l.favorecido + " · " + Din.formatar(l.valor_centavos) + " · " + Dat.paraTela(l.data), motivo: l.motivo_recusa || "" };
        });
        return { ultimoEnvio: horaLocal(v[0]), recusados: recusados };
      });
    }

    function mostrar(e) {
      return detalhe().then(function (det) {
        var t = textos(e);
        var antes = mostrado;
        mostrado = e;
        mostradoEm = agora();
        // Anuncia só quando muda (nunca na primeira vez, nunca em "Enviando…" nem "Vai enviar": a voz vem vazia).
        var chave = e.estado + "|" + t.pilula + "|" + (e.online === false);
        var anuncia = chaveVoz !== null && chaveVoz !== chave;
        chaveVoz = chave;
        pintar({
          estado: e, texto: t, detalhe: det, online: online,
          voz: anuncia ? t.voz : "",
          podeEnviar: e.pendentes > 0 && online && e.estado !== "enviando" && e.estado !== "precisa-de-atencao",
          mudou: !antes || antes.estado !== e.estado,
        });
      });
    }

    // Aplica a regra do "Enviando…": só aparece depois de 300 ms e fica 800 ms.
    function decidir() {
      var e = ultimo;
      if (!e) return Promise.resolve();
      if (timer !== null) { cancelar(timer); timer = null; }
      if (e.estado === "enviando") {
        if (mostrado && mostrado.estado === "enviando") return mostrar(e);
        timer = agendar(function () { timer = null; if (ultimo && ultimo.estado === "enviando") mostrar(ultimo); }, ATRASO_ENVIANDO);
        return Promise.resolve();
      }
      if (mostrado && mostrado.estado === "enviando") {
        var falta = MINIMO_ENVIANDO - (agora() - mostradoEm);
        if (falta > 0) {
          timer = agendar(function () { timer = null; if (ultimo) mostrar(ultimo); }, falta);
          return Promise.resolve();
        }
      }
      return mostrar(e);
    }

    function atualizar() {
      var minha = ++geracao;
      return ler().then(function (e) {
        if (minha !== geracao) return;
        ultimo = e;
        return decidir();
      }).catch(function () {
        if (minha === geracao) { ultimo = null; mostrado = null; pintar({ erro: true }); }
      });
    }

    // Envia o que está na fila e, se o envio terminou sem parar, baixa o que mudou na planilha (contrato seção 6).
    // Não faz nada sem internet, sem ponte ou sem configuração. Nunca lança.
    function tentarEnviar() {
      if (!online || !ponte) return Promise.resolve({ pulou: true });
      var comecou = false;
      return Promise.all([db.fila.contar(), configurado()]).then(function (v) {
        if (!v[1]) return { pulou: true };
        comecou = true;
        sinc.sincronizando = true;
        sinc.tentativaEm = agora();
        avisarSinc();
        var envio = v[0] ? fila.enviar(db, ponte) : Promise.resolve({});
        return envio.then(function (res) {
          if (res.parou || res.jaEnviando || typeof ponte.chamar !== "function") return res;
          return fila.receber(db, ponte).then(function (rec) {
            res.recebimento = rec;
            if (rec && !rec.parou && !rec.jaRecebendo) sinc.sincronizadoEm = agora();
            if (aoSincronizar && !(rec && rec.parou)) { try { aoSincronizar(); } catch (_) { /* nunca atrapalha o envio */ } }
            return res;
          });
        });
      }).catch(function () { return { pulou: true }; }).then(function (res) {
        if (comecou) { sinc.sincronizando = false; sinc.tentou = true; avisarSinc(); }
        return res;
      });
    }
    // Telas de ver: quem quer saber quando uma rodada começa e termina. Devolve a função que desliga.
    function aoSincronia(f) {
      ouvintesSinc.push(f);
      return function () { ouvintesSinc = ouvintesSinc.filter(function (o) { return o !== f; }); };
    }
    function sincronia() { return { sincronizando: sinc.sincronizando, tentou: sinc.tentou, tentativaEm: sinc.tentativaEm, sincronizadoEm: sinc.sincronizadoEm }; }

    function iniciar() {
      pintar({ carregando: true });
      if (janela && janela.addEventListener) {
        janela.addEventListener("online", function () { online = true; atualizar().then(tentarEnviar); });
        janela.addEventListener("offline", function () { online = false; atualizar(); });
      }
      desligar = fila.aoMudar(function (evento) {
        atualizar();
        // Salvou ou editou: tenta enviar já. Não reage a "enviando/terminou/falhou": sem repetição por tempo.
        if (evento === "criou" || evento === "editou") tentarEnviar();
      });
      // Ao abrir o app: mostra o estado e tenta enviar.
      return atualizar().then(tentarEnviar);
    }

    function parar() { if (desligar) desligar(); desligar = null; if (timer !== null) { cancelar(timer); timer = null; } }

    return { iniciar: iniciar, atualizar: atualizar, tentarEnviar: tentarEnviar, aoSincronia: aoSincronia, sincronia: sincronia, parar: parar };
  }

  return { ATRASO_ENVIANDO: ATRASO_ENVIANDO, MINIMO_ENVIANDO: MINIMO_ENVIANDO, textos: textos, horaLocal: horaLocal, criar: criar };
})();
if (typeof module !== "undefined") module.exports = Indicador;
