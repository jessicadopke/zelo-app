// Zelo: "possível duplicado" na leitura de comprovante (#100, parte 2). Função pura, sem tela e sem banco.
// Compara uma linha lida com os lançamentos que já existem no aparelho (cópia local e fila). Só valor, tipo, data e favorecido:
// nada do arquivo é guardado nem comparado (sem hash). Possível duplicado é aviso, nunca bloqueio. No navegador vira o objeto global Duplicado.
var Duplicado = (function () {
  var JANELA_DIAS = 3;

  // Igual ao normalizarNome do script (apps-script/comprovante.js): minúsculas, sem acento, sem "Pix para" etc., espaços únicos.
  function normalizarNome(texto) {
    var t = String(texto === null || texto === undefined ? "" : texto).toLowerCase();
    t = t.normalize ? t.normalize("NFD").replace(/[̀-ͯ]/g, "") : t;
    t = t.replace(/\s+/g, " ").trim();
    var prefixo = /^(pix (recebido de|recebido|enviado para|enviado|para|de)|ted (para|de)|doc (para|de)|transferencia (recebida de|enviada para|para|de)|pagamento (para|a|de))\s+/;
    var anterior;
    do { anterior = t; t = t.replace(prefixo, ""); } while (t !== anterior);
    return t.replace(/\s+/g, " ").trim();
  }

  // Saída = saiu e fatura (uma fatura antiga está como saiu); entrada = entrou. Os outros tipos nunca entram.
  function grupo(tipo) {
    if (tipo === "saiu" || tipo === "fatura") return "saida";
    if (tipo === "entrou") return "entrada";
    return "";
  }

  function diasDe(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof iso === "string" ? iso : "");
    return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
  }

  // linha: { tipo, valor_centavos, data, favorecido } (campos como a pessoa vê agora). lancamento: registro do aparelho.
  function pareceDuplicado(linha, lancamento) {
    if (!linha || !lancamento || lancamento.apagado === "sim") return false;
    var g = grupo(linha.tipo);
    if (g === "" || g !== grupo(lancamento.tipo)) return false;
    if (!Number.isInteger(linha.valor_centavos) || linha.valor_centavos !== lancamento.valor_centavos) return false;
    var a = diasDe(linha.data), b = diasDe(lancamento.data);
    if (a === null || b === null || Math.abs(a - b) > JANELA_DIAS) return false;
    var f1 = normalizarNome(linha.favorecido), f2 = normalizarNome(lancamento.favorecido);
    if (f1 === "" || f2 === "") return false; // favorecido vazio não compara; ao preencher, confere de novo
    return f1 === f2 || f1.indexOf(f2) >= 0 || f2.indexOf(f1) >= 0;
  }

  // existentes: foto tirada quando a proposta chega. idsDestaLeitura: ids que esta leitura já gerou (não se comparam entre si;
  // quando uma é salva, ela passa a existir no aparelho, mas o aviso das irmãs não muda: a foto de existentes é a do início).
  function acharParecido(linha, existentes, idsDestaLeitura) {
    var meus = idsDestaLeitura || [];
    var lista = existentes || [];
    for (var i = 0; i < lista.length; i++) {
      if (meus.indexOf(lista[i].id) >= 0) continue;
      if (pareceDuplicado(linha, lista[i])) return lista[i];
    }
    return null;
  }

  return { JANELA_DIAS: JANELA_DIAS, normalizarNome: normalizarNome, grupo: grupo, pareceDuplicado: pareceDuplicado, acharParecido: acharParecido };
})();
if (typeof module !== "undefined") module.exports = Duplicado;
