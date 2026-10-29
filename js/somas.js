// Zelo: somas do mês (lógica pura, sem tela, rede nem banco). No navegador vira o objeto global Somas.
// Dinheiro em centavos inteiros; "saldo" é o único valor com sinal. Os mesmos exemplos (tests/exemplos/somas.json) valem para o script da Etapa 4.
var Somas = (function () {
  var Din = typeof Dinheiro !== "undefined" ? Dinheiro : require("./dinheiro.js");
  var Dat = typeof Datas !== "undefined" ? Datas : require("./datas.js");

  function mesValido(mes) {
    return typeof mes === "string" && /^\d{4}-\d{2}$/.test(mes) && Dat.valida(mes + "-01");
  }

  function texto(v) {
    return typeof v === "string" ? v.replace(/^\s+|\s+$/g, "") : "";
  }

  function somarNa(grupos, nome, tipo, valor) {
    var g = grupos[nome];
    if (!g) g = grupos[nome] = { nome: nome, entrou: 0, saiu: 0 };
    g[tipo] += valor;
  }

  // Maior "saiu" primeiro; empate, maior "entrou"; empate, nome pt-BR; nome vazio sempre por último.
  function comparar(a, b) {
    if (a.nome === "" && b.nome !== "") return 1;
    if (b.nome === "" && a.nome !== "") return -1;
    if (a.saiu !== b.saiu) return b.saiu - a.saiu;
    if (a.entrou !== b.entrou) return b.entrou - a.entrou;
    return a.nome.localeCompare(b.nome, "pt-BR");
  }

  function lista(grupos, chave) {
    return Object.keys(grupos).map(function (k) { return grupos[k]; }).sort(comparar).map(function (g) {
      var o = {};
      o[chave] = g.nome;
      o.entrou = g.entrou;
      o.saiu = g.saiu;
      return o;
    });
  }

  function resumoDoMes(lancamentos, mes) {
    if (!mesValido(mes)) throw new TypeError("Mês inválido: use AAAA-MM.");
    if (!Array.isArray(lancamentos)) throw new TypeError("Os lançamentos devem vir em uma lista.");
    var entrou = 0, saiu = 0, quantidade = 0, ignorados = 0;
    var cats = Object.create(null), pessoas = Object.create(null);

    lancamentos.forEach(function (l) {
      if (l === null || typeof l !== "object") { ignorados++; return; }
      if (l.apagado === "sim") return;
      if (!Dat.valida(l.data)) { ignorados++; return; }
      if (Dat.mes(l.data) !== mes) return;
      if ((l.tipo !== "entrou" && l.tipo !== "saiu") || !Din.valido(l.valor_centavos)) { ignorados++; return; }
      if (l.tipo === "entrou") entrou += l.valor_centavos; else saiu += l.valor_centavos;
      quantidade++;
      somarNa(cats, texto(l.categoria), l.tipo, l.valor_centavos);
      somarNa(pessoas, texto(l.pessoa), l.tipo, l.valor_centavos);
    });

    return {
      mes: mes,
      entrou: entrou,
      saiu: saiu,
      saldo: entrou - saiu,
      quantidade: quantidade,
      ignorados: ignorados,
      porCategoria: lista(cats, "categoria"),
      porPessoa: lista(pessoas, "pessoa")
    };
  }

  return { resumoDoMes: resumoDoMes };
})();
if (typeof module !== "undefined") module.exports = Somas;
