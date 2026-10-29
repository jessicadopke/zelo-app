// Zelo: cliente da ponte (Google Apps Script). Monta o pedido do contrato, fala com a ponte e entende a resposta.
// No navegador vira o objeto global Ponte. Contrato: docs/contrato-ponte.md (seções 1, 2 e 10).
// O endereço e o código do aparelho vêm só de lerConfig() (o que a pessoa digitou em Ajustes, guardado no celular):
// nunca ficam aqui, nunca vão na URL e nunca aparecem em mensagem. Sem DOM, sem armazenamento, sem console.
// ponte(lote) e ponte.chamar(acao, dados) NUNCA lançam: falhas só do app voltam como { ok: false, local: true, erro }.
var Ponte = (function () {
  var CONTRATO = 1;
  var TEMPO_LIMITE = 30000; // ms (contrato seção 1)

  var MENSAGENS = {
    sem_internet: "Sem internet. O app envia quando a conexão voltar.",
    tempo_esgotado: "A ponte demorou para responder. O app tenta de novo.",
    resposta_estranha: "A ponte respondeu algo inesperado. Confira o endereço em Ajustes.",
    sem_configuracao: "Falta configurar a ponte em Ajustes.",
    endereco_invalido: "O endereço da ponte precisa começar com https://. Confira em Ajustes.",
  };

  function local(codigo) {
    return { ok: false, local: true, erro: { codigo: codigo, mensagem: MENSAGENS[codigo] } };
  }

  // opcoes: { lerConfig() -> Promise<{ url, codigo }>, fetch, versaoApp, tempoLimite, setTimeout, clearTimeout, AbortController }
  function criar(opcoes) {
    var op = opcoes || {};
    var lerConfig = op.lerConfig || function () { return Promise.resolve(null); };
    var versaoApp = typeof op.versaoApp === "string" ? op.versaoApp : "";
    var limite = typeof op.tempoLimite === "number" ? op.tempoLimite : TEMPO_LIMITE;

    function chamar(acao, dados) {
      return executar(acao, dados).catch(function () { return local("resposta_estranha"); });
    }

    async function executar(acao, dados) {
      var cfg = null;
      try { cfg = await lerConfig(); } catch (_) { cfg = null; }
      var url = cfg && typeof cfg.url === "string" ? cfg.url.trim() : "";
      var codigo = cfg && typeof cfg.codigo === "string" ? cfg.codigo.trim() : "";
      if (!url || !codigo) return local("sem_configuracao");
      if (!/^https:\/\//i.test(url)) return local("endereco_invalido");

      var buscar = op.fetch || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
      var Controle = op.AbortController || (typeof AbortController !== "undefined" ? AbortController : null);
      var agendar = op.setTimeout || (typeof setTimeout !== "undefined" ? setTimeout : null);
      var desagendar = op.clearTimeout || (typeof clearTimeout !== "undefined" ? clearTimeout : null);
      if (!buscar) return local("sem_internet");

      var corpo = JSON.stringify({ contrato: CONTRATO, acao: acao, codigo: codigo, versao_app: versaoApp, dados: dados === undefined ? {} : dados });
      var controle = Controle ? new Controle() : null;
      var estourou = false;
      var timer = null;
      if (controle && agendar) timer = agendar(function () { estourou = true; controle.abort(); }, limite);

      try {
        var resp;
        var texto;
        try {
          resp = await buscar(url, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: corpo,
            redirect: "follow",
            signal: controle ? controle.signal : undefined,
          });
          if (!resp || resp.status !== 200) return local("resposta_estranha");
          texto = await resp.text();
        } catch (_) {
          return local(estourou ? "tempo_esgotado" : "sem_internet");
        }
        var env;
        try { env = JSON.parse(texto); } catch (_) { return local("resposta_estranha"); }
        if (!env || typeof env !== "object" || Array.isArray(env) || typeof env.ok !== "boolean") return local("resposta_estranha");
        if (env.ok === false && (!env.erro || typeof env.erro !== "object" || typeof env.erro.codigo !== "string")) return local("resposta_estranha");
        return env;
      } finally {
        if (timer !== null && desagendar) desagendar(timer);
      }
    }

    var ponte = function (lote) { return chamar("gravar_lancamentos", lote); };
    ponte.chamar = chamar;
    return ponte;
  }

  return { CONTRATO: CONTRATO, TEMPO_LIMITE: TEMPO_LIMITE, MENSAGENS: MENSAGENS, criar: criar };
})();
if (typeof module !== "undefined") module.exports = Ponte;
