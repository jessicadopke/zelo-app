// Zelo: porta de entrada das telas para os lançamentos (criar, editar, apagar, desfazer, listar).
// Camada fina sobre Db e Fila: não há segunda lógica de gravação. Apagar é só marcar (apagado: "sim"); nada some de verdade.
// No navegador vira o objeto global Lancamentos.
var Lancamentos = (function () {
  var Fil = typeof Fila !== "undefined" ? Fila : require("./fila.js");

  function criar(db, dados, relogio) {
    return Fil.criar(db, dados, relogio);
  }
  function editar(db, id, mudancas, relogio) {
    return Fil.editar(db, id, mudancas, relogio);
  }

  function naoEncontrado() {
    var e = new Error("Não achei este lançamento.");
    e.codigo = "nao_encontrado";
    return e;
  }

  // Mais novo primeiro: por data, depois por editado_em e, por fim, por id (crescente). O id desempata para que
  // lançamentos importados em lote (mesma data e mesmo editado_em) não troquem de lugar a cada desenho.
  function ordenar(lista) {
    return lista.slice().sort(function (a, b) {
      if (a.data !== b.data) return a.data < b.data ? 1 : -1;
      if (a.editado_em !== b.editado_em) return a.editado_em < b.editado_em ? 1 : -1;
      if (a.id !== b.id) return a.id < b.id ? -1 : 1;
      return 0;
    });
  }
  function visiveis(lista) {
    return ordenar(lista.filter(function (l) { return l.apagado !== "sim"; }));
  }

  // Marca como apagado e põe na fila com o registro inteiro. Já apagado: não faz nada.
  function apagar(db, id, relogio) {
    return db.lancamentos.obter(id).then(function (atual) {
      if (!atual) throw naoEncontrado();
      if (atual.apagado === "sim") return atual;
      return Fil.editar(db, id, { apagado: "sim" }, relogio);
    });
  }

  // Desfazer o apagar é permitido (contrato 5): volta apagado "" com editado_em mais novo.
  function desfazerApagar(db, id, relogio) {
    return db.lancamentos.obter(id).then(function (atual) {
      if (!atual) throw naoEncontrado();
      if (atual.apagado !== "sim") return atual;
      return Fil.editar(db, id, { apagado: "" }, relogio);
    });
  }

  function listar(db, mes) {
    return db.lancamentos.doMes(mes).then(visiveis);
  }
  function todosVisiveis(db) {
    return db.lancamentos.todos().then(visiveis);
  }

  return { criar: criar, editar: editar, apagar: apagar, desfazerApagar: desfazerApagar, listar: listar, todosVisiveis: todosVisiveis, ordenar: ordenar };
})();
if (typeof module !== "undefined") module.exports = Lancamentos;
