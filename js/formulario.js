// Zelo: regras do formulário de lançamento (#18, parte A): valor em centavos, data AAAA-MM-DD, textos e aviso de dado proibido.
// Sem DOM, sem banco e sem relógio próprio (a data de hoje entra em ctx.hoje): quem desenha e grava é js/app.js.
// A regra de dado proibido é cópia da de apps-script/validar.js (contrato seção 9); um teste prova que as duas dão o mesmo resultado.
// No navegador vira o objeto global Formulario.
var Formulario = (function () {
  var Din = typeof Dinheiro !== "undefined" ? Dinheiro : require("./dinheiro.js");
  var Dat = typeof Datas !== "undefined" ? Datas : require("./datas.js");
  var Som = typeof Somas !== "undefined" ? Somas : require("./somas.js");

  var CAMPOS = ["tipo", "valor", "data", "favorecido", "categoria", "pessoa", "forma", "cartao", "caixinha"];
  var LIMITE = { favorecido: 80, categoria: 40, pessoa: 40, forma: 30, cartao: 40, caixinha: 40 };
  var TIPOS = ["entrou", "saiu", "fatura", "guardou", "tirou", "saldo"];

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
    fora_da_lista: "Escolha uma das opções da lista.",
    escolha_cartao: "Escolha o cartão.",
    escolha_caixinha: "Escolha a caixinha.",
    sem_cartao: "Este tipo não usa cartão.",
    sem_caixinha: "Este tipo não usa caixinha.",
    so_um: "Escolha só o cartão ou só a caixinha.",
    forma_cartao: "cartão",
    fatura_maior: "Este valor é maior que o que está em aberto ({v}). Pode salvar se for isso mesmo.",
    fatura_zero: "Este cartão não tem nada em aberto agora. Confira se as compras foram lançadas. Pode salvar se for isso mesmo.",
    fatura_negativo: "Este cartão já está pago a mais ({v}). Confira se as compras foram lançadas. Pode salvar se for isso mesmo."
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

  var PLURAL = { categoria: "categorias", pessoa: "pessoas", forma: "formas", cartao: "cartoes", caixinha: "caixinhas" };

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
    if (TIPOS.indexOf(tipo) >= 0) reg.tipo = tipo; else erros.tipo = TEXTOS.tipo;

    var v = conferirValor(c.valor);
    // Só o saldo conferido aceita zero.
    if (v.erro === TEXTOS.valor_zero && tipo === "saldo") { v = { centavos: 0 }; }
    if (v.erro) erros.valor = v.erro; else reg.valor_centavos = v.centavos;

    var d = conferirData(c.data, x.hoje);
    if (d.erro) erros.data = d.erro; else { reg.data = d.data; if (d.aviso) avisos.data = d.aviso; }

    var f = conferirTexto("favorecido", c.favorecido, true);
    if (f.erro) erros.favorecido = f.erro; else reg.favorecido = f.valor;

    ["categoria", "pessoa", "forma", "cartao", "caixinha"].forEach(function (campo) {
      var r = conferirOpcao(campo, c[campo], x);
      if (r.erro) erros[campo] = r.erro; else reg[campo] = r.valor;
    });

    // Combinações da tabela 4.2 (as mesmas do script). Só olha se os dois campos passaram na checagem de forma.
    if (reg.cartao !== undefined && reg.caixinha !== undefined && reg.tipo) {
      if (reg.tipo === "fatura") {
        if (!reg.cartao) erros.cartao = TEXTOS.escolha_cartao;
        else if (reg.caixinha) erros.caixinha = TEXTOS.sem_caixinha;
      } else if (reg.tipo === "guardou" || reg.tipo === "tirou") {
        if (!reg.caixinha) erros.caixinha = TEXTOS.escolha_caixinha;
        else if (reg.cartao) erros.cartao = TEXTOS.sem_cartao;
      } else if (reg.tipo === "saldo") {
        if (reg.cartao && reg.caixinha) erros.caixinha = TEXTOS.so_um;
      } else if (reg.caixinha) {
        erros.caixinha = TEXTOS.sem_caixinha;
      }
    }

    var ok = Object.keys(erros).length === 0;
    var saida = { ok: ok, erros: erros, avisos: avisos };
    if (ok) {
      saida.registro = {
        tipo: reg.tipo, valor_centavos: reg.valor_centavos, data: reg.data, favorecido: reg.favorecido,
        categoria: reg.categoria, pessoa: reg.pessoa, forma: reg.forma
      };
      // Cartão e caixinha só entram no registro quando têm valor, ou para limpar o que o lançamento já tinha (ctx.manter).
      ["cartao", "caixinha"].forEach(function (campo) {
        var tinha = x.manter && typeof x.manter[campo] === "string" && x.manter[campo] !== "";
        if (reg[campo] || tinha) saida.registro[campo] = reg[campo] || "";
      });
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
    var saida = {
      tipo: TIPOS.indexOf(x.tipo) >= 0 ? x.tipo : "saiu",
      valor: typeof x.valor_centavos === "number" && Number.isInteger(x.valor_centavos) ? Din.formatarCampo(x.valor_centavos) : "",
      data: texto(x.data), favorecido: texto(x.favorecido), categoria: texto(x.categoria), pessoa: texto(x.pessoa), forma: texto(x.forma),
    };
    if (texto(x.cartao)) saida.cartao = texto(x.cartao);
    if (texto(x.caixinha)) saida.caixinha = texto(x.caixinha);
    return saida;
  }

  // Só o que mudou entre o lançamento guardado e o registro validado (nomes do registro guardado).
  function diferenca(original, registro) {
    var o = original || {}, r = registro || {}, saida = {};
    ["tipo", "valor_centavos", "data", "favorecido", "categoria", "pessoa", "forma", "cartao", "caixinha"].forEach(function (k) {
      var antes = k === "valor_centavos" ? o[k] : texto(o[k]);
      if (r[k] !== undefined && r[k] !== antes) saida[k] = r[k];
    });
    return saida;
  }

  // O lançamento aberto foi alterado depois (por outro celular)? Compara editado_em.
  function alteradoDepois(aberto, atual) {
    return !!(aberto && atual && typeof atual.editado_em === "string" && atual.editado_em > aberto.editado_em);
  }

  // ---- #37 P4: cartão e pagamento de fatura (tudo puro; a tela só desenha) ----

  // Ajusta o que a tela leu antes de validar, sem mexer no que a pessoa digitou na tela:
  // - fatura: favorecido sozinho ("Fatura <cartão>"); categoria, pessoa e forma ficam vazias (o tipo não usa);
  // - saiu no cartão: forma "cartão" sozinha (e aceita mesmo que a planilha não tenha essa forma na lista).
  // Devolve { campos, ctx } novos; os de entrada não mudam.
  function preparar(campos, ctx) {
    var c = {};
    Object.keys(campos || {}).forEach(function (k) { c[k] = campos[k]; });
    var x = {};
    Object.keys(ctx || {}).forEach(function (k) { x[k] = ctx[k]; });
    var cartao = aparar(c.cartao);
    if (aparar(c.tipo) === "fatura") {
      c.favorecido = cartao ? "Fatura " + cartao : "Fatura";
      c.categoria = ""; c.pessoa = ""; c.forma = "";
    } else if (aparar(c.tipo) === "saiu" && cartao) {
      c.forma = TEXTOS.forma_cartao;
      var o = x.opcoes;
      if (o && Array.isArray(o.formas) && o.formas.indexOf(TEXTOS.forma_cartao) < 0) {
        var copia = {};
        Object.keys(o).forEach(function (k) { copia[k] = o[k]; });
        copia.formas = o.formas.concat([TEXTOS.forma_cartao]);
        x.opcoes = copia;
      }
    }
    return { campos: c, ctx: x };
  }

  // Quanto falta pagar no cartão até a data, sem contar o lançamento exceto (o próprio pagamento, no Editar). Centavos (pode ser negativo).
  function emAberto(lancamentos, cartao, ate, exceto) {
    var lista = (lancamentos || []).filter(function (l) { return l && (exceto === undefined || exceto === null || l.id !== exceto); });
    var r = Som.saldos(lista, Dat.valida(ate) ? ate : "2099-12-31");
    for (var i = 0; i < r.cartoes.length; i++) if (r.cartoes[i].cartao === cartao) return r.cartoes[i].em_aberto;
    return 0;
  }

  // Aviso amarelo do valor da fatura (nunca bloqueia). Sem valor válido ou sem aviso: "".
  function avisoFatura(valorCentavos, aberto) {
    if (typeof valorCentavos !== "number" || !Number.isInteger(valorCentavos) || valorCentavos <= 0) return "";
    if (aberto > 0) return valorCentavos > aberto ? TEXTOS.fatura_maior.replace("{v}", Din.formatar(aberto)) : "";
    if (aberto === 0) return TEXTOS.fatura_zero;
    return TEXTOS.fatura_negativo.replace("{v}", Din.formatar(-aberto));
  }

  // Valor que já vem preenchido no Pagar fatura: o em aberto se for maior que zero; senão vazio.
  function valorSugerido(aberto) {
    return typeof aberto === "number" && aberto > 0 ? Din.formatarCampo(aberto) : "";
  }

  // Textos que mudam com o tipo: título, rótulos de valor e data.
  function textosDoTipo(tipo, editar) {
    if (tipo === "fatura") {
      return { titulo: editar ? "Editar pagamento de fatura" : "Pagar fatura", valor: "Valor pago", data: "Data do pagamento", apagar: "Apagar pagamento" };
    }
    return { titulo: editar ? "Editar lançamento" : "Novo lançamento", valor: "Valor", data: "Data", apagar: "Apagar lançamento" };
  }

  // Cartão do último gasto (saiu) lançado, se ainda está na lista da planilha; "" = Conta (também no primeiro uso).
  function ultimoCartao(lancamentos, opcoes) {
    var achado = maisRecentesPrimeiro(lancamentos).filter(function (l) { return l.tipo === "saiu"; })[0];
    var nome = achado ? texto(achado.cartao) : "";
    return nome && opcoes && Array.isArray(opcoes.cartoes) && opcoes.cartoes.indexOf(nome) >= 0 ? nome : "";
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
    padroes: padroes, sugerir: sugerir, favorecidosRecentes: favorecidosRecentes,
    preparar: preparar, emAberto: emAberto, avisoFatura: avisoFatura, valorSugerido: valorSugerido, textosDoTipo: textosDoTipo, ultimoCartao: ultimoCartao
  };
})();
if (typeof module !== "undefined") module.exports = Formulario;
