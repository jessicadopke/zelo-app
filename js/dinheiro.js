// Zelo: dinheiro em centavos inteiros (lógica pura, testada com node --test). No navegador vira o objeto global Dinheiro.
// Nunca usa parseFloat nem "* 100": a conta é feita sobre o texto, para não errar centavo.
var Dinheiro = (function () {
  var MAXIMO = 1000000000; // contrato 4: de 1 a 10^9 centavos

  function valido(n) {
    return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAXIMO;
  }

  // "R$ 1.234,56" -> 123456. Texto inválido -> null (nunca lança erro).
  function paraCentavos(texto) {
    if (typeof texto !== "string") return null;
    var t = texto.replace(/^[\s ]+|[\s ]+$/g, "");
    t = t.replace(/^R\$[\s ]*/, "");
    var inteiro, frac = "";
    var virgulas = t.split(",").length - 1;
    if (virgulas > 1) return null;
    if (virgulas === 1) {
      var partes = t.split(",");
      inteiro = partes[0];
      frac = partes[1];
      if (!/^\d{1,2}$/.test(frac)) return null;
      if (!/^(\d{1,3}(\.\d{3})+|\d+)$/.test(inteiro)) return null;
    } else if (/^\d+$/.test(t)) {
      inteiro = t;
    } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
      inteiro = t; // ponto seguido de 3 dígitos = milhar
    } else if (/^\d+\.\d{1,2}$/.test(t)) {
      var i = t.indexOf(".");
      inteiro = t.slice(0, i);
      frac = t.slice(i + 1); // ponto seguido de 1 ou 2 dígitos no fim = decimal
    } else {
      return null;
    }
    inteiro = inteiro.replace(/\./g, "");
    while (frac.length < 2) frac += "0";
    var n = Number(inteiro + frac);
    return valido(n) ? n : null;
  }

  function checar(centavos) {
    if (typeof centavos !== "number" || !Number.isInteger(centavos)) {
      throw new TypeError("Dinheiro: o valor precisa ser um número inteiro de centavos.");
    }
  }

  // 123456 -> "1.234,56" (sem o símbolo)
  function formatarCampo(centavos) {
    checar(centavos);
    var neg = centavos < 0;
    var abs = Math.abs(centavos);
    var reais = String(Math.floor(abs / 100));
    var cents = String(abs % 100);
    if (cents.length < 2) cents = "0" + cents;
    reais = reais.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (neg ? "-" : "") + reais + "," + cents;
  }

  // 1000 -> "R$ 10,00" (espaço comum; a tela usa white-space: nowrap)
  function formatar(centavos) {
    return "R$ " + formatarCampo(centavos);
  }

  return { MAXIMO: MAXIMO, valido: valido, paraCentavos: paraCentavos, formatar: formatar, formatarCampo: formatarCampo };
})();
if (typeof module !== "undefined") module.exports = Dinheiro;
