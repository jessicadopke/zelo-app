// Zelo: lógica da tela Ajustes (#20): validar a ligação com a ponte, entender o resultado do teste, versões e atualização.
// Sem DOM e sem armazenamento próprio: quem desenha é js/app.js. O endereço e o código só passam por aqui para o banco
// do aparelho (db.config) e nunca entram em mensagem, console ou URL. No navegador vira o objeto global Ajustes.
var Ajustes = (function () {
  var TEXTOS = {
    url_vazio: "Cole o endereço da ponte.",
    url_sem_https: "O endereço precisa começar com https://.",
    codigo_vazio: "Digite o código deste celular.",
    sem_internet: "Sem internet. O app envia quando a conexão voltar.",
    tempo_esgotado: "A ponte demorou para responder. O app tenta de novo.",
    resposta_estranha: "A ponte respondeu algo inesperado. Confira o endereço em Ajustes.",
    endereco_invalido: "O endereço da ponte precisa começar com https://. Confira em Ajustes.",
    sem_configuracao: "Falta configurar a ponte em Ajustes.",
    codigo_invalido: "Este celular não foi reconhecido. Confira o código do aparelho em Ajustes.",
    versao_incompativel: "A ponte está desatualizada e precisa ser publicada de novo.",
    interno: "Algo deu errado na ponte. O app tenta de novo mais tarde.",
  };

  // Tira todo espaço e quebra de linha (das pontas e de dentro: endereço e código não têm espaço).
  function limpar(valor) {
    return typeof valor === "string" ? valor.replace(/\s+/g, "") : "";
  }

  // Devolve { ok, url, codigo, erros: { url?, codigo? } } com os valores já limpos. Nada é gravado aqui.
  function validar(campos) {
    var c = campos || {};
    var url = limpar(c.url);
    var codigo = limpar(c.codigo);
    var erros = {};
    if (!url) erros.url = TEXTOS.url_vazio;
    else if (!/^https:\/\//i.test(url)) erros.url = TEXTOS.url_sem_https;
    if (!codigo) erros.codigo = TEXTOS.codigo_vazio;
    return { ok: !erros.url && !erros.codigo, url: url, codigo: codigo, erros: erros };
  }

  // Lê o que está guardado no aparelho: { url, codigo } (texto vazio se não houver).
  function carregar(db) {
    return Promise.all([db.config.obter("url_ponte"), db.config.obter("codigo_aparelho")]).then(function (v) {
      return { url: typeof v[0] === "string" ? v[0] : "", codigo: typeof v[1] === "string" ? v[1] : "" };
    });
  }

  // Valida e só então grava. Com erro, não grava nada. Devolve o resultado de validar().
  function salvar(db, campos) {
    var v = validar(campos);
    if (!v.ok) return Promise.resolve(v);
    return db.config.definir("url_ponte", v.url).then(function () {
      return db.config.definir("codigo_aparelho", v.codigo);
    }).then(function () { return v; });
  }

  // Resposta da ponte (ou erro local do app) -> { tom: ok|atencao|erro|info, icone, titulo, apoio, versao }.
  function textoDoResultado(resposta) {
    var r = resposta && typeof resposta === "object" ? resposta : {};
    if (r.ok === true) {
      var d = r.dados && typeof r.dados === "object" ? r.dados : {};
      var versao = typeof d.versao_script === "string" ? d.versao_script : "";
      var pl = d.planilha && typeof d.planilha === "object" ? d.planilha : null;
      if (pl && pl.ok === false) {
        var faltam = Array.isArray(pl.faltam) ? pl.faltam.filter(function (f) { return typeof f === "string"; }).join(", ") : "";
        return { tom: "atencao", icone: "i-atencao", titulo: "A ponte respondeu, mas a planilha está sem: " + faltam + ".", apoio: "", versao: versao };
      }
      var nome = typeof d.aparelho === "string" && d.aparelho ? d.aparelho : "";
      return { tom: "ok", icone: "i-ok", titulo: "Tudo certo. Este celular é o de " + nome + ".",
        apoio: versao ? "Versão da ponte: " + versao : "", versao: versao };
    }
    var e = r.erro && typeof r.erro === "object" ? r.erro : {};
    var codigo = typeof e.codigo === "string" ? e.codigo : "";
    var msg = typeof e.mensagem === "string" ? e.mensagem.trim() : "";
    var daPonte = r.local !== true;
    var res = function (tom, icone, titulo, apoio) { return { tom: tom, icone: icone, titulo: titulo, apoio: apoio || "", versao: "" }; };
    switch (codigo) {
      case "sem_internet": return res("info", "i-semnet", TEXTOS.sem_internet, "Conecte e teste de novo.");
      case "tempo_esgotado": return res("info", "i-espera", TEXTOS.tempo_esgotado);
      case "resposta_estranha": case "endereco_invalido": case "sem_configuracao":
        return res("erro", "i-atencao", TEXTOS[codigo]);
      case "codigo_invalido": case "versao_incompativel":
        return res("erro", "i-atencao", daPonte && msg ? msg : TEXTOS[codigo]);
      case "interno":
        return res("erro", "i-atencao", daPonte && /^A planilha está sem a coluna/.test(msg) ? msg : TEXTOS.interno);
      default:
        return res("erro", "i-atencao", msg || TEXTOS.interno);
    }
  }

  // Chama "estado" na ponte. Nunca lança. Devolve o texto do resultado ({ tom, icone, titulo, apoio, versao }) e se deu certo.
  function testarLigacao(opcoes) {
    var ponte = opcoes && opcoes.ponte;
    if (!ponte || typeof ponte.chamar !== "function") {
      return Promise.resolve({ conferido: false, resultado: textoDoResultado({ ok: false, local: true, erro: { codigo: "sem_configuracao" } }) });
    }
    return Promise.resolve().then(function () { return ponte.chamar("estado", {}); }).then(function (resp) {
      var resultado = textoDoResultado(resp);
      return { conferido: resultado.tom === "ok", resultado: resultado };
    }).catch(function () {
      return { conferido: false, resultado: textoDoResultado({ ok: false, local: true, erro: { codigo: "resposta_estranha" } }) };
    });
  }

  function maiorMenor(v) {
    var m = /^(\d+)\.(\d+)/.exec(typeof v === "string" ? v.trim() : "");
    return m ? m[1] + "." + m[2] : null;
  }

  // true quando o número maior ou o menor (X.Y) é diferente. Versão que não dá para ler = não avisa.
  function compararVersoes(app, script) {
    var a = maiorMenor(app), s = maiorMenor(script);
    return a !== null && s !== null && a !== s;
  }

  // container = navigator.serviceWorker. Devolve "atualizado" | "nova" | "falha". Não recarrega nada.
  function buscarAtualizacao(container) {
    return Promise.resolve().then(function () {
      if (!container || typeof container.getRegistration !== "function") return "falha";
      return container.getRegistration().then(function (reg) {
        if (!reg || typeof reg.update !== "function") return "falha";
        return reg.update().then(function () { return reg.installing || reg.waiting ? "nova" : "atualizado"; });
      });
    }).catch(function () { return "falha"; });
  }

  // Como o botão do olho fica: visivel=true mostra o código (type text).
  function estadoOlho(visivel) {
    return visivel
      ? { tipo: "text", pressionado: true, rotulo: "Ocultar código", texto: "Ocultar", icone: "i-olho-fechado" }
      : { tipo: "password", pressionado: false, rotulo: "Mostrar código", texto: "Mostrar", icone: "i-olho" };
  }

  return { TEXTOS: TEXTOS, estadoOlho: estadoOlho, limpar: limpar, validar: validar, carregar: carregar, salvar: salvar,
    textoDoResultado: textoDoResultado, testarLigacao: testarLigacao, compararVersoes: compararVersoes, buscarAtualizacao: buscarAtualizacao };
})();
if (typeof module !== "undefined") module.exports = Ajustes;
