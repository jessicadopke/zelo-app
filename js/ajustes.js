// Zelo: lógica da tela Ajustes (#20): validar a ligação com a ponte, entender o resultado do teste, versões e atualização.
// Sem DOM e sem armazenamento próprio: quem desenha é js/app.js. O endereço e o código só passam por aqui para o banco
// do aparelho (db.config) e nunca entram em mensagem, console ou URL. No navegador vira o objeto global Ajustes.
var Ajustes = (function () {
  var Din = typeof Dinheiro !== "undefined" ? Dinheiro : require("./dinheiro.js");
  var TEXTOS = {
    url_vazio: "Cole o endereço da ponte.",
    url_sem_https: "O endereço precisa começar com https://.",
    codigo_vazio: "Digite o código deste celular.",
    sem_internet: "Sem internet. O app envia quando a conexão voltar.",
    tempo_esgotado: "A ponte demorou para responder. O app tenta de novo.",
    ponte_inacessivel: "Não consegui falar com a ponte, mesmo com internet. Confira o endereço em Ajustes e tente de novo.",
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
      case "ponte_inacessivel": return res("erro", "i-atencao", TEXTOS.ponte_inacessivel);
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
      var r = resp && typeof resp === "object" ? resp : {};
      var ia = r.ok === true && r.dados && typeof r.dados === "object" ? usoValido(r.dados.ia) : null;
      var semInternet = r.ok !== true && !!r.erro && r.erro.codigo === "sem_internet";
      return { conferido: resultado.tom === "ok", resultado: resultado, uso: ia, semInternet: semInternet };
    }).catch(function () {
      return { conferido: false, resultado: textoDoResultado({ ok: false, local: true, erro: { codigo: "resposta_estranha" } }) };
    });
  }

  // ---- Gasto do mês (#97): o app só mostra o que o script contou; não soma, não corta ----
  var MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  var USO = {
    titulo: "Gasto do mês",
    vazio_titulo: "Sem informação ainda",
    vazio_apoio: "Toque em “Testar ligação” para ver o gasto do mês.",
    perto: "Perto do limite",
    perto_apoio: "Falta pouco para o limite deste mês.",
    atingido: "Limite atingido",
    atingido_apoio: "A IA volta no começo do próximo mês.",
    sem_internet: "Sem internet. Este é o último valor que o app recebeu.",
    nota: "O limite é combinado em família e fica no script; o app só mostra.",
  };
  var CHAVES_USO = { gasto: "ia_gasto_centavos", teto: "ia_teto_centavos", mes: "ia_mes" };

  function inteiroDe0(n) {
    return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= Din.MAXIMO;
  }

  // dados.ia da ponte -> { gasto_centavos, teto_centavos, mes } ou null (ausente, texto, negativo, teto 0, mês ruim).
  function usoValido(ia) {
    if (!ia || typeof ia !== "object" || Array.isArray(ia)) return null;
    var g = ia.gasto_centavos, t = ia.teto_centavos, m = ia.mes;
    if (!inteiroDe0(g) || !inteiroDe0(t) || t < 1) return null;
    if (typeof m !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return null;
    return { gasto_centavos: g, teto_centavos: t, mes: m };
  }

  function mesDeHoje(hoje) {
    var d = hoje instanceof Date && !isNaN(hoje.getTime()) ? hoje : new Date();
    return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1);
  }

  // Como o bloco "Gasto do mês" fica. opcoes: { hoje: Date, semInternet: boolean }.
  // nivel: normal (menos de 80%), perto (80% a menos de 100%), atingido (100% ou mais).
  // estilo: o nivel, ou "antigo" quando o valor é de um mês anterior (aí não mostra selo de nível), ou "vazio".
  function usoDoMes(ia, opcoes) {
    var o = opcoes || {};
    var u = usoValido(ia);
    if (!u) {
      return { visivel: false, texto: "", estilo: "vazio", titulo: USO.vazio_titulo, apoio: USO.vazio_apoio, nota: USO.nota };
    }
    var pct = Math.floor(u.gasto_centavos * 100 / u.teto_centavos);
    var nivel = pct >= 100 ? "atingido" : pct >= 80 ? "perto" : "normal";
    var antigo = u.mes < mesDeHoje(o.hoje);
    var valor = Din.formatar(u.gasto_centavos), teto = Din.formatar(u.teto_centavos);
    var aviso = null;
    if (antigo) {
      var nome = MESES[Number(u.mes.slice(5, 7)) - 1];
      aviso = { icone: "i-espera", texto: "Valor de " + nome + ". " + (o.semInternet ? "Sem internet para atualizar." : "Toque em “Testar ligação” para atualizar.") };
    } else if (o.semInternet) {
      aviso = { icone: "i-semnet", texto: USO.sem_internet };
    }
    var mostraNivel = !antigo && nivel !== "normal";
    return {
      visivel: true,
      texto: USO.titulo + ": " + valor + " de " + teto,
      valor: valor, teto: "de " + teto, pct: pct, barra: Math.min(100, pct), pctTexto: pct + "% do limite",
      nivel: nivel, estilo: antigo ? "antigo" : nivel,
      selo: mostraNivel ? USO[nivel] : "", apoio: mostraNivel ? USO[nivel + "_apoio"] : "",
      aviso: aviso, nota: USO.nota,
    };
  }

  // Guarda o último valor recebido (só se válido) em db.config. Devolve true se gravou.
  function guardarUso(db, ia) {
    var u = usoValido(ia);
    if (!u) return Promise.resolve(false);
    return db.config.definir(CHAVES_USO.gasto, u.gasto_centavos).then(function () {
      return db.config.definir(CHAVES_USO.teto, u.teto_centavos);
    }).then(function () {
      return db.config.definir(CHAVES_USO.mes, u.mes);
    }).then(function () { return true; });
  }

  // Lê o último valor guardado: { gasto_centavos, teto_centavos, mes } ou null.
  function lerUsoGuardado(db) {
    return Promise.all([db.config.obter(CHAVES_USO.gasto), db.config.obter(CHAVES_USO.teto), db.config.obter(CHAVES_USO.mes)]).then(function (v) {
      return usoValido({ gasto_centavos: v[0], teto_centavos: v[1], mes: v[2] });
    }).catch(function () { return null; });
  }

  // Depois do Testar ligação: grava o valor novo (se veio) ou lê o último guardado, e devolve como o bloco fica.
  function usoAposTeste(db, teste, hoje) {
    var t = teste || {};
    var base = t.uso ? guardarUso(db, t.uso).catch(function () {}).then(function () { return t.uso; }) : lerUsoGuardado(db);
    return base.then(function (ia) { return usoDoMes(ia, { hoje: hoje, semInternet: !!t.semInternet && !t.uso }); });
  }

  // Ao abrir os Ajustes: mostra o último valor guardado.
  function usoGuardado(db, hoje) {
    return lerUsoGuardado(db).then(function (ia) { return usoDoMes(ia, { hoje: hoje }); });
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
    textoDoResultado: textoDoResultado, testarLigacao: testarLigacao,
    usoValido: usoValido, usoDoMes: usoDoMes, guardarUso: guardarUso, lerUsoGuardado: lerUsoGuardado, usoAposTeste: usoAposTeste, usoGuardado: usoGuardado, compararVersoes: compararVersoes, buscarAtualizacao: buscarAtualizacao };
})();
if (typeof module !== "undefined") module.exports = Ajustes;
