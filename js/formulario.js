// Zelo: regras do formulário de lançamento (#18, parte A): valor em centavos, data AAAA-MM-DD, textos e aviso de dado proibido.
// Sem DOM, sem banco e sem relógio próprio (a data de hoje entra em ctx.hoje): quem desenha e grava é js/app.js.
// A regra de dado proibido é cópia da de apps-script/validar.js (contrato seção 9); um teste prova que as duas dão o mesmo resultado.
// No navegador vira o objeto global Formulario.
var Formulario = (function () {
  var Din = typeof Dinheiro !== "undefined" ? Dinheiro : require("./dinheiro.js");
  var Dat = typeof Datas !== "undefined" ? Datas : require("./datas.js");

  var CAMPOS = ["tipo", "valor", "data", "favorecido", "categoria", "pessoa", "forma"];
  var LIMITE = { favorecido: 80, categoria: 40, pessoa: 40, forma: 30 };

  var TEXTOS = {
    tipo: "Escolha se entrou ou saiu dinheiro.",
    valor_vazio: "Digite o valor.",
    valor_zero: "O valor precisa ser maior que zero.",
    valor_estranho: "Não entendi o valor. Escreva assim: 10,00",
    valor_grande: "O valor é grande demais.",
    data_vazia: "Escolha a data.",
    data_invalida: "Esta data não existe. Escolha outra.",
    data_longe: "Esta data está bem longe. Confira.",
    favorecido_vazio: "Escreva quem recebeu ou quem pagou.",
    texto_grande: "O nome pode ter até {n} letras.",
    controle: "O texto não pode ter quebra de linha.",
    formula: "O texto não pode começar com =, +, - ou @.",
    proibido: "Isto parece número de documento, cartão, telefone ou boleto. Tire os números e escreva só o nome.",
    fora_da_lista: "Escolha uma das opções da lista."
  };

  var RE_CONTROLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
  var RE_BLOCO = /\d(?:[\u0020\u00a0.,-]?\d)*/g;
  var RE_TELEFONE_DDD = /\(\d{2}\) ?\d{4,5}[ -]?\d{4}/;

  function texto(v) { return typeof v === "string" ? v : ""; }
  function aparar(v) { return texto(v).replace(/^\s+|\s+$/g, ""); }

  // Bloco numérico com 10 ou mais dígitos, ou telefone com DDD entre parênteses (contrato seção 9).
  function pareceDadoProibido(t) {
    t = texto(t);
    if (RE_TELEFONE_DDD.test(t)) return true;
    var blocos = t.match(RE_BLOCO) || [];
    for (var i = 0; i < blocos.length; i++) {
      if (blocos[i].replace(/\D/g, "").length >= 10) return true;
    }
    return false;
  }

  // Devolve { erro } ou { centavos }. Nunca usa parseFloat nem "* 100": a conta é do Dinheiro.
  function conferirValor(bruto) {
    var t = aparar(bruto);
    if (t === "") return { erro: TEXTOS.valor_vazio };
    var c = Din.paraCentavos(t);
    if (c !== null) return { centavos: c };
    var s = t.replace(/^R\$\s*/, "");
    var forma = /^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(s) || /^\d+\.\d{1,2}$/.test(s);
    if (!forma) return { erro: TEXTOS.valor_estranho };
    if (/^[0.]*(,0{1,2})?$/.test(s) || /^0+\.0{1,2}$/.test(s)) return { erro: TEXTOS.valor_zero };
    return { erro: TEXTOS.valor_grande };
  }

  // Mesmo dia e mês, um ano depois (AAAA-MM-DD compara certo como texto).
  function umAnoDepois(hoje) {
    return String(Number(hoje.slice(0, 4)) + 1) + hoje.slice(4);
  }

  function conferirData(bruta, hoje) {
    var t = aparar(bruta);
    if (t === "") return { erro: TEXTOS.data_vazia };
    var iso = Dat.deTexto(t);
    if (iso === null) return { erro: TEXTOS.data_invalida };
    var aviso = null;
    if (typeof hoje === "string" && Dat.valida(hoje) && iso > umAnoDepois(hoje)) aviso = TEXTOS.data_longe;
    return { data: iso, aviso: aviso };
  }

  // Favorecido (obrigatório) e os textos de categoria/pessoa/forma passam pela mesma checagem de forma.
  function conferirTexto(campo, bruto, obrigatorio) {
    var original = texto(bruto);
    if (RE_CONTROLE.test(original)) return { erro: TEXTOS.controle };
    var t = aparar(original);
    if (t === "") return obrigatorio ? { erro: TEXTOS.favorecido_vazio } : { valor: "" };
    if (pareceDadoProibido(t)) return { erro: TEXTOS.proibido };
    if (t.length > LIMITE[campo]) return { erro: TEXTOS.texto_grande.replace("{n}", String(LIMITE[campo])) };
    if ("=+-@".indexOf(t.charAt(0)) >= 0) return { erro: TEXTOS.formula };
    return { valor: t };
  }

  var PLURAL = { categoria: "categorias", pessoa: "pessoas", forma: "formas" };

  // Opcional: precisa estar na lista da planilha, ou ser o valor que o lançamento já tinha (ctx.manter).
  function conferirOpcao(campo, bruto, ctx) {
    var r = conferirTexto(campo, bruto, false);
    if (r.erro || r.valor === "") return r;
    var manter = ctx.manter && typeof ctx.manter[campo] === "string" ? ctx.manter[campo] : "";
    if (r.valor === manter) return r;
    var lista = ctx.opcoes ? ctx.opcoes[PLURAL[campo]] : null;
    if (!Array.isArray(lista) || lista.indexOf(r.valor) < 0) return { erro: TEXTOS.fora_da_lista };
    return r;
  }

  // campos: os textos como a pessoa digitou. ctx: { opcoes: { categorias, pessoas, formas } | null, hoje, manter? }
  // Devolve { ok, erros, avisos, registro } (registro só se ok), pronto para Lancamentos.criar/editar.
  function validar(campos, ctx) {
    var c = campos || {};
    var x = ctx || {};
    var erros = {}, avisos = {}, reg = {};

    var tipo = aparar(c.tipo);
    if (tipo === "entrou" || tipo === "saiu") reg.tipo = tipo; else erros.tipo = TEXTOS.tipo;

    var v = conferirValor(c.valor);
    if (v.erro) erros.valor = v.erro; else reg.valor_centavos = v.centavos;

    var d = conferirData(c.data, x.hoje);
    if (d.erro) erros.data = d.erro; else { reg.data = d.data; if (d.aviso) avisos.data = d.aviso; }

    var f = conferirTexto("favorecido", c.favorecido, true);
    if (f.erro) erros.favorecido = f.erro; else reg.favorecido = f.valor;

    ["categoria", "pessoa", "forma"].forEach(function (campo) {
      var r = conferirOpcao(campo, c[campo], x);
      if (r.erro) erros[campo] = r.erro; else reg[campo] = r.valor;
    });

    var ok = Object.keys(erros).length === 0;
    var saida = { ok: ok, erros: erros, avisos: avisos };
    if (ok) {
      saida.registro = {
        tipo: reg.tipo, valor_centavos: reg.valor_centavos, data: reg.data, favorecido: reg.favorecido,
        categoria: reg.categoria, pessoa: reg.pessoa, forma: reg.forma
      };
    }
    return saida;
  }

  // Primeiro campo com erro, na ordem da tela (para levar o foco até ele). Sem erro: null.
  function primeiroErro(erros) {
    for (var i = 0; i < CAMPOS.length; i++) {
      if (erros && Object.prototype.hasOwnProperty.call(erros, CAMPOS[i])) return CAMPOS[i];
    }
    return null;
  }

  // Estado inicial de um Novo. Não escreve em lugar nenhum.
  function vazio(ctx) {
    return { tipo: "saiu", valor: "", data: ctx && typeof ctx.hoje === "string" ? ctx.hoje : "", favorecido: "", categoria: "", pessoa: "", forma: "" };
  }

  // A pessoa mexeu em algo? (para perguntar antes de descartar)
  function mudou(inicial, atual) {
    var a = inicial || {}, b = atual || {};
    for (var i = 0; i < CAMPOS.length; i++) {
      if (texto(a[CAMPOS[i]]) !== texto(b[CAMPOS[i]])) return true;
    }
    return false;
  }

  // Rótulos que mudam com o tipo (só o texto da tela; os campos guardados são os mesmos).
  function rotulos(tipo) {
    return tipo === "entrou"
      ? { favorecido: "Quem pagou", pessoa: "Quem recebeu" }
      : { favorecido: "Quem recebeu", pessoa: "Quem pagou" };
  }

  // Lançamento guardado -> textos da tela (valor com vírgula, data AAAA-MM-DD).
  function deLancamento(l) {
    var x = l || {};
    return {
      tipo: x.tipo === "entrou" ? "entrou" : "saiu",
      valor: typeof x.valor_centavos === "number" && Number.isInteger(x.valor_centavos) ? Din.formatarCampo(x.valor_centavos) : "",
      data: texto(x.data), favorecido: texto(x.favorecido), categoria: texto(x.categoria), pessoa: texto(x.pessoa), forma: texto(x.forma)
    };
  }

  // Só o que mudou entre o lançamento guardado e o registro validado (nomes do registro guardado).
  function diferenca(original, registro) {
    var o = original || {}, r = registro || {}, saida = {};
    ["tipo", "valor_centavos", "data", "favorecido", "categoria", "pessoa", "forma"].forEach(function (k) {
      var antes = k === "valor_centavos" ? o[k] : texto(o[k]);
      if (r[k] !== undefined && r[k] !== antes) saida[k] = r[k];
    });
    return saida;
  }

  // O lançamento aberto foi alterado depois (por outro celular)? Compara editado_em.
  function alteradoDepois(aberto, atual) {
    return !!(aberto && atual && typeof atual.editado_em === "string" && atual.editado_em > aberto.editado_em);
  }

  // ---- parte E: padrões e sugestões (funções puras, só leem a lista que recebem) ----
  function semAcento(s) {
    var d = texto(s).normalize ? texto(s).normalize("NFD") : texto(s);
    var fora = "";
    for (var i = 0; i < d.length; i++) { var c = d.charCodeAt(i); if (c < 768 || c > 879) fora += d.charAt(i); }
    return fora.toLowerCase().replace(/\s+/g, " ").replace(/^ | $/g, "");
  }
  function maisRecentesPrimeiro(lancamentos) {
    return (lancamentos || []).filter(function (l) { return l && l.apagado !== "sim"; }).sort(function (a, b) {
      return texto(a.editado_em) < texto(b.editado_em) ? 1 : texto(a.editado_em) > texto(b.editado_em) ? -1 : 0;
    });
  }
  function nasOpcoes(opcoes, plural, valor) {
    return !!(opcoes && Array.isArray(opcoes[plural]) && opcoes[plural].indexOf(valor) >= 0);
  }

  // Valores iniciais de um Novo: pessoa e forma do lançamento mais recente que ainda estejam nas listas da planilha.
  function padroes(lancamentos, ctx) {
    var x = ctx || {};
    var saida = { tipo: "saiu", data: typeof x.hoje === "string" ? x.hoje : "", pessoa: "", forma: "" };
    maisRecentesPrimeiro(lancamentos).forEach(function (l) {
      if (!saida.pessoa && l.pessoa && nasOpcoes(x.opcoes, "pessoas", l.pessoa)) saida.pessoa = l.pessoa;
      if (!saida.forma && l.forma && nasOpcoes(x.opcoes, "formas", l.forma)) saida.forma = l.forma;
    });
    return saida;
  }

  // Favorecido já usado (igual, sem diferença de maiúscula ou acento, a partir de 2 letras): categoria, pessoa e forma do mais recente.
  // Com opcoes, valor que saiu da planilha volta vazio (decisão 8). Sem sugestão: null.
  function sugerir(lancamentos, textoDigitado, opcoes) {
    var chave = semAcento(textoDigitado);
    if (chave.length < 2) return null;
    var achado = maisRecentesPrimeiro(lancamentos).filter(function (l) { return semAcento(l.favorecido) === chave; })[0];
    if (!achado) return null;
    function filtrar(plural, v) { return v && (!opcoes || nasOpcoes(opcoes, plural, v)) ? v : ""; }
    return {
      favorecido: achado.favorecido,
      categoria: filtrar("categorias", achado.categoria),
      pessoa: filtrar("pessoas", achado.pessoa),
      forma: filtrar("formas", achado.forma)
    };
  }

  // Nomes já usados, do mais recente, sem repetidos (até 8). Com texto de 2 letras ou mais, só os que combinam.
  function favorecidosRecentes(lancamentos, textoDigitado, limite) {
    var chave = semAcento(textoDigitado);
    var vistos = {}, saida = [];
    maisRecentesPrimeiro(lancamentos).forEach(function (l) {
      var nome = texto(l.favorecido), k = semAcento(nome);
      if (!k || vistos[k] || saida.length >= 8) return;
      vistos[k] = true;
      saida.push({ nome: nome, k: k });
    });
    if (chave.length >= 2) saida = saida.filter(function (s) { return s.k.indexOf(chave) >= 0 && s.k !== chave; });
    else saida = [];
    return saida.slice(0, typeof limite === "number" ? limite : 4).map(function (s) { return s.nome; });
  }

  return {
    CAMPOS: CAMPOS, TEXTOS: TEXTOS, validar: validar, pareceDadoProibido: pareceDadoProibido, primeiroErro: primeiroErro, vazio: vazio, mudou: mudou,
    rotulos: rotulos, deLancamento: deLancamento, diferenca: diferenca, alteradoDepois: alteradoDepois,
    padroes: padroes, sugerir: sugerir, favorecidosRecentes: favorecidosRecentes
  };
})();
if (typeof module !== "undefined") module.exports = Formulario;
